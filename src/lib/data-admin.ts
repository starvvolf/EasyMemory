// 데이터 관리 (11/9 사용자 "데이터 관리할 수 있게 간단하게, 조그만 탭에서, 비울 건 내가 비울 수 있게"):
// 이 컴퓨터의 데이터 폴더(STUDY_FORGE_DATA_DIR, 보통 ../RecallerData)에 무엇이 얼마나 있는지, 동기화 상태를 보여 주고
// 비우기는 지우지 않고 보관/<날짜-이름>/으로 옮긴다(scripts/recaller-data.mjs와 같은 방식). 보관/은 동기화하지 않는다(.gitignore),
// 그래서 보관한 것은 이 컴퓨터에만 남고 다른 컴퓨터에서는 다음 받기 때 사라진다. 보관본 지우기만 진짜로 지운다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = () => process.cwd();
export const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() ? path.resolve(root(), process.env.STUDY_FORGE_DATA_DIR.trim()) : path.join(root(), ".study-forge-data");
const syncOff = () => path.join(root(), "tmp", "no-data-sync");
const ARCHIVE = "보관";
// 비우기(전부)에서도 그대로 두는 것: git·설정 파일, 보관본, 이 PC의 실험 기록
const KEEP = new Set([".git", ".gitignore", ".gitattributes", "README.md", ARCHIVE, "ai-calls", "lab"]);

async function sizeOf(p: string): Promise<{ bytes: number; files: number }> {
  let s; try { s = await stat(p); } catch { return { bytes: 0, files: 0 }; }
  if (!s.isDirectory()) return { bytes: s.size, files: 1 };
  let bytes = 0, files = 0;
  for (const e of await readdir(p)) { if (e === ".git") continue; const x = await sizeOf(path.join(p, e)); bytes += x.bytes; files += x.files; }
  return { bytes, files };
}
const readJson = async <T>(p: string): Promise<T | null> => { try { return JSON.parse(await readFile(p, "utf8")) as T; } catch { return null; } };

function run(cmd: string, args: string[], cwd: string, ms = 90000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    const take = (b: Buffer) => { out += b.toString(); };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, out: `${out}\n(시간 초과)` }); }, ms);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, out: String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim() }); });
  });
}

export type DataItem = { path: string; title: string; detail: string; bytes: number; at?: string };
export type DataView = {
  dir: string; total: number; files: number;
  sync: { repo: boolean; on: boolean; last?: string; changes?: number };
  groups: Array<{ key: string; label: string; bytes: number; items: DataItem[]; note?: string }>;
  archives: Array<{ name: string; bytes: number; files: number }>;
};

