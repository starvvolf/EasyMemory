// 코드 문제와 지식을 잇는 곳: a problem's knowledge lives in the knowledge store, and every submission leaves its mark
// there (맞힘 / 틀림 / 힌트), so the sidebar, the review queue and the agent see code practice like any other study.
//
// 이번 풀이 (2026-10-26): while a problem is being solved, its 틀림 · 힌트 · 물어봄 wait in the attempt, not in the
// knowledge record. The tutor sees them as this attempt (never "지난번에도"), and they go into the record together when
// the attempt ends: 맞았습니다, leaving the problem, or two hours without a move.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordEvent, saveMany, type KEventKind } from "../knowledge/api.ts";
import { listProblems, readProblemMeta, setProblemKnowledge, submit, type Problem, type ProblemMeta } from "./problems.ts";
import { VERDICT_LABEL, type Lang } from "./run.ts";
import { SEED_KNOWLEDGE } from "./seeds.ts";
import { readTrain, saveStep } from "./train.ts";

const filled = new Set<string>();

/** The problem's knowledge names as items (만남 the first time), ids written back on the problem. */
export async function ensureProblemKnowledge<T extends Problem | ProblemMeta>(problem: T): Promise<T> {
  // Seed problems also fill in their knowledge's meaning once per run (an item made before keeps its own text).
  const seedFill = problem.source.kind === "seed" && !filled.has(problem.id);
  if (problem.knowledgeIds.length === problem.knowledge.length && problem.knowledgeIds.length && !seedFill) return problem;
  filled.add(problem.id);
  const results = await saveMany(problem.knowledge.map((title, i) => ({ title, folder: problem.folder,
    ...(SEED_KNOWLEDGE[title] || problem.knowledgeBodies?.[i] ? { body: SEED_KNOWLEDGE[title] || problem.knowledgeBodies![i] } : {}),
    source: { kind: "code" as const, title: problem.title, ref: `code:${problem.id}` } })));
  const knowledgeIds = results.map((r) => r.item.id);
  await setProblemKnowledge(problem.id, knowledgeIds);
  return { ...problem, knowledgeIds };
}
export async function listProblemsWithKnowledge() {
  await endIdleAttempts();
  const list = await listProblems();
  for (const p of list) { try { await ensureProblemKnowledge(await readProblemMeta(p.id)); } catch { /* listed anyway */ } }
  return list;
}

