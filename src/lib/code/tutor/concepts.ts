// PS 튜터: 개념과 헷갈리는 짝 (2026-11-10, 사용자 "보기를 BFS·DFS·배열·큐 정도 레벨의 개념 중에서, 개념들의 연관성을 이어서
// 연관성 있는 애들을 깔자", "살짝 섞을 수도 — 해시·정렬·유니온 파인드·BFS처럼").
//   - 방법 고르기의 보기는 AI가 문제마다 지어낸 문장이 아니라 이 개념 이름이다. 정답은 문제 패턴의 개념, 오답은 연결된 개념 둘 + 섞은 것 하나.
//   - 연결마다 "언제 이쪽이고 언제 저쪽인지" 한 줄(손으로 씀): 틀렸을 때 설명이자 기억 카드의 "이렇게 하면 돼요".
//   - 채점도 코드: 문제 패턴의 개념(+ 그 패턴에서 "이것도 돼요"인 개념)이면 맞음. AI 없음.
export type Concept = { id: string; name: string; what: string };
export const CONCEPTS: Concept[] = [
  { id: "array", name: "배열", what: "값을 칸 번호로 바로 찾거나 세어 둬요" },
  { id: "hash", name: "해시", what: "값이나 이름을 열쇠로 넣고 바로 찾아요" },
  { id: "linked", name: "연결 리스트", what: "중간에 넣고 지우기를 많이 할 때 써요" },
  { id: "stack", name: "스택", what: "가장 최근에 넣은 것부터 꺼내요" },
  { id: "queue", name: "큐", what: "먼저 넣은 것부터 꺼내요" },
  { id: "deque", name: "덱", what: "양쪽 끝에서 넣고 빼요" },
  { id: "sort", name: "정렬", what: "기준대로 줄 세워요" },
  { id: "bsearch", name: "이분 탐색", what: "정렬된 곳에서 범위를 반씩 줄여 찾아요" },
  { id: "twoptr", name: "투 포인터", what: "구간의 양 끝을 앞으로만 밀며 조건을 맞춰요" },
  { id: "prefix", name: "누적 합", what: "앞에서부터 더해 두고 빼서 구간 합을 구해요" },
  { id: "recursion", name: "재귀", what: "한 단계 작은 같은 문제로 줄여요" },
  { id: "divide", name: "분할 정복", what: "여러 조각으로 나눠 각각 풀고 합쳐요" },
  { id: "backtrack", name: "백트래킹", what: "하나씩 골랐다가 되돌리며 모든 경우를 만들어요" },
  { id: "brute", name: "완전 탐색", what: "가능한 경우를 전부 해 봐요" },
  { id: "sim", name: "시뮬레이션", what: "문제에 적힌 규칙을 그대로 따라 해요" },
  { id: "bfs", name: "BFS", what: "가까운 곳부터 한 겹씩 퍼져 나가요" },
  { id: "dfs", name: "DFS", what: "한 길로 끝까지 갔다가 돌아와요" },
  { id: "greedy", name: "그리디", what: "지금 가장 좋아 보이는 것을 고르는 게 늘 맞을 때 써요" },
  { id: "dp", name: "DP", what: "작은 문제의 답을 표에 적어 두고 큰 문제의 답을 만들어요" },
  { id: "math", name: "수학(소수·약수)", what: "소수 체, 최대공약수 같은 수의 성질을 써요" },
  { id: "heap", name: "우선순위 큐", what: "넣으면서 가장 작은(큰) 것을 계속 꺼내요" },
  { id: "bst", name: "이진 검색 트리", what: "넣고 빼면서도 정렬된 상태를 지켜요" },
  { id: "tree", name: "트리", what: "사이클 없이 이어진 그래프를 뿌리부터 따라가요" },
  { id: "topo", name: "위상 정렬", what: "먼저 해야 할 것부터 순서를 정해요" },
  { id: "dijkstra", name: "다익스트라", what: "선마다 거리가 다를 때 한 점에서의 최단 거리를 구해요" },
  { id: "floyd", name: "플로이드", what: "모든 점 사이의 최단 거리를 한꺼번에 구해요" },
  { id: "mst", name: "최소 신장 트리", what: "모든 점을 가장 싸게 이어요" },
  { id: "dsu", name: "유니온 파인드", what: "같은 무리인지 빨리 확인하고 무리를 합쳐요" },
];
const NAME = new Map(CONCEPTS.map((c) => [c.id, c]));
export const conceptOf = (id: string) => NAME.get(id);