export async function dataView(): Promise<DataView> {
  const dir = dataDir();
  const repo = existsSync(path.join(dir, ".git"));
  const sync: DataView["sync"] = { repo, on: !existsSync(syncOff()) };
  if (repo) {
    const last = await run("git", ["-C", dir, "log", "-1", "--format=%cd · %s", "--date=format:%m/%d %H:%M"], dir, 10000);
    if (last.ok) sync.last = last.out.split("\n")[0];
    const st = await run("git", ["-C", dir, "status", "--porcelain"], dir, 20000);
    if (st.ok) sync.changes = st.out ? st.out.split("\n").length : 0;
  }
  // 자료 (만든 지식·문제)
  const gens: DataItem[] = [];
  const genRoot = path.join(dir, "study-gen");
  for (const g of existsSync(genRoot) ? (await readdir(genRoot)).filter((x) => /^gen_[a-z0-9]+$/.test(x)) : []) {
    const st = await readJson<{ input?: { fileName?: string; pageNumbers?: number[] }; createdAt?: string; status?: string }>(path.join(genRoot, g, "state.json"));
    const sz = await sizeOf(path.join(genRoot, g));
    gens.push({ path: `study-gen/${g}`, title: (st?.input?.fileName ?? g).replace(/\.pdf$/i, ""), detail: `${st?.input?.pageNumbers?.length ?? "?"}쪽 · ${st?.status ?? ""}`, bytes: sz.bytes, ...(st?.createdAt ? { at: st.createdAt } : {}) });
  }
  gens.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // 등록한 PDF
  const pdfs: DataItem[] = [];
  const srcRoot = path.join(dir, "mcp-sources");
  for (const f of existsSync(srcRoot) ? (await readdir(srcRoot)).filter((x) => /^src_[a-f0-9]{64}\.pdf$/.test(x)) : []) {
    const id = f.replace(/\.pdf$/, "");
    const meta = await readJson<{ fileName?: string; pageCount?: number; createdAt?: string }>(path.join(srcRoot, `${id}.json`));
    const s = await stat(path.join(srcRoot, f));
    pdfs.push({ path: `mcp-sources/${id}`, title: meta?.fileName ?? id.slice(0, 16), detail: `${meta?.pageCount ?? "?"}쪽`, bytes: s.size, at: meta?.createdAt ?? s.mtime.toISOString() });
  }
  pdfs.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // 알고리즘 문제
  const probs: DataItem[] = [];
  const pRoot = path.join(dir, "code", "problems");
  for (const f of existsSync(pRoot) ? (await readdir(pRoot)).filter((x) => /^cp_[\w-]+\.json$/.test(x) && !x.endsWith(".tests.json")) : []) {
    const id = f.replace(/\.json$/, "");
    const p = await readJson<{ title?: string; createdAt?: string }>(path.join(pRoot, f));
    const a = await sizeOf(path.join(pRoot, f)), b = await sizeOf(path.join(pRoot, `${id}.tests.json`));
    probs.push({ path: `code/problems/${id}`, title: p?.title ?? id, detail: b.bytes ? "테스트 있음" : "", bytes: a.bytes + b.bytes, ...(p?.createdAt ? { at: p.createdAt } : {}) });
  }
  // 그 밖(기록·지식·일정 등): 크기만
  const others: DataItem[] = [];
  for (const e of await readdir(dir)) {
    if (KEEP.has(e) || ["study-gen", "mcp-sources", "code"].includes(e)) continue;
    const s = await sizeOf(path.join(dir, e)); others.push({ path: e, title: e, detail: `${s.files}개 파일`, bytes: s.bytes });
  }
  const codeRest = await sizeOf(path.join(dir, "code")); const pBytes = probs.reduce((n, x) => n + x.bytes, 0);
  if (codeRest.bytes - pBytes > 0) others.push({ path: "code", title: "code(풀이 기록 등)", detail: "", bytes: codeRest.bytes - pBytes });
  for (const e of ["ai-calls", "lab"]) { const s = await sizeOf(path.join(dir, e)); if (s.bytes) others.push({ path: e, title: `${e} (이 PC에만)`, detail: "AI 호출 기록·실험실 설정", bytes: s.bytes }); }
  const sum = (xs: DataItem[]) => xs.reduce((n, x) => n + x.bytes, 0);
  const archives: DataView["archives"] = [];
  const aRoot = path.join(dir, ARCHIVE);
  for (const a of existsSync(aRoot) ? await readdir(aRoot) : []) { const s = await sizeOf(path.join(aRoot, a)); archives.push({ name: a, ...s }); }
  archives.sort((a, b) => b.name.localeCompare(a.name));
  const live = await sizeOf(dir), arch = await sizeOf(aRoot);
  return { dir, total: live.bytes - arch.bytes, files: live.files - arch.files, sync,
    groups: [
      { key: "gens", label: "만든 자료(지식·문제)", bytes: sum(gens), items: gens },
      { key: "pdfs", label: "등록한 PDF", bytes: sum(pdfs), items: pdfs, note: "PDF를 보관하면 그 PDF로 만든 자료의 쪽 보기·그림이 안 열린다." },
      { key: "probs", label: "알고리즘 문제", bytes: sum(probs), items: probs },
      { key: "others", label: "기록·그 밖", bytes: sum(others), items: others, note: "풀이 기록·지식·일정 같은 것. 여기서는 크기만 본다." },
    ], archives };
}

