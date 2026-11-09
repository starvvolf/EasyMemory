// 시험지 설계 → 문제 쓰기 (11/10 사용자 "너가 낸다 치고 몇 문제를 어떻게 낼지" → 구상(그래픽스 10·데드락 6) → "너처럼 할 수 있게 해 봐").
// 기억마다 기계적으로 한 문제가 아니라, 교수가 시험지를 짜듯 강의 전체를 보고 "큰 생각마다 한 문제"를 설계한 뒤 문제를 쓴다.
//   ① 설계(sol low, 자료당 1번): 기억(요지·식과 조건·헷갈림)·구조의 대비와 짝·학습 목표 → 문제 목록(쓸 기억, 노릴 오개념, 형식, 상황 생각, 이유)
//   ② 쓰기(sol low, 문제마다 동시): 설계 한 줄 + 그 기억들 + 원문 → 문제. 오답마다 어떤 실수에서 나왔는지.
// 지시문에 개수·줄 수를 두지 않는다(사용자). 풀기 검사는 일단 뺐다(사용자 "일단 풀기는 빼 보고, 문제 설계에 대한 고민이 필요").
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import type { DigestObjective } from "./gen/digest.ts";
import { cardLine, type Card } from "./gen/cards.ts";
import type { MapCard, MaterialMap } from "./material-map.ts";
import type { Structure } from "./structure.ts";

export const EXAM_MODEL = { model: "gpt-6-sol", effort: "low" };
export const EXAM_FORMS = ["ox", "choice", "blank", "short"] as const;

export const DESIGN_SYSTEM = `너는 이 강의를 가르친 교수다. 학생이 이 강의를 정말 이해했는지 확인하는 복습 시험지를 설계한다(문제를 쓰는 것은 다음 단계).
받는 것: 강의의 기억(외울 단위: 이름·종류·요지·식과 조건·학생이 헷갈리는 점), 기억 사이의 대비와 짝, 학습 목표.

설계 원칙
- 기억마다 한 문제가 아니라, 이 강의의 큰 생각마다 한 문제다. 같은 생각을 두 번 묻지 않는다. 학생이 지치지 않게 꼭 필요한 문제만.
- 한 문제는 질문 하나다: 노리는 오개념 하나, 답 하나. 서로 다른 생각을 한 문제에 이어 붙이지 않는다("별도로 …도 구하라", "이어서 …" 금지). 여러 기억을 쓴다는 것은 그 하나의 답을 내려면 함께 알아야 한다는 뜻이다.
- 강의의 큰 갈래(예: 선 그리기, 원·타원, 다각형 판정, 면과 평면, 채우기)가 빠짐없이 시험지에 들어가게 한다. 큰 생각이 여럿인 갈래는 생각마다 따로.
- 바탕 지식(앞 과목의 식·정의)은 따로 묻지 않고, 다른 문제를 풀 때 쓰이게 한다. 곁가지(배경·종류 나열)는 묻지 않는다.
- 문제마다 노릴 오개념을 하나 정한다: 이 주제에서 학생이 실제로 틀리는 생각(받은 "헷갈림"이 좋은 출발점이다). 그 오개념대로 풀면 다른 답이 나오는 상황을 고른다.
- 경계에서 묻는다: 동점(p = 0), 꼭짓점을 지나는 선, 같은 직선 위의 점, 자원이 여러 개인 순환처럼 대충 알면 틀리는 자리.
- 중간값이 아니라 결론을 묻는다(그래서 오목한가, 승인하는가, 다음 화소는 어디인가).
- 상황의 전제가 강의의 규칙대로 성립해야 한다: 회피에서 요청하는 자원은 지금 비어 있어야 판정이 의미 있다(이미 다른 프로세스가 쥔 자원이면 그냥 기다린다), 꼭짓점 순서는 말한 방향과 맞아야 한다.
- 형식은 노린 오개념이 가장 잘 드러나는 것으로:
  - ox: 오개념이 그럴듯한 문장 하나로 말해질 때(그 문장을 맞다/틀리다로).
  - choice: 비슷한 갈래 사이에서 헷갈릴 때, 판정 결과를 고를 때. 오답은 각각 다른 오개념의 결과.
  - blank: 식·규칙의 핵심 조각을 정확히 기억해야 할 때.
  - short: 값을 넣어 손으로 따라가거나 계산해야 할 때(경계 상황이 들어가게).
- 시험지 전체로 따라가기·판정·오개념·비교가 섞이게 한다.

각 문제: memories(쓸 기억 번호), target(노릴 오개념, 한 문장), form, situation(어떤 상황·값으로 물을지 구체적으로), why(이 문제로 무엇을 확인하나).`;
const DESIGN_SCHEMA = S.obj({ items: S.arr(S.obj({ memories: S.arr(S.int), target: S.str, form: S.oneOf(...EXAM_FORMS), situation: S.str, why: S.str })) });
export type DesignItem = { memories: number[]; target: string; form: (typeof EXAM_FORMS)[number]; situation: string; why: string };

