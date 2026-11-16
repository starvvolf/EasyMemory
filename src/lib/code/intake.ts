// 문제 받기 창구 (11/16 사용자): 입력창 하나 + 캡처 이미지. AI 1번이 지시문의 규칙표대로 길을 고르고 값을 채운다.
//  - 캡처 이미지 → 그 문제를 옮겨 적고, 잘리거나 안 보이거나 빠진 조건은 채워 넣는다(채운 것은 assumed로 따로)
//  - 문제 · 강의 글을 붙여 넣음 → 그 글 그대로(원문은 앱이 넘기고 AI가 옮겨 쓰지 않는다)
//  - 문제 번호 · 주소 · 이름 → 그 문제를 따라간다(이름이면 웹 검색으로 번호 · 주소를 찾는다)
//  - 그 밖(풀고 싶은 문제를 말함, 빈 입력) → 맞는 문제를 웹에서 찾아 후보로
// 길만 고르면 뒤는 지금의 /api/code/make(from · lesson)가 만든다. 내장 문제집은 쓰지 않는다(공유 배포판에서 뺄 예정).
import { askJson, S } from "../assist/model.ts";
import { findContext, pickCandidates, type Found } from "./find.ts";

export type Route = "image" | "paste" | "named" | "find";
export type IntakeLang = "python" | "javascript" | "cpp" | "csharp";
export type Intake = { route: Route; say: string; kind: "full" | "blank"; lang?: IntakeLang; from?: string; lesson?: string; assumed?: string[]; candidates?: Found[] };

export const INTAKE_SYSTEM = `너는 알고리즘 공부 앱의 "문제 받기" 창구다. 학습자가 입력창 하나에 적은 글(과 붙인 캡처 이미지)을 보고, 할 일을 하나 고르고 필요한 칸을 채운다.

## 길 (위에서부터 맞는 첫 번째)
1. image — 캡처 이미지가 붙어 있다. 이미지 속 문제를 lesson에 그대로 옮겨 적는다: 제목 · 설명 · 입력 · 출력 · 제한(시간 · 메모리 · 값의 범위) · 예제 입력/출력을 빠짐없이, 이미지에 있는 문장 그대로.
   잘렸거나 흐려서 안 보이거나 아예 빠진 조건(값의 범위, 시간 제한, 출력 형식, 예제 등)이 있으면 문제 뜻에 맞게 채워 lesson에 넣고, 채운 것은 assumed에 한 줄씩 적는다(무엇을 어떻게 채웠나). 다 보이면 assumed는 빈 목록.
2. paste — 문제 글이나 강의 · 풀이 글을 붙여 넣었다(여러 줄, 문제 설명 · 입력 · 출력 · 코드 같은 내용). lesson은 비워 둔다(앱이 붙여 넣은 원문을 그대로 쓴다).
3. named — 특정 문제 하나를 가리켰다: 백준 번호(예: 7785), 문제 페이지 주소, 문제 이름(예: "백준 토마토", "프로그래머스 타겟 넘버"). from에 백준 번호(숫자만) 또는 문제 페이지 주소를 넣는다. 이름만 왔으면 웹 검색으로 그 문제를 찾아 번호나 주소를 넣는다. 같은 문제가 백준에 있으면 백준 번호를 쓴다. 찾지 못했으면 from을 비우고 비슷한 후보를 candidates에 넣는다.
4. find — 그 밖: 어떤 문제를 풀고 싶다고 말함("BFS 쉬운 거", "투 포인터 하나 더", "다음 거"), 또는 빈 입력. 웹 검색으로 실제로 있는 문제 후보 3~5개를 candidates에 넣는다.

## candidates 규칙 (find, 또는 named에서 못 찾았을 때)
- 웹 검색으로 실제로 있는 문제만. 지어내지 않는다. 백준 먼저(주소 https://www.acmicpc.net/problem/번호), 없으면 프로그래머스 · 코드포스 · AtCoder 등. 블로그 글이면 그 글이 다루는 문제의 원래 주소.
- 표준 입력 → 표준 출력 문제만. 스페셜 저지, 실수 오차 허용, 함수만 채우는 문제, 인터랙티브 문제는 뺀다.
- [이미 있는 문제]는 고르지 않는다. [최근 한 것] · [푼 문제] · [학습자 기억]으로 수준을 맞춘다: 최근에 틀렸으면 비슷하거나 조금 쉬운 것, 잘 풀었으면 한 단계 위. 빈 입력이면 [다음에 배울 것]의 맨 앞으로.
- 후보마다 title · number(백준이면 번호) · url · site · level("실버 4"처럼, 모르면 "") · pattern(푸는 방법 하나) · why(왜 지금 이 문제인지 한 문장, 해요체).

## 모든 길에 공통
- kind: 글에 "빈칸"이라는 말이 있으면 "blank", 아니면 "full".
- lang: 글에 언어 이름이 있으면 python · javascript · cpp · csharp 중 하나(파이썬 → python, 자바스크립트 · JS → javascript, C++ → cpp, C# → csharp). 없으면 "".
- say: 학습자에게 보여 줄 한 줄(해요체, 쉬운 말): 무엇을 할지. 예: "백준 7785번 '회사에 있는 사람'을 가져올게요." / "캡처에서 문제를 읽었어요. 안 보인 조건 2개는 채워 넣었어요." / "붙여 넣은 글로 문제를 만들게요." / "BFS 연습 문제를 찾아 왔어요."
- 쓰지 않는 칸은 빈 값("" 또는 []).`;