const stamp = () => { const d = new Date(); const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const ALLOWED = /^(study-gen\/gen_[a-z0-9]+|mcp-sources\/src_[a-f0-9]{64}|code\/problems\/cp_[\w-]+)$/;
async function moveInto(dir: string, dest: string, rel: string) {
  const from = path.join(dir, rel), to = path.join(dest, rel);
  if (!existsSync(from)) return false;
  await mkdir(path.dirname(to), { recursive: true }); await rename(from, to); return true;
}

/** 고른 것을 보관/<날짜>-정리/로 옮긴다. PDF는 .pdf·.json, 문제는 .json·.tests.json을 같이. */
export async function archiveItems(paths: string[]): Promise<{ label: string; moved: string[] }> {
  const dir = dataDir();
  const ok = [...new Set(paths)].filter((p) => ALLOWED.test(p));
  if (!ok.length) throw Object.assign(new Error("보관할 것을 고르지 않았어요."), { status: 400 });
  const label = `${stamp()}-정리`, dest = path.join(dir, ARCHIVE, label);
  const moved: string[] = [];
  for (const p of ok) {
    const parts = p.startsWith("mcp-sources/") ? [`${p}.pdf`, `${p}.json`] : p.startsWith("code/problems/") ? [`${p}.json`, `${p}.tests.json`] : [p];
    let any = false; for (const x of parts) any = (await moveInto(dir, dest, x)) || any;
    if (any) moved.push(p);
  }
  return { label, moved };
}

/** 지금 데이터를 전부 보관하고 비운다(설정·보관본·이 PC 실험 기록은 그대로). 다음에 켤 때 앱 창의 브라우저 기록도 한 번 비운다. */
export async function archiveAll(): Promise<{ label: string; moved: string[] }> {
  const dir = dataDir();
  const entries = (await readdir(dir)).filter((e) => !KEEP.has(e));
  if (!entries.length) throw Object.assign(new Error("비울 데이터가 없어요."), { status: 400 });
  const label = `${stamp()}-비우기`, dest = path.join(dir, ARCHIVE, label);
  await mkdir(dest, { recursive: true });
  for (const e of entries) await rename(path.join(dir, e), path.join(dest, e));
  await mkdir(path.join(root(), "tmp"), { recursive: true });
  await writeFile(path.join(root(), "tmp", "fresh-start"), label);
  return { label, moved: entries };
}

/** 보관본 하나를 진짜로 지운다(되돌릴 수 없음). 보관/ 바로 아래 이름만. */
export async function deleteArchive(name: string) {
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) throw Object.assign(new Error("보관본 이름이 올바르지 않아요."), { status: 400 });
  const p = path.join(dataDir(), ARCHIVE, name);
  if (!existsSync(p)) throw Object.assign(new Error("그 보관본이 없어요."), { status: 404 });
  await rm(p, { recursive: true, force: true });
}

export async function setSync(on: boolean) {
  if (on) { try { await unlink(syncOff()); } catch { /* already on */ } }
  else { await mkdir(path.dirname(syncOff()), { recursive: true }); await writeFile(syncOff(), "11/9 데이터 관리에서 끔\n"); }
}

/** 지금 올리기: 앱을 끄지 않고 scripts/recaller-sync.mjs push. */
export async function pushNow() {
  if (existsSync(syncOff())) throw Object.assign(new Error("이 컴퓨터는 동기화가 꺼져 있어요. 먼저 켜 주세요."), { status: 409 });
  return run(process.execPath, [path.join(root(), "scripts", "recaller-sync.mjs"), "push"], root(), 120000);
}
