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
import { sameAnswer, shuffleChoice, type QuizReply } from "./quiz-plan.ts";
import type { RcQuestion } from "./gen/recaller.ts";

// 예/아니요 답은 말이 달라도 같은 것으로(11/10 시험: "아니요" ≠ "승인하지 않는다"로 쓸데없이 고쳐 썼다).
const YES = /^(예|네|그렇다|맞다|참|승인|허용|가능|있다|o\b)/i, NO = /^(아니|아니요|아니오|불허|거부|승인하지|허용하지|불가능|없다|틀리다|거짓|x\b)/i;
const yn = (x: string) => { const t = x.trim().replace(/[.\s]+$/, ""); return NO.test(t) ? "no" : YES.test(t) ? "yes" : ""; };
export function sameExamAnswer(form: (typeof EXAM_FORMS)[number], a: string, b: string) {
  const ya = yn(a), yb = yn(b);
  if (ya && yb) return ya === yb;
  return sameAnswer(form === "blank" ? "short" : form, a, b);
}

export const EXAM_MODEL = { model: "gpt-6-sol", effort: "low" };
export const EXAM_FORMS = ["ox", "choice", "blank", "short"] as const;

export const DESIGN_SYSTEM = `너는 이 강의를 가르친 교수다. 학생이 이 강의를 정말 이해했는지 확인하는 복습 시험지를 설계한다(문제를 쓰는 것은 다음 단계).
받는 것: 강의의 기억(외울 단위: 이름·종류·요지·식과 조건·학생이 헷갈리는 점), 기억 사이의 대비와 짝, 학습 목표.

설계 원칙
- 기억마다 한 문제가 아니라, 이 강의의 큰 생각마다 한 문제다. 같은 생각을 두 번 묻지 않는다. 학생이 지치지 않게 꼭 필요한 문제만.
- 한 문제는 질문 하나다: 노리는 오개념 하나, 답 하나. 서로 다른 생각을 한 문제에 이어 붙이지 않는다("별도로 …도 구하라", "이어서 …" 금지). 여러 기억을 쓴다는 것은 그 하나의 답을 내려면 함께 알아야 한다는 뜻이다.
- 강의의 큰 갈래가 빠짐없이 시험지에 들어가게 한다. 큰 생각이 여럿인 갈래는 생각마다 따로.
- 바탕 지식(앞 과목의 식·정의)은 따로 묻지 않고, 다른 문제를 풀 때 쓰이게 한다. 곁가지(배경·종류 나열)는 묻지 않는다.
- 문제마다 노릴 오개념을 하나 정한다: 이 주제에서 학생이 실제로 틀리는 생각(받은 "헷갈림"이 좋은 출발점이다). 그 오개념대로 풀면 다른 답이 나오는 상황을 고른다.
- 경계에서 묻는다: 규칙이 갈리는 자리(값이 같아 두 갈래가 맞닿는 때, 특수한 경우, 한계값, 겹치는 경우)처럼 대충 알면 틀리는 자리.
- 중간값이 아니라 결론을 묻는다(그래서 무엇으로 판정되는가, 다음은 무엇인가).
- 상황은 강의의 규칙이 실제로 적용되는 조건을 만족해야 한다(그 규칙이 다루지 않는 상황을 만들지 않는다).
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
- 오답 보기는 각각 실제 학생 실수 하나에서 나온 답이다(오개념대로 풀었을 때, 순서·방향·부호를 뒤바꿨을 때, 하나 차이, 반대로 판정했을 때…). 문제 글과 모순되는 보기, "언제나·반드시·모두"로 티 나는 보기, 아무것도 아닌 보기를 쓰지 않는다. 정답만 길거나 말이 누그러지지 않게 보기 길이와 말투를 맞춘다.
- 강의를 듣지 않은 사람이 상식이나 보기 소거로 풀 수 있으면 실패다.
- 문제는 그것만 보고 풀 수 있게 쓴다(자료의 쪽·그림을 가리키지 않는다). 필요한 값은 다 준다.
- 상황의 전제가 강의의 규칙대로 성립하는지 확인한다(규칙이 적용되는 조건을 만족하는가, 문제 글의 값끼리 서로 맞는가).
- form: ox(answer "O"/"X"), choice(보기 4개, answer는 정답 번호 1부터), blank(문제 글에 빈칸 ___ 하나 이상, answer는 빈칸 답을 차례로 "; "로), short(answer는 값만).
- explain: 정답 풀이. traps: 오답(또는 흔한 틀린 답)마다 어떤 실수에서 나오는지 한 줄씩.
- 한국어로. 용어는 처음에 "한국어(영어 원어)". 수식·기호는 원문 그대로.`;
const WRITE_SCHEMA = S.obj({ form: S.oneOf(...EXAM_FORMS), stem: S.str, options: S.arr(S.str), answer: S.str, explain: S.str, traps: S.arr(S.str) });
export type Written = { form: (typeof EXAM_FORMS)[number]; stem: string; options: string[]; answer: string; explain: string; traps: string[] };

