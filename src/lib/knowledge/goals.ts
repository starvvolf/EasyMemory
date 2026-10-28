// 목표 (2026-10-28 결정 "4개 축": 주제·종류·출처·목표). Why and until when something is learned: a class with its exam
// (그래픽스 중간 10/20), or something without a date (코테 준비, 주식 공부). It takes the place of the study screen's
// 과목·시험일 and the schedule's 기한, and it is what review and 일정 나누기 are scoped by.
//
// Items are not put into goals one by one: a goal holds 자료 (sources), and every item met in one of them belongs to
// it — so 이분 탐색 met in a class PDF and in a 바킹독 problem belongs to both goals and stays one item. An item can also
// be added by hand. A closed goal (the exam is over) keeps its items and records; it only stops showing as current.
//
// File: STUDY_FORGE_DATA_DIR/knowledge/goals.json.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { KnowledgeError, readAll, reviewQueue, reviewStatus, type KSource, type Knowledge, type SourceKind } from "./store.ts";

export type GoalSource = { key: string; kind: SourceKind; title: string };
export type Goal = { id: string; name: string; date: string | null; closed: boolean; sources: GoalSource[]; itemIds: string[]; note: string; createdAt: string };
/** A source no goal holds yet, with the goal sorting suggested for it (goalId "" = a new goal named `name`; name "" = asked, nothing fits). */
export type GoalSuggestion = { key: string; goalId: string; name: string; reason: string; at: string };
type GoalFile = { goals: Goal[]; suggestions: GoalSuggestion[]; ignored: string[] };

