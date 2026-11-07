// 문제 등급과 요구 능력 (2026-11-07, 사용자 요청). AI 없이 코드로만 정한다.
//   등급: 백준 문제는 solved.ac 티어(1~30)·분류·푼 사람 수. 앱 안의 묶음(solvedac-snapshot.json)에서 읽는다.
//   요구 능력: 문법(1단계)부터 심화 알고리즘(6단계)까지 고정된 사다리. 낮은 단계는 모범 풀이 코드에서 찾고,
//   높은 단계는 solved.ac 분류와 문제에 걸린 기억 이름으로 찾는다.
import snapshot from "./solvedac-snapshot.json" with { type: "json" };

/* ---------- 등급 ---------- */
export type Grade = { platform: "boj"; number: string; level: number; tier: string; group: TierGroup; meaning: string;
  tags: Array<{ key: string; name: string }>; solvers: number; avgTries: number; at: string };
export type TierGroup = "unrated" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "ruby";
const GROUPS: Array<[TierGroup, string, string]> = [
  ["bronze", "브론즈", "입출력과 문법(조건·반복·배열)만 알면 풀 수 있어요."],
  ["silver", "실버", "기본 자료구조·정렬·완전 탐색·BFS/DFS 기초처럼 대표 풀이 하나를 떠올려야 해요."],
  ["gold", "골드", "DP·그래프·이분 탐색 같은 기법을 문제에 맞게 응용해야 해요. 코딩 테스트에서 흔히 보는 수준이에요."],
  ["platinum", "플래티넘", "세그먼트 트리 같은 고급 자료구조나 여러 기법을 합쳐야 해요."],
  ["diamond", "다이아몬드", "대회 수준의 어려운 문제예요."],
  ["ruby", "루비", "최상위 대회 수준이에요."],
];
const ROMAN = ["V", "IV", "III", "II", "I"];
/** solved.ac level 1~30 → "실버 III". 0은 아직 등급이 없는 문제. */
export function tierOf(level: number): { tier: string; group: TierGroup; meaning: string } {
  if (!Number.isInteger(level) || level < 1 || level > 30) return { tier: "등급 없음", group: "unrated", meaning: "아직 solved.ac 등급이 정해지지 않은 문제예요." };
  const [group, name, meaning] = GROUPS[Math.floor((level - 1) / 5)];
  return { tier: `${name} ${ROMAN[(level - 1) % 5]}`, group, meaning };
}

// solved.ac는 앱 서버의 요청을 Cloudflare 확인으로 막아서(11/8 확인, 403) 서버에서 묻지 않는다.
// 대신 바킹독 문제집 전체(483문제)를 PC 브라우저로 한 번 받아 둔 묶음을 읽는다. 묶음에 없는 번호는 등급 없음.
type Snapshot = { fetchedAt: string; probs: Record<string, [number, number, number, string[]]>; tags: Record<string, string> };
const SNAP = snapshot as unknown as Snapshot;

/** The Baekjoon number of a problem, from its id, title, source title or address. */
export function bojNumber(p: { id: string; title: string; source: { title: string; url?: string } }): string | null {
  const hit = /^cp_boj_(\d{1,6})$/.exec(p.id) ?? /\bBOJ\s*(\d{1,6})/.exec(p.title) ?? /\bBOJ\s*(\d{1,6})/.exec(p.source.title)
    ?? /acmicpc\.net\/problem\/(\d{1,6})/.exec(p.source.url ?? "");
  return hit ? hit[1] : null;
}

/** Grades for Baekjoon numbers, from the kept solved.ac copy. Numbers it does not have are left out. */
export function gradesFor(numbers: string[], snap: Snapshot = SNAP): Map<string, Grade> {
  const out = new Map<string, Grade>();
  for (const n of new Set(numbers)) {
    const row = snap.probs[n];
    if (!row) continue;
    const [level, solvers, avgTries, keys] = row;
    out.set(n, { platform: "boj", number: n, level, ...tierOf(level), solvers, avgTries, at: snap.fetchedAt, tags: keys.map((key) => ({ key, name: snap.tags[key] ?? key })) });
  }
  return out;
}

/* ---------- 요구 능력 사다리 ---------- */
export type Ability = { id: string; name: string; what: string;
  /** solved.ac 분류 key */ tags?: string[];
  /** 기억 이름과 맞출 다른 이름 */ names?: string[];
  /** 모범 풀이(JavaScript)에서 찾는 모양 */ code?: RegExp; always?: true };
