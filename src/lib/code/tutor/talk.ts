// 대화 장부 (11/11 사용자 "AI한테 채팅으로 물어보는 거… 그런 기록도 푼 과정에 저장이 되어 있어야 돼. 내가 '이거 아니야?' 물어봤는데
// 사실 아니었으면, 내가 혼란을 가지고 있는 거고… 그런 게 다 담겨 있어야 나중에 다시 가공해서 쓸 수 있다").
// 문제 화면에서 AI와 주고받은 것을 원문 그대로 덧붙이기만 한다(요약 없음, AI 호출 없음). 이번 풀이 메모·문제 한 장·카드 정리는 그대로이고,
// 이 장부는 그 옆에 따로 쌓인다. 기억 도서관의 풀이 노트 "푼 과정"이 읽는다(GET /api/code/tutor/talk).
// 데이터 폴더 code/tutor/talk.jsonl (한 줄 = 주고받은 한 번). 공개 저장소에는 올리지 않는다.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TalkKind = "질문" | "힌트" | "도움 칸" | "오류 설명" | "맞는지 봐 줘" | "반례" | "훈련 질문";
export type Talk = { id: string; at: string; problemId: string; number?: string; kind: TalkKind; q: string; a: string; selection?: string; code?: string; verdict?: string };

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
const file = () => path.join(dir(), "talk.jsonl");
const cut = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

/** 백준 번호: 튜터 문제(cp_boj_N·연결된 문제) 또는 제목의 "BOJ N". */
async function numberOf(problemId: string) {
  try {
    const { tutorNumberOf } = await import("./problem-model.ts");
    const n = await tutorNumberOf(problemId);
    if (n) return n;
  } catch { /* 튜터 재료가 없음 */ }
  try {
    const { readProblemMeta } = await import("../problems.ts");
    return /^BOJ\s*(\d+)/.exec((await readProblemMeta(problemId)).title)?.[1];
  } catch { return undefined; }
}

let writing: Promise<unknown> = Promise.resolve();
export function appendTalk(t: { problemId: string; kind: TalkKind; q: string; a: string; selection?: string; code?: string; verdict?: string; number?: string }): Promise<Talk> {
  const run = writing.then(async () => {
    const number = t.number ?? await numberOf(t.problemId);
    const row: Talk = { id: `tk_${randomBytes(5).toString("hex")}`, at: new Date().toISOString(), problemId: t.problemId, ...(number ? { number } : {}), kind: t.kind,
      q: cut(t.q, 4000), a: cut(t.a, 8000), ...(t.selection ? { selection: cut(t.selection, 4000) } : {}), ...(t.code ? { code: cut(t.code, 4000) } : {}), ...(t.verdict ? { verdict: cut(t.verdict, 20) } : {}) };
    await mkdir(dir(), { recursive: true });
    await appendFile(file(), `${JSON.stringify(row)}\n`, "utf8");
    return row;
  });
  writing = run.catch(() => undefined);
  return run;
}
/** 화면을 기다리게 하지 않고 남긴다(실패해도 답은 그대로). */
export const keepTalk = (t: Parameters<typeof appendTalk>[0]) => { void appendTalk(t).catch(() => undefined); };

export async function readTalk(filter: { problemId?: string; number?: string } = {}): Promise<Talk[]> {
  let lines: string[] = [];
  try { lines = (await readFile(file(), "utf8")).split("\n").filter(Boolean); } catch { return []; }
  const rows = lines.flatMap((l) => { try { return [JSON.parse(l) as Talk]; } catch { return []; } });
  return rows.filter((r) => (!filter.problemId || r.problemId === filter.problemId) && (!filter.number || r.number === filter.number)).sort((a, b) => a.at.localeCompare(b.at));
}