/** 헷갈리는 짝과 "언제 이쪽, 언제 저쪽". 앞이 a, 뒤가 b. */
export const EDGES: Array<{ a: string; b: string; diff: string }> = [
  { a: "bfs", b: "dfs", diff: "가장 짧은 거리를 물으면 BFS예요. 가까운 곳부터 퍼져서 처음 닿을 때가 곧 최단이에요. 이어진 곳을 다 돌아보기만 하면 DFS도 돼요." },
  { a: "dfs", b: "backtrack", diff: "이어진 곳을 한 번씩 훑기만 하면 DFS, 하나씩 골랐다 되돌리며 모든 경우를 만들어야 하면 백트래킹이에요." },
  { a: "backtrack", b: "brute", diff: "경우가 적어 다 해 봐도 되면 완전 탐색, 고르는 도중에 안 될 길을 일찍 끊어야 하면 백트래킹이에요." },
  { a: "bfs", b: "dijkstra", diff: "선마다 거리가 다 같으면 BFS, 선마다 거리가 다르면 다익스트라예요." },
  { a: "dijkstra", b: "floyd", diff: "출발점이 하나면 다익스트라, 모든 점 사이의 거리가 필요하고 점이 수백 개 이하면 플로이드예요." },
  { a: "mst", b: "dijkstra", diff: "한 곳에서 다른 곳까지 가장 짧은 길은 다익스트라, 모든 점을 가장 싸게 잇는 건 최소 신장 트리예요." },
  { a: "mst", b: "dsu", diff: "모든 점을 싸게 이으려면 최소 신장 트리, 같은 무리인지 묻고 합치기만 하면 유니온 파인드예요." },
  { a: "dsu", b: "bfs", diff: "연결이 계속 더해지며 같은 무리인지 자주 물으면 유니온 파인드, 다 이어진 뒤 덩어리를 한 번 세면 BFS로도 돼요." },
  { a: "topo", b: "bfs", diff: "'A를 끝내야 B'처럼 순서 조건이 있으면 위상 정렬, 그냥 이어진 곳으로 퍼지면 BFS예요." },
  { a: "tree", b: "bfs", diff: "트리는 사이클이 없어서 뿌리에서 BFS나 DFS로 부모와 깊이를 한 번에 구해요. 그래프면 방문 표시가 더 필요해요." },
  { a: "tree", b: "dfs", diff: "트리는 사이클이 없어서 뿌리에서 DFS나 BFS로 부모와 깊이를 한 번에 구해요." },
  { a: "stack", b: "queue", diff: "가장 최근에 넣은 것부터 꺼내면 스택, 먼저 넣은 것부터 꺼내면 큐예요." },
  { a: "queue", b: "deque", diff: "한쪽으로 넣고 다른 쪽으로 빼기만 하면 큐, 양쪽 끝에서 넣고 빼야 하면 덱이에요." },
  { a: "stack", b: "deque", diff: "한쪽 끝만 쓰면 스택으로 충분해요. 양쪽 끝을 다 써야 덱이에요." },
  { a: "linked", b: "array", diff: "중간에 넣고 지우기가 많으면 연결 리스트, 몇 번째 칸인지로 바로 찾기가 많으면 배열이에요." },
  { a: "linked", b: "stack", diff: "커서 앞뒤로 넣고 지우는 편집은 연결 리스트나 스택 두 개로 해요. 스택 하나로는 커서 뒤쪽을 못 다뤄요." },
  { a: "array", b: "hash", diff: "값의 범위가 작은 정수면 배열 칸에 바로 세고, 값이 아주 크거나 문자열이면 해시예요." },
  { a: "hash", b: "sort", diff: "있는지·몇 번 나왔는지만 빨리 보면 해시, 순서대로 나열하거나 범위를 봐야 하면 정렬이에요." },
  { a: "sort", b: "bsearch", diff: "한 번 정렬해 두고 값을 여러 번 찾으면 이분 탐색까지 써요. 줄 세우기만 필요하면 정렬로 끝나요." },
  { a: "hash", b: "bsearch", diff: "있는지 여러 번 물으면 해시도, 정렬 + 이분 탐색도 돼요. '이상·이하' 같은 범위를 물으면 이분 탐색이에요." },
  { a: "bsearch", b: "twoptr", diff: "정렬된 곳에서 값 하나를 찾으면 이분 탐색, 구간의 양 끝을 함께 밀며 조건을 맞추면 투 포인터예요." },
  { a: "twoptr", b: "prefix", diff: "고정된 구간의 합을 여러 번 물으면 누적 합, 조건을 만족하는 가장 긴(짧은) 구간을 찾으면 투 포인터예요." },
  { a: "prefix", b: "dp", diff: "더해 둔 값을 빼서 구간 합을 구하면 누적 합, 앞 칸 답으로 다음 칸 답을 만들면 DP예요." },
  { a: "dp", b: "greedy", diff: "지금 가장 좋아 보이는 걸 고르는 게 늘 맞으면 그리디, 아니면 경우를 표에 쌓아 비교하는 DP예요." },
  { a: "dp", b: "brute", diff: "같은 계산이 여러 번 반복되면 DP로 표에 적어 두고, 경우가 적으면 완전 탐색도 돼요." },
  { a: "greedy", b: "sort", diff: "줄만 세우면 답이 나오면 정렬, 줄 세운 뒤 앞에서부터 고르는 판단이 들어가면 그리디예요." },
  { a: "heap", b: "sort", diff: "처음에 한 번 줄 세우면 되면 정렬, 넣으면서 계속 가장 작은(큰) 걸 꺼내야 하면 우선순위 큐예요." },
  { a: "bst", b: "heap", diff: "가장 작은(큰) 것만 꺼내면 우선순위 큐, 작은 것·큰 것·특정 값을 다 넣고 빼야 하면 이진 검색 트리예요." },
  { a: "bst", b: "hash", diff: "있는지만 보면 해시, 정렬된 순서도 같이 필요하면 이진 검색 트리예요." },
  { a: "recursion", b: "divide", diff: "한 단계 작은 같은 문제로 줄이면 재귀, 여러 조각으로 나눠 각각 풀고 합치면 분할 정복이에요." },
  { a: "recursion", b: "dp", diff: "같은 작은 문제를 여러 번 부르게 되면 재귀 대신 DP로 답을 적어 둬요." },
  { a: "recursion", b: "backtrack", diff: "답을 하나로 줄여 가면 재귀, 여러 선택지를 차례로 골랐다 되돌리면 백트래킹이에요." },
  { a: "sim", b: "queue", diff: "차례를 줄 세워 앞에서부터 처리하면 큐, 정해진 규칙대로 한 칸씩 따라가기만 하면 시뮬레이션이에요." },
  { a: "sim", b: "brute", diff: "정해진 규칙을 한 번 따라가면 시뮬레이션, 가능한 경우를 전부 해 보면 완전 탐색이에요." },
  { a: "sim", b: "array", diff: "배열에 값을 적어 두고 규칙대로 바꿔 가는 게 시뮬레이션이에요. 배열은 그 도구예요." },
  { a: "math", b: "brute", diff: "수마다 하나씩 나눠 보면 느려요. 소수를 여러 번 쓰면 체로 한 번에 걸러요." },
  { a: "math", b: "dp", diff: "수의 성질(약수·소수)로 바로 구하면 수학, 작은 수의 답으로 큰 수의 답을 만들면 DP예요." },
];

