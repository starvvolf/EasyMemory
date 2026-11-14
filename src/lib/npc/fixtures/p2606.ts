// NPC 시험용 문제 재료: BOJ 2606 "바이러스"와 같은 구조의 문제. 공개 저장소라 원문을 넣지 않고 내 말로 줄여 썼다.
// 예제 · 테스트도 손으로 만든 것 + 씨앗으로 만든 무작위 입력(정답은 아래 BFS로 계산). 원문 예제는 쓰지 않는다.
import type { TestCase } from "../../code/run.ts";
import type { ProblemModel } from "../../code/tutor/problem-model.ts";

export const P2606_ID = "cp_boj_2606"; // tutorNumberOf가 2606으로 읽는다 → 도움 칸 · 튜터 기록이 이 번호로 붙는다
export const P2606_NUMBER = "2606";
export const P2606 = {
  title: "BOJ 2606 바이러스",
  statement: "컴퓨터 N대(1번~N번)가 M개의 선으로 짝지어 이어져 있다. 선은 양쪽으로 통한다. 1번 컴퓨터가 바이러스에 걸리면, 선을 따라 이어진 컴퓨터는(몇 번을 건너든) 모두 걸린다. 1번 때문에 바이러스에 걸리는 컴퓨터가 몇 대인지(1번은 빼고) 출력한다.",
  inputText: "첫 줄에 N(1 ≤ N ≤ 100), 둘째 줄에 M(0 ≤ M ≤ N(N-1)/2), 그다음 M줄에 이어진 두 컴퓨터 번호 a b.",
  outputText: "1번 때문에 걸리는 컴퓨터 수 하나.",
  timeLimitMs: 1000,
};

/** 정답 계산(BFS) — 테스트 출력과 모범 풀이 확인에 쓴다 */
export function solve2606(input: string): string {
  const t = input.trim().split(/\s+/).map(Number);
  const n = t[0], m = t[1];
  const adj: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < m; i++) { const a = t[2 + 2 * i], b = t[3 + 2 * i]; adj[a].push(b); adj[b].push(a); }
  const seen = new Array(n + 1).fill(false); seen[1] = true;
  const q = [1]; let c = 0;
  while (q.length) { const x = q.shift()!; for (const y of adj[x]) if (!seen[y]) { seen[y] = true; c++; q.push(y); } }
  return String(c);
}
const tc = (input: string): TestCase => ({ input, output: solve2606(input) });
const edges = (n: number, list: Array<[number, number]>) => `${n}\n${list.length}\n${list.map(([a, b]) => `${a} ${b}`).join("\n")}${list.length ? "\n" : ""}`;

/** 손으로 만든 작은 입력: 사이클 · 거꾸로 적힌 선 · 1과 바로 안 이어진 것 · 아무것도 안 이어짐 · 혼자 */
export const EXAMPLES: TestCase[] = [
  tc(edges(8, [[1, 3], [3, 4], [1, 6], [6, 3], [6, 7], [5, 8]])),
  tc(edges(3, [[2, 1], [3, 2]])),
];
const HAND: TestCase[] = [
  tc(edges(5, [])),
  tc(edges(4, [[1, 2], [2, 3], [3, 1]])),
  tc(edges(6, [[3, 4], [4, 1], [6, 5], [2, 3]])),
  tc(edges(1, [])),
  tc(edges(7, [[2, 3], [3, 4], [4, 5]])),
  tc(edges(5, [[5, 4], [4, 3], [3, 2], [2, 1]])),
];
/** 씨앗 무작위 입력(같은 씨앗이면 늘 같음) + 가장 큰 입력(모두 이어진 100대: 표시 없이 넣으면 끝나지 않는다) */
function randomTests(seed: number, count: number): TestCase[] {
  let h = seed >>> 0;
  const r = () => ((h = (Math.imul(h, 48271) + 12345) >>> 0) / 2 ** 32);
  const out: TestCase[] = [];
  for (let k = 0; k < count; k++) {
    const n = 2 + Math.floor(r() * (k < count - 4 ? 15 : 99));
    const want = Math.floor(r() * Math.min(n * (n - 1) / 2, n * 2));
    const set = new Set<string>(); const list: Array<[number, number]> = [];
    while (list.length < want) { const a = 1 + Math.floor(r() * n), b = 1 + Math.floor(r() * n); if (a === b) continue; const key = a < b ? `${a},${b}` : `${b},${a}`; if (set.has(key)) continue; set.add(key); list.push(r() < 0.5 ? [a, b] : [b, a]); }
    out.push(tc(edges(n, list)));
  }
  const all: Array<[number, number]> = [];
  for (let a = 1; a <= 100; a++) for (let b = a + 1; b <= 100; b++) all.push([a, b]);
  out.push(tc(edges(100, all)));
  return out;
}
export const TESTS: TestCase[] = [...HAND, ...randomTests(2606, 24)];

