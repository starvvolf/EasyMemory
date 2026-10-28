// 지식 저장소 (2026-10-26, 기획: 협업/기획결정_20261026_Claude.md): what the learner has met, did not know, and knows,
// kept across every material (PDF, web article, code). One knowledge item is one thing to know. Folders hold items
// like a file tree; links between items are the "고리" (금리 → 대출 → 성장주). Events are the third memory level:
// every question asked, every wrong answer, every hint and every correct answer, newest last.
//
// Files (in STUDY_FORGE_DATA_DIR, private): knowledge/store.json (folders + items) and knowledge/events.jsonl.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * 복습 간격: the same boxes as PDF practice (src/app/study/dejipgi-app.js INTERVALS), so one piece of knowledge waits the
 * same way wherever it was met. 맞힘 moves up one box; 틀림 · 힌트 · 물어봄 go back to the first box and come again tomorrow
 * (no re-ask minutes later: 사용자 결정 2026-10-12).
 */
const MIN = 60_000, DAY = 86_400_000;
export const REVIEW_BOXES = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
export type KReview = { algorithm: "leitner"; box: number; dueAt: string; lastReviewAt: string; repetitions: number; lapses: number };
export function nextReview(current: KReview | undefined, remembered: boolean, at: Date): KReview {
  const prior = current?.algorithm === "leitner" ? current : undefined;
  const t = at.getTime();
  if (!remembered) return { algorithm: "leitner", box: 0, dueAt: new Date(t + DAY).toISOString(), lastReviewAt: at.toISOString(), repetitions: (prior?.repetitions ?? 0) + 1, lapses: (prior?.lapses ?? 0) + 1 };
  const box = Math.min((prior?.box ?? 0) + 1, REVIEW_BOXES.length - 1);
  return { algorithm: "leitner", box, dueAt: new Date(t + REVIEW_BOXES[box]).toISOString(), lastReviewAt: at.toISOString(), repetitions: (prior?.repetitions ?? 0) + 1, lapses: prior?.lapses ?? 0 };
}

export type KState = "met" | "unknown" | "known";
export const STATE_LABEL: Record<KState, string> = { met: "만남", unknown: "몰랐음", known: "앎" };
export type SourceKind = "pdf" | "web" | "code" | "chat" | "manual";
export type KSource = { kind: SourceKind; title: string; ref?: string; url?: string; page?: number; quote?: string; at: string };
/** `note`: a short 연결 문장 for the learner ("누적 합으로 구간 합을 한 번에 구한다"), from the link check. */
export type KLink = { to: string; relation: string; note?: string };
/**
 * 종류 (2026-10-28 결정 "4개 축"): how the item is learned — it decides the review questions and whether two items
 * with the same meaning are the same knowledge (어휘: never; big and large are two words to learn).
 */
export type ExplainParts = { summary: string; why: string; analogy: string; example: string; elsewhere: string };
export type KKind = "concept" | "procedure" | "fact" | "formula" | "vocab";
export const KIND_LABEL: Record<KKind, string> = { concept: "개념·용어", procedure: "절차·방법", fact: "사실·수치", formula: "공식", vocab: "어휘" };
export type KStats = { asked: number; wrong: number; hint: number; correct: number; correctDays: string[] };
export type Knowledge = {
  id: string; title: string; body: string; folderId: string | null; state: KState; graduated: boolean;
  aliases: string[]; links: KLink[]; sources: KSource[]; stats: KStats; createdAt: string; updatedAt: string; lastAt: string;
  /** When to ask again (상자 단계). Set by every 맞힘 / 틀림 / 힌트 / 물어봄; none until the first one. */
  review?: KReview;
  /** The schedule before the last result, so "내 답도 맞아요" can take a grader's miss back. */
  reviewBefore?: KReview | null;
  /** 종류; none until the item is sorted (classify.ts, a few seconds after it is saved). */
  kind?: KKind;
  /** Where the item came in (a PDF's section, an article's topic): a hint for sorting it into 주제, cleared once sorted. */
  topicHint?: string;
  /** The learner put it in this folder by hand: 주제 정리 never moves it. */
  placedByHand?: boolean;
  /**
   * 층 나누기 (2026-10-28): body is the 뜻 to recall (general, short); `example` is how it was used where it was met
   * ("이 문제에선 이름 → 누적 포인트를 O(1)에"); `explain` is a longer, easier explanation made when the learner says
   * 잘 모르겠어요. `layered`: the 뜻 was checked once for source context mixed in; `bodyBefore`: the 뜻 before that.
   */
  example?: string;
  explain?: string;
  /** 쉽게 풀어 보기의 칸들 (explain은 이것을 이은 글, 예전 데이터·검색용). */
  explainParts?: ExplainParts;
  /** 쉽게 풀어 보기와 함께 보여 줄 지식: sure = 이미 고리로 이어져 있음(먼저 알 것), 아니면 함께 알아보기. */
  explainSee?: Array<{ title: string; id: string | null; sure: boolean }>;
  layered?: boolean;
  bodyBefore?: string;
};
/** `hand`: made by the learner (+ 폴더), kept even when empty; folders made on the way by saving or sorting are not. */
export type Folder = { id: string; name: string; parentId: string | null; order: number; note: string; createdAt: string; hand?: boolean };
export type KEventKind = "met" | "asked" | "wrong" | "hint" | "correct" | "note";
export const EVENT_LABEL: Record<KEventKind, string> = { met: "만남", asked: "물어봄", wrong: "틀림", hint: "힌트 받음", correct: "맞힘", note: "메모" };
export type KEvent = { id: string; at: string; knowledgeId: string; kind: KEventKind; detail: string; source?: { kind: SourceKind; title: string; ref?: string } };
type Store = { version: 1; folders: Folder[]; items: Knowledge[] };

export class KnowledgeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/* ---------- files ---------- */
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge");
const storeFile = () => path.join(dir(), "store.json");
const eventsFile = () => path.join(dir(), "events.jsonl");
const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;
const nowIso = () => new Date().toISOString();
/** The learner's own calendar day (KST by default), so "three different days" means days the learner lived. */
export const dayOf = (iso: string, offsetMinutes = Number(process.env.RECALLER_TZ_OFFSET_MIN ?? 540)) =>
  new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);

async function readStore(): Promise<Store> {
  try {
    const data = JSON.parse(await readFile(storeFile(), "utf8")) as Store;
    return { version: 1, folders: data.folders ?? [], items: (data.items ?? []).map(fill) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, folders: [], items: [] };
    throw error;
  }
}
/**
 * Schedules saved before the 상자 방식 (2026-10-26) were FSRS (`algorithm: "fsrs"`, no box). Read them as the first box,
 * keeping their due date and counts, so "복습 n단계" never shows NaN; the next write stores the new form.
 */
