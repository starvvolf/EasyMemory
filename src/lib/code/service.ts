// 코드 문제의 풀이 기록 (2026-11-08 바꿈, 사용자 결정 "원래 있던 거는 버리고 오늘 만든 거로"): 문제 풀이는 더 이상 기억 저장소에
// 쓰지 않는다. "풀었다 = 맞힘"이 아니라, 배우는 과정에서 몰랐던 게 드러나고 배운 것만 기억이 된다 — 그건 PS 튜터(tutor/)가 한다
// (문제 화면의 AI 힌트·드래그 설명은 경로에서 tutor/service.ts noteAiHelp로). 여기 남은 일: 이번 풀이의 틀림·힌트·물어봄을
// 모아 두기(AI 튜터가 "이번 풀이에서"로 읽는다), 제출 채점, 훈련 모드 복기 저장. 예전에 만든 문제의 knowledgeIds는 그대로 두지만 쓰지 않는다.
//
// 이번 풀이 (2026-10-26): while a problem is being solved, its 틀림 · 힌트 · 물어봄 wait in the attempt. The AI tutor sees
// them as this attempt (never "지난번에도"); the attempt is cleared when it ends: 맞았습니다, leaving, or two hours idle.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KEventKind } from "../knowledge/api.ts";
import { listProblems, readProblemMeta, submit, type Problem, type ProblemMeta } from "./problems.ts";
import { VERDICT_LABEL, type Lang } from "./run.ts";
import { saveStep } from "./train.ts";

/** 11/8부터 아무것도 하지 않는다(문제의 개념 이름을 기억으로 만들지 않음). 부르는 곳이 많아 이름은 남긴다. */
export async function ensureProblemKnowledge<T extends Problem | ProblemMeta>(problem: T): Promise<T> {
  return problem;
}
export async function listProblemsWithKnowledge() {
  await endIdleAttempts();
  return listProblems();
}

/* ---------- 이번 풀이: what happened in the attempt still going on ---------- */
export type AttemptEvent = { at: string; kind: Extract<KEventKind, "wrong" | "hint" | "asked">; detail: string; /** 물어봄의 튜터 답(11/11, 끝날 때 정리에 씀) */ answer?: string };
export type Attempt = { startedAt: string; lastAt: string; events: AttemptEvent[] };
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
/** 이번 풀이 그대로(문제 한 장 정리용, tutor/sheets.ts). */
export async function peekAttempt(problemId: string): Promise<Attempt | undefined> { return (await readAttempts())[problemId]; }
/** 끝나서 지운 풀이를 잠깐 들고 있는다: 맞았습니다로 끝난 풀이도 문제 한 장으로 정리할 수 있게(tutor/sheets.ts가 가져감). */
const ended = globalThis as unknown as { __endedAttempts?: Map<string, Attempt> };
export function takeEnded(problemId: string) { const m = (ended.__endedAttempts ??= new Map()); const a = m.get(problemId); m.delete(problemId); return a; }
/** 튜터 답을 마지막 물어봄에 붙인다(11/11 "한 문제를 풀면서 기억을 가져가야"). */
export async function noteAnswer(problemId: string, answer: string, kind: "asked" | "hint" = "asked") {
  await serial(async () => {
    const all = await readAttempts();
    const ev = [...(all[problemId]?.events ?? [])].reverse().find((e) => e.kind === kind && !e.answer);
    if (!ev) return;
    ev.answer = answer.slice(0, 1500);
    await writeAttempts(all);
  });
}
/** This attempt so far, for the tutor: told as this attempt, not as an earlier one. */
export async function currentAttempt(problemId: string): Promise<AttemptEvent[]> {
  return (await readAttempts())[problemId]?.events ?? [];
}
/** The attempt ends (맞았습니다, leaving the problem, or two hours without a move): it is cleared. 11/8부터 기억에는 쓰지 않는다. */
export async function endAttempt(problemId: string, ending?: { kind: "correct" | "note"; detail: string }, now = new Date().toISOString()) {
  void now;
  const attempt = await serial(async () => {
    const all = await readAttempts();
    const found = all[problemId];
    if (found) { delete all[problemId]; await writeAttempts(all); (ended.__endedAttempts ??= new Map()).set(problemId, found); }
    return found;
  });
  return { recorded: 0, ended: (attempt?.events.length ?? 0) + (ending ? 1 : 0) };
}
/** 두 시간 그대로인 풀이(문제 한 장으로 먼저 정리하려고 고른다). */
export async function idleAttempts(now = Date.now()) { return Object.entries(await readAttempts()).filter(([, a]) => now - Date.parse(a.lastAt) > ATTEMPT_IDLE_MS).map(([id]) => id); }
/** Attempts left without a move for two hours end as they stand. */
export async function endIdleAttempts(now = Date.now()) {
  const all = await readAttempts();
  for (const [id, a] of Object.entries(all)) if (now - Date.parse(a.lastAt) > ATTEMPT_IDLE_MS) await endAttempt(id, undefined, new Date(now).toISOString()).catch(() => undefined);
}

/**
 * 제출 → 채점. Only "제출" counts: 맞았습니다 ends the attempt; 틀림·시간 초과·런타임 에러 wait in the attempt as 틀림.
 * PS 튜터는 이 제출 기록을 읽어 "혼자 구현"을 확인한다(tutor/service.ts).
 */
export async function submitAndRecord(problemId: string, lang: Lang, code: string, mode: "example" | "submit", hints: number, advice = 0) {
  const result = await submit(problemId, lang, code, mode, hints);
  if (mode === "submit" && result.verdict !== "CE" && result.verdict !== "MISSING") {
    // 훈련 모드 · 지켜보기 (2026-10-31): passing with the steps checked one by one, or after the watcher's warnings, is not
    // 앎 yet (a note); 앎 comes from solving it alone later, as after hints.
    if (result.verdict === "AC") await endAttempt(problemId, hints ? { kind: "note", detail: `힌트 ${hints}번 받고 통과` }
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
 * 복기 (훈련 모드 7단계, 2026-10-31): kept in the step record. 11/8부터 기억에는 쓰지 않는다.
 */
export async function saveReview(problemId: string, review: { idea?: string; stuck?: string; transfer?: string }) {
  const lines = [review.idea?.trim() && `핵심 발상: ${review.idea.trim()}`, review.stuck?.trim() && `막힌 이유: ${review.stuck.trim()}`, review.transfer?.trim() && `다른 문제에도: ${review.transfer.trim()}`].filter(Boolean) as string[];
  await saveStep(problemId, "review", { answer: review });
  return { recorded: 0, lines: lines.length };
}