export const WRITE_SYSTEM = `너는 이 강의를 가르친 교수다. 설계된 문제 하나를 실제 문제로 쓴다.
- 문제 글에는 상황과 값만 준다. 학생이 알아야 할 규칙·판정식·갱신식·정의를 문제 글에 쓰지 않는다(그것을 아는지가 시험이다).
- 노린 오개념(target)대로 풀면 틀리게 되도록 상황을 그대로 살린다(설계의 situation). 값을 바꾸면 직접 계산해 경계 상황이 실제로 생기는지 확인한다.
- 오답 보기는 각각 실제 학생 실수 하나에서 나온 답이다(오개념대로 풀었을 때, 축·부호를 바꿨을 때, 하나 차이, 반대로 판정했을 때…). 문제 글과 모순되는 보기, "언제나·반드시·모두"로 티 나는 보기, 아무것도 아닌 보기를 쓰지 않는다. 정답만 길거나 말이 누그러지지 않게 보기 길이와 말투를 맞춘다.
- 강의를 듣지 않은 사람이 상식이나 보기 소거로 풀 수 있으면 실패다.
- 문제는 그것만 보고 풀 수 있게 쓴다(자료의 쪽·그림을 가리키지 않는다). 필요한 값은 다 준다.
- 상황의 전제가 성립하는지 확인한다(요청한 자원이 실제로 비어 있는가, 꼭짓점 순서가 말한 방향인가).
- form: ox(answer "O"/"X"), choice(보기 4개, answer는 정답 번호 1부터), blank(문제 글에 빈칸 ___ 하나 이상, answer는 빈칸 답을 차례로 "; "로), short(answer는 값만).
- explain: 정답 풀이. traps: 오답(또는 흔한 틀린 답)마다 어떤 실수에서 나오는지 한 줄씩.
- 한국어로. 용어는 처음에 "한국어(영어 원어)". 수식·기호는 원문 그대로.`;
const WRITE_SCHEMA = S.obj({ form: S.oneOf(...EXAM_FORMS), stem: S.str, options: S.arr(S.str), answer: S.str, explain: S.str, traps: S.arr(S.str) });
export type Written = { form: (typeof EXAM_FORMS)[number]; stem: string; options: string[]; answer: string; explain: string; traps: string[] };

const line = (c: MapCard) => cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 500);

/** 설계 입력: 메인·바탕 기억(곁은 뺌), 요지·식과 조건·헷갈림, 구조의 대비·짝, 학습 목표. */
export function designInput(map: MaterialMap, structure: Structure | null, goals: DigestObjective[]) {
  const cards = map.sections.flatMap((s) => s.cards).filter((c) => !c.title.startsWith("흐름: ") && c.memo?.role !== "곁");
  const num = new Map(cards.map((c, i) => [c.id, i + 1]));
  const lines = cards.map((c, i) => [`${i + 1}|${c.memo?.role ?? (c.core ? "메인" : "보조")}|${c.kind}|${c.title}`,
    c.memo?.line ? `  요지: ${c.memo.line}` : `  ${line(c)}`,
    ...(c.memo?.facts ?? []).map((f) => `  식·조건: ${f}`),
    ...(c.mistakes ?? []).map((m) => `  헷갈림: ${m}`)].join("\n"));
  const rel = [...(structure?.versus ?? []).map((v) => `대비 ${num.get(v.a)} vs ${num.get(v.b)}: ${v.on}`), ...(structure?.pairs ?? []).map((p) => `짝 ${num.get(p.a)} — ${num.get(p.b)}: ${p.why}`)]
    .filter((x) => !x.includes("undefined"));
  const user = `자료: ${map.title}\n\n[기억] (번호|역할|종류|이름)\n${lines.join("\n")}\n\n[대비·짝]\n${rel.join("\n") || "(없음)"}\n\n[학습 목표]\n${goals.map((g) => `${g.id} ${g.verb}: ${g.text}`).join("\n") || "(없음)"}`;
  return { user, cards };
}

export async function designExam(id: string, map: MaterialMap, structure: Structure | null, goals: DigestObjective[], texts: Record<string, string>) {
  const { user, cards } = designInput(map, structure, goals);
  const t0 = Date.now();
  const plan = await withTrace({ area: "pdf", action: "quiz-design", ref: id }, () => askJson<{ items: DesignItem[] }>("map:exam-design", DESIGN_SYSTEM, user, DESIGN_SCHEMA, EXAM_MODEL));
  const designMs = Date.now() - t0;
  const items = (plan.items ?? []).map((it) => ({ ...it, memories: it.memories.filter((n) => n >= 1 && n <= cards.length) })).filter((it) => it.memories.length);
  const written = await Promise.all(items.map(async (it) => {
    const used = it.memories.map((n) => cards[n - 1]);
    const pages = [...new Set(used.flatMap((c) => c.pages))].sort((a, b) => a - b);
    const source = pages.map((p) => `[원문 p.${p}]\n${texts[p] ?? ""}`).join("\n\n").slice(0, 12000);
    const mem = used.map((c) => [`- ${c.title} (${c.kind})`, c.memo?.line ? `  요지: ${c.memo.line}` : "", `  ${line(c)}`, ...(c.memo?.facts ?? []).map((f) => `  식·조건: ${f}`), ...(c.mistakes ?? []).map((m) => `  헷갈림: ${m}`)].filter(Boolean).join("\n")).join("\n");
    const u = `자료: ${map.title}\n\n[설계]\n노릴 오개념: ${it.target}\n형식: ${it.form}\n상황: ${it.situation}\n확인할 것: ${it.why}\n\n[쓸 기억]\n${mem}\n\n[원문]\n${source}`;
    try { return { item: it, titles: used.map((c) => c.title), q: await withTrace({ area: "pdf", action: "quiz-write", ref: id }, () => askJson<Written>("map:exam-write", WRITE_SYSTEM, u, WRITE_SCHEMA, EXAM_MODEL)) }; }
    catch (e) { return { item: it, titles: used.map((c) => c.title), error: (e as Error).message }; }
  }));
  return { designMs, ms: Date.now() - t0, items: written };
}
