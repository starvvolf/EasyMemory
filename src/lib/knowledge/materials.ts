// 자료 보기 (지식 창 왼쪽, 2026-10-30 사용자: "자료가 먼저, 누르면 그 자료의 지도", "자료 폴더 정리 가능하게").
// 지식이 어디서 왔는지(출처)를 한 줄씩: 자료(PDF·웹 글), 프로젝트(같은 코스는 하나로), 코드 문제(같은 제목은 하나로).
// 줄마다 지도를 여는 데 필요한 것을 붙인다: PDF는 가장 최근 생성 id(자료 지도), 웹 글은 읽은 글 id(글 지도), 프로젝트는
// 단계별 지식. 학습자가 만든 자료 폴더(이름·순서)와 어느 줄이 어느 폴더에 있는지는 material-folders.json에 둔다.
// 보는 방법일 뿐이다: 지식은 주제 트리에 한 번 있다.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { listMaterials } from "./goals.ts";
import { getSource, sourceIdOf } from "./sources.ts";
import { KnowledgeError, readAll, readEvents } from "./store.ts";

export type MaterialGroup = "material" | "project" | "code";
export type MaterialRow = {
  key: string; group: MaterialGroup; kind: string; title: string; items: number; itemIds: string[]; lastAt: string;
  /** The source keys underneath (a project course run more than once, a code problem opened more than once). */
  keys: string[];
  folderId: string | null;
  /** PDF: the newest engine material (gen_…) its knowledge came from, for 자료 지도. */
  genId?: string;
  /** 웹 글: the read article (글 지도). */
  sourceId?: string;
  /** 프로젝트: the knowledge by the course stage it first came up in. */
  stages?: Array<{ name: string; itemIds: string[] }>;
};
export type MaterialFolder = { id: string; name: string; order: number };
type FolderFile = { folders: MaterialFolder[]; place: Record<string, string> };

const PROJECT_PREFIX = "프로젝트 코스: ";
const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge", "material-folders.json");
async function read(): Promise<FolderFile> {
  try { const d = JSON.parse(await readFile(file(), "utf8")) as Partial<FolderFile>; return { folders: d.folders ?? [], place: d.place ?? {} }; }
  catch { return { folders: [], place: {} }; }
}
const lock = globalThis as unknown as { __materialFolders?: Promise<unknown> };
function change<T>(run: (data: FolderFile) => T): Promise<T> {
  const next = (lock.__materialFolders ?? Promise.resolve()).then(async () => {
    const data = await read();
    const out = run(data);
    await mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 1), "utf8");
    await rename(tmp, file());
    return out;
  });
  lock.__materialFolders = next.catch(() => undefined);
  return next;
}

/** Code problem titles opened more than once ("BOJ 1003번: 피보나치 함수", "피보나치 함수") read as one. */
const codeName = (title: string) => title.replace(/^BOJ\s*\d+\s*번?\s*:\s*/i, "").trim();

