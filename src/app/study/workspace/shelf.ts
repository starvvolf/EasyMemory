// 자료 목록 하나를 공부 탭과 기억 탭이 같이 쓴다 (11/12 사용자 "공부 탭이랑 기억 탭이 자연스럽게 이어지게" → "같은 틀, 두 얼굴").
// 같은 목록 · 같은 순서 · 같은 묶음(같은 PDF는 최신 하나 + 예전 것), 고른 자료도 두 탭이 함께 기억한다.
import { call } from "./api";
import type { MaterialRow } from "./KnowledgeWindow";

export type ShelfRow = MaterialRow & { pages?: number };
export type ShelfEntry = { key: string; branch: "material"; icon: string; title: string; sub: string; lastAt: string; itemIds: string[]; row: ShelfRow; pages?: number; older?: ShelfEntry[] };
type GenRun = { id: string; createdAt: string; status: string; fileName: string; pages: number[]; sectionCount?: number };

/** 기억 탭이 쓰던 그대로: PDF는 실제로 만든 자료(study-gen, 다 됐거나 기억까지 된 것), 기억은 같은 자료 줄(genId)에서. 나머지 갈래 줄은 그대로. */
export async function loadShelfRows(): Promise<MaterialRow[]> {
  const [v, g] = await Promise.all([call<{ materials: MaterialRow[] }>("/api/knowledge/material-view"),
    call<{ runs: GenRun[] }>("/api/lab/gen?origin=study").catch(() => ({ runs: [] as GenRun[] }))]);
  const pdfRows = v.materials.filter((r) => r.group === "material" && r.kind === "pdf");
  const pdfs: ShelfRow[] = g.runs.filter((r) => r.status === "done" || r.status === "cards").map((r) => {
    const same = pdfRows.find((x) => x.genId === r.id);
    return { key: `gen:${r.id}`, group: "material", kind: "pdf", title: r.fileName.replace(/\.pdf$/i, ""), items: same?.items ?? r.sectionCount ?? 0, itemIds: same?.itemIds ?? [],
      lastAt: same?.lastAt && same.lastAt > r.createdAt ? same.lastAt : r.createdAt, keys: same?.keys ?? [], folderId: null, genId: r.id, pages: r.pages.length };
  });
  return [...pdfs, ...v.materials.filter((r) => !(r.group === "material" && r.kind === "pdf"))];
}

/** 자료 갈래 목록: 최신이 위, 같은 PDF(같은 제목 · 같은 쪽 수)를 여러 번 만들었으면 최신 하나만 줄에 두고 나머지는 older로. */
export function materialEntries(rows: MaterialRow[]): ShelfEntry[] {
  const all: ShelfEntry[] = rows.filter((r) => r.group === "material").map((r) => {
    const pages = (r as ShelfRow).pages;
    return { key: r.key, branch: "material", row: r as ShelfRow, itemIds: r.itemIds, lastAt: r.lastAt, title: r.title, pages,
      icon: r.kind === "web" ? "🌐" : "📄", sub: r.key.startsWith("gen:") ? `${pages ?? "?"}쪽` : `기억 ${r.items}` };
  });
  const latest = new Map<string, ShelfEntry>();
  for (const e of all.sort((a, b) => b.lastAt.localeCompare(a.lastAt))) {
    const k = e.key.startsWith("gen:") ? `${e.title}|${e.pages ?? ""}` : e.key;
    const top = latest.get(k);
    if (top) (top.older ??= []).push(e); else latest.set(k, e);
  }
  return [...latest.values()].map((e) => (e.older?.length ? { ...e, sub: `${e.sub} · ${e.older.length + 1}번 만듦` } : e));
}

/** 두 탭이 함께 기억하는 "고른 자료"(목록 줄 key, 예: gen:<id>). 바뀌면 recaller:shelf-sel 이벤트. */
const SEL = "recaller:shelf-sel";
export const shelfSel = {
  get(): string | null { try { return localStorage.getItem(SEL); } catch { return null; } },
  set(key: string | null) {
    try { if (key) localStorage.setItem(SEL, key); else localStorage.removeItem(SEL); } catch { /* storage off */ }
    window.dispatchEvent(new CustomEvent(SEL, { detail: key }));
  },
  on(fn: (key: string | null) => void) { const h = (e: Event) => fn((e as CustomEvent<string | null>).detail); window.addEventListener(SEL, h); return () => window.removeEventListener(SEL, h); },
};
/** 갈래(자료 · 알고리즘 · 실습)도 두 탭이 같이: 공부에서 알고리즘을 보다 기억으로 가면 기억도 알고리즘. */
export const BRANCH_KEY = "recaller:lib-branch";
export function setBranch(b: "material" | "code" | "project") {
  try { localStorage.setItem(BRANCH_KEY, b); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("recaller:branch", { detail: b }));
}
/** 목록 줄 key가 가리키는 자료 id (gen:<id> → <id>) */
export const genOfKey = (key: string | null | undefined) => (key && key.startsWith("gen:") ? key.slice(4) : null);
/** 공부 › 실습 목록에서 누른 실습: 실습 화면이 열리면 그 실습의 편집기 · 튜터로 (ProjectStudy가 읽고 비운다) */
export const projectOpen: { id: string | null } = { id: null };
