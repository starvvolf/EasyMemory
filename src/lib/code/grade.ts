// 문제가 요구하는 능력 (2026-11-07, 사용자 요청): 문법(1단계)부터 심화 알고리즘(6단계)까지 고정된 사다리.
//   1~2단계는 모범 풀이 코드 모양으로 코드가 찾고, 3~6단계는 AI가 사다리 칸 중에서 고른 것(code-level.ts, 코드가 목록과 대조)과
//   문제에 걸린 기억 이름으로 찾는다. solved.ac 데이터는 쓰지 않는다(11/8 사용자 결정).

/* ---------- 요구 능력 사다리 ---------- */
export type Ability = { id: string; name: string; what: string;
  /** 기억 이름과 맞출 다른 이름 */ names?: string[];
  /** 모범 풀이(JavaScript)에서 찾는 모양 */ code?: RegExp; always?: true };
export type Step = { step: number; name: string; what: string; abilities: Ability[] };
export const LADDER: Step[] = [
  { step: 1, name: "입출력과 기본 문법", what: "문제를 읽고 답을 내는 데 꼭 필요한 문법", abilities: [
    { id: "io", name: "입력 받기·출력하기", what: "입력을 읽어 숫자로 바꾸고, 형식에 맞게 출력", always: true },
    { id: "var", name: "변수와 자료형", what: "정수·실수·문자열을 담고 바꾸기", always: true },
    { id: "arith", name: "연산(몫·나머지)", what: "사칙 연산, 몫과 나머지", code: /%|Math\.(floor|trunc|ceil)|\*\*/ },
    { id: "cond", name: "조건문", what: "경우에 따라 다르게 하기", code: /\bif\s*\(|\?[^:\n]+:/ },
    { id: "loop", name: "반복문", what: "같은 일을 여러 번", code: /\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.reduce\(/ },
    { id: "bigint", name: "큰 수(자료형 범위)", what: "int 범위를 넘는 값 다루기", code: /BigInt|\b\d+n\b/, names: ["자료형 범위(오버플로)", "오버플로"] },
  ] },
  { step: 2, name: "자료 다루기", what: "여러 값을 담고 꺼내는 문법", abilities: [
    { id: "array", name: "배열·리스트", what: "여러 값을 순서대로 담기", code: /\.push\(|new Array|Array\.from|\[\s*\]|\w\[[ijk]\]/ },
    { id: "grid", name: "2차원 배열(격자)", what: "표·지도를 행과 열로", code: /\w\[[^\]]+\]\[[^\]]+\]/ },
    { id: "string", name: "문자열 다루기", what: "글자 하나씩 보기, 자르기, 바꾸기", code: /charCodeAt|charAt\(|substring\(|toUpperCase|toLowerCase|split\(""\)|fromCharCode/, names: ["문자열"] },
    { id: "sortfn", name: "정렬 함수 쓰기", what: "기본 정렬과 기준 정렬", code: /\.sort\(/, names: ["정렬"] },
    { id: "func", name: "함수 만들기", what: "일을 함수로 나눠 다시 쓰기", code: /\bfunction\s+\w+\s*\(|const\s+\w+\s*=\s*\([^)]*\)\s*=>/ },
  ] },
  { step: 3, name: "기초 풀이 방법", what: "자료구조 없이 생각만으로 푸는 방법", abilities: [
    { id: "impl", name: "구현·시뮬레이션", what: "문제에 적힌 대로 정확히 옮기기", names: ["구현", "시뮬레이션"] },
    { id: "brute", name: "완전 탐색", what: "가능한 경우를 모두 해 보기", names: ["브루트포스", "완전 탐색"] },
    { id: "math", name: "수학(약수·소수·최대공약수)", what: "수의 성질로 계산 줄이기", names: ["수학", "소수", "최대공약수"] },
    { id: "prefix", name: "누적 합", what: "구간 합을 미리 더해 두기", names: ["누적 합", "구간 합"] },
    { id: "greedy", name: "그리디", what: "지금 가장 좋은 것을 고르기", names: ["그리디", "탐욕법"] },
  ] },
  { step: 4, name: "자료구조", what: "값을 넣고 빼는 규칙이 있는 그릇", abilities: [
    { id: "stack", name: "스택", what: "나중에 넣은 것을 먼저", names: ["스택"] },
    { id: "queue", name: "큐·덱", what: "먼저 넣은 것을 먼저, 양쪽 끝", names: ["큐", "덱"] },
    { id: "hash", name: "해시(맵·셋)", what: "키로 바로 찾기", code: /new (Map|Set)\b/, names: ["해시", "해시 테이블", "해시맵", "셋"] },
    { id: "linked", name: "연결 리스트", what: "앞뒤를 가리키며 이어 붙이기", names: ["연결 리스트"] },
    { id: "heap", name: "우선순위 큐", what: "가장 작은(큰) 것을 빨리", names: ["우선순위 큐", "힙"] },
    { id: "tree", name: "트리", what: "부모·자식으로 이어진 구조", names: ["트리"] },
  ] },
  { step: 5, name: "알고리즘 기법", what: "대표 풀이 틀을 문제에 맞추기", abilities: [
    { id: "recursion", name: "재귀", what: "같은 일을 더 작은 문제로", names: ["재귀"] },
    { id: "binsearch", name: "이분 탐색", what: "반씩 줄여 찾기", names: ["이분 탐색", "이진 탐색", "lower_bound", "매개 변수 탐색"] },
    { id: "twoptr", name: "투 포인터", what: "두 위치를 움직이며 훑기", names: ["투 포인터", "슬라이딩 윈도우"] },
    { id: "graph", name: "그래프 탐색(BFS·DFS)", what: "이어진 곳을 차례로 방문", names: ["BFS", "DFS", "너비 우선 탐색", "깊이 우선 탐색", "그래프 탐색"] },
    { id: "backtrack", name: "백트래킹", what: "해 보고 아니면 되돌리기", names: ["백트래킹"] },
    { id: "divide", name: "분할 정복", what: "나눠 풀고 합치기", names: ["분할 정복"] },
  ] },
  { step: 6, name: "심화", what: "여러 기법을 합치거나 큰 입력을 다루는 방법", abilities: [
    { id: "dp", name: "다이나믹 프로그래밍", what: "작은 답을 저장해 큰 답을", names: ["다이나믹 프로그래밍", "동적 계획법", "DP", "메모이제이션"] },
    { id: "shortest", name: "최단 경로", what: "가중치 그래프에서 가장 짧은 길", names: ["최단 경로", "다익스트라", "플로이드"] },
    { id: "dsu", name: "유니온 파인드", what: "같은 묶음인지 빨리", names: ["유니온 파인드", "분리 집합"] },
    { id: "mst", name: "최소 스패닝 트리", what: "모두 잇는 가장 싼 길", names: ["최소 스패닝 트리"] },
    { id: "topo", name: "위상 정렬", what: "순서가 정해진 일 줄 세우기", names: ["위상 정렬"] },
    { id: "segtree", name: "세그먼트 트리", what: "구간 값을 빨리 고치고 묻기", names: ["세그먼트 트리", "펜윅 트리"] },
    { id: "bitmask", name: "비트마스킹", what: "켜고 끔을 비트로", names: ["비트마스킹"] },
    { id: "traceback", name: "경로 되짚기(역추적)", what: "답만이 아니라 답이 된 과정을 남기기", names: ["역추적", "경로 복원"] },
    { id: "stralgo", name: "문자열 알고리즘(KMP·트라이)", what: "긴 글에서 빨리 찾기", names: ["KMP", "트라이"] },
    { id: "sweep", name: "스위핑·좌표 압축", what: "정렬한 뒤 한 방향으로 훑기", names: ["스위핑", "좌표 압축"] },
    { id: "geometry", name: "기하(좌표·선분)", what: "점·선·원의 위치 관계 계산", names: ["기하학", "기하"] },
  ] },
];

export type Need = { id: string; name: string; what: string; why: Array<"code" | "ai" | "memory" | "basic"> };
export type Needs = { steps: Array<{ step: number; name: string; what: string; needs: Need[] }>;
  /** 사다리에 없는 기억 이름 */ other: string[]; top: number };

const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s()·_-]/g, "");
/** Ladder abilities from step 3 up: what the model may pick (ids). */
export const PICKABLE = LADDER.filter((s) => s.step >= 3).flatMap((s) => s.abilities.map((a) => a.id));
/** What a problem asks for, on the ladder. `reference` is the model solution (JavaScript); `picked` the ability ids the model chose. */
export function needsOf(input: { reference?: string | null; picked?: string[]; knowledge?: string[] }): Needs {
  const code = (input.reference ?? "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const picked = new Set((input.picked ?? []).filter((id) => PICKABLE.includes(id)));
  const used = new Set<string>();
  const memory = new Map((input.knowledge ?? []).map((k) => [squash(k), k]));
  const steps = LADDER.map((s) => ({ step: s.step, name: s.name, what: s.what, needs: s.abilities.flatMap((a): Need[] => {
    const why: Need["why"] = [];
    if (a.always) why.push("basic");
    if (a.code && code && a.code.test(code)) why.push("code");
    if (picked.has(a.id)) why.push("ai");
    const memHit = [squash(a.name), ...(a.names ?? []).map(squash)].filter((n) => memory.has(n));
    if (memHit.length) { why.push("memory"); for (const n of memHit) used.add(`mem:${n}`); }
    return why.length ? [{ id: a.id, name: a.name, what: a.what, why }] : [];
  }) })).filter((s) => s.needs.length);
  const other = [...memory].filter(([n]) => !used.has(`mem:${n}`)).map(([, k]) => k);
  const uniq = [...new Set(other)].filter((n) => !steps.some((s) => s.needs.some((x) => squash(x.name) === squash(n))));
  return { steps, other: uniq, top: Math.max(0, ...steps.filter((s) => s.needs.some((n) => !n.why.includes("basic"))).map((s) => s.step)) };
}