/* ---------- 이번 풀이: what happened in the attempt still going on ---------- */
export type AttemptEvent = { at: string; kind: Extract<KEventKind, "wrong" | "hint" | "asked">; detail: string };
type Attempt = { startedAt: string; lastAt: string; events: AttemptEvent[] };
/** An attempt with no move for this long is over (the learner went away), and goes into the record as it stands. */
export const ATTEMPT_IDLE_MS = 2 * 60 * 60 * 1000;
const attemptsFile = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "attempts.json");
async function readAttempts(): Promise<Record<string, Attempt>> {
  try { return JSON.parse(await readFile(attemptsFile(), "utf8")) as Record<string, Attempt>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
async function writeAttempts(all: Record<string, Attempt>) {
  await mkdir(path.dirname(attemptsFile()), { recursive: true });
  const tmp = `${attemptsFile()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 1), "utf8");
  await rename(tmp, attemptsFile());
}
const queue = globalThis as unknown as { __attemptQueue?: Promise<unknown> };
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = (queue.__attemptQueue ?? Promise.resolve()).then(run, run);
  queue.__attemptQueue = next.catch(() => undefined);
  return next;
}
async function hold(problemId: string, kind: AttemptEvent["kind"], detail: string, at = new Date().toISOString()) {
  await serial(async () => {
    const all = await readAttempts();
    const attempt = all[problemId] ?? { startedAt: at, lastAt: at, events: [] };
    attempt.events.push({ at, kind, detail: detail.slice(0, 600) });
    attempt.lastAt = at;
    all[problemId] = attempt;
    await writeAttempts(all);
  });
}
/** This attempt so far, for the tutor: told as this attempt, not as an earlier one. */
export async function currentAttempt(problemId: string): Promise<AttemptEvent[]> {
  return (await readAttempts())[problemId]?.events ?? [];
}
/**
 * The attempt ends: what waited goes into the knowledge record, at the times it happened, then the ending itself
 * (맞힘 / 힌트 받고 통과). Nothing waited and no ending: nothing to write.
 */
export async function endAttempt(problemId: string, ending?: { kind: "correct" | "note"; detail: string }, now = new Date().toISOString()) {
  const attempt = await serial(async () => {
    const all = await readAttempts();
    const found = all[problemId];
    if (found) { delete all[problemId]; await writeAttempts(all); }
    return found;
  });
  if (!attempt?.events.length && !ending) return { recorded: 0 };
  const problem = await ensureProblemKnowledge(await readProblemMeta(problemId));
  const source = { kind: "code" as const, title: problem.title, ref: `code:${problem.id}` };
  for (const id of problem.knowledgeIds) {
    for (const e of attempt?.events ?? []) await recordEvent(id, e.kind, e.detail, source, e.at).catch(() => undefined);
    if (ending) await recordEvent(id, ending.kind, ending.detail, source, now).catch(() => undefined);
  }
  return { recorded: (attempt?.events.length ?? 0) + (ending ? 1 : 0) };
}
/** Attempts left without a move for two hours end as they stand. */
export async function endIdleAttempts(now = Date.now()) {
  const all = await readAttempts();
  for (const [id, a] of Object.entries(all)) if (now - Date.parse(a.lastAt) > ATTEMPT_IDLE_MS) await endAttempt(id, undefined, new Date(now).toISOString()).catch(() => undefined);
}

/**
 * 제출 → 채점 → 기록. Only "제출" counts: 맞았습니다 ends the attempt — without hints it is 맞힘 (→ 앎); after hints it is
 * noted, since the hints already mark 몰랐음. 틀림·시간 초과·런타임 에러 wait in the attempt as 틀림. Compile errors and
 * "예제 실행" leave the knowledge alone.
 */
export async function submitAndRecord(problemId: string, lang: Lang, code: string, mode: "example" | "submit", hints: number, advice = 0) {
  await ensureProblemKnowledge(await readProblemMeta(problemId));
  const result = await submit(problemId, lang, code, mode, hints);
  if (mode === "submit" && result.verdict !== "CE" && result.verdict !== "MISSING") {
    // 훈련 모드 · 지켜보기 (2026-10-31): passing with the steps checked one by one, or after the watcher's warnings, is not
    // 앎 yet (a note); 앎 comes from solving it alone later, as after hints.
    const training = (await readTrain(problemId)).mode === "train";
    if (result.verdict === "AC") await endAttempt(problemId, training ? { kind: "note", detail: "훈련 모드로 통과" } : hints ? { kind: "note", detail: `힌트 ${hints}번 받고 통과` }
      : advice ? { kind: "note", detail: `지켜보기 조언 ${advice}번 받고 통과` } : { kind: "correct", detail: "힌트 없이 통과" });
    else {
      const failed = result.shown[0];
      await hold(problemId, "wrong", `${VERDICT_LABEL[result.verdict]}${failed ? ` (입력 ${failed.input.split("\n")[0].slice(0, 40)}…)` : ""}`);
    }
  }
  return result;
}
export async function recordHint(problemId: string, level: number) {
  const problem = await readProblemMeta(problemId);
  await hold(problemId, "hint", `힌트 ${level}단계: ${problem.title}`);
}
export async function recordAsked(problemId: string | undefined, detail: string) {
  if (!problemId) return;
  await readProblemMeta(problemId);
  await hold(problemId, "asked", detail.slice(0, 200));
}

/**
 * 복기 (훈련 모드 7단계, 2026-10-31): what the learner kept of the review goes onto the problem's knowledge as a note, so the
 * knowledge window shows it under 겪은 일 and the tutor reads it next time. Empty lines are not saved.
 */
export async function saveReview(problemId: string, review: { idea?: string; stuck?: string; transfer?: string }) {
  const lines = [review.idea?.trim() && `핵심 발상: ${review.idea.trim()}`, review.stuck?.trim() && `막힌 이유: ${review.stuck.trim()}`, review.transfer?.trim() && `다른 문제에도: ${review.transfer.trim()}`].filter(Boolean) as string[];
  await saveStep(problemId, "review", { answer: review });
  if (!lines.length) return { recorded: 0 };
  const problem = await ensureProblemKnowledge(await readProblemMeta(problemId));
  const source = { kind: "code" as const, title: problem.title, ref: `code:${problem.id}` };
  for (const id of problem.knowledgeIds) await recordEvent(id, "note", `[복기] ${lines.join(" · ")}`.slice(0, 600), source).catch(() => undefined);
  return { recorded: problem.knowledgeIds.length };
}