// 직접 풀어 보기 (11/10 사용자 "한 번 해 봐"): 정답을 보여 주지 않고 따로 푼다. 상황 확인과 동시에.
// 11/10 사용자 "전부 다시 풀기 넣자": 계산 문제만이 아니라 모든 문제를 푼다(개념 문제의 틀린 정답도 잡게).
// 풀기(평균 3.5초)가 확인(5초)보다 빨라 시간은 그대로, 문제당 약 $0.004. 문제를 쓸 때 work 칸도 뺐다.
// 11/10 시험: 상황 확인은 "답이 하나인가"만 보고 칠하기 문제의 틀린 정답을 놓쳤다.
export const SOLVE_SYSTEM = `강의 문제 하나를 정답을 모르는 채로 정리된 지식과 원문을 기준으로 푼다. 단계마다 직접 계산하거나 따라간다.
answer: choice면 정답 보기 번호(1부터), ox면 "O"/"X", blank면 빈칸 답을 차례로 "; "로, short면 값만. work: 푼 과정을 짧게.`;
const SOLVE_SCHEMA = S.obj({ work: S.str, answer: S.str });

// 같은 뜻 보기 (11/10 전부 다시 풀기 시험): 빈칸·짧은 답은 코드 비교로는 "거부"/"불승인", 문장 답의 낱말 차이를 다르다고 봐
// 쓸데없이 고쳐 쓰거나(약 20초) 내지 않았다. 코드가 다르다고 할 때만 terra로 한 번 묻는다(약 3초, 걸릴 때만).
const SAME_SYSTEM = `문제 하나에 정답과, 따로 푼 사람의 답이 있다. 채점자라면 둘을 같은 답으로 인정하는지만 정한다. 표현·낱말·순서·표기만 다르고 뜻이 같으면 same true. 값·판정·가리키는 대상이 다르면 false.`;
const SAME_SCHEMA = S.obj({ same: { type: "boolean" } });
const SAME_MODEL = { model: "gpt-6.1-terra", effort: "low" };

// 상황 확인 (11/10 사용자 "그렇게 해서 한 번 더 테스트" — 풀기 검사 대신 싸게): 쓴 문제를 한 번 보고, 노린 함정이 실제로 생기는지·전제가 성립하는지·
// 답이 하나인지만 본다. 걸리면 그 이유를 주고 한 번 고쳐 쓴다.
export const CHECK_SYSTEM = `강의 문제 하나와 그 문제가 노린 오개념을 받는다. 정리된 지식과 원문을 기준으로 세 가지만 확인한다.
1. trap: 노린 오개념대로 풀면 정답과 다른 답이 실제로 나오는가(직접 따져 본다). 같은 답이 나오면 함정이 없는 것이다.
2. premise: 상황이 강의의 규칙이 적용되는 조건을 만족하는가, 문제 글의 값끼리 서로 맞는가.
3. unique: 정답이 하나로 정해지는가(맞는 보기가 둘이거나, 정의에 따라 답이 갈리거나, 계산 방식(반올림 등)에 따라 갈리면 아니다). 표시된 정답이 맞는가.
셋 다 문제없으면 ok true. 아니면 ok false와 problems(무엇이 왜 문제인지, 고칠 방향).`;
const CHECK_SCHEMA = S.obj({ trap: S.str, premise: S.str, unique: S.str, ok: { type: "boolean" }, problems: S.arr(S.str) });
type Check = { trap: string; premise: string; unique: string; ok: boolean; problems: string[] };

