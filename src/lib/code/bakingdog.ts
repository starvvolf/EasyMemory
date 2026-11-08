// 바킹독 workbook 문제 내장 (docs/DECISIONS.md 2026-10-26): the list ships with the app (bakingdog-workbook.json, made by
// scripts/bakingdog-workbook.mjs); a problem is filled the first time it is picked — the original from the Internet
// Archive — and saved only in the data folder. 강의 풀이는 11/9부터 쓰지 않는다(아래 fillProblem).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import workbook from "./bakingdog-workbook.json" with { type: "json" };
import { archivedBojProblem, type Fetcher } from "./archive.ts";
import { CodeError, readProblemMeta, savePreparing, setPreparing, type Problem, type ProblemMeta } from "./problems.ts";
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

type Deps = { fetcher: Fetcher; make: typeof makeProblem };

/** Fills one problem: the original from the Internet Archive, then makeProblem with that original (네 호출을 동시에 —
 *  가져온 백준 문제와 같은 길). 2026-11-09 사용자 "강의 풀이 빼고 AI 풀이만으로, 테스트는 합리적인 선에서 강하게":
 *  강의 풀이를 받아 대조하던 것을 뺐다(없는 문제도 같은 길로 가게). 바로 열기: 원문을 먼저 저장해 문제를 바로 열고,
 *  숨은 테스트는 뒤에서 만든다(wait면 끝까지 기다림). avoid: 틀린 풀이에 꼭 넣을 실수(튜터 교육용 모델의 틀린 접근·흔한 실수). */
export async function fillProblem(number: string, deps: Deps = { fetcher: fetch, make: makeProblem }, opts: { wait?: boolean; avoid?: string[] } = {}): Promise<Problem | ProblemMeta> {
  const chapter = CHAPTERS.find((c) => c.problems.some((p) => p.number === number));
  const row = chapter?.problems.find((p) => p.number === number);
  if (!chapter || !row) throw new CodeError(404, "문제집에 없는 문제예요.");
  const id = problemIdOf(number);
  const existing = await readProblemMeta(id).catch(() => null);
  if (existing) return existing;
  const fail = async (reason: string): Promise<never> => { await writeFill(number, { status: "failed", reason, at: new Date().toISOString() }); throw new CodeError(422, reason); };
  const original = await archivedBojProblem(number, deps.fetcher).catch(() => null);
  if (!original) return fail("인터넷 아카이브에서 이 문제의 원문을 찾지 못했어요.");
  const title = original.title || row.title;
  const lesson = [`[받아 온 문제] BOJ ${number}번: ${title}`, `문제\n${original.statement}`, `입력\n${original.inputText}`, `출력\n${original.outputText}`,
    ...original.examples.flatMap((ex, i) => [`예제 입력 ${i + 1}\n${ex.input}`, `예제 출력 ${i + 1}\n${ex.output}`])].join("\n\n");
  const folder = `알고리즘/${chapter.title}`;
  const build = async () => {
    try {
      const made = await deps.make({ id, lesson, kind: "full", folder, sourceTitle: `BOJ ${number} ${title}`, sourceUrl: original.url,
        original: { statement: original.statement, inputText: original.inputText, outputText: original.outputText, examples: original.examples },
        ...(opts.avoid?.length ? { mutantsHint: opts.avoid.slice(0, 6) } : {}) });
      await writeFill(number, { status: "ready", problemId: made.id, at: new Date().toISOString() });
      return made;
    } catch (error) {
      const reason = (error as Error).message.slice(0, 500);
      const meta = await readProblemMeta(id).catch(() => null);
      if (meta?.preparing) await setPreparing(id, { ...meta.preparing, error: reason }).catch(() => undefined);
      if (error instanceof CodeError && error.status === 422) return fail(reason);
      await writeFill(number, { status: "failed", reason, at: new Date().toISOString() });
      throw error;
    }
  };
  if (opts.wait || !original.examples.length) return build();
  const pending = await savePreparing({ id, title: `BOJ ${number}번: ${title}`, statement: original.statement, inputText: original.inputText, outputText: original.outputText,
    examples: original.examples, folder, source: { kind: "ai", title: `BOJ ${number} ${title}`, url: original.url }, from: number });
  void build().catch(() => undefined);
  return pending;
}
