// 일정 (2026-10-26): 타이머, 공부 시간 기록, 할 일, 기한과 날짜별 나누기, 주간 시간표.
// The timer keeps its start time on the server, so a refresh, a closed tab or another device never loses the count.
// Files: STUDY_FORGE_DATA_DIR/schedule/{timer,todos,deadlines}.json and sessions.jsonl.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewQueue, tree, dayOf } from "../knowledge/store.ts";

export class ScheduleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "schedule");
const file = (name: string) => path.join(dir(), name);
const newId = (p: string) => `${p}_${randomBytes(5).toString("hex")}`;
async function readJson<T>(name: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(file(name), "utf8")) as T; } catch { return fallback; } }
async function writeJson(name: string, value: unknown) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${file(name)}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await rename(tmp, file(name));
}
const queue = globalThis as unknown as { __scheduleQueue?: Promise<unknown> };
function serial<T>(run: () => Promise<T>): Promise<T> { const next = (queue.__scheduleQueue ?? Promise.resolve()).then(run, run); queue.__scheduleQueue = next.catch(() => undefined); return next; }
export const today = (now = new Date()) => dayOf(now.toISOString());
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/* ---------- 타이머 ---------- */
export type Timer = { running: boolean; startedAt: string | null; carriedMs: number; label: string; mode: "stopwatch" | "pomodoro"; targetMin: number; folderId: string | null };
export type Session = { id: string; start: string; end: string; minutes: number; label: string; folderId: string | null };
const IDLE: Timer = { running: false, startedAt: null, carriedMs: 0, label: "", mode: "stopwatch", targetMin: 25, folderId: null };
export const elapsedMs = (t: Timer, now = Date.now()) => t.carriedMs + (t.running && t.startedAt ? now - Date.parse(t.startedAt) : 0);

export async function getTimer() { const t = await readJson<Timer>("timer.json", IDLE); return { ...t, elapsedMs: elapsedMs(t), now: new Date().toISOString() }; }
export const startTimer = (opts: { label?: string; mode?: Timer["mode"]; targetMin?: number; folderId?: string | null } = {}) => serial(async () => {
  const t = await readJson<Timer>("timer.json", IDLE);
  if (t.running) return { ...t, elapsedMs: elapsedMs(t) };
  const fresh = t.carriedMs === 0;
  const next: Timer = { ...t, running: true, startedAt: new Date().toISOString(),
    ...(fresh ? { label: (opts.label ?? "").slice(0, 80), mode: opts.mode ?? "stopwatch", targetMin: Math.min(180, Math.max(1, opts.targetMin ?? 25)), folderId: opts.folderId ?? null } : {}) };
  await writeJson("timer.json", next);
  return { ...next, elapsedMs: elapsedMs(next) };
});
export const pauseTimer = () => serial(async () => {
  const t = await readJson<Timer>("timer.json", IDLE);
  if (!t.running) return { ...t, elapsedMs: elapsedMs(t) };
  const next: Timer = { ...t, running: false, carriedMs: elapsedMs(t), startedAt: null };
  await writeJson("timer.json", next);
  return { ...next, elapsedMs: next.carriedMs };
});
/** Stop: the time studied becomes a session (1 minute or more), and the timer goes back to zero. */
export const stopTimer = (at = new Date()) => serial(async () => {
  const t = await readJson<Timer>("timer.json", IDLE);
  const ms = elapsedMs(t, at.getTime());
  await writeJson("timer.json", IDLE);
  if (ms < 60_000) return { saved: null, minutes: Math.round(ms / 60_000) };
  const session: Session = { id: newId("ss"), start: new Date(at.getTime() - ms).toISOString(), end: at.toISOString(), minutes: Math.round(ms / 60_000), label: t.label, folderId: t.folderId };
  await mkdir(dir(), { recursive: true });
  await appendFile(file("sessions.jsonl"), JSON.stringify(session) + "\n", "utf8");
  return { saved: session, minutes: session.minutes };
});
export async function readSessions(): Promise<Session[]> {
  try { return (await readFile(file("sessions.jsonl"), "utf8")).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Session]; } catch { return []; } }); }
  catch { return []; }
}
/** A session typed in by hand ("어제 2시간 했어요"), for the timetable. */
export async function addSession(input: { start: string; minutes: number; label?: string }) {
  if (!Number.isFinite(Date.parse(input.start)) || input.minutes < 1 || input.minutes > 24 * 60) throw new ScheduleError(400, "시간을 확인해 주세요.");
  const start = new Date(input.start);
  const session: Session = { id: newId("ss"), start: start.toISOString(), end: new Date(start.getTime() + input.minutes * 60_000).toISOString(), minutes: Math.round(input.minutes), label: (input.label ?? "").slice(0, 80), folderId: null };
  await mkdir(dir(), { recursive: true });
  await appendFile(file("sessions.jsonl"), JSON.stringify(session) + "\n", "utf8");
  return session;
}

