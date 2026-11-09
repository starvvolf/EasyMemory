// 기억 단위 문제 만들기 (11/10 사용자 "여러 방법 테스트해서 문제까지 내면서 제일 좋은 거 하나 골라서 마무리").
// 비교(claude/실험_기억단위출제_20261110.md, 블라인드 평가): 학습 목표마다 낸 문제가 가장 알찼지만(데드락 1위) 목표가 덮지 않는 단원이 통째로
// 빠졌다(그래픽스 다각형·채우기). 기억마다 낸 문제는 범위가 넓었다(그래픽스 1·2위). 그래서 둘을 합친다:
//   ① 학습 목표마다 하나 — 목표 ↔ 기억 잇기(goal-links.ts)로 필요한 기억을 넣고, 목표의 동사로 방식(판정·계산은 상황·값, 구별은 가르기)
//   ② 어느 목표에도 쓰이지 않은 메인 기억마다 하나 — 5종류(뜻·나열·비교·순서·적용), 순서·적용은 깊게(따라가기·상황)
// O/X는 내지 않는다(평가: "공짜 문항"). 출제 고리는 quiz-plan.ts의 makeOne(출제 sol → 따로 풀기 → 엇갈리면 판정 → 한 번 고쳐 쓰기).
import type { DigestObjective } from "./gen/digest.ts";
import type { RcQuestion } from "./gen/recaller.ts";
import { linkGoalsFor } from "./goal-links.ts";
import type { MapCard, MaterialMap } from "./material-map.ts";
import { makeOne, type Form, type MadeQuestion, type PlanItem } from "./quiz-plan.ts";

export const FIVE: Record<string, "뜻" | "나열" | "비교" | "순서" | "적용"> = { 용어: "뜻", 사실: "뜻", 개념: "뜻", 패턴: "뜻", 목록: "나열", 비교: "비교", 절차: "순서", 조건: "적용", 공식: "적용" };
export const FIVE_ASK: Record<string, { form: Form; level: number; ask: string }> = {
  뜻: { form: "choice", level: 3, ask: "이 기억의 뜻과 이유를 묻는다: 왜 그런지(원리·까닭)를 고르게. 정의를 살짝 바꾼 보기와 가르게." },
  나열: { form: "choice", level: 3, ask: "원소들 가운데 빠진 것이나 아닌 것을 고르게. 원소 하나가 빠지면 어떻게 되는지 물어도 된다." },
  비교: { form: "choice", level: 3, ask: "같은 상황·입력에서 대상들이 어떻게 다른지, 또는 주어진 설명이 어느 쪽인지 가르게." },
  순서: { form: "short", level: 4, ask: "깊게: 구체적인 값을 주고 단계를 손으로 따라가게(다음 값·찍히는 점·결과를 구한다). 경우(방향·범위)를 바꿔 물어도 된다." },
  적용: { form: "choice", level: 4, ask: "깊게: 상황이나 값을 주고 결과를 내게(판정·계산·분류). 경계 상황이면 더 좋다. 판정의 열쇠는 문제 글에 말하지 않는다." },
};
const VERB: Record<string, { form: Form; level: number }> = { 떠올리기: { form: "choice", level: 2 }, 구별: { form: "choice", level: 3 }, 판정: { form: "choice", level: 4 }, 계산: { form: "short", level: 4 }, 설명: { form: "choice", level: 3 } };

/** 계획(코드): 목표마다 하나 + 목표 밖 메인 기억마다 하나. */
export function planStemQuiz(goals: DigestObjective[], links: Array<{ goal: string; need: string[]; confuse: string[] }>, cards: MapCard[], topicOf: (c: MapCard) => string): PlanItem[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const items: PlanItem[] = [];
  for (const l of links) {
    const g = goals.find((x) => x.id === l.goal);
    if (!g || !l.need.length) continue;
    const fl = VERB[g.verb] ?? { form: "choice" as Form, level: 3 };
    items.push({ n: items.length + 1, unit: l.need.length > 1 ? "잇기" : "낱장", name: g.id, cards: l.need, form: fl.form, level: fl.level === 5 ? 4 : fl.level, topic: topicOf(byId.get(l.need[0])!), why: g.text,
      ask: `학습 목표 "${g.text}"를 확인한다.${g.given ? ` 주는 것: ${g.given}. 내는 것: ${g.output ?? ""}.` : ""}${l.confuse.length ? ` 헷갈리게 할 것: ${l.confuse.map((x) => byId.get(x)?.title).filter(Boolean).join(", ")}.` : ""}` });
  }
  const used = new Set(links.flatMap((l) => l.need));
  for (const c of cards.filter((x) => x.core && !used.has(x.id))) {
    const t = FIVE[c.kind] ?? "뜻";
    items.push({ n: items.length + 1, unit: "낱장", name: c.title, cards: [c.id], ...FIVE_ASK[t], topic: topicOf(c), why: t });
  }
  return items;
}

