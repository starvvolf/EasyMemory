// 줄기 먼저 + 영역 강의 실험 (11/10 사용자 "메인 커리큘럼을 그냥 쭉 뽑자 … 사이사이에 모르는 거 있으면 대화 내용 잘라서 넣어서 주면 되잖아",
// "큰 파트 나눠서 가도 되긴 할 듯", "솔한테 처음에 자료 큰그림 정리 후에 첫 덩어리 시키면?", "sol low 말고 medium 써도 될 듯?"). 제품 흐름에 넣지 않는다.
//   1. 줄기(sol, low·medium 동시): 자료 전체(쪽 글자 + 그림) → 영역 · 걸음(앞이 모자란 것 하나를 채우는 이야기 마디) · 기억(몰랐음 단위, 흐름/부품) · 기억 없는 쪽의 까닭
//      코드가 점검: 걸음에 안 든 쪽, 기억도 까닭도 없는 쪽, 쪽이 많은 기억, 이름 겹침.
//   2. 영역 강의(sol low, 한 흐름): 줄기 전체 + 그 영역 쪽(글자 + 그림) → 걸음 순서로 강의. ⟦걸음 n⟧ ⟦카드 mN⟧ ⟦그림: 이름표 | 볼 것⟧ ⟦확인⟧ ⟦답⟧.
//      앞쪽(지시문 · 줄기 · 영역 쪽)은 영역 안 질문과 같게 두어 session_id 캐시가 붙게 하고, 할 일은 tail로.
// GPT 채팅으로 해 본 것(11/10)에서 나온 것을 지시문에 반영: 밖의 그림 금지, 기호는 원문 이름 그대로, 큰 방법은 흐름 + 부품, 표의 값은 곁, 답은 글로.
// 지시문에 개수·글자 수 제한을 두지 않는다(사용자).
import { callModel } from "../ai/model.ts";
import { currentTrace, withTrace } from "../ai/trace.ts";
import { LOCAL_CALLER, logAssistCall, S } from "../assist/model.ts";

type Img = { page: number; label: string; dataUrl: string };
const log = (purpose: string, m: { model: string; effort: string }, started: number, u: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number } | undefined, inChars: number, firstTextMs?: number) =>
  logAssistCall({ at: new Date(started).toISOString(), purpose, ...m, ms: Date.now() - started, ...(firstTextMs ? { firstTextMs } : {}), ok: true, inChars,
    ...(u ? { tokens: { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } } : {}), trace: currentTrace() });

export const LP_PLAN_SYSTEM = `너는 이 강의 자료 한 편 전체(쪽마다 [p.N] 원문, 그림으로 된 쪽과 그림 조각은 "원문 p.N" 이름표의 이미지)를 보고, 학생이 공부할 계획(줄기)을 세운다. 강의 내용은 쓰지 않는다.
먼저 (쓰지 말고) 생각한다: 이 강의가 풀려는 문제는 무엇이고, 어떤 순서로 풀어 가는가? 세운 뒤에는 아래 규칙으로 스스로 다시 점검하고 고친 것을 낸다.

영역: 같은 큰 질문에 답하는 이어진 쪽들. 자료 순서로. name은 자료의 말, question은 이 영역이 답하는 질문 한 줄.

걸음: 영역 안에서 강의가 한 번에 하나씩 넘어가는 이야기 마디. 번호 n은 강의 전체에서 이어서 붙인다.
- 걸음 하나 = 앞 걸음까지로는 모자란 것 하나를 이 걸음이 채운다. title은 "모자람 → 채움"이 보이게.
- 표지·목차·참고문헌이 아닌 모든 쪽은 어느 걸음의 pages에 들어간다. 그림만 있는 쪽도 그림을 읽고 넣는다.

기억: 학생이 외우고 복습할 단위. 다음 셋을 모두 만족해야 기억 하나다.
- 질문 하나로 물을 수 있다. 학생이 "이걸 몰랐다"고 한 문장으로 말할 수 있다. 다른 기억 없이 혼자 읽혀도 뜻이 선다.
- 같은 것을 다른 꼴로 적은 쪽들은 기억 하나다. 한 기억이 다른 기억 안에 통째로 들어가면 하나로 합친다.
- 방법·알고리즘이 한 걸음 안에서 끝나면 기억 하나(식·조건·경우를 모두 안에).
- 방법이 여러 걸음에 걸치면: 단계 전체의 순서를 담은 흐름 기억 하나(part_of는 빈 칸) + 걸음마다 따로 물을 수 있는 부품 기억(part_of = 흐름 기억 id).
- name은 자료에 나온 용어 그대로(원어가 있으면 괄호로). 식의 기호도 자료에 적힌 이름 그대로 생각한다.
- kind: 용어 · 사실 · 목록 · 조건(판정 규칙) · 절차 · 공식 · 비교 · 개념 · 패턴.
- role: 메인 = 이 강의에서 새로 배우고 시험에 나올 것. 바탕 = 이 강의 전에 알고 와야 하고 설명 없이 쓰이는 것(앞 과목의 수학 식·정의). 곁 = 배경·종류 나열·참고용 표의 값·덧붙인 이야기.
- pages: 근거 쪽 전부. shown_at: 이 기억이 다 갖춰지는 걸음 번호(여러 걸음에 걸치면 마지막 걸음).
- confuse: 두 쪽이 같은 것을 다르게 적었거나(기호·계수가 다름) 학생이 실제로 헷갈릴 점이 원문으로 분명하면 한 줄, 없으면 빈 칸.

no_memory: 어느 기억의 pages에도 안 든 쪽만, 그 까닭(표지, 안내, 보기 그림 등)과 함께.`;

