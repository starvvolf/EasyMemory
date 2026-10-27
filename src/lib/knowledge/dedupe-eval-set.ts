// 같은 지식 찾기 시험지 (2026-10-28, 가상 데이터). Existing knowledge, then knowledge that comes in, with the answer
// for the pairs that matter. Any pair not listed is "다름". `ok` lists the verdicts that count as right for that pair:
// 같음 must be same; a 헷갈리는 다름 must never be same (and usually different).
export type EvalItem = { key: string; title: string; aliases?: string[]; body?: string; path: string };
export type EvalNew = EvalItem & { truth: Record<string, Array<"same" | "narrower" | "broader" | "related" | "different">> };

const A = "알고리즘", CS = "CS", EC = "경제", GR = "그래픽스";
export const BASE: EvalItem[] = [
  { key: "bin", title: "이분 탐색", path: A, body: "정렬된 배열에서 가운데 값과 비교해 찾는 범위를 절반씩 줄여 가며 찾는다. O(log N)." },
  { key: "dfs", title: "깊이 우선 탐색", path: A, body: "한 갈래를 끝까지 따라간 뒤 되돌아와 다른 갈래를 탐색한다. 스택이나 재귀로 구현한다." },
  { key: "bfs", title: "너비 우선 탐색", path: A, body: "시작점에서 가까운 정점부터 차례로 방문한다. 큐로 구현하며 가중치 없는 최단 거리를 구한다." },
  { key: "dp", title: "동적 계획법", path: A, body: "작은 부분 문제의 답을 저장해 두고 큰 문제의 답을 만든다. 겹치는 부분 문제와 최적 부분 구조가 있을 때 쓴다." },
  { key: "dij", title: "다익스트라 알고리즘", path: A, body: "음수 가중치가 없는 그래프에서 한 정점으로부터 모든 정점까지의 최단 거리를 구한다." },
  { key: "pq", title: "우선순위 큐", path: A, body: "우선순위가 가장 높은 원소를 먼저 꺼내는 자료구조. 보통 힙으로 구현한다." },
  { key: "heap", title: "힙", path: A, body: "부모가 자식보다 항상 크거나(최대 힙) 작은(최소 힙) 완전 이진 트리." },
  { key: "stack", title: "스택", path: A, body: "마지막에 넣은 것을 먼저 꺼내는(LIFO) 자료구조." },
  { key: "queue", title: "큐", path: A, body: "먼저 넣은 것을 먼저 꺼내는(FIFO) 자료구조." },
  { key: "mst", title: "최소 신장 트리", path: A, body: "그래프의 모든 정점을 잇는 트리 중 간선 가중치 합이 가장 작은 것." },
  { key: "kruskal", title: "크루스칼 알고리즘", path: A, body: "간선을 가중치 순으로 정렬해 사이클이 생기지 않는 것부터 골라 최소 신장 트리를 만든다." },
  { key: "uf", title: "유니온 파인드", path: A, body: "원소가 어느 집합에 속하는지 관리하며 두 집합을 합치고(union) 대표를 찾는다(find)." },
  { key: "prefix", title: "누적 합", path: A, body: "앞에서부터의 합 S[i]를 미리 만들어 두면 구간 합을 S[r] - S[l-1]로 구한다." },
  { key: "topo", title: "위상 정렬", path: A, body: "방향 비순환 그래프에서 간선의 방향을 거스르지 않도록 정점을 나열한다." },
  { key: "tc", title: "시간 복잡도", path: A, body: "입력 크기에 따라 알고리즘이 수행하는 연산 횟수가 늘어나는 정도." },
  { key: "sc", title: "공간 복잡도", path: A, body: "입력 크기에 따라 알고리즘이 쓰는 메모리가 늘어나는 정도." },
  { key: "lb", title: "lower_bound", path: A, body: "정렬된 배열에서 x 이상인 값이 처음 나오는 위치." },
  { key: "trie", title: "트라이", path: A, body: "문자열을 글자 단위로 트리에 저장해 접두사 검색을 빠르게 하는 자료구조." },
  { key: "dl", title: "교착 상태", path: CS, body: "둘 이상의 프로세스가 서로가 가진 자원을 기다리며 영원히 진행하지 못하는 상태." },
  { key: "starv", title: "기아 상태", path: CS, body: "우선순위가 낮은 프로세스가 자원을 계속 받지 못해 한없이 기다리는 상태." },
  { key: "tcp", title: "TCP", path: CS, body: "연결을 맺고 순서와 도착을 보장하는 전송 계층 프로토콜." },
  { key: "udp", title: "UDP", path: CS, body: "연결 없이 데이터를 보내며 순서와 도착을 보장하지 않는 전송 계층 프로토콜." },
  { key: "cache", title: "캐시", path: CS, body: "자주 쓰는 데이터를 빠른 저장소에 두어 접근 시간을 줄이는 것." },
  { key: "rate", title: "기준금리", path: EC, body: "한국은행이 정하는 정책 금리로, 시중 금리의 기준이 된다." },
  { key: "mrate", title: "시장금리", path: EC, body: "채권·예금 등 금융시장에서 실제로 형성되는 금리." },
  { key: "per", title: "PER", aliases: ["주가수익비율"], path: EC, body: "주가를 주당순이익으로 나눈 값. 이익에 비해 주가가 얼마나 높은지 보여 준다." },
  { key: "pbr", title: "PBR", path: EC, body: "주가를 주당순자산으로 나눈 값." },
  { key: "infl", title: "인플레이션", path: EC, body: "물가가 전반적으로 계속 오르는 현상." },
  { key: "defl", title: "디플레이션", path: EC, body: "물가가 전반적으로 계속 내리는 현상." },
  { key: "persp", title: "원근 투영", path: GR, body: "먼 물체일수록 작게 보이도록 한 점(시점)으로 모이는 선을 따라 투영한다." },
  { key: "ortho", title: "평행 투영", path: GR, body: "투영선이 서로 평행해 거리와 상관없이 크기가 유지된다." },
  { key: "zbuf", title: "깊이 버퍼", path: GR, body: "화소마다 가장 가까운 물체의 깊이를 저장해 가려진 면을 지운다." },
];

