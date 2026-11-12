// 시험용(11/10 → 11/13): 예전 꼴(learned · gaps / cards)로 쓴 가짜 목표 정리 답을 지금 정리 꼴(리뷰 글 + "# 기록용")로 바꾼다.
// 배운 것 = 혼자 해냄 카드, 부족한 점 = 틀렸다 고침 카드(예전 시험의 뜻 그대로).
type Old = { summary?: string; steps?: string[]; learned?: any[]; gaps?: any[]; memory?: any; cards?: any[]; md?: string };
export function asCards(o: Old) {
  if (!o || typeof o !== "object") return o;
  const cards = o.cards ?? [
    ...(o.learned ?? []).map((x) => ({ name: x.concept, did: "", quote: x.quote ?? "", learned: x.meaning ?? "", how: "혼자 해냄", ids: [], recheck: { q: "", a: "" } })),
    ...(o.gaps ?? []).map((x) => ({ name: x.concept, did: x.wrong ?? "", quote: x.quote ?? "", learned: x.right ?? "", how: "틀렸다 고침", ids: x.ids ?? [], code: x.code, recheck: x.recheck ?? { q: "", a: "" } })),
  ];
  return toMd({ summary: o.summary ?? "", steps: o.steps ?? [], cards, memory: o.memory, md: o.md });
}
/** 정리 글 꼴로 쓴다(리뷰 + # 기록용) */
export function toMd(o: { summary: string; steps: string[]; cards: any[]; memory?: any; md?: string }) {
  const m = o.memory ?? {};
  return [o.md ?? "# 학습 총평\n시험용 총평이에요. 이 목표에서 한 일을 짧게 적었어요. 시험이라 내용은 중요하지 않고 머리글과 길이만 맞으면 돼요. 한 줄 더 써서 백오십 자를 넘겨요.\n\n# 핵심 학습 리뷰\n## 1. 시험 주제 [작은]\n**어려웠던 것** 없음\n**제대로 알기**\n없음\n**정리**\n- 없음",
    "", "# 기록용", `요약: ${o.summary}`, `과정: ${o.steps.join(" / ")}`, "",
    ...o.cards.flatMap((c) => [`## 카드: ${c.name}`, `- 어떻게: ${c.how}`, `- 상황: ${c.situation ?? ""}`, `- 한 것: ${c.did ?? ""}`, `- 인용: ${c.quote ?? ""}`, `- 알게 된 것: ${c.learned ?? ""}`, `- 다음엔: ${c.next ?? ""}`,
      ...(c.code?.save ? [`- 코드: ${c.code.save} ${c.code.from}-${c.code.to}`] : []), ...(c.recheck?.q ? [`- 다시 확인: ${c.recheck.q}`, `- 모범답: ${c.recheck.a}`] : []), ...(c.ids?.length ? [`- 원장: ${c.ids.join(", ")}`] : []), ""]),
    "## 메모리", ...(m.add ?? []).map((x: any) => `- 추가: ${x.text} ← ${(x.evidence ?? []).join(", ")}`), ...(m.update ?? []).map((x: any) => `- 유지 [${x.id}]: ${x.text} ← ${(x.evidence ?? []).join(", ")}`),
    ...(m.improved ?? []).map((x: any) => `- 나아짐 [${x.id}] ← ${(x.evidence ?? []).join(", ")}`)].join("\n");
}
export const wrapFake = (ai: { setFakeAi: (f: any) => void }) => (f: (p: string, u: string) => any) => ai.setFakeAi((p: string, u: string) => { const r = f(p, u); return p === "goal-record" ? asCards(r) : r; });