/** 패턴 → 개념. null은 방법이 아니라 쓰는 요령(격자 사방 탐색, 방문 표시, 빠른 입출력, 초기값)이라 보기로 묻지 않는다. */
export const PATTERN_CONCEPT: Record<string, string | null> = {
  "count-array": "array", "exist-table": "array", "min-max-init": null, "cursor-list": "linked", "stack-match": "stack", "stack-mono": "stack",
  "queue-sim": "queue", "deque-both": "deque", "grid-dxdy": null, visited: null, "bfs-distance": "bfs", "multi-source": "bfs", components: "bfs",
  "recursion-reduce": "recursion", "divide-quarter": "divide", "backtrack-choose": "backtrack", "backtrack-start": "backtrack", "backtrack-prune": "backtrack",
  "sort-key": "sort", "counting-sort": "array", "stable-sort": "sort", "merge-two": "sort", "fast-io": null, "prefix-sum": "prefix",
  "dp-1d": "dp", "dp-state": "dp", "dp-knapsack": "dp", lis: "dp", "greedy-sort": "greedy", sieve: "math", gcd: "math",
  bsearch: "bsearch", "param-search": "bsearch", "two-pointer": "twoptr", "hash-lookup": "hash", "ordered-set": "bst", heap: "heap",
  "graph-adj": "bfs", "tree-walk": "tree", "topo-sort": "topo", mst: "mst", floyd: "floyd", dijkstra: "dijkstra", "union-find": "dsu",
};
/** 그 패턴의 문제에서 "이것도 돼요"인 개념(정답으로 친다). */
export const ALSO_OK: Record<string, string[]> = {
  components: ["dfs", "dsu"], "graph-adj": ["dfs"], "tree-walk": ["bfs", "dfs"], "exist-table": ["hash"], "count-array": ["hash"],
  "cursor-list": ["stack"], "queue-sim": ["deque"], "divide-quarter": ["recursion"], "merge-two": ["twoptr"], "hash-lookup": ["bst", "bsearch"],
  "stack-match": [], "union-find": [],
};