const line = (c: MapCard) => cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 500);

/** 설계 입력: 메인·바탕 기억(곁은 뺌), 요지·식과 조건·헷갈림, 구조의 대비·짝, 학습 목표. */
export function designInput(map: MaterialMap, structure: Structure | null, goals: DigestObjective[]) {
  const cards = map.sections.flatMap((s) => s.cards).filter((c) => !c.title.startsWith("흐름: ") && c.memo?.role !== "곁");
  const num = new Map(cards.map((c, i) => [c.id, i + 1]));
  const lines = cards.map((c, i) => [`${i + 1}|${c.memo?.role ?? (c.core ? "메인" : "보조")}|${c.kind}|${c.title}`,
    c.memo?.line ? `  요지: ${c.memo.line}` : `  ${line(c)}`,
    ...(c.memo?.facts ?? []).map((f) => `  식·조건: ${f}`), ...(c.memo?.details ?? []).map((f) => `  참고: ${f}`),
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
    const mem = used.map((c) => [`- ${c.title} (${c.kind})`, c.memo?.line ? `  요지: ${c.memo.line}` : "", `  ${line(c)}`, ...(c.memo?.facts ?? []).map((f) => `  식·조건: ${f}`), ...(c.memo?.details ?? []).map((f) => `  참고: ${f}`), ...(c.mistakes ?? []).map((m) => `  헷갈림: ${m}`)].filter(Boolean).join("\n")).join("\n");
    const u = `자료: ${map.title}\n\n[설계]\n노릴 오개념: ${it.target}\n형식: ${it.form}\n상황: ${it.situation}\n확인할 것: ${it.why}\n\n[쓸 기억]\n${mem}\n\n[원문]\n${source}`;
    try {
      const write = (extra = "") => withTrace({ area: "pdf", action: "quiz-write", ref: id }, () => askJson<Written>("map:exam-write", WRITE_SYSTEM, `${u}${extra}`, WRITE_SCHEMA, EXAM_MODEL));
      const check = (q: Written) => withTrace({ area: "pdf", action: "quiz-check", ref: id }, () => askJson<Check>("map:exam-check", CHECK_SYSTEM,
        `노린 오개념: ${it.target}\n\n[문제] (${q.form})\n${q.stem}${q.options.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : ""}\n정답: ${q.answer}\n풀이: ${q.explain}\n\n[정리된 지식]\n${mem}\n\n[원문]\n${source}`, CHECK_SCHEMA, EXAM_MODEL));
      const solve = (q: Written) => withTrace({ area: "pdf", action: "quiz-solve", ref: id }, () => askJson<{ work: string; answer: string }>("map:exam-solve", SOLVE_SYSTEM,
        `[문제] (${q.form})\n${q.stem}${q.options.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : ""}\n\n[정리된 지식]\n${mem}\n\n[원문]\n${source}`, SOLVE_SCHEMA, EXAM_MODEL)).catch(() => null);
      // 확인 + 풀어 보기(동시). 풀어 본 답이 정답과 다르면 걸림.
      const review = async (q: Written) => {
        const [c, s] = await Promise.all([check(q).catch(() => null), solve(q)]);
        let differs = Boolean(s && !sameExamAnswer(q.form, q.answer, s.answer));
        if (differs && (q.form === "short" || q.form === "blank")) {
          const same = await withTrace({ area: "pdf", action: "quiz-same", ref: id }, () => askJson<{ same: boolean }>("map:exam-same", SAME_SYSTEM,
            `[문제]\n${q.stem}\n\n정답: ${q.answer}\n따로 푼 답: ${s!.answer}`, SAME_SCHEMA, SAME_MODEL)).catch(() => null);
          if (same?.same) differs = false;
        }
        const problems = [...(c && !c.ok ? c.problems : []), ...(differs ? [`정답을 모르고 직접 풀면 "${s!.answer}"가 나온다(표시된 정답 "${q.answer}"). 풀이: ${s!.work.slice(0, 400)}`] : [])];
        return { check: c, solved: s, ok: problems.length === 0, problems };
      };
      const first = await write();
      const r1 = await review(first);
      if (r1.ok) return { item: it, cardIds: used.map((c) => c.id), titles: used.map((c) => c.title), q: first, check: r1.check, solved: r1.solved };
      const second = await write(`\n\n[고쳐 쓰기] 앞에서 쓴 문제는 이래서 안 됐다: ${r1.problems.join(" / ")}\n앞 문제: ${first.stem.slice(0, 600)} / 정답 ${first.answer}`);
      const r2 = await review(second);
      // 고쳐도 직접 푼 답과 정답이 다르면 내지 않는다(틀린 정답을 학생에게 주지 않는다).
      const held = r2.problems.some((x) => x.startsWith("정답을 모르고 직접 풀면")) ? r2.problems.join(" / ") : undefined;
      return { item: it, cardIds: used.map((c) => c.id), titles: used.map((c) => c.title), q: second, check: r2.check, solved: r2.solved, first, firstProblems: r1.problems, rewritten: true, ...(held ? { held } : {}) };
    } catch (e) { return { item: it, cardIds: used.map((c) => c.id), titles: used.map((c) => c.title), error: (e as Error).message }; }
  }));
  return { designMs, ms: Date.now() - t0, items: written };
}

