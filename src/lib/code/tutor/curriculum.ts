// 알고리즘 커리큘럼 (2026-11-11, 사용자 "커리큘럼 하나로 합치자"). 튜터의 배우는 순서·설문·다음에 배울 것·AI 튜터 3번 장이 모두 이것을 본다.
// 설계 문서: Claude 문서 "Recaller 알고리즘 커리큘럼 (안)" (자료구조 15 + 알고리즘 37 = 필수 52, 처음 배우는 순서 12칸 3부).
//   - 칸(step)은 처음 배우는 사람의 순서다. 칸마다 갈래(자료구조 / 알고리즘)와 이름이 있다.
//   - 지금 앱에 있는 패턴 44개를 칸에 넣었다. 커리큘럼에만 있는 13개는 이름만 자리에 둔다(planned: 문제 재료를 만들면 패턴이 된다).
//   - 합쳐진 것(merged): 방문 표시는 BFS·DFS를 짤 때 계획 단계에서 확인할 것, 안정 정렬은 정렬 기준 정하기의 한 경우. 설문·배우는 순서에서 뺀다.
//   - 선택(optional): 커서 편집·정렬된 집합·네 조각 분할 정복. 필수 뒤에 둔다.
//   - 먼저 알 것(prereq): 칸 순서와 별도로, 배우는 순서는 먼저 알 것이 앞에 오게 맞춘다(예: 트리 돌기는 인접 리스트 뒤).
import { PATTERNS, type Pattern } from "./patterns.ts";

export type Track = "ds" | "algo";
export const TRACK_NAME: Record<Track, string> = { ds: "자료구조", algo: "알고리즘" };
export type Step = { n: number; part: 1 | 2 | 3; track: Track; code: string; name: string; /** 있는 패턴 id, 순서대로 */ patterns: string[]; /** 커리큘럼에만 있는 것(아직 패턴 아님) */ planned: string[] };
export const PART_NAME = { 1: "구현과 정렬", 2: "자료구조와 탐색", 3: "최적화와 그래프 심화" } as const;
export const STEPS: Step[] = [
  { n: 1, part: 1, track: "algo", code: "알1", name: "기본기", patterns: ["fast-io"], planned: ["구현·시뮬레이션", "문자열 다루기"] },
  { n: 2, part: 1, track: "ds", code: "자1", name: "배열과 표", patterns: ["min-max-init", "count-array", "exist-table", "prefix-sum"], planned: ["2차원 누적 합"] },
  { n: 3, part: 1, track: "algo", code: "알2", name: "정렬", patterns: ["sort-key", "counting-sort", "merge-two"], planned: ["좌표 압축", "구간 합치기"] },
  { n: 4, part: 1, track: "ds", code: "자2", name: "해시", patterns: ["hash-lookup"], planned: ["빈도 세기·그룹 묶기"] },
  { n: 5, part: 2, track: "ds", code: "자3", name: "줄 서는 것", patterns: ["stack-match", "stack-mono", "queue-sim", "deque-both", "heap"], planned: [] },
  { n: 6, part: 2, track: "algo", code: "알3", name: "모두 해 보기", patterns: ["recursion-reduce", "backtrack-choose", "backtrack-start", "backtrack-prune"], planned: ["완전 탐색", "비트마스크로 부분집합"] },
  { n: 7, part: 2, track: "algo", code: "알4", name: "그래프 탐색", patterns: ["grid-dxdy", "bfs-distance", "multi-source", "components", "tree-walk"], planned: ["깊이 우선 탐색(DFS)"] },
  { n: 8, part: 2, track: "ds", code: "자4", name: "그래프·트리 담기", patterns: ["graph-adj", "union-find"], planned: ["트리 부모·깊이 구하기"] },
  { n: 9, part: 3, track: "algo", code: "알5", name: "범위 좁혀 찾기", patterns: ["bsearch", "param-search", "two-pointer"], planned: ["슬라이딩 윈도우"] },
  { n: 10, part: 3, track: "algo", code: "알6", name: "그리디와 DP", patterns: ["greedy-sort", "dp-1d", "dp-state", "dp-knapsack", "lis"], planned: ["격자 경로 DP"] },
  { n: 11, part: 3, track: "algo", code: "알7", name: "수학", patterns: ["gcd", "sieve"], planned: ["나머지·조합 세기"] },
  { n: 12, part: 3, track: "algo", code: "알8", name: "그래프 심화", patterns: ["topo-sort", "dijkstra", "floyd", "mst"], planned: [] },
];
export const OPTIONAL = ["cursor-list", "ordered-set", "divide-quarter"];
/** 다른 패턴에 합쳐져 따로 배우지 않는 것 → 합쳐진 곳 */
export const MERGED: Record<string, string> = { visited: "bfs-distance", "stable-sort": "sort-key" };
/** 먼저 알 것(필수끼리만). */
export const PREREQ: Record<string, string[]> = {
  "stack-mono": ["stack-match"], "bfs-distance": ["queue-sim", "grid-dxdy"], "multi-source": ["bfs-distance"], components: ["grid-dxdy"], "tree-walk": ["graph-adj"],
  "backtrack-choose": ["recursion-reduce"], "backtrack-start": ["recursion-reduce"], "backtrack-prune": ["recursion-reduce"], "divide-quarter": ["recursion-reduce"],
  bsearch: ["sort-key"], "param-search": ["bsearch"], "two-pointer": ["sort-key"], "greedy-sort": ["sort-key"],
  "dp-1d": ["recursion-reduce"], "dp-state": ["dp-1d"], "dp-knapsack": ["dp-1d"], lis: ["dp-1d", "bsearch"],
  "topo-sort": ["queue-sim", "graph-adj"], dijkstra: ["heap", "bfs-distance", "graph-adj"], floyd: ["graph-adj"], mst: ["sort-key", "union-find"],
};
export const OPTIONAL_STEP: Step = { n: 13, part: 3, track: "algo", code: "선택", name: "더 해 보기", patterns: OPTIONAL, planned: ["0-1 BFS", "KMP·트라이", "기하"] };