const neighbors = (c: string) => EDGES.flatMap((e) => (e.a === c ? [e.b] : e.b === c ? [e.a] : []));
export const diffOf = (x: string, y: string) => EDGES.find((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x))?.diff;

/** 이 문제(패턴들)의 정답 개념: 첫 개념이 주된 것. 요령 패턴만 있으면 빈 목록(보기로 묻지 않음). */
export function answerOf(patterns: string[]) {
  const main = [...new Set(patterns.map((p) => PATTERN_CONCEPT[p]).filter((c): c is string => Boolean(c)))];
  const ok = new Set([...main, ...patterns.flatMap((p) => ALSO_OK[p] ?? [])]);
  return { main: main[0] ?? null, ok };
}

function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 2 ** 32; }; }
const shuffle = <T,>(xs: T[], r: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 보기 4개(개념 이름): 정답 + 정답과 이어진 개념 둘 + 섞은 것 하나(이웃의 이웃이나 아무 개념). 정답으로 치는 개념은 오답으로 안 낸다.
 *  같은 seed면 같은 보기(다시 열어도 그대로). */
export function conceptOptions(patterns: string[], seed: string, count = 4): { options: string[]; answer: string; ok: string[] } | null {
  const { main, ok } = answerOf(patterns);
  if (!main) return null;
  const r = rng(`${seed}:${patterns.join(",")}`);
  const near = shuffle(neighbors(main).filter((c) => !ok.has(c)), r);
  const twoHop = shuffle([...new Set(near.flatMap(neighbors))].filter((c) => c !== main && !ok.has(c) && !near.includes(c)), r);
  const rest = shuffle(CONCEPTS.map((c) => c.id).filter((c) => c !== main && !ok.has(c) && !near.includes(c) && !twoHop.includes(c)), r);
  const mixed = r() < 0.5 ? (twoHop[0] ?? rest[0]) : (rest[0] ?? twoHop[0]);
  const picks = [...near.slice(0, count - 2), ...(mixed ? [mixed] : [])];
  for (const c of [...near.slice(count - 2), ...twoHop, ...rest]) if (picks.length < count - 1 && !picks.includes(c)) picks.push(c);
  const name = (id: string) => NAME.get(id)!.name;
  return { options: shuffle([main, ...picks.slice(0, count - 1)], r).map(name), answer: name(main), ok: [...ok].map(name) };
}
/** 개념 이름 → id */
export const conceptIdOf = (name: string) => CONCEPTS.find((c) => c.name === name)?.id;
