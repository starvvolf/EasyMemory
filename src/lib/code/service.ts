// 코드 문제와 지식을 잇는 곳: a problem's knowledge lives in the knowledge store, and every submission leaves its mark
// there (맞힘 / 틀림 / 힌트), so the sidebar, the review queue and the agent see code practice like any other study.
import { recordEvent, saveMany } from "../knowledge/store.ts";
import { listProblems, readProblem, setProblemKnowledge, submit, type Problem } from "./problems.ts";
import { VERDICT_LABEL, type Lang } from "./run.ts";
import { SEED_KNOWLEDGE } from "./seeds.ts";

const filled = new Set<string>();

/** The problem's knowledge names as items (만남 the first time), ids written back on the problem. */
export async function ensureProblemKnowledge(problem: Problem) {
  // Seed problems also fill in their knowledge's meaning once per run (an item made before keeps its own text).
  const seedFill = problem.source.kind === "seed" && !filled.has(problem.id);
  if (problem.knowledgeIds.length === problem.knowledge.length && problem.knowledgeIds.length && !seedFill) return problem;
  filled.add(problem.id);
  const results = await saveMany(problem.knowledge.map((title) => ({ title, folder: problem.folder, ...(SEED_KNOWLEDGE[title] ? { body: SEED_KNOWLEDGE[title] } : {}),
    source: { kind: "code" as const, title: problem.title, ref: `code:${problem.id}` } })));
  return setProblemKnowledge(problem.id, results.map((r) => r.item.id));
}
export async function listProblemsWithKnowledge() {
  const list = await listProblems();
  for (const p of list) { try { await ensureProblemKnowledge(await readProblem(p.id)); } catch { /* listed anyway */ } }
  return list;
}

/**
 * 제출 → 채점 → 기록. Only "제출" counts: 맞았습니다 without hints is 맞힘 (→ 앎); after hints it is noted, since the hint
 * already marked 몰랐음; 틀림·시간 초과·런타임 에러 are 틀림. Compile errors and "예제 실행" leave the knowledge alone.
 */
export async function submitAndRecord(problemId: string, lang: Lang, code: string, mode: "example" | "submit", hints: number) {
  const problem = await ensureProblemKnowledge(await readProblem(problemId));
  const result = await submit(problemId, lang, code, mode, hints);
  if (mode === "submit" && result.verdict !== "CE" && result.verdict !== "MISSING") {
    const source = { kind: "code" as const, title: problem.title, ref: `code:${problem.id}` };
    for (const id of problem.knowledgeIds) {
      if (result.verdict === "AC") await recordEvent(id, hints ? "note" : "correct", hints ? `힌트 ${hints}번 받고 통과` : "힌트 없이 통과", source).catch(() => undefined);
      else {
        const failed = result.shown[0];
        await recordEvent(id, "wrong", `${VERDICT_LABEL[result.verdict]}${failed ? ` (입력 ${failed.input.split("\n")[0].slice(0, 40)}…)` : ""}`, source).catch(() => undefined);
      }
    }
  }
  return result;
}
export async function recordHint(problemId: string, level: number) {
  const problem = await ensureProblemKnowledge(await readProblem(problemId));
  for (const id of problem.knowledgeIds) await recordEvent(id, "hint", `힌트 ${level}단계: ${problem.title}`, { kind: "code", title: problem.title, ref: `code:${problem.id}` }).catch(() => undefined);
}
export async function recordAsked(problemId: string | undefined, detail: string) {
  if (!problemId) return;
  const problem = await ensureProblemKnowledge(await readProblem(problemId));
  for (const id of problem.knowledgeIds) await recordEvent(id, "asked", detail.slice(0, 200), { kind: "code", title: problem.title, ref: `code:${problem.id}` }).catch(() => undefined);
}