/* ---------- 할 일 ---------- */
export type Todo = { id: string; text: string; date: string | null; done: boolean; doneAt: string | null; createdAt: string; origin: "user" | "schedule" | "agent"; deadlineId: string | null };
export async function listTodos() { return (await readJson<Todo[]>("todos.json", [])).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.createdAt.localeCompare(b.createdAt)); }
export const addTodo = (input: { text: string; date?: string | null; origin?: Todo["origin"]; deadlineId?: string | null }) => serial(async () => {
  if (!input.text.trim()) throw new ScheduleError(400, "할 일을 적어 주세요.");
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ScheduleError(400, "날짜는 2026-10-30 형식으로 적어요.");
  const todos = await readJson<Todo[]>("todos.json", []);
  const todo: Todo = { id: newId("td"), text: input.text.trim().slice(0, 200), date: input.date ?? null, done: false, doneAt: null, createdAt: new Date().toISOString(), origin: input.origin ?? "user", deadlineId: input.deadlineId ?? null };
  todos.push(todo);
  await writeJson("todos.json", todos);
  return todo;
});
export const updateTodo = (id: string, patch: { text?: string; date?: string | null; done?: boolean }) => serial(async () => {
  const todos = await readJson<Todo[]>("todos.json", []);
  const todo = todos.find((t) => t.id === id);
  if (!todo) throw new ScheduleError(404, "할 일을 찾을 수 없어요.");
  if (patch.text !== undefined) todo.text = patch.text.trim().slice(0, 200) || todo.text;
  if (patch.date !== undefined) todo.date = patch.date;
  if (patch.done !== undefined) { todo.done = patch.done; todo.doneAt = patch.done ? new Date().toISOString() : null; }
  await writeJson("todos.json", todos);
  return todo;
});
export const deleteTodo = (id: string) => serial(async () => { await writeJson("todos.json", (await readJson<Todo[]>("todos.json", [])).filter((t) => t.id !== id)); return { ok: true }; });

