// Same-origin JSON calls for the 지식 · 코드 · 일정 screens (local experiment mode only).
export async function call<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, { method: method ?? (body === undefined ? "GET" : "POST"), cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `요청이 실패했어요 (${res.status})`);
  return data as T;
}
/** Run after the effect returns (so state set by `run` is not set synchronously inside the effect). */
export function later(run: () => void, ms = 0) { const t = setTimeout(run, ms); return () => clearTimeout(t); }
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export type KState = "met" | "unknown" | "known";
export const STATE_LABEL: Record<KState, string> = { met: "만남", unknown: "몰랐음", known: "앎" };
export type Folder = { id: string; name: string; parentId: string | null; order: number; note: string };
export type KKind = "concept" | "procedure" | "fact" | "formula" | "vocab";
export const KIND_LABEL: Record<KKind, string> = { concept: "개념·용어", procedure: "절차·방법", fact: "사실·수치", formula: "공식", vocab: "어휘" };
export type ItemLite = { id: string; title: string; state: KState; graduated: boolean; folderId: string | null; updatedAt: string; lastAt: string; line: string; links: number; weak: number; dueAt?: string; kind?: KKind };
/** 목표 (2026-10-28 "4개 축"): why and until when; its 자료 bring their items. */
export type SourceKindName = "pdf" | "web" | "code" | "chat" | "manual";
export type GoalSource = { key: string; kind: SourceKindName; title: string };
export type GoalView = { id: string; name: string; date: string | null; closed: boolean; sources: GoalSource[]; itemIds: string[]; note: string; daysLeft: number | null;
  counts: { total: number; unknown: number; known: number; met: number; graduated: number; due: number } };
export type Material = { key: string; kind: SourceKindName; title: string; items: number; itemIds: string[]; lastAt: string; goals: string[]; ignored: boolean;
  suggestion: { goalId: string; name: string; reason: string } | null };
export const SOURCE_LABEL: Record<SourceKindName, string> = { pdf: "PDF", web: "웹 글", code: "코드", chat: "대화", manual: "직접" };
export const dday = (n: number | null) => n === null ? "" : n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
/** What the review session says when nothing is due: how many are due now and when the next one comes. */
export type ReviewStatus = { due: number; next: string | null };
/** "내일 오후 3시", "3일 뒤", "11월 2일" — when the next review comes, in the learner's words. */
export function whenText(iso: string, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return "";
  const mins = Math.ceil((t - now) / 60000);
  if (mins <= 0) return "지금";
  if (mins < 60) return `${mins}분 뒤`;
  const d = new Date(t), today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const hour = d.getHours(), clock = `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}시`;
  if (days === 0) return `오늘 ${clock}`;
  if (days === 1) return `내일 ${clock}`;
  if (days < 7) return `${days}일 뒤`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
export type Tree = { folders: Folder[]; items: ItemLite[] };
export type KEvent = { id: string; at: string; knowledgeId: string; kind: "met" | "asked" | "wrong" | "hint" | "correct" | "note"; detail: string; source?: { kind: string; title: string } };
export const EVENT_LABEL: Record<KEvent["kind"], string> = { met: "만남", asked: "물어봄", wrong: "틀림", hint: "힌트 받음", correct: "맞힘", note: "메모" };
export type Knowledge = { id: string; title: string; body: string; folderId: string | null; state: KState; graduated: boolean; aliases: string[]; kind?: KKind;
  example?: string; explain?: string;
  links: Array<{ to: string; relation: string; note?: string }>; sources: Array<{ kind: string; title: string; ref?: string; url?: string; page?: number; quote?: string; at: string }>;
  stats: { asked: number; wrong: number; hint: number; correct: number; correctDays: string[] }; createdAt: string; updatedAt: string; lastAt: string;
  review?: { algorithm: "leitner"; box: number; dueAt: string; repetitions: number; lapses: number } };
export type Detail = { item: Knowledge; path: string; links: Array<{ to: string; relation: string; note?: string; item: ItemLite }>; backlinks: Array<{ relation: string; note?: string; item: ItemLite }>; events: KEvent[];
  /** 가까운 지식: close, but no clear link (AI 판정 "가까움"). */
  near?: Array<{ id: string; title: string; line: string }> };
export type Question = { id: string; kind: "flashcard" | "choice" | "ox" | "blank" | "short" | "recognize"; label: string; knowledgeId: string; prompt: string; context?: string;
  options?: string[]; answer: string; accept?: string[]; explain: string };
export type Graded = { correct: boolean; expected: string; note: string };

/** Paths of folders, for pickers: "주식 / 금리". */
export function folderPaths(folders: Folder[]) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string) => { const parts: string[] = []; let cur = byId.get(id); let guard = 0; while (cur && guard++ < 20) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; } return parts.join(" / "); };
  return folders.map((f) => ({ id: f.id, path: pathOf(f.id) })).sort((a, b) => a.path.localeCompare(b.path, "ko"));
}
/** Tell the rest of the app (the old screen, the sidebar) to go somewhere. */
/** What a "go" asked the next screen to open (a screen mounted after the event reads it from here). */
export const handoff: { start?: "pdf" | "web" | "code"; webId?: string; codeId?: string; knowledgeId?: string } = {};
export function go(view: string, detail: { kind?: "pdf" | "web" | "code"; id?: string } = {}) {
  if (view === "start") handoff.start = detail.kind;
  if (view === "web" && detail.id) handoff.webId = detail.id;
  if (view === "code" && detail.id) handoff.codeId = detail.id;
  if (view === "knowledge" && detail.id) handoff.knowledgeId = detail.id;
  window.dispatchEvent(new CustomEvent("recaller:go", { detail: { view, ...detail } }));
  const name = { web: "recaller:web-open", code: "recaller:code-open", knowledge: "recaller:knowledge-focus" }[view];
  if (name && detail.id) setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail: { id: detail.id } })), 60);
}
export type ScreenContext = { view: string; title: string; refs: string[]; knowledgeIds: string[]; problemId?: string; selection?: string; text?: string };
export function shareContext(context: ScreenContext) { window.dispatchEvent(new CustomEvent("recaller:context", { detail: context })); }