const PLAN_SCHEMA = S.obj({
  problem: S.str,
  areas: S.arr(S.obj({ name: S.str, question: S.str, steps: S.arr(S.obj({ n: S.int, title: S.str, pages: S.arr(S.int) })) })),
  memories: S.arr(S.obj({ id: S.str, name: S.str, kind: S.str, role: S.oneOf("메인", "바탕", "곁"), area: S.int, pages: S.arr(S.int), shown_at: S.int, part_of: S.str, confuse: S.str })),
  no_memory: S.arr(S.obj({ page: S.int, reason: S.str })),
});
export type LpPlan = {
  problem: string;
  areas: Array<{ name: string; question: string; steps: Array<{ n: number; title: string; pages: number[] }> }>;
  memories: Array<{ id: string; name: string; kind: string; role: string; area: number; pages: number[]; shown_at: number; part_of: string; confuse: string }>;
  no_memory: Array<{ page: number; reason: string }>;
};

/** 코드 점검: 걸음에 안 든 쪽, 기억도 까닭도 없는 쪽, 쪽이 많은 기억, 이름 겹침, 흐름·부품. */
export function checkPlan(plan: LpPlan, pages: number[]) {
  const steps = plan.areas.flatMap((a) => a.steps);
  const inStep = new Set(steps.flatMap((s) => s.pages));
  const inMem = new Set(plan.memories.flatMap((m) => m.pages));
  const reasoned = new Set(plan.no_memory.map((x) => x.page));
  const names = plan.memories.map((m) => m.name.trim().toLowerCase());
  return {
    areas: plan.areas.length, steps: steps.length, memories: plan.memories.length,
    roles: Object.fromEntries(["메인", "바탕", "곁"].map((r) => [r, plan.memories.filter((m) => m.role === r).length])),
    flows: plan.memories.filter((m) => !m.part_of && plan.memories.some((x) => x.part_of === m.id)).map((m) => ({ id: m.id, name: m.name, parts: plan.memories.filter((x) => x.part_of === m.id).map((x) => x.name) })),
    notInStep: pages.filter((p) => !inStep.has(p)),
    noMemoryNoReason: pages.filter((p) => !inMem.has(p) && !reasoned.has(p)),
    biggest: [...plan.memories].sort((a, b) => b.pages.length - a.pages.length).slice(0, 5).map((m) => ({ id: m.id, name: m.name, pages: m.pages })),
    sameName: names.filter((n, i) => names.indexOf(n) !== i),
    badShownAt: plan.memories.filter((m) => !steps.some((s) => s.n === m.shown_at)).map((m) => m.id),
  };
}

export const lpModel = (effort: string) => ({ model: "gpt-6.1-sol", effort });
const material = (fileName: string, pages: number[], texts: Record<string, string>) => [`[자료] ${fileName}`, ...pages.map((p) => `[p.${p}]\n${(texts[p] ?? "").trim() || "(글자 없음)"}`)].join("\n\n");

export async function runLpPlan(id: string, fileName: string, pages: number[], texts: Record<string, string>, images: Img[], effort: string) {
  const m = lpModel(effort);
  const user = material(fileName, pages, texts);
  const t = Date.now();
  let first = 0;
  // 기록은 withTrace 안에서(밖이면 trace가 없어 비용 집계에서 빠진다).
  const r = await withTrace({ area: "pdf", action: "quiz-lp-plan", ref: id }, async () => { const x = await callModel({ purpose: `lab:lp-plan-${effort}`, system: `${LP_PLAN_SYSTEM}\n출력은 JSON으로만 한다.`, user, json: true, schema: PLAN_SCHEMA,
    schemaName: "recaller_lab_lp_plan", ...m, caller: LOCAL_CALLER, images: images.map(({ label, dataUrl }) => ({ label, dataUrl })), onText: () => { if (!first) first = Date.now(); } });
    log(`lab:lp-plan-${effort}`, m, t, x.usage, user.length, first ? first - t : undefined); return x; });
  const plan = r.data as LpPlan;
  return { effort, ms: Date.now() - t, firstTextMs: first ? first - t : null, usage: r.usage, check: checkPlan(plan, pages), plan };
}