const same = ["same"] as const;
const notSame = ["different", "related", "narrower", "broader"] as const;
export const INCOMING: EvalNew[] = [
  // 같음: 다른 말, 한영, 약어, 띄어쓰기, 뜻 없이 이름만
  { key: "n_bin", title: "이진 탐색", path: A, body: "정렬된 자료를 반으로 나누어 원하는 값을 찾는 방법.", truth: { bin: [...same] } },
  { key: "n_binen", title: "Binary Search", path: A, truth: { bin: [...same] } },
  { key: "n_dfs", title: "DFS", path: A, truth: { dfs: [...same], bfs: ["different", "related"] } },
  { key: "n_bfs", title: "BFS", path: A, body: "Breadth-first search. 가까운 노드부터 방문한다.", truth: { bfs: [...same], dfs: ["different", "related"] } },
  { key: "n_dp", title: "다이나믹 프로그래밍", path: A, truth: { dp: [...same] } },
  { key: "n_dp2", title: "DP", path: A, body: "Dynamic Programming. 이미 푼 부분 문제의 답을 저장해 다시 계산하지 않는다.", truth: { dp: [...same] } },
  { key: "n_dij", title: "Dijkstra's algorithm", path: A, truth: { dij: [...same] } },
  { key: "n_mst", title: "MST", path: A, body: "Minimum Spanning Tree.", truth: { mst: [...same] } },
  { key: "n_uf", title: "서로소 집합 자료구조", path: A, body: "Disjoint Set Union. 집합 합치기와 대표 찾기를 빠르게 한다.", truth: { uf: [...same] } },
  { key: "n_prefix", title: "prefix sum", path: A, truth: { prefix: [...same] } },
  { key: "n_topo", title: "topological sort", path: A, truth: { topo: [...same] } },
  { key: "n_trie", title: "접두사 트리", path: A, body: "문자열의 공통 접두사를 공유하는 트리 구조.", truth: { trie: [...same] } },
  { key: "n_dl", title: "데드락", path: CS, truth: { dl: [...same], starv: ["different", "related"] } },
  { key: "n_rate", title: "정책금리", path: EC, body: "중앙은행이 통화정책으로 정하는 금리.", truth: { rate: [...same], mrate: ["different", "related"] } },
  { key: "n_per", title: "주가수익비율", path: EC, truth: { per: [...same] } },
  { key: "n_persp", title: "Perspective projection", path: GR, truth: { persp: [...same], ortho: ["different", "related"] } },
  { key: "n_zbuf", title: "Z-버퍼", path: GR, body: "픽셀마다 깊이를 저장해 앞에 있는 것만 그린다.", truth: { zbuf: [...same] } },
  { key: "n_rate2", title: "기준 금리", path: EC, truth: { rate: [...same] } },
  // 포함
  { key: "n_minheap", title: "최소 힙", path: A, body: "루트가 가장 작은 값인 힙.", truth: { heap: ["narrower"], n_maxheap: ["different", "related"] } },
  { key: "n_maxheap", title: "최대 힙", path: A, body: "루트가 가장 큰 값인 힙.", truth: { heap: ["narrower"], n_minheap: ["different", "related"] } },
  { key: "n_prim", title: "프림 알고리즘", path: A, body: "한 정점에서 시작해 가장 가벼운 간선으로 트리를 넓혀 최소 신장 트리를 만든다.",
    truth: { mst: ["narrower", "related"], kruskal: ["different", "related"] } },
  { key: "n_ub", title: "upper_bound", path: A, body: "정렬된 배열에서 x보다 큰 값이 처음 나오는 위치.", truth: { lb: ["different", "related"], bin: ["narrower", "related"] } },
  { key: "n_graph", title: "그래프 탐색", path: A, body: "그래프의 정점을 빠짐없이 체계적으로 방문하는 방법들.", truth: { dfs: ["broader"], bfs: ["broader"] } },
  { key: "n_iso", title: "등각 투영", path: GR, body: "세 축이 같은 각도로 보이게 하는 평행 투영의 한 종류.", truth: { ortho: ["narrower"], persp: ["different"] } },
  // 관련
  { key: "n_range", title: "구간 합", path: A, body: "배열의 l번째부터 r번째까지의 합.", truth: { prefix: ["related", "narrower"] } },
  { key: "n_heapsort", title: "힙 정렬", path: A, body: "힙에서 가장 큰 원소를 반복해서 꺼내 정렬한다.", truth: { heap: ["related"] } },
  { key: "n_memo", title: "메모이제이션", path: A, body: "함수의 결과를 저장해 두고 같은 입력이 오면 다시 계산하지 않는다.", truth: { dp: ["related", "narrower"] } },
  { key: "n_quic", title: "QUIC", path: CS, body: "UDP 위에서 연결 설정과 신뢰성을 구현한 전송 프로토콜.", truth: { udp: ["related"], tcp: ["different", "related"] } },
  // 헷갈리는 다름: 절대 같음이면 안 된다
  { key: "n_live", title: "라이브락", path: CS, body: "프로세스들이 서로 양보하며 상태는 계속 바뀌지만 아무도 진행하지 못하는 상태.", truth: { dl: [...notSame], starv: [...notSame] } },
  { key: "n_call", title: "콜금리", path: EC, body: "금융기관끼리 하루 동안 돈을 빌릴 때 적용되는 금리.", truth: { rate: [...notSame], mrate: ["narrower", "related", "different"] } },
  { key: "n_psr", title: "PSR", path: EC, body: "주가를 주당매출액으로 나눈 값.", truth: { per: ["different", "related"], pbr: ["different", "related"] } },
  { key: "n_stag", title: "스태그플레이션", path: EC, body: "경기 침체와 물가 상승이 함께 나타나는 현상.", truth: { infl: [...notSame], defl: ["different", "related"] } },
  { key: "n_thrash", title: "스래싱", path: CS, body: "페이지 교체가 너무 잦아 실제 작업보다 교체에 시간을 더 쓰는 상태.", truth: { dl: ["different", "related"], cache: ["different", "related"] } },
  { key: "n_asym", title: "점근 표기법", path: A, body: "빅오처럼 입력이 커질 때 증가하는 정도를 나타내는 표기.", truth: { tc: ["related", "narrower", "broader"], sc: ["related", "different"] } },
];