/* ---------- 기한과 나누기 ---------- */
export type Deadline = { id: string; title: string; date: string; folderId: string | null; amount: number; unit: string; createdAt: string };
export async function listDeadlines() { return (await readJson<Deadline[]>("deadlines.json", [])).sort((a, b) => a.date.localeCompare(b.date)); }
export const addDeadline = (input: { title: string; date: string; folderId?: string | null; amount?: number; unit?: string }) => serial(async () => {
  if (!input.title.trim()) throw new ScheduleError(400, "무엇의 기한인지 적어 주세요.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ScheduleError(400, "날짜는 2026-10-30 형식으로 적어요.");
  const list = await readJson<Deadline[]>("deadlines.json", []);
  const deadline: Deadline = { id: newId("dl"), title: input.title.trim().slice(0, 80), date: input.date, folderId: input.folderId ?? null,
    amount: Math.max(0, Math.round(input.amount ?? 0)), unit: (input.unit ?? "").slice(0, 10), createdAt: new Date().toISOString() };
  list.push(deadline);
  await writeJson("deadlines.json", list);
  return deadline;
});
export const deleteDeadline = (id: string) => serial(async () => {
  await writeJson("deadlines.json", (await readJson<Deadline[]>("deadlines.json", [])).filter((d) => d.id !== id));
  await writeJson("todos.json", (await readJson<Todo[]>("todos.json", [])).filter((t) => t.deadlineId !== id || t.done));
  return { ok: true };
});

/**
 * 날짜별로 나누기: from today to the day before the deadline, the work is split evenly; the last day before is for
 * going over everything and the weak ones (시험 직전 몰아 보기). With a folder, the work is its items still in review
 * (몰랐음 first); without one, the amount the learner gave (쪽, 강 …). Earlier schedule items not yet done are replaced.
 */
export async function makeSchedule(deadlineId: string, now = new Date()) {
  const deadline = (await listDeadlines()).find((d) => d.id === deadlineId);
  if (!deadline) throw new ScheduleError(404, "기한을 찾을 수 없어요.");
  const start = today(now);
  const left = daysBetween(start, deadline.date);
  if (left < 1) throw new ScheduleError(400, "기한이 오늘이거나 지났어요.");
  let units: string[];
  let what: string;
  if (deadline.folderId) {
    const { folders } = await tree();
    const name = folders.find((f) => f.id === deadline.folderId)?.name ?? "폴더";
    const items = await reviewQueue({ folderId: deadline.folderId, limit: 500 });
    const all = (await tree()).items.filter((i) => i.folderId === deadline.folderId || false);
    const pool = items.length ? items : all.filter((i) => !i.graduated);
    units = pool.map((i) => i.title);
    what = `${name} 지식`;
  } else {
    units = Array.from({ length: deadline.amount || 1 }, (_, i) => `${i + 1}`);
    what = deadline.title;
  }
  const studyDays = Math.max(1, left - 1);
  const per = Math.ceil(units.length / studyDays);
  const plan: Array<{ date: string; text: string }> = [];
  for (let d = 0; d < studyDays && d * per < units.length; d++) {
    const chunk = units.slice(d * per, (d + 1) * per);
    const text = deadline.folderId ? `${what} ${chunk.length}개 보기: ${chunk.slice(0, 4).join(", ")}${chunk.length > 4 ? " …" : ""}`
      : `${what} ${chunk[0]}${chunk.length > 1 ? `~${chunk.at(-1)}` : ""}${deadline.unit}`;
    plan.push({ date: addDays(start, d), text });
  }
  if (left >= 2) plan.push({ date: addDays(deadline.date, -1), text: `${deadline.title}: 전체 훑기 + 약한 것 몰아 보기` });
  return serial(async () => {
    const todos = (await readJson<Todo[]>("todos.json", [])).filter((t) => !(t.deadlineId === deadlineId && t.origin === "schedule" && !t.done));
    const made: Todo[] = plan.map((p) => ({ id: newId("td"), text: p.text.slice(0, 200), date: p.date, done: false, doneAt: null, createdAt: new Date().toISOString(), origin: "schedule", deadlineId }));
    await writeJson("todos.json", [...todos, ...made]);
    return { deadline, days: left, todos: made };
  });
}

/* ---------- 주간 시간표 ---------- */
export async function week(startDay?: string, now = new Date()) {
  const base = startDay ?? (() => { const t = today(now); const dow = new Date(`${t}T00:00:00Z`).getUTCDay(); return addDays(t, -((dow + 6) % 7)); })();
  const days = Array.from({ length: 7 }, (_, i) => addDays(base, i));
  const [sessions, todos, deadlines] = await Promise.all([readSessions(), listTodos(), listDeadlines()]);
  return {
    start: base, today: today(now),
    days: days.map((date) => {
      const mine = sessions.filter((s) => dayOf(s.start) === date);
      return { date, minutes: mine.reduce((sum, s) => sum + s.minutes, 0), sessions: mine, todos: todos.filter((t) => t.date === date), deadlines: deadlines.filter((d) => d.date === date) };
    }),
    undated: todos.filter((t) => !t.date && !t.done),
    upcoming: deadlines.filter((d) => d.date >= today(now)),
  };
}