/** 시험지 문제 → 엔진 문제(RcQuestion): 보기는 섞고(정답이 1번에 몰림), 해설 뒤에 오답마다 어떤 실수인지. 고쳐도 틀린 문제(held)는 뺀다. */
export function examToRc(x: { item: DesignItem; cardIds: string[]; q?: Written; held?: string }, cards: Map<string, MapCard>, objectiveId: string, seed: string): RcQuestion | null {
  if (!x.q || x.held) return null;
  const q = { ...x.q, options: [...x.q.options] };
  const used = x.cardIds.map((id) => cards.get(id)).filter((c): c is MapCard => !!c);
  const sectionId = (x.cardIds[0] ?? "").split(".")[0];
  const reply: QuizReply = { form: q.form === "choice" ? "choice" : "short", level: 3, stem: q.stem, options: q.options, answer: q.answer, explain: q.explain, uses: [] };
  if (q.form === "choice") shuffleChoice(reply, seed);
  const traps = q.traps.map((t) => t.replace(/^\s*\(?\s*[1-4]\s*번?\s*\)?\s*[:.)]\s*/, "")).filter(Boolean);
  const explanation = `${reply.explain}${traps.length ? `\n헷갈리기 쉬운 것: ${traps.join(" / ")}` : ""}`;
  const stem = [{ kind: "text" as const, text: q.stem, latex: null, rows: null }];
  let answer: RcQuestion["authored"]["answer"];
  if (q.form === "choice" || q.form === "ox") {
    const options = q.form === "ox" ? ["맞다(O)", "틀리다(X)"] : reply.options;
    const correct = q.form === "ox" ? (yn(q.answer) === "no" || /^\s*x/i.test(q.answer) ? 1 : 0) : Number(reply.answer) - 1;
    if (!(correct >= 0 && correct < options.length)) return null;
    answer = { kind: "choice", options: options.map((o) => ({ text: o, latex: null })), correctIndex: correct, accepted: null, before: null, after: null, explanation };
  } else answer = { kind: "short", options: null, correctIndex: null, accepted: [q.answer, ...(q.form === "blank" ? q.answer.split(/\s*;\s*/).filter((a) => a && a !== q.answer) : [])], before: null, after: null, explanation };
  const kindOf: Record<string, RcQuestion["kind"]> = { 용어: "용어", 사실: "사실", 개념: "개념", 패턴: "패턴", 목록: "사실", 비교: "관계", 절차: "절차", 조건: "관계", 공식: "공식" };
  return { objectiveId, sectionId, tier: "basic", cardIds: x.cardIds, format: answer.kind === "choice" ? "choice" : "short", goal: x.item.why || x.item.target,
    authored: { objectiveId, stem, answer }, pages: [...new Set(used.flatMap((c) => c.pages))].sort((a, b) => a - b), quotes: used.flatMap((c) => c.quotes).slice(0, 3),
    kind: kindOf[used[0]?.kind ?? ""] ?? "개념", core: true, checks: [] };
}