const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge", "goals.json");
async function read(): Promise<GoalFile> {
  try { const d = JSON.parse(await readFile(file(), "utf8")) as Partial<GoalFile>; return { goals: d.goals ?? [], suggestions: d.suggestions ?? [], ignored: d.ignored ?? [] }; }
  catch { return { goals: [], suggestions: [], ignored: [] }; }
}
const lock = globalThis as unknown as { __goalsFile?: Promise<unknown> };
function change<T>(run: (data: GoalFile) => T | Promise<T>): Promise<T> {
  const next = (lock.__goalsFile ?? Promise.resolve()).then(async () => {
    const data = await read();
    const out = await run(data);
    await mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 1), "utf8");
    await rename(tmp, file());
    return out;
  });
  lock.__goalsFile = next.catch(() => undefined);
  return next;
}
const newId = () => `goal_${randomBytes(6).toString("hex")}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One material, however many items and remakes it has: a PDF by its material name (remakes keep it), a code problem
 * by its id, an article by its address.
 */
export function sourceKey(s: Pick<KSource, "kind" | "title" | "ref" | "url">) {
  if (s.kind === "code" && s.ref) return s.ref.startsWith("code:") ? s.ref : `code:${s.ref}`;
  if (s.kind === "web") return `web:${s.url || s.title}`;
  return `${s.kind}:${s.title}`;
}

export async function listGoals() { return (await read()).goals; }
export async function getGoal(id: string) {
  const goal = (await read()).goals.find((g) => g.id === id);
  if (!goal) throw new KnowledgeError(404, "목표를 찾을 수 없어요.");
  return goal;
}
export const createGoal = (input: { name: string; date?: string | null; note?: string; sources?: GoalSource[] }) => change((data) => {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new KnowledgeError(400, "목표 이름이 비어 있어요.");
  if (input.date && !DATE.test(input.date)) throw new KnowledgeError(400, "날짜는 2026-10-30 형식으로 적어요.");
  const same = data.goals.find((g) => !g.closed && g.name === name);
  if (same) return same;
  const goal: Goal = { id: newId(), name, date: input.date || null, closed: false, sources: [], itemIds: [], note: (input.note ?? "").slice(0, 400), createdAt: new Date().toISOString() };
  for (const s of input.sources ?? []) attach(data, goal, s);
  data.goals.push(goal);
  return goal;
});
export const updateGoal = (id: string, patch: { name?: string; date?: string | null; closed?: boolean; note?: string }) => change((data) => {
  const goal = data.goals.find((g) => g.id === id);
  if (!goal) throw new KnowledgeError(404, "목표를 찾을 수 없어요.");
  if (patch.name !== undefined) { if (!patch.name.trim()) throw new KnowledgeError(400, "목표 이름이 비어 있어요."); goal.name = patch.name.trim().slice(0, 60); }
  if (patch.date !== undefined) { if (patch.date && !DATE.test(patch.date)) throw new KnowledgeError(400, "날짜는 2026-10-30 형식으로 적어요."); goal.date = patch.date || null; }
  if (patch.closed !== undefined) goal.closed = patch.closed;
  if (patch.note !== undefined) goal.note = patch.note.slice(0, 400);
  return goal;
});
/** Deleting a goal leaves its items and records alone; only the grouping goes. */
export const deleteGoal = (id: string) => change((data) => {
  data.goals = data.goals.filter((g) => g.id !== id);
  data.suggestions = data.suggestions.filter((s) => s.goalId !== id);
  return { ok: true };
});

function attach(data: GoalFile, goal: Goal, source: GoalSource) {
  if (!goal.sources.some((s) => s.key === source.key)) goal.sources.push({ key: source.key.slice(0, 300), kind: source.kind, title: source.title.slice(0, 200) });
  data.suggestions = data.suggestions.filter((s) => s.key !== source.key);
  data.ignored = data.ignored.filter((k) => k !== source.key);
}
/** 자료를 목표에 넣기 (or take it out): every item met in it belongs to the goal from then on. */
export const setGoalSource = (goalId: string, source: GoalSource, on: boolean) => change((data) => {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) throw new KnowledgeError(404, "목표를 찾을 수 없어요.");
  if (on) attach(data, goal, source); else goal.sources = goal.sources.filter((s) => s.key !== source.key);
  return goal;
});
/** One item by hand (a term worth keeping for this exam that came from somewhere else). */
export const setGoalItem = (goalId: string, itemId: string, on: boolean) => change((data) => {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) throw new KnowledgeError(404, "목표를 찾을 수 없어요.");
  goal.itemIds = on ? [...new Set([...goal.itemIds, itemId])] : goal.itemIds.filter((x) => x !== itemId);
  return goal;
});

const belongs = (goal: Goal, item: Knowledge) => goal.itemIds.includes(item.id) || item.sources.some((s) => goal.sources.some((g) => g.key === sourceKey(s)));
/** The ids of a goal's items. */
export async function goalItemIds(goalId: string) {
  const goal = await getGoal(goalId);
  return (await readAll()).items.filter((i) => belongs(goal, i)).map((i) => i.id);
}
/** Which goals each item belongs to (for the knowledge screen). */
export async function goalsOfItems() {
  const [{ goals }, { items }] = await Promise.all([read(), readAll()]);
  return Object.fromEntries(items.map((i) => [i.id, goals.filter((g) => belongs(g, i)).map((g) => g.id)]));
}
/** Review scoped to a goal: what is due, and how many are due / when the next one comes. */
export async function goalReview(goalId: string, options: { limit?: number; dueOnly?: boolean; now?: Date } = {}) {
  const ids = await goalItemIds(goalId);
  return { queue: await reviewQueue({ ...options, ids }), status: await reviewStatus({ now: options.now, ids }) };
}

/** Days left until a goal's date, by the learner's calendar day (0 = today); null without a date. */
export function daysLeft(goal: Pick<Goal, "date">, now = new Date(), offsetMinutes = Number(process.env.RECALLER_TZ_OFFSET_MIN ?? 540)) {
  if (!goal.date) return null;
  const today = new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${goal.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** The goals as the screen shows them: counts by state, what is due, days left; open ones first (soonest date first). */
export async function goalOverview(now = new Date()) {
  const [{ goals }, { items }] = await Promise.all([read(), readAll()]);
  const t = now.getTime();
  const due = (i: Knowledge) => !i.graduated && i.state !== "met" && (!i.review || Date.parse(i.review.dueAt) <= t);
  const out = goals.map((g) => {
    const mine = items.filter((i) => belongs(g, i));
    return { ...g, daysLeft: daysLeft(g, now), counts: { total: mine.length, unknown: mine.filter((i) => i.state === "unknown").length, known: mine.filter((i) => i.state === "known").length,
      met: mine.filter((i) => i.state === "met").length, graduated: mine.filter((i) => i.graduated).length, due: mine.filter(due).length } };
  });
  const rank = (g: (typeof out)[number]) => g.closed ? 3 : g.daysLeft === null ? 1 : g.daysLeft < 0 ? 2 : 0;
  return out.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.name.localeCompare(b.name, "ko"));
}

/** Every 자료 the items came from, with how many items each has and the goals holding it (for "자료별" and goal picking). */
export async function listMaterials() {
  const [{ goals, suggestions, ignored }, { items }] = await Promise.all([read(), readAll()]);
  const byKey = new Map<string, { key: string; kind: SourceKind; title: string; items: number; lastAt: string }>();
  for (const i of items) for (const s of i.sources) {
    const key = sourceKey(s);
    const m = byKey.get(key) ?? { key, kind: s.kind, title: s.title, items: 0, lastAt: "" };
    m.items += 1; if (s.at > m.lastAt) m.lastAt = s.at;
    byKey.set(key, m);
  }
  return [...byKey.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((m) => ({ ...m,
    goals: goals.filter((g) => g.sources.some((s) => s.key === m.key)).map((g) => g.id),
    suggestion: suggestions.find((s) => s.key === m.key) ?? null, ignored: ignored.includes(m.key) }));
}
/** 자료 that no goal holds, that the learner has not set aside ("목표 없이 두기"). */
export async function unplacedMaterials() { return (await listMaterials()).filter((m) => !m.goals.length && !m.ignored); }
export const ignoreMaterial = (key: string) => change((data) => {
  if (!data.ignored.includes(key)) data.ignored.push(key);
  data.suggestions = data.suggestions.filter((s) => s.key !== key);
  return { ok: true };
});
/** Suggestions from sorting (classify.ts): which goal each new 자료 seems to belong to. Never attaches by itself. */
export const suggestGoals = (entries: Array<{ key: string; goalId: string; name: string; reason: string }>) => change((data) => {
  for (const e of entries) {
    if (data.goals.some((g) => g.sources.some((s) => s.key === e.key)) || data.ignored.includes(e.key)) continue;
    data.suggestions = [...data.suggestions.filter((s) => s.key !== e.key), { ...e, name: e.name.slice(0, 60), reason: e.reason.slice(0, 200), at: new Date().toISOString() }];
  }
  return data.suggestions.filter((s) => s.name).length;
});
/** Accept a suggestion: into the goal it named, or a new goal by that name. */
export async function acceptSuggestion(key: string, title: string, kind: SourceKind) {
  const s = (await read()).suggestions.find((x) => x.key === key);
  if (!s || !s.name) throw new KnowledgeError(404, "추천을 찾을 수 없어요.");
  const goal = s.goalId && (await read()).goals.some((g) => g.id === s.goalId) ? s.goalId : (await createGoal({ name: s.name })).id;
  return setGoalSource(goal, { key, kind, title }, true);
}

/**
 * The study screen's 과목·시험일 (kept in the browser until now) become goals: a subject is a goal with the same name
 * and its exam date, and each material set to that subject is one of its 자료. Run whenever the subjects are saved;
 * goals made by hand are not touched, and a subject that was removed leaves its goal (the learner can delete it).
 */
export const syncSubjects = (subjects: Array<{ name: string; exam?: string }>, materials: Array<{ subject: string; title: string }>) => change((data) => {
  for (const s of subjects) {
    const name = s.name.trim().slice(0, 60);
    if (!name) continue;
    let goal = data.goals.find((g) => !g.closed && g.name === name);
    if (!goal) { goal = { id: newId(), name, date: null, closed: false, sources: [], itemIds: [], note: "", createdAt: new Date().toISOString() }; data.goals.push(goal); }
    if (s.exam !== undefined) goal.date = s.exam && DATE.test(s.exam) ? s.exam : goal.date;
    for (const m of materials.filter((x) => x.subject === s.name)) attach(data, goal, { key: sourceKey({ kind: "pdf", title: m.title }), kind: "pdf", title: m.title });
  }
  return data.goals;
});