const stepOfId = new Map<string, Step>([...STEPS, OPTIONAL_STEP].flatMap((s) => s.patterns.map((id) => [id, s] as const)));
for (const [id, into] of Object.entries(MERGED)) stepOfId.set(id, stepOfId.get(into)!);
export const stepOf = (id: string) => stepOfId.get(id);

/** 배우는 순서: 칸 순서대로, 단 먼저 알 것이 뒤에 있으면 그 뒤로 미룬다. 합쳐진 것은 빼고 선택은 맨 뒤. */
function order(): Pattern[] {
  const byId = new Map(PATTERNS.map((p) => [p.id, p]));
  const wanted = [...STEPS.flatMap((s) => s.patterns), ...OPTIONAL].filter((id) => byId.has(id));
  const out: string[] = []; const left = [...wanted];
  while (left.length) {
    const i = left.findIndex((id) => (PREREQ[id] ?? []).every((r) => out.includes(r) || !wanted.includes(r)));
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return out.map((id) => byId.get(id)!);
}
export const ORDERED = order();
/** 화면에 보이는 패턴 목록에 없던 것(새 패턴이 patterns.ts에 생겼는데 칸에 안 넣은 것)이 있으면 시험이 잡는다. */
export const UNPLACED = PATTERNS.filter((p) => !stepOfId.has(p.id)).map((p) => p.id);

/** 이 패턴이 커리큘럼 어디인지: "알고리즘 › 범위 좁혀 찾기 › 투 포인터". */
export function placeOf(id: string) {
  const s = stepOf(id), p = PATTERNS.find((x) => x.id === id);
  if (!s || !p) return null;
  const merged = MERGED[id];
  return { step: s.n, part: s.part, code: s.code, track: s.track, trackName: TRACK_NAME[s.track], stepName: s.name, name: p.name, optional: OPTIONAL.includes(id),
    ...(merged ? { mergedInto: PATTERNS.find((x) => x.id === merged)?.name ?? merged } : {}), prereqs: (PREREQ[id] ?? []).map((r) => ({ id: r, name: PATTERNS.find((x) => x.id === r)?.name ?? r })) };
}
