// PS 튜터: 패턴 ↔ 기억 id, 문제 번호 → 패턴 (2026-11-08). 다른 모듈을 거의 부르지 않아서 code-ai.ts·code 경로에서도
// 순환 없이 쓸 수 있다(problem-model.ts는 bakingdog → code-ai를 불러서 여기서는 models.json을 직접 읽는다).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
export async function readLinks(): Promise<Record<string, string>> { try { return JSON.parse(await readFile(path.join(dir(), "links.json"), "utf8")) as Record<string, string>; } catch { return {}; } }
export async function writeLink(patternId: string, knowledgeId: string) {
  const links = await readLinks(); links[patternId] = knowledgeId;
  await mkdir(dir(), { recursive: true });
  const f = path.join(dir(), "links.json"), tmp = `${f}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(links), "utf8"); await rename(tmp, f);
}
/** 튜터 문제의 패턴(교육용 모델에 적힌 것). 튜터 문제가 아니면 빈 목록. */
export async function patternsOfNumber(number: string): Promise<string[]> {
  try { return (JSON.parse(await readFile(path.join(dir(), "models.json"), "utf8")) as Record<string, { patterns?: string[] }>)[number]?.patterns ?? []; } catch { return []; }
}
/** 문제 id(cp_boj_N) → 이미 기억이 된 패턴들의 기억 id. "지난번에도"를 말할 때 쓴다. */
/** 문제 화면의 id → 튜터 번호(cp_boj_N, 또는 재료가 있는 유저 문제). problem-model을 부르지 않는다(순환 import를 피하려고). */
export async function numberOfProblem(problemId: string): Promise<string | undefined> {
  const n = /^cp_boj_(\d{1,6})$/.exec(problemId)?.[1];
  if (n) return n;
  try { return Object.values(JSON.parse(await readFile(path.join(dir(), "models.json"), "utf8")) as Record<string, { number: string; problemId?: string }>).find((m) => m.problemId === problemId)?.number; } catch { return undefined; }
}
export async function memoryIdsOfProblem(problemId: string): Promise<string[]> {
  // 유저가 넣은 문제(11/10)는 재료의 problemId로 번호를 찾는다(problem-model을 부르지 않는 것은 순환 import를 피하려고).
  const n = /^cp_boj_(\d{1,6})$/.exec(problemId)?.[1] ?? await (async () => {
    try { return Object.values(JSON.parse(await readFile(path.join(dir(), "models.json"), "utf8")) as Record<string, { number: string; problemId?: string }>).find((m) => m.problemId === problemId)?.number; } catch { return undefined; }
  })();
  if (!n) return [];
  const [links, patterns] = await Promise.all([readLinks(), patternsOfNumber(n)]);
  return patterns.map((p) => links[p]).filter(Boolean);
}
