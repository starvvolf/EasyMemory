// 첫 실험 (설계 8번): 2606에서 지식 하나만 바꾸기. 성격 · 씨앗 · 나머지 조각은 똑같고 조각 하나씩만 다른 다섯 명.
export type ExperimentNpc = { id: string; name: string; options: string[]; expect: { route: string; see: string } };
export const FIRST_EXPERIMENT: ExperimentNpc[] = [
  { id: "n1", name: "① 다 가짐", options: [], expect: { route: "A", see: "한 번에 맞히나" } },
  { id: "n2", name: "② 큐 없음, 재귀 있음", options: ["큐없음"], expect: { route: "B", see: "길이 실제로 갈리나" } },
  { id: "n3", name: "③ 큐 · 재귀 없음", options: ["큐없음", "재귀없음"], expect: { route: "C", see: "지도에 있는 \"돌아가는 길\"이 코드로 나오나" } },
  { id: "n4", name: "④ \"표시하기\"를 잘못 앎", options: ["잘못앎-표시"], expect: { route: "E", see: "E → 시간 초과 → 막힘, 튜터가 그 생각을 짚나, 리뷰가 [핵심]으로 잡나" } },
  { id: "n5", name: "⑤ 2차원 목록 문법 없음", options: ["2차원문법없음"], expect: { route: "A", see: "A를 가다 문법 자리에서 막힘, 튜터가 문법만 짧게 알려 주나, 리뷰가 작은 것으로 잡나" } },
];