function asLeitner(review: unknown): KReview | undefined {
  if (!review || typeof review !== "object") return undefined;
  const r = review as Partial<KReview> & { algorithm?: string };
  if (r.algorithm === "leitner" && Number.isInteger(r.box)) return r as KReview;
  const at = typeof r.lastReviewAt === "string" ? r.lastReviewAt : typeof r.dueAt === "string" ? r.dueAt : new Date(0).toISOString();
  return { algorithm: "leitner", box: 0, dueAt: typeof r.dueAt === "string" ? r.dueAt : at, lastReviewAt: at,
    repetitions: Number(r.repetitions) || 0, lapses: Number(r.lapses) || 0 };
}
const fill = (item: Knowledge): Knowledge => {
  const out: Knowledge = { ...item, aliases: item.aliases ?? [], links: item.links ?? [], sources: item.sources ?? [],
    stats: { ...{ asked: 0, wrong: 0, hint: 0, correct: 0, correctDays: [] as string[] }, ...(item.stats as Partial<KStats> | undefined) }, graduated: item.graduated === true, body: item.body ?? "" };
  if (item.review !== undefined) { const r = asLeitner(item.review); if (r) out.review = r; else delete out.review; }
  if (item.reviewBefore) out.reviewBefore = asLeitner(item.reviewBefore) ?? null;
  return out;
};
async function writeStore(store: Store) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${storeFile()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 1), "utf8");
  await rename(tmp, storeFile());
}
export async function readEvents(): Promise<KEvent[]> {
  try {
    return (await readFile(eventsFile(), "utf8")).split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as KEvent]; } catch { return []; } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function rewriteEvents(events: KEvent[]) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${eventsFile()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""), "utf8");
  await rename(tmp, eventsFile());
}

// One change at a time: every write reads the newest store, so two screens saving at once never lose each other's work.
const queue = globalThis as unknown as { __knowledgeQueue?: Promise<unknown> };
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = (queue.__knowledgeQueue ?? Promise.resolve()).then(run, run);
  queue.__knowledgeQueue = next.catch(() => undefined);
  return next;
}
async function change<T>(run: (store: Store) => T | Promise<T>): Promise<T> {
  return serial(async () => { const store = await readStore(); const out = await run(store); await writeStore(store); return out; });
}
/** Like change, but writes only when the run says it changed something (for tidy-ups that run on every page load). */
async function changeIf<T>(run: (store: Store) => { dirty: boolean; out: T }): Promise<T> {
  return serial(async () => { const store = await readStore(); const { dirty, out } = run(store); if (dirty) await writeStore(store); return out; });
}

/* ---------- matching: same knowledge under another wording ---------- */
/** Letters and digits only, lower case, so "기준 금리" and "기준금리" and "PER" / "per" meet. */
export const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** The PDF engine writes what a card takes and gives as ` ⟨받음: a, b / 냄: c⟩`. It becomes 고리, not text to read. */
const WIRING = /\s*⟨받음:\s*([^/⟩]*)\/\s*냄:\s*([^⟩]*)⟩/;
const stripWiring = (line: string) => line.replace(new RegExp(WIRING.source, "g"), "").trim();
function parseWiring(lines: string[]) {
  const names = (text: string) => text.split(/[,，]/).map((s) => s.trim()).filter((s) => s && s !== "-");
  for (const line of lines) { const m = WIRING.exec(line); if (m) return { takes: names(m[1]), gives: names(m[2]) }; }
  return { takes: [] as string[], gives: [] as string[] };
}
function bigrams(text: string) {
  const s = normalize(text); const out = new Map<string, number>();
  if (s.length < 2) { if (s) out.set(s, 1); return out; }
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); }
  return out;
}
/** Dice similarity of letter pairs, 0..1. Cheap and model-free; it catches spacing, endings and word order changes. */
export function similarity(a: string, b: string) {
  const x = bigrams(a), y = bigrams(b);
  let both = 0, total = 0;
  for (const [g, n] of x) { both += Math.min(n, y.get(g) ?? 0); total += n; }
  for (const n of y.values()) total += n;
  return total ? (2 * both) / total : 0;
}
const namesOf = (item: Pick<Knowledge, "title" | "aliases">) => [item.title, ...item.aliases];
/**
 * 1단계 (이름): the item this title already is — the same name after normalizing, or a very close name (≥ 0.88) for
 * names of 4+ letters. Exported for the duplicate-check evaluation, which runs it on items that are not saved.
 */
export const sameName = <T extends Pick<Knowledge, "title" | "aliases">>(items: T[], title: string, aliases: string[] = []) => sameAs(items, title, aliases);
function sameAs<T extends Pick<Knowledge, "title" | "aliases">>(items: T[], title: string, aliases: string[] = []): T | undefined {
  const wanted = [title, ...aliases].map(normalize).filter(Boolean);
  const exact = items.find((item) => namesOf(item).some((name) => wanted.includes(normalize(name))));
  if (exact) return exact;
  if (normalize(title).length < 4) return undefined;
  let best: T | undefined, score = 0;
  for (const item of items) for (const name of namesOf(item)) {
    if (normalize(name).length < 4) continue;
    const s = similarity(title, name);
    if (s > score) { score = s; best = item; }
  }
  return score >= 0.88 ? best : undefined;
}

