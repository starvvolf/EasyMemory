// 문제 찾아오기 (11/11 사용자 "다음 문제를 어디서 구하고 싶어. 인터넷에 찾긴 귀찮아. 얘가 서치해서 긁어오는 거지",
// "이전에 풀었던 완료한 기록, 마지막으로 했던 것 프롬프트에 살짝 넣으면 좋을 듯"). 웹 글 규칙의 예외(DECISIONS 11/11 PS 튜터 시뮬레이션).
// AI 웹 검색 1번으로 후보를 받고, 이미 있는 문제는 코드가 거른다. 고른 후보는 지금의 /api/code/make(from = 번호나 주소)로 만든다:
// 원문 받기 → AI 4번 동시 → 숨은 테스트 검증 → 저장. 이 파일은 고르기까지만.
import { askJson, S } from "../assist/model.ts";
import { listProblems, type ProblemLite } from "./problems.ts";

export type Found = { title: string; number: string; url: string; site: string; why: string; level: string; pattern: string };

export const FIND_SYSTEM = `너는 알고리즘(PS) 공부를 돕는 사서다. 학습자가 다음에 풀 문제를 웹에서 찾아 후보를 고른다.
- 웹 검색으로 실제로 있는 문제만 고른다. 지어내지 않는다. 주소는 문제 페이지 주소(백준이면 https://www.acmicpc.net/problem/번호).
- 백준 문제를 먼저 찾는다(원문을 가져오기 쉽다). 없으면 프로그래머스·코드포스·AtCoder 등. 블로그 글은 그 글이 다루는 문제의 원래 주소를 적는다.
- 표준 입력 → 표준 출력 문제만. 답이 여러 개인 문제(스페셜 저지), 실수 오차를 허용하는 문제, 함수만 채우는 문제, 그림·인터랙티브 문제는 뺀다.
- [이미 있는 문제]는 고르지 않는다. [최근 한 것]·[푼 문제]를 보고 수준을 맞춘다: 최근에 틀렸으면 비슷하거나 조금 쉬운 것, 잘 풀었으면 한 단계 위.
- [요청]이 비어 있으면 [다음에 배울 것]의 맨 앞 패턴으로 찾는다.
- 후보는 서로 다른 문제 3~5개. why는 학습자에게 보여 줄 한 문장(해요체, 쉬운 말): 왜 지금 이 문제인지. level은 "브론즈 2"·"실버 4"처럼 알면 적고 모르면 "".
- pattern은 이 문제를 푸는 방법 이름 한 개(예: "BFS", "누적 합").`;
const SCHEMA = S.obj({ candidates: S.arr(S.obj({ title: S.str, number: S.str, url: S.str, site: S.str, why: S.str, level: S.str, pattern: S.str })) });

const STATUS: Record<ProblemLite["status"], string> = { new: "안 풂", tried: "예제만 돌림", wrong: "틀림", solved: "맞음" };
const bojOf = (title: string) => /^BOJ\s*(\d+)/.exec(title)?.[1] ?? "";

/** 학습자 기록 요약(코드가 고름): 최근 한 것 5개, 푼 문제 30개, 이미 있는 백준 번호, 다음에 배울 패턴 3개. */
export async function findContext() {
  const list = await listProblems();
  const recent = list.filter((x) => x.lastAt).slice(0, 5).map((x) => `- ${x.title} (${STATUS[x.status]}${x.tries ? `, 제출 ${x.tries}번` : ""}, ${x.lastAt.slice(5, 10).replace("-", "/")})`);
  const solved = list.filter((x) => x.status === "solved").slice(0, 30).map((x) => x.title.replace(/^BOJ (\d+)번: /, "$1 "));
  const have = new Set(list.map((x) => bojOf(x.title)).filter(Boolean));
  let next: string[] = [], memory = "";
  try {
    const [{ readEvents, computeState }, { readProfile }, { learningOrder }, { readModels }, { readMemory, memoryText, MEMORY_LEGEND }] = await Promise.all([
      import("./tutor/state.ts"), import("./tutor/profile.ts"), import("./tutor/policy.ts"), import("./tutor/problem-model.ts"), import("./tutor/memory.ts")]);
    const [events, profile, models] = await Promise.all([readEvents(), readProfile(), readModels()]);
    for (const n of Object.keys(models)) have.add(n);
    next = learningOrder(computeState(events), profile.focus.length ? profile : undefined).list.slice(0, 3).map((p) => p.name);
    const text = memoryText(await readMemory(), { maxRows: 6, withErrors: true, withRecent: true });
    memory = text ? `${MEMORY_LEGEND}\n${text}` : "";
  } catch { /* 튜터 기록이 없으면 문제 목록만 */ }
  return { recent, solved, have, next, memory };
}

export async function findProblems(query: string): Promise<{ candidates: Found[] }> {
  const c = await findContext();
  const user = [
    c.recent.length ? `[최근 한 것]\n${c.recent.join("\n")}` : "[최근 한 것] 없음(처음)",
    c.solved.length ? `[푼 문제] ${c.solved.join(", ")}` : "",
    c.memory ? `[학습자 기억]\n${c.memory}` : "",
    c.next.length ? `[다음에 배울 것] ${c.next.join(" → ")}` : "",
    c.have.size ? `[이미 있는 문제(백준 번호)] ${[...c.have].slice(0, 200).join(", ")}` : "",
    `[요청] ${query.trim() || "(비어 있음)"}`,
  ].filter(Boolean).join("\n\n");
  const raw = await askJson<{ candidates?: Found[] }>("code:find", FIND_SYSTEM, user, SCHEMA, { webSearch: true });
  return { candidates: pickCandidates(raw.candidates ?? [], c.have) };
}

/** 코드가 거른다: 주소도 번호도 없는 것, 이미 있는 백준 번호, 같은 문제 두 번. 최대 3개. */
export function pickCandidates(list: Found[], have: Set<string>) {
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const f of list) {
    const number = (/^\d{3,6}$/.exec(f.number?.trim() ?? "")?.[0]) ?? (/acmicpc\.net\/problem\/(\d{3,6})/.exec(f.url ?? "")?.[1] ?? "");
    const url = /^https?:\/\//i.test(f.url?.trim() ?? "") ? f.url.trim() : number ? `https://www.acmicpc.net/problem/${number}` : "";
    if (!url) continue;
    const key = number || url.replace(/[?#].*$/, "").replace(/\/$/, "");
    if ((number && have.has(number)) || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: (f.title ?? "").slice(0, 120), number, url, site: (f.site ?? "").slice(0, 40), why: (f.why ?? "").slice(0, 200), level: (f.level ?? "").slice(0, 20), pattern: (f.pattern ?? "").slice(0, 40) });
    if (out.length >= 3) break;
  }
  return out;
}