export const LP_LECTURE_SYSTEM = `너는 이 강의를 맡은 강사다. 학생은 이 자료를 처음 본다. 글자로만 답한다.
받는 것: 강의 전체의 줄기(영역 · 걸음 · 기억), 지금 영역의 쪽들 원문과 그림("[이미지] 이름표"), 맨 끝의 [할 일].
강의할 때:
- 걸음 순서대로 한다. 걸음마다 ⟦걸음 n⟧ 한 줄로 시작한다.
- 걸음마다: 학생이 겪어 봤을 상황이나 질문으로 시작해서, 그 걸음의 쪽을 보며 한 단계씩 설명한다. 그 쪽에 있는 내용은 기억에 안 들어간 것까지 빠짐없이 다룬다. 앞 걸음에서 설명한 것은 다시 풀지 않고 이어서 쓴다.
- 식은 $…$(한 줄 식은 $$…$$)로, 자료에 적힌 기호 이름 그대로 쓴다(바꾸거나 새 이름을 붙이지 않는다). 무엇이 커지면 무엇이 어떻게 되는지 말로 풀어 주고, 기호는 처음 나올 때 뜻을 말한다.
- 학생이 실제로 헷갈릴 만한 점(줄기의 confuse 포함)은 "여기서 많이들 ~라고 생각하는데"로 그 자리에서 바로잡는다.
- 기억이 다 갖춰지는 자리(줄기의 shown_at 걸음, 설명이 끝난 곳)에 ⟦카드 기억id⟧ 한 줄. 바탕 기억은 쓰이는 곳에서 짧게 떠올려 주고, 곁 기억은 짧게.
- 그림은 받은 그림만 가리킨다: 그 그림을 보며 설명할 자리에 ⟦그림: 이미지 이름표 | 이 그림에서 볼 것⟧ 한 줄(받은 이름표 그대로). 밖의 그림을 찾거나 만들지 않는다. 표는 본문에 표로 옮겨 써도 된다.
- 걸음 끝에 학생이 스스로 따져 볼 짧은 질문 하나: ⟦확인⟧ 질문, 다음 줄에 ⟦답⟧ 답과 까닭(글로).
- 영역 끝에서 이 영역을 한 문장으로 묶고, 다음 영역으로 넘어가는 까닭을 말한다.
- 다른 영역의 내용은 미리 설명하지 않고 "뒤에서 볼게요" 정도로만 짚는다. 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;

const planText = (plan: LpPlan) => [
  `강의가 풀려는 문제: ${plan.problem}`,
  ...plan.areas.map((a, i) => `## 영역 ${i + 1}. ${a.name} — ${a.question}\n${a.steps.map((s) => `  걸음 ${s.n}. ${s.title} (p.${s.pages.join(",")})`).join("\n")}`),
  `## 기억\n${plan.memories.map((m) => `- ${m.id} | ${m.name} | ${m.kind} | ${m.role} | 영역 ${m.area} | p.${m.pages.join(",")} | 걸음 ${m.shown_at}${m.part_of ? ` | ${m.part_of}의 부품` : ""}${m.confuse ? ` | 헷갈림: ${m.confuse}` : ""}`).join("\n")}`,
].join("\n\n");

export async function runLpLecture(id: string, plan: LpPlan, area: number, texts: Record<string, string>, images: Img[], effort = "low") {
  const a = plan.areas[area - 1];
  if (!a) throw Object.assign(new Error(`영역 ${area}이 없어요.`), { status: 400 });
  const pages = [...new Set(a.steps.flatMap((s) => s.pages))].sort((x, y) => x - y);
  const m = lpModel(effort);
  const user = `[줄기]\n${planText(plan)}\n\n[지금 영역] 영역 ${area}. ${a.name} (p.${pages.join(",")})\n\n[원문]\n${pages.map((p) => `[p.${p}]\n${(texts[p] ?? "").trim() || "(글자 없음)"}`).join("\n\n")}`;
  const tail = `[할 일] 영역 ${area}. ${a.name}을 걸음 ${a.steps.map((s) => s.n).join(", ")} 순서로 강의한다.`;
  const t = Date.now();
  let first = 0;
  const r = await withTrace({ area: "pdf", action: "quiz-lp-lecture", ref: id }, async () => { const x = await callModel({ purpose: "lab:lp-lecture", system: LP_LECTURE_SYSTEM, user, tail, cacheKey: `recaller-lp-${id}-${area}`, ...m, caller: LOCAL_CALLER,
    images: images.filter((y) => pages.includes(y.page)).map(({ label, dataUrl }) => ({ label, dataUrl })), onText: () => { if (!first) first = Date.now(); } });
    log("lab:lp-lecture", m, t, x.usage, user.length, first ? first - t : undefined); return x; });
  const text = r.text;
  const want = plan.memories.filter((x) => x.area === area).map((x) => x.id);
  const shown = [...text.matchAll(/⟦카드\s*([^⟧\s]+)\s*⟧/g)].map((x) => x[1]);
  return { area, name: a.name, pages, effort, ms: Date.now() - t, firstTextMs: first ? first - t : null, usage: r.usage, chars: text.length,
    steps: [...text.matchAll(/⟦걸음\s*(\d+)\s*⟧/g)].map((x) => Number(x[1])), cardsShown: shown, cardsMissing: want.filter((x) => !shown.includes(x)),
    figures: [...text.matchAll(/⟦그림:\s*([^|⟧]+)/g)].map((x) => x[1].trim()), checks: (text.match(/⟦확인⟧/g) ?? []).length, text };
}
