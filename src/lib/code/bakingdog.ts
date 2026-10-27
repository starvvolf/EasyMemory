// 바킹독 workbook 문제 내장 (docs/DECISIONS.md 2026-10-26): the list ships with the app (bakingdog-workbook.json, made by
// scripts/bakingdog-workbook.mjs); a problem is filled the first time it is picked — the original from the Internet
// Archive, the lecture's solution from GitHub — and saved only in the data folder. The lecture's solution must pass the
// original examples, then makeProblem builds the hidden tests and the solution must print the same on every one of them.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import workbook from "./bakingdog-workbook.json" with { type: "json" };
import { archivedBojProblem, type Fetcher } from "./archive.ts";
import { judge, type Lang } from "./run.ts";
import { CodeError, deleteProblem, readProblemMeta, type Problem, type ProblemMeta } from "./problems.ts";
import { makeProblem } from "../assist/code-ai.ts";

export type WorkbookProblem = { category: string; recommended: boolean; number: string; title: string; solution: string };
export type Chapter = { chapter: string; title: string; problems: WorkbookProblem[] };
export const CHAPTERS = (workbook as { chapters: Chapter[] }).chapters;
export type Fill = { status: "ready" | "failed"; problemId?: string; reason?: string; at: string };

export const problemIdOf = (number: string) => `cp_boj_${number}`;
const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code");
const statusFile = () => path.join(root(), "bakingdog.json");
async function readFills(): Promise<Record<string, Fill>> { try { return JSON.parse(await readFile(statusFile(), "utf8")) as Record<string, Fill>; } catch { return {}; } }
async function writeFill(number: string, fill: Fill) {
  const all = await readFills(); all[number] = fill;
  await mkdir(root(), { recursive: true });
  const tmp = `${statusFile()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 1), "utf8");
  await rename(tmp, statusFile());
}

/** The built-in list with each problem's state: 준비됨 (filled), 실패 (why) or 준비 안 됨. */
export async function chapters() {
  const fills = await readFills();
  return CHAPTERS.map((c) => ({ ...c, problems: c.problems.map((p) => ({ ...p, hasSolution: Boolean(p.solution), fill: fills[p.number] ?? null })) }));
}

const LANG_OF: Record<string, Lang> = { cpp: "cpp", cc: "cpp", py: "python", js: "javascript", cs: "csharp" };
type Deps = { fetcher: Fetcher; make: typeof makeProblem };

/** Fills one problem. Refuses (and records why) when there is no archived original, no solution, or a check fails. */
export async function fillProblem(number: string, deps: Deps = { fetcher: fetch, make: makeProblem }): Promise<Problem | ProblemMeta> {
  const chapter = CHAPTERS.find((c) => c.problems.some((p) => p.number === number));
  const row = chapter?.problems.find((p) => p.number === number);
  if (!chapter || !row) throw new CodeError(404, "바킹독 문제집에 없는 문제예요.");
  const existing = await readProblemMeta(problemIdOf(number)).catch(() => null);
  if (existing) return existing;
  const fail = async (reason: string): Promise<never> => { await writeFill(number, { status: "failed", reason, at: new Date().toISOString() }); throw new CodeError(422, reason); };

  if (!row.solution) return fail("문제집에 정답 코드 링크가 없어요.");
  const lang = LANG_OF[/\.(\w+)$/.exec(row.solution)?.[1] ?? ""];
  if (!lang) return fail(`정답 코드 언어를 실행할 수 없어요 (${row.solution.split("/").pop()}).`);
  const original = await archivedBojProblem(number, deps.fetcher).catch(() => null);
  if (!original) return fail("인터넷 아카이브에서 이 문제의 원문을 찾지 못했어요.");
  const codeResponse = await deps.fetcher(row.solution, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!codeResponse?.ok) return fail(`정답 코드를 받지 못했어요 (${codeResponse?.status ?? "연결 실패"}).`);
  const code = await codeResponse.text();

  // The lecture's solution must pass the original's examples before anything is built on it.
  const onExamples = await judge(lang, code, original.examples, { stopAtFirstFail: true, timeLimitMs: 5000 });
  if (onExamples.verdict === "MISSING") return fail(`이 컴퓨터에 ${lang} 실행기가 없어 정답 코드를 확인할 수 없어요.`);
  if (onExamples.verdict === "CE") return fail(`정답 코드가 이 컴퓨터에서 컴파일되지 않아요: ${onExamples.compile.slice(0, 200)}`);
  if (onExamples.verdict !== "AC") {
    const bad = onExamples.results.find((r) => r.verdict !== "AC");
    return fail(`정답 코드가 원문 예제 ${bad ? bad.index + 1 : "?"}번에서 ${onExamples.verdict}`);
  }
  const lesson = [`[받아 온 문제] BOJ ${number}번: ${original.title || row.title}`, `문제\n${original.statement}`, `입력\n${original.inputText}`, `출력\n${original.outputText}`,
    ...original.examples.flatMap((ex, i) => [`예제 입력 ${i + 1}\n${ex.input}`, `예제 출력 ${i + 1}\n${ex.output}`])].join("\n\n");
  try {
    const made = await deps.make({ id: problemIdOf(number), lesson, kind: "full", human: { lang, code }, folder: `바킹독/${chapter.chapter} ${chapter.title}`,
      sourceTitle: `바킹독 ${chapter.chapter} ${chapter.title} · ${row.category} · BOJ ${number}`, sourceUrl: original.url });
    if (made.check?.human !== "match") { await deleteProblem(made.id); return fail("정답 코드와 모범 풀이를 숨은 테스트에서 비교하지 못했어요."); }
    await writeFill(number, { status: "ready", problemId: made.id, at: new Date().toISOString() });
    return made;
  } catch (error) {
    if (error instanceof CodeError && error.status === 422) return fail(error.message);
    throw error;
  }
}