/** 모범 풀이(채점 쪽에만, NPC에게 주지 않는다) — JavaScript */
export const REFERENCE_JS = `const t = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
const n = t[0], m = t[1];
const adj = Array.from({ length: n + 1 }, () => []);
for (let i = 0; i < m; i++) { const a = t[2 + 2 * i], b = t[3 + 2 * i]; adj[a].push(b); adj[b].push(a); }
const seen = new Array(n + 1).fill(false); seen[1] = true;
const q = [1]; let c = 0;
while (q.length) { const x = q.shift(); for (const y of adj[x]) if (!seen[y]) { seen[y] = true; c++; q.push(y); } }
console.log(c);
`;

/** 교육용 문제 모델(튜터 도움 칸 · 지도 만들기 재료). 내 말로 쓴 것. */
export const MODEL_2606: ProblemModel = {
  number: P2606_NUMBER, title: "바이러스", chapter: "", role: "basic", url: "", statement: P2606.statement, inputText: P2606.inputText, outputText: P2606.outputText,
  example: { input: EXAMPLES[0].input, output: EXAMPLES[0].output },
  summary: "이어진 컴퓨터를 따라가며 1번과 이어진 컴퓨터 수를 센다.", maxN: 100, patterns: ["graph-adj", "visited"],
  signals: ["선으로 이어진 것은 몇 번을 건너든 모두 걸린다", "1번에서 시작"],
  approaches: [
    { name: "1번에서 BFS(또는 DFS)로 이어진 컴퓨터를 따라가며 센다", verdict: "best", why: "한 번 본 컴퓨터를 표시하면 각 컴퓨터를 한 번씩만 본다" },
    { name: "바뀐 게 없을 때까지 선 목록을 다시 훑는다", verdict: "ok", why: "N이 100 이하라 여러 번 훑어도 충분히 빠르다" },
    { name: "1번과 바로 이어진 것만 센다", verdict: "wrong", why: "여러 번 건너 걸리는 컴퓨터를 빠뜨린다" },
  ],
  state: { right: "컴퓨터마다 이미 걸렸는지 표시한 목록", wrong: ["1번의 이웃 수", "표시 없이 큐에 넣은 횟수"] },
  update: "이웃을 볼 때 아직 표시 안 된 것만 표시하고 넣는다", complexity: "n²", pitfalls: ["선은 양쪽으로 통한다", "1번 자신은 세지 않는다"],
  walkthrough: { observe: "몇 번을 건너든 걸린다 → 끝까지 따라가야 한다", choose: "그래프 탐색(BFS/DFS)", compare: "바로 이웃만 세면 틀린다", verify: "사이클이 있는 입력으로 확인" },
  problemId: P2606_ID, at: "2026-11-15T00:00:00.000Z",
};

/** 지도 · 드라이버가 쓰는 문제 묶음 */
export const PACK_2606 = { id: P2606_ID, number: P2606_NUMBER, title: P2606.title, statement: P2606.statement, inputText: P2606.inputText, outputText: P2606.outputText,
  examples: EXAMPLES, tests: TESTS, timeLimitMs: P2606.timeLimitMs, referenceJs: REFERENCE_JS, model: MODEL_2606 };