export type Step = { step: number; name: string; what: string; abilities: Ability[] };
export const LADDER: Step[] = [
  { step: 1, name: "입출력과 기본 문법", what: "문제를 읽고 답을 내는 데 꼭 필요한 문법", abilities: [
    { id: "io", name: "입력 받기·출력하기", what: "입력을 읽어 숫자로 바꾸고, 형식에 맞게 출력", always: true },
    { id: "var", name: "변수와 자료형", what: "정수·실수·문자열을 담고 바꾸기", always: true },
    { id: "arith", name: "연산(몫·나머지)", what: "사칙 연산, 몫과 나머지", code: /%|Math\.(floor|trunc|ceil)|\*\*/, tags: ["arithmetic"] },
    { id: "cond", name: "조건문", what: "경우에 따라 다르게 하기", code: /\bif\s*\(|\?[^:\n]+:/ },
    { id: "loop", name: "반복문", what: "같은 일을 여러 번", code: /\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.reduce\(/ },
    { id: "bigint", name: "큰 수(자료형 범위)", what: "int 범위를 넘는 값 다루기", code: /BigInt|\b\d+n\b/, tags: ["arbitrary_precision"], names: ["자료형 범위(오버플로)", "오버플로"] },
  ] },
  { step: 2, name: "자료 다루기", what: "여러 값을 담고 꺼내는 문법", abilities: [
    { id: "array", name: "배열·리스트", what: "여러 값을 순서대로 담기", code: /\.push\(|new Array|Array\.from|\[\s*\]|\w\[[ijk]\]/ },
    { id: "grid", name: "2차원 배열(격자)", what: "표·지도를 행과 열로", code: /\w\[[^\]]+\]\[[^\]]+\]/, tags: ["grid_graph"] },
    { id: "string", name: "문자열 다루기", what: "글자 하나씩 보기, 자르기, 바꾸기", code: /charCodeAt|charAt\(|substring\(|toUpperCase|toLowerCase|split\(""\)|fromCharCode/, tags: ["string", "parsing"], names: ["문자열"] },
    { id: "sortfn", name: "정렬 함수 쓰기", what: "기본 정렬과 기준 정렬", code: /\.sort\(/, tags: ["sorting"], names: ["정렬"] },
    { id: "func", name: "함수 만들기", what: "일을 함수로 나눠 다시 쓰기", code: /\bfunction\s+\w+\s*\(|const\s+\w+\s*=\s*\([^)]*\)\s*=>/ },
  ] },
  { step: 3, name: "기초 풀이 방법", what: "자료구조 없이 생각만으로 푸는 방법", abilities: [
    { id: "impl", name: "구현·시뮬레이션", what: "문제에 적힌 대로 정확히 옮기기", tags: ["implementation", "simulation", "case_work"], names: ["구현", "시뮬레이션"] },
    { id: "brute", name: "완전 탐색", what: "가능한 경우를 모두 해 보기", tags: ["bruteforcing"], names: ["브루트포스", "완전 탐색"] },
    { id: "math", name: "수학(약수·소수·최대공약수)", what: "수의 성질로 계산 줄이기", tags: ["math", "number_theory", "primality_test", "sieve", "euclidean", "combinatorics"], names: ["수학", "소수", "최대공약수"] },
    { id: "prefix", name: "누적 합", what: "구간 합을 미리 더해 두기", tags: ["prefix_sum"], names: ["누적 합", "구간 합"] },
    { id: "greedy", name: "그리디", what: "지금 가장 좋은 것을 고르기", tags: ["greedy"], names: ["그리디", "탐욕법"] },
  ] },
  { step: 4, name: "자료구조", what: "값을 넣고 빼는 규칙이 있는 그릇", abilities: [
    { id: "stack", name: "스택", what: "나중에 넣은 것을 먼저", tags: ["stack"], names: ["스택"] },
    { id: "queue", name: "큐·덱", what: "먼저 넣은 것을 먼저, 양쪽 끝", tags: ["queue", "deque"], names: ["큐", "덱"] },
    { id: "hash", name: "해시(맵·셋)", what: "키로 바로 찾기", code: /new (Map|Set)\b/, tags: ["hash_set", "set", "map"], names: ["해시", "해시 테이블", "해시맵", "셋"] },
    { id: "heap", name: "우선순위 큐", what: "가장 작은(큰) 것을 빨리", tags: ["priority_queue"], names: ["우선순위 큐", "힙"] },
    { id: "tree", name: "트리", what: "부모·자식으로 이어진 구조", tags: ["trees", "tree_set"], names: ["트리"] },
  ] },
  { step: 5, name: "알고리즘 기법", what: "대표 풀이 틀을 문제에 맞추기", abilities: [
    { id: "recursion", name: "재귀", what: "같은 일을 더 작은 문제로", tags: ["recursion"], names: ["재귀"] },
    { id: "binsearch", name: "이분 탐색", what: "반씩 줄여 찾기", tags: ["binary_search", "parametric_search"], names: ["이분 탐색", "이진 탐색", "lower_bound", "매개 변수 탐색"] },
    { id: "twoptr", name: "투 포인터", what: "두 위치를 움직이며 훑기", tags: ["two_pointer", "sliding_window"], names: ["투 포인터", "슬라이딩 윈도우"] },
    { id: "graph", name: "그래프 탐색(BFS·DFS)", what: "이어진 곳을 차례로 방문", tags: ["graphs", "graph_traversal", "bfs", "dfs", "flood_fill"], names: ["BFS", "DFS", "너비 우선 탐색", "깊이 우선 탐색", "그래프 탐색"] },
    { id: "backtrack", name: "백트래킹", what: "해 보고 아니면 되돌리기", tags: ["backtracking"], names: ["백트래킹"] },
    { id: "divide", name: "분할 정복", what: "나눠 풀고 합치기", tags: ["divide_and_conquer", "exponentiation_by_squaring"], names: ["분할 정복"] },
  ] },
  { step: 6, name: "심화", what: "여러 기법을 합치거나 큰 입력을 다루는 방법", abilities: [
    { id: "dp", name: "다이나믹 프로그래밍", what: "작은 답을 저장해 큰 답을", tags: ["dp", "knapsack", "lis", "dp_tree", "dp_bitfield"], names: ["다이나믹 프로그래밍", "동적 계획법", "DP", "메모이제이션"] },
    { id: "shortest", name: "최단 경로", what: "가중치 그래프에서 가장 짧은 길", tags: ["shortest_path", "dijkstra", "floyd_warshall", "bellman_ford"], names: ["최단 경로", "다익스트라", "플로이드"] },
    { id: "dsu", name: "유니온 파인드", what: "같은 묶음인지 빨리", tags: ["disjoint_set"], names: ["유니온 파인드", "분리 집합"] },
    { id: "mst", name: "최소 스패닝 트리", what: "모두 잇는 가장 싼 길", tags: ["mst"], names: ["최소 스패닝 트리"] },
    { id: "topo", name: "위상 정렬", what: "순서가 정해진 일 줄 세우기", tags: ["topological_sorting"], names: ["위상 정렬"] },
    { id: "segtree", name: "세그먼트 트리", what: "구간 값을 빨리 고치고 묻기", tags: ["segtree", "lazyprop", "fenwick"], names: ["세그먼트 트리", "펜윅 트리"] },
    { id: "bitmask", name: "비트마스킹", what: "켜고 끔을 비트로", tags: ["bitmask"], names: ["비트마스킹"] },
  ] },
];

export type Need = { id: string; name: string; what: string; why: Array<"code" | "tag" | "memory" | "basic"> };
export type Needs = { steps: Array<{ step: number; name: string; what: string; needs: Need[] }>;
  /** 사다리에 없는 분류·기억 이름 (맨 위 단계 옆에 보인다) */ other: string[]; top: number };

const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s()·_-]/g, "");
/** What a problem asks for, on the ladder. `reference` is the model solution (JavaScript); tags are solved.ac keys and names. */
export function needsOf(input: { reference?: string | null; tags?: Array<{ key: string; name: string }>; knowledge?: string[] }): Needs {
  const code = (input.reference ?? "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const tagKeys = new Set((input.tags ?? []).map((t) => t.key));
  const used = new Set<string>();
  const memory = new Map((input.knowledge ?? []).map((k) => [squash(k), k]));
  const steps = LADDER.map((s) => ({ step: s.step, name: s.name, what: s.what, needs: s.abilities.flatMap((a): Need[] => {
    const why: Need["why"] = [];
    if (a.always) why.push("basic");
    if (a.code && code && a.code.test(code)) why.push("code");
    const tagHit = (a.tags ?? []).filter((t) => tagKeys.has(t));
    if (tagHit.length) { why.push("tag"); for (const t of tagHit) used.add(`tag:${t}`); }
    const memHit = [squash(a.name), ...(a.names ?? []).map(squash)].filter((n) => memory.has(n));
    if (memHit.length) { why.push("memory"); for (const n of memHit) used.add(`mem:${n}`); }
    return why.length ? [{ id: a.id, name: a.name, what: a.what, why }] : [];
  }) })).filter((s) => s.needs.length);
  const other = [...(input.tags ?? []).filter((t) => !used.has(`tag:${t.key}`)).map((t) => t.name),
    ...[...memory].filter(([n]) => !used.has(`mem:${n}`)).map(([, k]) => k)];
  const uniq = [...new Set(other)].filter((n) => !steps.some((s) => s.needs.some((x) => squash(x.name) === squash(n))));
  return { steps, other: uniq, top: Math.max(0, ...steps.filter((s) => s.needs.some((n) => !n.why.includes("basic"))).map((s) => s.step)) };
}