/** 목표 잇기 + 출제(동시 몇 개씩). */
export async function makeStemQuestions(id: string, map: MaterialMap, texts: Record<string, string>, goals: DigestObjective[], opts: { fake?: boolean } = {}) {
  const cards = map.sections.flatMap((s) => s.cards).filter((c) => !c.title.startsWith("흐름: "));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const topicOf = (c: MapCard) => map.sections.find((s) => s.cards.includes(c))?.id ?? "";
  const links = goals.length && !opts.fake ? (await linkGoalsFor(goals, cards).catch(() => ({ links: [] as Array<{ goal: string; need: string[]; confuse: string[] }> }))).links : [];
  const items = planStemQuiz(goals, links, cards, topicOf);
  // 가짜 모델(테스트): AI 없이 기억 제목으로 객관식 하나씩.
  if (opts.fake) return { items, byId, made: items.map((it): MadeQuestion => ({ ...it, ok: true, tries: 1, problems: [], ms: 0,
    q: { form: "choice", level: it.level, stem: `${it.name}에 맞는 것은?`, options: ["가", "나", "다", "라"], answer: "1", explain: "가짜", uses: [1] } })) };
  const made: MadeQuestion[] = [];
  for (let i = 0; i < items.length; i += 8) made.push(...await Promise.all(items.slice(i, i + 8).map((it) => makeOne(id, map, it, byId, texts, {}))));
  return { items, made, byId };
}

/** 만든 문제 → 엔진 문제(RcQuestion): 연습 화면·자료 지도가 그대로 쓴다. */
export function toRcQuestion(m: MadeQuestion, byId: Map<string, MapCard>, objectiveId: string): RcQuestion | null {
  const q = m.q;
  if (!m.ok || !q) return null;
  const cards = m.cards.map((x) => byId.get(x)).filter((c): c is MapCard => !!c);
  const sectionId = (cards[0]?.id ?? "").split(".")[0];
  const stem = [{ kind: "text" as const, text: q.stem, latex: null, rows: null }];
  let answer: RcQuestion["authored"]["answer"];
  if (q.form === "choice" || q.form === "ox") {
    const options = q.form === "ox" ? ["맞다", "틀리다"] : q.options;
    const correct = q.form === "ox" ? (q.answer.trim().toUpperCase().startsWith("O") ? 0 : 1) : Number(q.answer) - 1;
    if (!(correct >= 0 && correct < options.length)) return null;
    answer = { kind: "choice", options: options.map((o) => ({ text: o, latex: null })), correctIndex: correct, accepted: null, before: null, after: null, explanation: q.explain };
  } else {
    if (q.form === "order") stem.push({ kind: "text", text: q.options.map((o, i) => `${i + 1}. ${o}`).join("\n"), latex: null, rows: null });
    answer = { kind: "short", options: null, correctIndex: null, accepted: [q.answer], before: q.form === "order" ? "바른 순서(번호를 쉼표로)" : null, after: null, explanation: q.explain };
  }
  const kindOf: Record<string, RcQuestion["kind"]> = { 용어: "용어", 사실: "사실", 개념: "개념", 패턴: "패턴", 목록: "사실", 비교: "관계", 절차: "절차", 조건: "관계", 공식: "공식" };
  return { objectiveId, sectionId, tier: "basic", cardIds: m.cards, format: answer.kind === "choice" ? "choice" : "short", goal: m.why || m.name,
    authored: { objectiveId, stem, answer }, pages: [...new Set(cards.flatMap((c) => c.pages))].sort((a, b) => a - b), quotes: cards.flatMap((c) => c.quotes).slice(0, 3),
    kind: kindOf[cards[0]?.kind ?? ""] ?? "개념", core: true, checks: [] };
}