/* ---------- folders ---------- */
function folderPath(store: Store, folderId: string | null): string[] {
  const out: string[] = []; let id = folderId; let guard = 0;
  while (id && guard++ < 50) { const f = store.folders.find((x) => x.id === id); if (!f) break; out.unshift(f.name); id = f.parentId; }
  return out;
}
export const pathOf = (store: Pick<Store, "folders">, folderId: string | null) => folderPath(store as Store, folderId).join(" / ");
function subtree(store: Store, folderId: string): Set<string> {
  const ids = new Set([folderId]); let grew = true;
  while (grew) { grew = false; for (const f of store.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }
  return ids;
}
/** "주식/금리" → the folder, made on the way if missing. */
function ensurePath(store: Store, pathText: string): string | null {
  const parts = pathText.split("/").map((p) => p.trim()).filter(Boolean).slice(0, 6);
  let parent: string | null = null;
  for (const name of parts) {
    let found: Folder | undefined = store.folders.find((f) => f.parentId === parent && normalize(f.name) === normalize(name));
    if (!found) {
      found = { id: newId("fld"), name: name.slice(0, 60), parentId: parent, order: store.folders.filter((f) => f.parentId === parent).length, note: "", createdAt: nowIso() };
      store.folders.push(found);
    }
    parent = found.id;
  }
  return parent;
}
export const createFolder = (name: string, parentId: string | null = null) => change((store) => {
  if (!name.trim()) throw new KnowledgeError(400, "폴더 이름을 적어 주세요.");
  if (parentId && !store.folders.some((f) => f.id === parentId)) throw new KnowledgeError(404, "상위 폴더를 찾을 수 없어요.");
  const folder: Folder = { id: newId("fld"), name: name.trim().slice(0, 60), parentId, order: store.folders.filter((f) => f.parentId === parentId).length, note: "", createdAt: nowIso(), hand: true };
  store.folders.push(folder);
  return folder;
});
export const updateFolder = (id: string, patch: { name?: string; parentId?: string | null; order?: number; note?: string }) => change((store) => {
  const folder = store.folders.find((f) => f.id === id);
  if (!folder) throw new KnowledgeError(404, "폴더를 찾을 수 없어요.");
  if (patch.name !== undefined) { if (!patch.name.trim()) throw new KnowledgeError(400, "폴더 이름을 적어 주세요."); folder.name = patch.name.trim().slice(0, 60); }
  if (patch.parentId !== undefined) {
    if (patch.parentId && subtree(store, id).has(patch.parentId)) throw new KnowledgeError(400, "폴더를 자기 안으로 옮길 수는 없어요.");
    if (patch.parentId && !store.folders.some((f) => f.id === patch.parentId)) throw new KnowledgeError(404, "옮길 폴더를 찾을 수 없어요.");
    folder.parentId = patch.parentId;
  }
  if (patch.order !== undefined) {
    const siblings = store.folders.filter((f) => f.parentId === folder.parentId && f.id !== id).sort((a, b) => a.order - b.order);
    siblings.splice(Math.max(0, Math.min(siblings.length, patch.order)), 0, folder);
    siblings.forEach((f, i) => { f.order = i; });
  }
  if (patch.note !== undefined) folder.note = patch.note.slice(0, 2000);
  return folder;
});
/** A deleted folder's items and sub-folders move up one level; nothing the learner knows is lost. */
export const deleteFolder = (id: string) => change((store) => {
  const folder = store.folders.find((f) => f.id === id);
  if (!folder) throw new KnowledgeError(404, "폴더를 찾을 수 없어요.");
  for (const f of store.folders) if (f.parentId === id) f.parentId = folder.parentId;
  for (const item of store.items) if (item.folderId === id) item.folderId = folder.parentId;
  store.folders = store.folders.filter((f) => f.id !== id);
  return { ok: true };
});

/* ---------- items ---------- */
export type SaveInput = {
  title: string; body?: string; state?: KState; folderId?: string | null; folder?: string; aliases?: string[];
  source?: Omit<KSource, "at"> & { at?: string }; links?: Array<{ to?: string; title?: string; relation: string }>;
  /** 종류 when the caller knows it; otherwise sorting decides. */
  kind?: KKind;
  /** No 주제 folder yet; where it came in, for sorting (classify.ts). */
  topicHint?: string;
};
export type SaveResult = { item: Knowledge; merged: boolean; created: boolean; again: boolean };

function blank(title: string): Knowledge {
  const at = nowIso();
  return { id: newId("k"), title, body: "", folderId: null, state: "met", graduated: false, aliases: [], links: [], sources: [],
    stats: { asked: 0, wrong: 0, hint: 0, correct: 0, correctDays: [] }, createdAt: at, updatedAt: at, lastAt: at };
}
const sameSource = (a: KSource, b: Omit<KSource, "at">) => (a.ref && b.ref ? a.ref === b.ref : a.kind === b.kind && a.title === b.title && (a.url ?? "") === (b.url ?? "") && (a.page ?? 0) === (b.page ?? 0));

function saveInto(store: Store, input: SaveInput, events: KEvent[]): SaveResult {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new KnowledgeError(400, "지식 이름이 비어 있어요.");
  const at = nowIso();
  const existing = sameAs(store.items, title, input.aliases);
  const item = existing ?? blank(title);
  const fromNewPlace = Boolean(existing && input.source && !existing.sources.some((s) => sameSource(s, input.source!)));
  if (!existing) store.items.push(item);
  // Saving what is already there (a code problem opened again, a page reloaded) is not "seeing it again": the item keeps
  // its place in "최근 순" unless something about it actually changed.
  const before = existing ? JSON.stringify([item.body, item.aliases, item.sources.length, item.folderId, item.state, item.graduated, item.links]) : "";
  if (input.body && (!item.body || (!existing && input.body))) item.body = input.body.trim().slice(0, 4000);
  for (const alias of [...(input.aliases ?? []), ...(existing && normalize(title) !== normalize(item.title) ? [title] : [])]) {
    const a = alias.trim().slice(0, 120);
    if (a && !namesOf(item).some((n) => normalize(n) === normalize(a))) item.aliases.push(a);
  }
  if (input.source && !item.sources.some((s) => sameSource(s, input.source!))) item.sources.push({ ...input.source, at: input.source.at ?? at });
  if (item.sources.length > 40) item.sources = item.sources.slice(-40);
  const folderId = input.folderId !== undefined ? input.folderId : input.folder ? ensurePath(store, input.folder) : undefined;
  if (folderId !== undefined && (!existing || existing.folderId === null)) item.folderId = folderId;
  // A new item takes the state it was saved with; an existing one only moves down to "몰랐음" (asked about) or up to
  // "앎" (checked) — meeting it again never erases what is known about it.
  if (!existing) item.state = input.state ?? "met";
  if (input.kind && !item.kind) item.kind = input.kind;
  if (!existing && input.topicHint && item.folderId === null) item.topicHint = input.topicHint.slice(0, 200);
  else if (input.state === "unknown" || input.state === "known") item.state = input.state;
  if (item.state === "unknown") item.graduated = false;
  for (const link of input.links ?? []) {
    const target = link.to ? store.items.find((x) => x.id === link.to) : link.title ? sameAs(store.items, link.title) ?? saveInto(store, { title: link.title, folderId: item.folderId, source: input.source }, events).item : undefined;
    if (target && target.id !== item.id && !item.links.some((l) => l.to === target.id)) item.links.push({ to: target.id, relation: link.relation.trim().slice(0, 60) || "이어짐" });
  }
  if (!existing || before !== JSON.stringify([item.body, item.aliases, item.sources.length, item.folderId, item.state, item.graduated, item.links])) { item.updatedAt = at; item.lastAt = at; }
  if (!existing || fromNewPlace) events.push({ id: newId("ev"), at, knowledgeId: item.id, kind: "met", detail: existing ? "다른 자료에서 다시 만남" : "처음 만남",
    ...(input.source ? { source: { kind: input.source.kind, title: input.source.title, ...(input.source.ref ? { ref: input.source.ref } : {}) } } : {}) });
  if (input.state === "unknown") events.push({ id: newId("ev"), at, knowledgeId: item.id, kind: "asked", detail: "저장하면서 몰랐음으로 표시" });
  return { item, merged: Boolean(existing), created: !existing, again: fromNewPlace };
}

/*
 * After a save that made new items, whoever listens is told (the duplicate check, src/lib/knowledge/dedupe.ts, which
 * the knowledge API registers). Kept on globalThis so every route bundle of the dev server shares one listener;
 * nothing listens in tests unless a test registers one.
 */
type AfterCreate = (ids: string[]) => void;
const listener = globalThis as unknown as { __knowledgeAfterCreate?: AfterCreate };
export function onKnowledgeCreated(run: AfterCreate | null) { listener.__knowledgeAfterCreate = run ?? undefined; }
function told(results: SaveResult[]) {
  const ids = results.filter((r) => r.created).map((r) => r.item.id);
  if (ids.length) try { listener.__knowledgeAfterCreate?.(ids); } catch { /* a listener never breaks a save */ }
}

export async function saveKnowledge(input: SaveInput): Promise<SaveResult> {
  const events: KEvent[] = [];
  const result = await change((store) => saveInto(store, input, events));
  await appendEvents(events);
  told([result]);
  return result;
}
/** Many at once (a whole article's knowledge): one write, results in the given order. */
export async function saveMany(inputs: SaveInput[]): Promise<SaveResult[]> {
  const events: KEvent[] = [];
  const results = await change((store) => inputs.map((input) => saveInto(store, input, events)));
  await appendEvents(events);
  told(results);
  return results;
}
async function appendEvents(events: KEvent[]) {
  if (!events.length) return;
  await serial(async () => { await mkdir(dir(), { recursive: true }); await appendFile(eventsFile(), events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8"); });
}

/**
 * Fill in what is missing without touching what the learner wrote: a meaning only where there is none, other names
 * (English name, abbreviation, the Korean name of an English term) added unless another item already goes by them.
 */
/**
 * 층 나누기 결과 넣기: a general 뜻 in body (the old one kept in bodyBefore), the source's own case in example, a 헷갈림
 * line when there was none. Every entry is marked layered so it is not asked again.
 */
export const layerKnowledge = (entries: Array<{ id: string; body?: string; example?: string; confusion?: string }>) => change((store) => {
  const changed: string[] = [];
  for (const entry of entries) {
    const item = store.items.find((x) => x.id === entry.id);
    if (!item) continue;
    const old = item.body.split("\n");
    const confusions = old.filter((l) => /^헷갈림:/.test(l.trim()));
    const meaning = entry.body?.trim();
    let touched = false;
    if (meaning && meaning !== old.filter((l) => !/^헷갈림:/.test(l.trim())).join("\n").trim()) {
      if (item.body.trim()) item.bodyBefore = item.body;
      item.body = [meaning, ...confusions].join("\n").slice(0, 4000);
      touched = true;
    }
    if (entry.confusion?.trim() && !confusions.length) { item.body = `${item.body}\n헷갈림: ${entry.confusion.trim()}`.slice(0, 4000); touched = true; }
    if (entry.example?.trim() && !item.example) { item.example = entry.example.trim().slice(0, 600); touched = true; }
    item.layered = true;
    if (touched) { item.updatedAt = nowIso(); changed.push(item.id); }
  }
  return { changed };
});
export const enrichKnowledge = (entries: Array<{ id: string; body?: string; aliases?: string[] }>) => change((store) => {
  const taken = new Map(store.items.flatMap((i) => namesOf(i).map((n) => [normalize(n), i.id] as const)));
  const changed: string[] = [];
  for (const entry of entries) {
    const item = store.items.find((x) => x.id === entry.id);
    if (!item) continue;
    let touched = false;
    if (!item.body.trim() && entry.body?.trim()) { item.body = entry.body.trim().slice(0, 4000); touched = true; }
    for (const alias of entry.aliases ?? []) {
      const a = alias.trim().slice(0, 120), key = normalize(a);
      if (!key || item.aliases.length >= 20 || (taken.has(key) && taken.get(key) !== item.id)) continue;
      if (!namesOf(item).some((n) => normalize(n) === key)) { item.aliases.push(a); taken.set(key, item.id); touched = true; }
    }
    if (touched) { item.updatedAt = nowIso(); changed.push(item.id); }
  }
  return { changed };
});
export const updateKnowledge = (id: string, patch: { title?: string; body?: string; aliases?: string[]; folderId?: string | null; kind?: KKind; example?: string; explain?: string;
  explainParts?: ExplainParts; explainSee?: Knowledge["explainSee"] }) => change((store) => {
  const item = store.items.find((x) => x.id === id);
  if (!item) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
  if (patch.title !== undefined) { if (!patch.title.trim()) throw new KnowledgeError(400, "지식 이름이 비어 있어요."); item.title = patch.title.trim().slice(0, 120); }
  if (patch.body !== undefined) item.body = patch.body.slice(0, 4000);
  if (patch.aliases !== undefined) item.aliases = [...new Set(patch.aliases.map((a) => a.trim()).filter(Boolean))].slice(0, 20);
  if (patch.folderId !== undefined) {
    if (patch.folderId && !store.folders.some((f) => f.id === patch.folderId)) throw new KnowledgeError(404, "폴더를 찾을 수 없어요.");
    item.folderId = patch.folderId;
    item.topicHint = undefined;
    item.placedByHand = true;
  }
  if (patch.kind !== undefined) item.kind = patch.kind;
  if (patch.example !== undefined) item.example = patch.example.trim().slice(0, 600) || undefined;
  if (patch.explain !== undefined) item.explain = patch.explain.trim().slice(0, 3000) || undefined;
  if (patch.explainParts !== undefined) item.explainParts = patch.explainParts;
  if (patch.explainSee !== undefined) item.explainSee = patch.explainSee.slice(0, 5);
  item.updatedAt = nowIso();
  return item;
});
export async function deleteKnowledge(id: string) {
  await change((store) => {
    if (!store.items.some((x) => x.id === id)) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
    store.items = store.items.filter((x) => x.id !== id);
    for (const item of store.items) item.links = item.links.filter((l) => l.to !== id);
  });
  await serial(async () => rewriteEvents((await readEvents()).filter((e) => e.knowledgeId !== id)));
  return { ok: true };
}
/** Two items that are one thing: the second folds into the first (names, sources, links, record). */
export async function mergeKnowledge(keepId: string, dropId: string) {
  if (keepId === dropId) throw new KnowledgeError(400, "같은 지식끼리는 합칠 수 없어요.");
  const item = await change((store) => {
    const keep = store.items.find((x) => x.id === keepId), drop = store.items.find((x) => x.id === dropId);
    if (!keep || !drop) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
    for (const name of namesOf(drop)) if (!namesOf(keep).some((n) => normalize(n) === normalize(name))) keep.aliases.push(name);
    if (!keep.body.trim()) keep.body = drop.body; else if (drop.body.trim() && !keep.body.includes(drop.body.trim())) keep.body = `${keep.body}\n\n${drop.body}`.slice(0, 4000);
    for (const s of drop.sources) if (!keep.sources.some((x) => sameSource(x, s))) keep.sources.push(s);
    for (const l of drop.links) if (l.to !== keep.id && !keep.links.some((x) => x.to === l.to)) keep.links.push(l);
    keep.stats = { asked: keep.stats.asked + drop.stats.asked, wrong: keep.stats.wrong + drop.stats.wrong, hint: keep.stats.hint + drop.stats.hint,
      correct: keep.stats.correct + drop.stats.correct, correctDays: [...new Set([...keep.stats.correctDays, ...drop.stats.correctDays])].sort() };
    const rank: Record<KState, number> = { unknown: 2, known: 1, met: 0 };
    if (rank[drop.state] > rank[keep.state] && drop.state === "unknown") keep.state = "unknown";
    store.items = store.items.filter((x) => x.id !== dropId);
    for (const other of store.items) for (const l of other.links) if (l.to === dropId) l.to = keepId;
    for (const other of store.items) other.links = other.links.filter((l, i, all) => l.to !== other.id && all.findIndex((x) => x.to === l.to) === i);
    keep.updatedAt = nowIso();
    return keep;
  });
  await serial(async () => rewriteEvents((await readEvents()).map((e) => e.knowledgeId === dropId ? { ...e, knowledgeId: keepId } : e)));
  return item;
}
export const linkKnowledge = (fromId: string, toId: string, relation: string, note?: string) => change((store) => {
  const from = store.items.find((x) => x.id === fromId), to = store.items.find((x) => x.id === toId);
  if (!from || !to) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
  if (fromId === toId) throw new KnowledgeError(400, "자기 자신과는 이을 수 없어요.");
  const existing = from.links.find((l) => l.to === toId);
  const text = note?.trim().slice(0, 120);
  if (existing) { existing.relation = relation.trim().slice(0, 60) || existing.relation; if (text) existing.note = text; }
  else from.links.push({ to: toId, relation: relation.trim().slice(0, 60) || "이어짐", ...(text ? { note: text } : {}) });
  from.updatedAt = nowIso();
  return from;
});
export const unlinkKnowledge = (fromId: string, toId: string) => change((store) => {
  const from = store.items.find((x) => x.id === fromId);
  if (!from) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
  from.links = from.links.filter((l) => l.to !== toId);
  return from;
});
/** The learner's own call: 만남 / 몰랐음 / 앎, and 졸업 (out of review, still in what they know). */
export const setKnowledgeState = (id: string, patch: { state?: KState; graduated?: boolean }) => change((store) => {
  const item = store.items.find((x) => x.id === id);
  if (!item) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
  if (patch.state) item.state = patch.state;
  if (patch.graduated !== undefined) item.graduated = patch.graduated && item.state !== "unknown" ? true : false;
  if (patch.graduated && item.state === "met") { item.state = "known"; item.graduated = true; }
  item.updatedAt = nowIso();
  return item;
});

/** Days of correct answers, since the last miss, that graduate an item from review on their own. */
export const GRADUATE_DAYS = 3;
/**
 * One thing that happened to an item. 물어봄 · 틀림 · 힌트 → 몰랐음 (and back into review); 맞힘 → 앎, and correct
 * answers on three different days in a row of misses graduate it. 만남 and 메모 change nothing but the record.
 */
export async function recordEvent(knowledgeId: string, kind: KEventKind, detail = "", source?: KEvent["source"], at = nowIso()) {
  const item = await change((store) => {
    const item = store.items.find((x) => x.id === knowledgeId);
    if (!item) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
    if (kind === "asked" || kind === "wrong" || kind === "hint") {
      item.stats[kind] += 1; item.state = "unknown"; item.graduated = false; item.stats.correctDays = [];
    } else if (kind === "correct") {
      item.stats.correct += 1; item.state = "known";
      const day = dayOf(at);
      if (!item.stats.correctDays.includes(day)) item.stats.correctDays.push(day);
      if (item.stats.correctDays.length >= GRADUATE_DAYS) item.graduated = true;
    }
    if (kind === "asked" || kind === "wrong" || kind === "hint" || kind === "correct") {
      item.reviewBefore = item.review ?? null;
      // Results can arrive out of order (two computers, a late request); a schedule only moves forward in time.
      const when = Math.max(Date.parse(at), Date.parse(item.review?.lastReviewAt ?? "") || 0);
      item.review = nextReview(item.review, kind === "correct", new Date(when));
    }
    item.lastAt = at; item.updatedAt = at;
    return item;
  });
  await appendEvents([{ id: newId("ev"), at, knowledgeId, kind, detail: detail.slice(0, 600), ...(source ? { source } : {}) }]);
  return item;
}

/** How long a 틀림 can still be taken back by "내 답도 맞아요". */
const TAKE_BACK_MS = 6 * 60 * 60 * 1000;
/**
 * "내 답도 맞아요": the last 틀림 was the grader's miss, not the learner's. It is taken back — the record line, the count
 * and the review date — and, when the answer counts as recall (not right after reading), it becomes 맞힘.
 */
export async function takeBackWrong(knowledgeId: string, asCorrect: boolean, source?: KEvent["source"], at = nowIso()) {
  const removed = await serial(async () => {
    const events = await readEvents();
    let index = -1;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].knowledgeId === knowledgeId) { if (events[i].kind === "wrong") index = i; break; }
    if (index < 0 || Date.parse(at) - Date.parse(events[index].at) > TAKE_BACK_MS) return false;
    events.splice(index, 1);
    await rewriteEvents(events);
    return true;
  });
  if (removed) await change((store) => {
    const item = store.items.find((x) => x.id === knowledgeId);
    if (!item) return;
    item.stats.wrong = Math.max(0, item.stats.wrong - 1);
    if (item.reviewBefore !== undefined) { item.review = item.reviewBefore ?? undefined; item.reviewBefore = undefined; }
    if (!asCorrect) item.state = item.stats.wrong + item.stats.hint + item.stats.asked > 0 ? "unknown" : item.stats.correct ? "known" : "met";
    item.updatedAt = at;
  });
  if (asCorrect) return recordEvent(knowledgeId, "correct", "내 답도 맞아요 (표기만 다름)", source, at);
  return (await getKnowledge(knowledgeId)).item;
}

/* ---------- reading ---------- */
export type ItemLite = Pick<Knowledge, "id" | "title" | "state" | "graduated" | "folderId" | "updatedAt" | "lastAt" | "kind"> & { line: string; links: number; weak: number; dueAt?: string };
const firstLine = (body: string) => body.split("\n").map((l) => stripWiring(l)).find(Boolean)?.slice(0, 120) ?? "";
const weakness = (item: Knowledge) => item.stats.wrong * 2 + item.stats.hint + item.stats.asked;
const lite = (item: Knowledge): ItemLite => ({ id: item.id, title: item.title, state: item.state, graduated: item.graduated, folderId: item.folderId,
  updatedAt: item.updatedAt, lastAt: item.lastAt, line: firstLine(item.body), links: item.links.length, weak: weakness(item), ...(item.review ? { dueAt: item.review.dueAt } : {}),
  ...(item.kind ? { kind: item.kind } : {}) });

export async function tree() {
  const store = await readStore();
  return { folders: [...store.folders].sort((a, b) => a.order - b.order), items: store.items.map(lite) };
}
export async function getKnowledge(id: string) {
  const store = await readStore();
  const item = store.items.find((x) => x.id === id);
  if (!item) throw new KnowledgeError(404, "지식을 찾을 수 없어요.");
  const byId = new Map(store.items.map((x) => [x.id, x]));
  const links = item.links.flatMap((l) => byId.has(l.to) ? [{ ...l, item: lite(byId.get(l.to)!) }] : []);
  const backlinks = store.items.flatMap((x) => x.links.filter((l) => l.to === id).map((l) => ({ relation: l.relation, ...(l.note ? { note: l.note } : {}), item: lite(x) })));
  const events = (await readEvents()).filter((e) => e.knowledgeId === id).slice(-40).reverse();
  return { item, path: pathOf(store, item.folderId), links, backlinks, events };
}

export type SearchHit = ItemLite & { score: number; by: "글자" | "비슷한 말" };
/**
 * Find what the learner already has, without a model: names and text that contain the words first, then names that
 * look alike (letter pairs). A model only needs to judge among these few.
 */
export async function searchKnowledge(query: string, options: { limit?: number; folderId?: string } = {}): Promise<SearchHit[]> {
  const store = await readStore();
  const q = normalize(query);
  if (!q) return [];
  const words = query.split(/\s+/).map(normalize).filter((w) => w.length >= 1);
  const inFolder = options.folderId ? subtree(store, options.folderId) : null;
  const hits: SearchHit[] = [];
  for (const item of store.items) {
    if (inFolder && (!item.folderId || !inFolder.has(item.folderId))) continue;
    const names = namesOf(item).map(normalize);
    const text = normalize(item.body);
    let score = 0, by: SearchHit["by"] = "글자";
    if (names.some((n) => n === q)) score = 1;
    else if (names.some((n) => n.includes(q) || (n.length >= 2 && q.includes(n)))) score = 0.9;
    else if (words.length && words.every((w) => names.some((n) => n.includes(w)) || text.includes(w))) score = 0.75;
    else if (text.includes(q)) score = 0.6;
    else {
      const s = Math.max(...namesOf(item).map((n) => similarity(query, n)));
      if (s >= 0.5) { score = s * 0.8; by = "비슷한 말"; }
    }
    if (score > 0) hits.push({ ...lite(item), score: Math.round(score * 100) / 100, by });
  }
  return hits.sort((a, b) => b.score - a.score || b.lastAt.localeCompare(a.lastAt)).slice(0, options.limit ?? 8);
}

/* ---------- memory: 1 전체 흐름 · 2 주제 요약 · 3 직접 겪은 것 ---------- */
const countStates = (items: Knowledge[]) => ({ met: items.filter((i) => i.state === "met").length, unknown: items.filter((i) => i.state === "unknown").length,
  known: items.filter((i) => i.state === "known").length, graduated: items.filter((i) => i.graduated).length, total: items.length });
const countLine = (c: ReturnType<typeof countStates>) => `${c.total}개 (앎 ${c.known}, 몰랐음 ${c.unknown}, 만남 ${c.met}${c.graduated ? `, 졸업 ${c.graduated}` : ""})`;

/** 1단계: the big picture, short enough to hand to any model on every turn. */
export async function memoryOverview() {
  const store = await readStore();
  const top = store.folders.filter((f) => !f.parentId).sort((a, b) => a.order - b.order);
  const itemsIn = (folderId: string) => { const ids = subtree(store, folderId); return store.items.filter((i) => i.folderId && ids.has(i.folderId)); };
  const loose = store.items.filter((i) => !i.folderId);
  const recent = [...store.items].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 6);
  const weak = store.items.filter((i) => i.state === "unknown").sort((a, b) => weakness(b) - weakness(a)).slice(0, 6);
  const lines = [
    `[전체] 지식 ${countLine(countStates(store.items))}`,
    ...top.map((f) => `- ${f.name}: ${countLine(countStates(itemsIn(f.id)))}`),
    ...(loose.length ? [`- (폴더 없음): ${countLine(countStates(loose))}`] : []),
    recent.length ? `[최근] ${recent.map((i) => `${i.title}(${STATE_LABEL[i.state]})`).join(", ")}` : "[최근] 아직 없음",
    weak.length ? `[약한 것] ${weak.map((i) => i.title).join(", ")}` : "[약한 것] 없음",
  ];
  return { text: lines.join("\n"), folders: top.map((f) => ({ id: f.id, name: f.name, ...countStates(itemsIn(f.id)) })), total: countStates(store.items) };
}
/** 2단계: one topic — a folder by id or name, or the items a search finds — with each item's line, weak spots and links. */
export async function memorySummary(topic: string) {
  const store = await readStore();
  const folder = store.folders.find((f) => f.id === topic) ?? store.folders.find((f) => normalize(f.name) === normalize(topic));
  let items: Knowledge[];
  let title: string;
  if (folder) { const ids = subtree(store, folder.id); items = store.items.filter((i) => i.folderId && ids.has(i.folderId)); title = pathOf(store, folder.id); }
  else { const hits = new Set((await searchKnowledge(topic, { limit: 20 })).map((h) => h.id)); items = store.items.filter((i) => hits.has(i.id)); title = `"${topic}" 검색`; }
  const byId = new Map(store.items.map((x) => [x.id, x]));
  const lines = [`[${title}] ${countLine(countStates(items))}`, ...(folder?.note ? [`메모: ${folder.note}`] : []),
    ...items.sort((a, b) => weakness(b) - weakness(a)).slice(0, 40).map((i) => {
      const weak = i.stats.wrong || i.stats.hint || i.stats.asked ? ` · 틀림 ${i.stats.wrong} 힌트 ${i.stats.hint} 물어봄 ${i.stats.asked}` : "";
      const links = i.links.filter((l) => byId.has(l.to)).slice(0, 3).map((l) => `${l.relation} → ${byId.get(l.to)!.title}`).join("; ");
      return `- ${i.title} [${STATE_LABEL[i.state]}${i.graduated ? "·졸업" : ""}]${weak}${firstLine(i.body) ? `: ${firstLine(i.body)}` : ""}${links ? ` (${links})` : ""}`;
    })];
  return { text: lines.join("\n"), folderId: folder?.id ?? null, items: items.map(lite) };
}
/** 3단계: what happened, newest first — for one item, one folder, or everything. */
export async function memoryEvents(options: { knowledgeId?: string; folderId?: string; kinds?: KEventKind[]; limit?: number } = {}) {
  const store = await readStore();
  const inFolder = options.folderId ? subtree(store, options.folderId) : null;
  const byId = new Map(store.items.map((x) => [x.id, x]));
  const events = (await readEvents()).filter((e) => (!options.knowledgeId || e.knowledgeId === options.knowledgeId)
    && (!inFolder || (byId.get(e.knowledgeId)?.folderId && inFolder.has(byId.get(e.knowledgeId)!.folderId!)))
    && (!options.kinds?.length || options.kinds.includes(e.kind))).reverse().slice(0, options.limit ?? 30);
  const text = events.map((e) => `${e.at.slice(0, 16).replace("T", " ")} ${byId.get(e.knowledgeId)?.title ?? "(지워진 지식)"} · ${EVENT_LABEL[e.kind]}${e.detail ? `: ${e.detail}` : ""}${e.source ? ` (${e.source.title})` : ""}`).join("\n");
  return { text: text || "기록이 없어요.", events: events.map((e) => ({ ...e, title: byId.get(e.knowledgeId)?.title ?? "" })) };
}

/** When an item is due: its box date, or now when it has none yet (몰랐음 or 앎 from before review dates existed). */
const dueTime = (item: Knowledge) => { const t = item.review ? Date.parse(item.review.dueAt) : 0; return Number.isFinite(t) ? t : 0; };
const inReview = (item: Knowledge) => !item.graduated && item.state !== "met";
/**
 * What to look at again: 몰랐음 first, then 앎 not yet graduated. With dueOnly, only what is due by now (box date),
 * soonest first — the review session. Without it, everything still in review, most missed first (deadline planning).
 */
export async function reviewQueue(options: { folderId?: string; limit?: number; dueOnly?: boolean; now?: Date; ids?: string[] } = {}) {
  const store = await readStore();
  const inFolder = options.folderId ? subtree(store, options.folderId) : null;
  const only = options.ids ? new Set(options.ids) : null;
  const now = (options.now ?? new Date()).getTime();
  const pool = store.items.filter((i) => inReview(i) && (!inFolder || (i.folderId && inFolder.has(i.folderId))) && (!only || only.has(i.id)) && (!options.dueOnly || dueTime(i) <= now));
  const byState = (a: Knowledge, b: Knowledge) => (a.state === b.state ? 0 : a.state === "unknown" ? -1 : 1);
  return pool.sort((a, b) => byState(a, b) || (options.dueOnly ? dueTime(a) - dueTime(b) : 0) || weakness(b) - weakness(a) || a.lastAt.localeCompare(b.lastAt))
    .slice(0, options.limit ?? 20).map(lite);
}
/** How many are due now, and when the next one comes due (for "다음 복습은 …"). */
export async function reviewStatus(options: { folderId?: string; now?: Date; ids?: string[] } = {}) {
  const store = await readStore();
  const inFolder = options.folderId ? subtree(store, options.folderId) : null;
  const only = options.ids ? new Set(options.ids) : null;
  const now = (options.now ?? new Date()).getTime();
  const pool = store.items.filter((i) => inReview(i) && (!inFolder || (i.folderId && inFolder.has(i.folderId))) && (!only || only.has(i.id)));
  const later = pool.map(dueTime).filter((t) => t > now).sort((a, b) => a - b);
  return { due: pool.filter((i) => dueTime(i) <= now).length, next: later.length ? new Date(later[0]).toISOString() : null };
}

/** Every item in full with the folders (for goals and sorting, inside the knowledge store; not part of api.ts). */
export async function readAll() { const store = await readStore(); return { folders: store.folders, items: store.items }; }
/**
 * 주제 정리: put items into topic paths ("CS/알고리즘/탐색", made on the way) and set their 종류; then remove folders
 * this emptied (never a folder that still holds items or folders). One write.
 */
export const sortItems = (entries: Array<{ id: string; topic?: string; kind?: KKind }>) => change((store) => {
  const moved: string[] = [], before = new Set<string>();
  for (const e of entries) {
    const item = store.items.find((x) => x.id === e.id);
    if (!item) continue;
    if (e.topic?.trim()) {
      const folderId = ensurePath(store, e.topic);
      if (folderId && folderId !== item.folderId) { if (item.folderId) before.add(item.folderId); item.folderId = folderId; moved.push(item.id); }
      item.topicHint = undefined;
    }
    if (e.kind) item.kind = e.kind;
    item.updatedAt = nowIso();
  }
  // Folders left empty go, and their parents if those are empty too: the ones this move emptied, and any folder made
  // on the way (not by the learner's + 폴더) that holds nothing — the old file-name and source folders.
  let gone = true;
  while (gone) {
    gone = false;
    for (const f of [...store.folders]) {
      if ((!before.has(f.id) && f.hand) || store.items.some((i) => i.folderId === f.id) || store.folders.some((g) => g.parentId === f.id)) continue;
      if (!before.has(f.id) && f.note.trim()) continue;
      store.folders = store.folders.filter((g) => g.id !== f.id);
      if (f.parentId) before.add(f.parentId);
      gone = true;
    }
  }
  return { moved };
});

/** "3D뷰잉_좌표계" → "3D뷰잉 좌표계": a file name read as a folder name. */
const folderName = (text: string) => text.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
/** A point's lines as the knowledge's meaning: no engine wiring, no name repeated in front ("z_vp — 뷰 평면의 위치…"). */
function pointBody(title: string, essentials: string[]) {
  return essentials.map((line, i) => {
    let l = stripWiring(line);
    if (i === 0) for (const sep of [" — ", " – ", " - ", ": "]) if (l.startsWith(title.trim() + sep)) { l = l.slice(title.trim().length + sep.length).trim(); break; }
    return l;
  }).filter(Boolean).join("\n");
}
/**
 * Knowledge points of PDF materials (the engine's knowledge layer), brought in as 만남 under 자료 이름/구역. Idempotent:
 * runs on every load, so it also tidies points brought in before (wiring out of the text, the file-name folder renamed)
 * and turns each card's 냄 → 받음 into 고리 inside one material, without a model call.
 */
export async function importPoints(points: Array<{ ref: string; title: string; essentials: string[]; folder: string; material: string; page?: number }>) {
  // Folders named after the file before this tidy-up take the cleaned name first (unless it is taken), so new points
  // land in the same folder. Only the material folders these points name are touched, never one the learner made.
  const raw = new Set(points.map((p) => p.folder.split("/")[0] ?? "").filter((name) => name.includes("_")));
  if (raw.size) await changeIf((s) => {
    let dirty = false;
    for (const f of s.folders) if (!f.parentId && raw.has(f.name)) {
      const name = folderName(f.name);
      if (!s.folders.some((g) => g !== f && !g.parentId && normalize(g.name) === normalize(name))) { f.name = name.slice(0, 60); dirty = true; }
    }
    return { dirty, out: null };
  });
  const store = await readStore();
  const have = new Set(store.items.flatMap((i) => i.sources.map((s) => s.ref).filter(Boolean)));
  const fresh = points.filter((p) => !have.has(p.ref)).slice(0, 400);
  // No folder named after the file (2026-10-28 "4개 축"): the material is the 출처, and 주제 정리 places the points in
  // the topic tree a few seconds later; "자료 / 구역" is its hint.
  const results = fresh.length ? await saveMany(fresh.map((p) => {
    const [material, ...rest] = p.folder.split("/");
    return { title: p.title, body: pointBody(p.title, p.essentials), topicHint: [folderName(material ?? ""), ...rest].join(" / "),
      source: { kind: "pdf" as const, title: p.material, ref: p.ref, ...(p.page ? { page: p.page } : {}) } };
  })) : [];
  const linked = await changeIf((s) => {
    let dirty = false;
    const byRef = new Map(s.items.flatMap((i) => i.sources.filter((x) => x.ref).map((x) => [x.ref!, i] as const)));
    for (const p of points) {
      const item = byRef.get(p.ref);
      if (!item) continue;
      const body = pointBody(item.title, item.body.split("\n"));
      if (body && body !== item.body && (item.body.includes("⟨받음:") || p.essentials.some((e) => stripWiring(e).startsWith(item.title)))) { item.body = body; dirty = true; }
    }
    let added = 0;
    const groups = new Map<string, Array<{ item: Knowledge; takes: string[]; gives: string[] }>>();
    for (const p of points) {
      const item = byRef.get(p.ref);
      if (!item) continue;
      groups.set(p.material, [...(groups.get(p.material) ?? []), { item, ...parseWiring(p.essentials) }]);
    }
    // Symbols are case-sensitive (N is the normal, n its unit vector); longer names compare like everywhere else.
    const symbol = (text: string) => text.replace(/\s+/g, "");
    const same = (a: string, b: string) => normalize(a).length <= 2 || normalize(b).length <= 2 ? symbol(a) === symbol(b) : normalize(a) === normalize(b);
    const isName = (wanted: string, item: Knowledge) => namesOf(item).some((n) => same(n, wanted) || n.trim().endsWith(`(${wanted.trim()})`)
      || (normalize(wanted).length >= 4 && similarity(n, wanted) >= 0.75));
    const MADE = (relation: string) => relation.startsWith("냄: ") || relation === "입력으로 씀";
    for (const cards of groups.values()) {
      const want = new Map<string, Map<string, string>>(); // from id → (to id → relation)
      for (const to of cards) for (const wanted of to.takes) {
        // What a card takes is a result another card gives, or another card itself (its name). Short names repeat:
        // the nearest card before this one that gives it, else any card that does.
        const gives = (c: (typeof cards)[number]) => c !== to && c.gives.some((g) => same(g, wanted));
        const giver = cards.slice(0, cards.indexOf(to)).reverse().find(gives) ?? cards.find(gives);
        const from = giver ?? cards.find((c) => c !== to && isName(wanted, c.item));
        if (!from || from.item.id === to.item.id) continue;
        const row = want.get(from.item.id) ?? new Map<string, string>();
        if (!row.has(to.item.id)) row.set(to.item.id, giver ? `냄: ${wanted}` : "입력으로 씀");
        want.set(from.item.id, row);
      }
      // Links this tidy-up made earlier and no longer finds go (a wrong match fixed later); the learner's own stay.
      const inGroup = new Set(cards.map((c) => c.item.id));
      for (const { item } of cards) {
        const keep = item.links.filter((l) => !(MADE(l.relation) && inGroup.has(l.to) && !want.get(item.id)?.has(l.to)));
        if (keep.length !== item.links.length) { item.links = keep; dirty = true; }
      }
      for (const { item } of cards) for (const [toId, relation] of want.get(item.id) ?? []) {
        const target = cards.find((c) => c.item.id === toId)!.item;
        if (item.links.some((l) => l.to === toId) || target.links.some((l) => l.to === item.id)) continue;
        item.links.push({ to: toId, relation: relation.slice(0, 60) }); added++; dirty = true;
      }
    }
    return { dirty, out: added };
  });
  return { added: results.filter((r) => r.created).length, merged: results.filter((r) => r.merged).length, linked };
}

/** Items that came from given places (a PDF material's points: "deckId:pointId"), by exact ref or ref prefix. */
export async function itemsByRef(refs: string[], prefix = false) {
  const store = await readStore();
  const match = (ref?: string) => Boolean(ref) && refs.some((r) => prefix ? ref!.startsWith(r) : ref === r);
  return store.items.filter((i) => i.sources.some((s) => match(s.ref))).map(lite);
}
/** A practice result on a PDF question, passed on to the knowledge its objective covers. */
export async function recordByRef(refs: string[], kind: KEventKind, detail = "", source?: KEvent["source"], takeBack?: "correct" | "read") {
  const items = await itemsByRef(refs);
  for (const item of items) {
    if (takeBack) await takeBackWrong(item.id, takeBack === "correct", source);
    else await recordEvent(item.id, kind, detail, source);
  }
  return { recorded: items.length };
}