const found = S.obj({ title: S.str, number: S.str, url: S.str, site: S.str, why: S.str, level: S.str, pattern: S.str });
export const INTAKE_SCHEMA = S.obj({ route: S.oneOf("image", "paste", "named", "find"), say: S.str, kind: S.oneOf("full", "blank"), lang: S.oneOf("", "python", "javascript", "cpp", "csharp"),
  from: S.str, lesson: S.str, assumed: S.arr(S.str), candidates: S.arr(found) });
type Reply = { route: Route; say: string; kind: "full" | "blank"; lang: "" | IntakeLang; from: string; lesson: string; assumed: string[]; candidates: Found[] };

export type IntakeAsk = (system: string, user: string, images: Array<{ label: string; dataUrl: string }>) => Promise<Reply>;
const defaultAsk: IntakeAsk = (system, user, images) => askJson<Reply>("code:intake", system, user, INTAKE_SCHEMA, { webSearch: true, ...(images.length ? { images: images.map((i) => ({ ...i, detail: "high" as const })) } : {}) });

const ROUTE_TEXT_CAP = 3000; // 길만 고르는 데는 앞부분이면 된다. 붙여 넣은 원문은 앱이 통째로 만들기로 넘긴다.
export const fromOf = (raw: string) => {
  const t = raw.trim();
  const num = /^(\d{3,6})$/.exec(t)?.[1] ?? /acmicpc\.net\/problem\/(\d{3,6})\b/.exec(t)?.[1];
  if (num) return num;
  return /^https?:\/\/\S+$/i.test(t) ? t : "";
};

/** 코드가 받친다: 길과 칸이 맞지 않으면 AI 말을 믿지 않고 바로잡는다. */
export function settle(reply: Reply, input: { text: string; image?: string }, have: Set<string>): Intake {
  const kind = reply.kind === "blank" ? "blank" as const : "full" as const;
  const lang = reply.lang || undefined;
  const base = { say: (reply.say ?? "").slice(0, 200), kind, ...(lang ? { lang } : {}) };
  const candidates = () => pickCandidates(reply.candidates ?? [], have);
  if (input.image && (reply.route === "image" || !reply.route)) {
    const lesson = (reply.lesson ?? "").trim();
    if (lesson.length < 20) throw Object.assign(new Error("캡처에서 문제를 읽지 못했어요. 문제 부분이 잘 보이게 다시 캡처해 주세요."), { status: 422 });
    const extra = input.text.trim() ? `\n\n[학습자가 덧붙인 말] ${input.text.trim().slice(0, 1000)}` : "";
    const assumed = (reply.assumed ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 10);
    return { route: "image", ...base, lesson: lesson + (assumed.length ? `\n\n[캡처에서 안 보여 채운 조건 — 문제 글에 (추정)으로 표시]\n- ${assumed.join("\n- ")}` : "") + extra, assumed };
  }
  if (reply.route === "paste" && input.text.trim().length >= 20) return { route: "paste", ...base, lesson: input.text };
  if (reply.route === "named") {
    // 입력 자체가 번호 · 주소면 그것이 먼저(AI가 바꿔 적어도)
    const from = fromOf(input.text) || fromOf(reply.from ?? "");
    if (from) return { route: "named", ...base, from };
    return { route: "find", ...base, say: base.say || "그 문제를 바로 찾지 못해서 비슷한 문제를 찾아 왔어요.", candidates: candidates() };
  }
  if (reply.route === "paste") return { route: "find", ...base, candidates: candidates() };
  // 번호 · 주소만 적었는데 AI가 find로 보냈으면 그 문제로
  const direct = fromOf(input.text);
  if (direct && reply.route !== "find") return { route: "named", ...base, from: direct };
  if (direct) return { route: "named", ...base, say: base.say || "그 문제를 가져올게요.", from: direct };
  return { route: "find", ...base, candidates: candidates() };
}

export async function intake(input: { text: string; image?: string }, ask: IntakeAsk = defaultAsk): Promise<Intake> {
  const c = await findContext();
  const text = input.text.trim();
  const user = [
    c.recent.length ? `[최근 한 것]\n${c.recent.join("\n")}` : "[최근 한 것] 없음(처음)",
    c.solved.length ? `[푼 문제] ${c.solved.join(", ")}` : "",
    c.memory ? `[학습자 기억]\n${c.memory}` : "",
    c.next.length ? `[다음에 배울 것] ${c.next.join(" → ")}` : "",
    c.have.size ? `[이미 있는 문제(백준 번호)] ${[...c.have].slice(0, 200).join(", ")}` : "",
    `[캡처 이미지] ${input.image ? "있음(아래)" : "없음"}`,
    `[입력]${text.length > ROUTE_TEXT_CAP ? ` (앞 ${ROUTE_TEXT_CAP}자만, 전체 ${text.length}자)` : ""}\n${text ? text.slice(0, ROUTE_TEXT_CAP) : "(비어 있음)"}`,
  ].filter(Boolean).join("\n\n");
  const reply = await ask(INTAKE_SYSTEM, user, input.image ? [{ label: "학습자가 붙인 캡처", dataUrl: input.image }] : []);
  return settle(reply, input, c.have);
}
