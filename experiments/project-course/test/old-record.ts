// 시험용(11/10): 예전 꼴(learned · gaps)로 쓴 가짜 목표 정리 답을 실습 기억 카드 꼴로 바꾼다.
// 배운 것 = 혼자 해냄 카드, 부족한 점 = 틀렸다 고침 카드(예전 시험의 뜻 그대로).
type Old = { summary?: string; steps?: string[]; learned?: any[]; gaps?: any[]; memory?: unknown; cards?: unknown };
export function asCards(o: Old) {
  if (!o || o.cards) return o;
  const none = { save: "", from: 0, to: 0 };
  const cards = [
    ...(o.learned ?? []).map((x) => ({ name: x.concept, situation: "", did: "", quote: x.quote ?? "", learned: x.meaning ?? "", next: "", how: "혼자 해냄", prereq: false, code: none, ids: [], recheck: { q: "", a: "" } })),
    ...(o.gaps ?? []).map((x) => ({ name: x.concept, situation: "", did: x.wrong ?? "", quote: x.quote ?? "", learned: x.right ?? "", next: "", how: "틀렸다 고침", prereq: false, code: x.code ?? none, ids: x.ids ?? [], recheck: x.recheck ?? { q: "", a: "" } })),
  ];
  return { summary: o.summary ?? "", steps: o.steps ?? [], cards, memory: o.memory ?? { add: [], update: [], improved: [] } };
}
export const wrapFake = (ai: { setFakeAi: (f: any) => void }) => (f: (p: string, u: string) => any) => ai.setFakeAi((p: string, u: string) => { const r = f(p, u); return p === "goal-record" ? asCards(r) : r; });