/** Every 자료 row with what its map needs, and the learner's folders. */
export async function materialView() {
  const [materials, { items }, folders, events] = await Promise.all([listMaterials(), readAll(), read(), readEvents()]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: MaterialRow[] = [];
  const merged = new Map<string, MaterialRow>();
  const add = (key: string, row: Omit<MaterialRow, "key" | "folderId">) => {
    const have = merged.get(key);
    if (!have) { const r = { ...row, key, folderId: null }; merged.set(key, r); rows.push(r); return r; }
    have.keys.push(...row.keys);
    have.itemIds = [...new Set([...have.itemIds, ...row.itemIds])]; have.items = have.itemIds.length;
    if (row.lastAt > have.lastAt) have.lastAt = row.lastAt;
    return have;
  };
  for (const m of materials) {
    const base = { kind: m.kind, title: m.title, items: m.items, itemIds: m.itemIds, lastAt: m.lastAt, keys: [m.key] };
    if (m.kind === "code" && m.key.startsWith("code:project:")) {
      const title = m.title.startsWith(PROJECT_PREFIX) ? m.title.slice(PROJECT_PREFIX.length) : m.title;
      add(`project:${title}`, { ...base, title, group: "project" });
    } else if (m.kind === "code") add(`code:${codeName(m.title)}`, { ...base, title: codeName(m.title), group: "code" });
    else add(m.key, { ...base, group: m.kind === "pdf" || m.kind === "web" ? "material" : "code" });
  }
  for (const r of rows) {
    const mine = r.itemIds.map((id) => byId.get(id)).filter((i) => i !== undefined);
    if (r.kind === "pdf") {
      // The newest engine material: the gen_ ref prefix with the latest meeting time.
      let best = "", at = "";
      for (const i of mine) for (const s of i.sources) if (s.kind === "pdf" && s.title === r.title && s.ref?.startsWith("gen_") && s.at >= at) { best = s.ref.split(":")[0]; at = s.at; }
      if (best) r.genId = best;
    }
    if (r.kind === "web") {
      const s = mine.flatMap((i) => i.sources).find((x) => x.kind === "web" && x.title === r.title);
      const id = s ? sourceIdOf(s.url ?? "", s.title) : "";
      if (id && await getSource(id)) r.sourceId = id;
    }
    if (r.group === "project") {
      // The stage an item first came up in, from its record ("2단계 · …"); items with none go under "기타".
      const refs = new Set(mine.flatMap((i) => i.sources).filter((s) => s.ref?.startsWith("project:")).map((s) => s.ref!));
      const stageOf = new Map<string, number>();
      for (const e of events) {
        if (!r.itemIds.includes(e.knowledgeId) || (e.source?.ref && !refs.has(e.source.ref))) continue;
        const n = Number(/^(\d+)단계/.exec(e.detail)?.[1] ?? NaN);
        if (Number.isFinite(n) && (!stageOf.has(e.knowledgeId) || n < stageOf.get(e.knowledgeId)!)) stageOf.set(e.knowledgeId, n);
      }
      const nums = [...new Set(stageOf.values())].sort((a, b) => a - b);
      const rest = r.itemIds.filter((id) => !stageOf.has(id));
      r.stages = [...nums.map((n) => ({ name: `${n}단계`, itemIds: r.itemIds.filter((id) => stageOf.get(id) === n) })), ...(rest.length ? [{ name: "기타", itemIds: rest }] : [])];
    }
    const f = folders.place[r.key];
    r.folderId = f && folders.folders.some((x) => x.id === f) ? f : null;
  }
  return { materials: rows, folders: [...folders.folders].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko")) };
}

export const createMaterialFolder = (name: string) => change((d) => {
  const n = name.trim().slice(0, 60);
  if (!n) throw new KnowledgeError(400, "폴더 이름이 비어 있어요.");
  const folder = { id: `mf_${randomBytes(6).toString("hex")}`, name: n, order: (d.folders.at(-1)?.order ?? 0) + 1 };
  d.folders.push(folder);
  return folder;
});
export const renameMaterialFolder = (id: string, name: string) => change((d) => {
  const f = d.folders.find((x) => x.id === id);
  if (!f) throw new KnowledgeError(404, "폴더를 찾을 수 없어요.");
  if (name.trim()) f.name = name.trim().slice(0, 60);
  return f;
});
/** Deleting a folder puts its 자료 back outside any folder (nothing else changes). */
export const deleteMaterialFolder = (id: string) => change((d) => {
  d.folders = d.folders.filter((x) => x.id !== id);
  for (const [k, v] of Object.entries(d.place)) if (v === id) delete d.place[k];
  return { ok: true };
});
/** Put rows (by their key) in a folder, or take them out (folderId null). */
export const placeMaterials = (keys: string[], folderId: string | null) => change((d) => {
  if (folderId && !d.folders.some((x) => x.id === folderId)) throw new KnowledgeError(404, "폴더를 찾을 수 없어요.");
  for (const k of keys.slice(0, 200)) { if (folderId) d.place[k] = folderId; else delete d.place[k]; }
  return { ok: true };
});
