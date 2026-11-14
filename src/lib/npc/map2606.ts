// 풀이 조각 지도 — BOJ 2606 바이러스 (설계 2번의 표, 손으로 쓴 지도 · 고정 재료). AI로 만든 지도와 같은 모양(ProblemMap)이다.
// 조각 = 풀이를 이루는 생각 · 도구 하나. 길 = 조각을 엮은 풀이(걸음 순서 + 걸음마다 코드). 틀린 조각(wrong)은 그럴듯하지만 틀린 생각.
// 걸음 코드의 {{자리}}는 그 자리에 쓸 조각(맞는 것 · 틀린 것 · "?" 지어 씀)의 코드로 채운다. 길의 판정은 짐작하지 않고 채점기로 잰다(map.ts measure).
import type { Fragment, ProblemMap, Route, Slot } from "./types.ts";

export const FRAGMENTS: Fragment[] = [
  { id: "syntax.py.read-input", layer: 1, what: "표준 입력에서 수를 한 줄씩 읽는다", example: "import sys\ninput = sys.stdin.readline\nn = int(input())\na, b = map(int, input().split())", keys: ["input\\(\\)", "readline", "입력을 읽"] },
  { id: "syntax.py.2d-list", layer: 1, what: "빈 목록 N개를 [[] for _ in range(N)]처럼 하나씩 따로 만든다", example: "adj = [[] for _ in range(n + 1)]\nadj[2].append(5)", keys: ["for _ in range", "\\[\\[\\] for", "빈 (목록|리스트)[^.\\n]{0,12}(따로|개)", "2차원 (목록|리스트)"], leak: ["\\[\\s*\\[\\s*\\]\\s*for\\b"] },
  { id: "shape.adj-list", layer: 2, what: "연결을 \"번호 → 이웃 목록\"으로 담는다", example: "adj = [[] for _ in range(n + 1)]\nadj[a].append(b)\nfor y in adj[x]:\n    print(y)", keys: ["인접 리스트", "이웃 목록", "번호 → 이웃", "adj\\[[a-z]\\]\\.append"] },
  { id: "shape.edge-list", layer: 2, what: "연결을 (a, b) 쌍의 목록으로 담는다", example: "edges = []\nedges.append((a, b))\nfor a, b in edges:\n    print(a, b)", keys: ["간선 목록", "쌍의 목록", "edges"] },
  { id: "idea.undirected", layer: 2, what: "양쪽으로 통하는 연결은 두 번호 모두에 서로를 넣는다", example: "adj[a].append(b)\nadj[b].append(a)", keys: ["양방향", "양쪽", "adj\\[b\\]\\.append\\(a\\)", "두 번호 모두", "서로를? 넣"] },
  { id: "idea.mark-visited", layer: 5, what: "한 번 본 컴퓨터를 표시해 두고 다시 보지 않는다", example: "seen = [False] * (n + 1)\nif not seen[y]:\n    seen[y] = True", keys: ["방문", "표시", "visited", "seen", "다시 (보지|넣지) 않"] },
  { id: "tool.queue", layer: 2, what: "넣고 앞에서 꺼내는 큐(deque)", example: "from collections import deque\nq = deque([1])\nq.append(2)\nx = q.popleft()", keys: ["큐", "deque", "popleft"] },
  { id: "tool.recursion", layer: 4, what: "함수가 자기를 다시 부른다", example: "def go(x):\n    for y in adj[x]:\n        go(y)", keys: ["재귀", "자기 ?자신을 ?(다시 )?부", "다시 부르"] },
  { id: "idea.until-no-change", layer: 5, what: "바뀐 게 없을 때까지 전체를 다시 훑는다", example: "changed = True\nwhile changed:\n    changed = False\n    # 바뀌면 changed = True", keys: ["바뀐 게 없을 때까지", "changed", "다시 훑"] },
  { id: "idea.reach-all", layer: 6, what: "몇 번을 건너든 이어진 것은 다 걸리니, 1번에서 끝까지 따라가는 방법을 쓴다", example: "# 1번에서 시작해 이웃의 이웃까지\n# 더 갈 데가 없을 때까지 따라간다", keys: ["끝까지 따라", "건너", "이어진 (것|컴퓨터)를? (모두|다)", "그래프 탐색", "BFS", "DFS"] },
  { id: "frame.bfs", layer: 4, what: "BFS 순서: 꺼냄 → 이웃 봄 → (안 본 것만) 표시 → 넣음", example: "while q:\n    x = q.popleft()\n    for y in adj[x]:\n        if not seen[y]:\n            seen[y] = True\n            q.append(y)", keys: ["BFS", "너비 우선", "꺼내[^.\\n]{0,20}이웃", "꺼냄"] },
  { id: "frame.dfs", layer: 4, what: "DFS 순서: 표시 → 이웃마다 (안 본 것이면) 다시 부름", example: "def go(x):\n    seen[x] = True\n    for y in adj[x]:\n        if not seen[y]:\n            go(y)", keys: ["DFS", "깊이 우선", "이웃마다 다시"] },
  { id: "wrong.alias-list", layer: 1, wrong: true, right: "syntax.py.2d-list", what: "[[]] * N으로 빈 목록 N개를 만들 수 있다(실제로는 같은 목록 하나를 N번 가리킴)", example: "adj = [[]] * (n + 1)", keys: ["\\[\\[\\]\\] ?\\*"] },
  { id: "wrong.one-way", layer: 2, wrong: true, right: "idea.undirected", what: "연결 (a, b)는 a의 이웃에 b만 넣으면 된다", example: "adj[a].append(b)", keys: ["한쪽(만|에만)", "한 방향"] },
  { id: "wrong.direct-only", layer: 6, wrong: true, right: "idea.reach-all", what: "1번과 바로 이어진 것만 세면 된다", example: "print(len(adj[1]))", keys: ["바로 (이어진|연결된) 것만"] },
  { id: "wrong.no-visited", layer: 5, wrong: true, right: "idea.mark-visited", what: "표시하지 않아도 언젠가 끝난다", example: "for y in adj[x]:\n    q.append(y)", keys: ["표시하지 않아도", "표시 없이", "언젠가 끝"] },
];

const HEAD = "import sys\ninput = sys.stdin.readline\nn = int(input())\nm = int(input())";
const read = { text: "입력 읽기(N, M)", uses: ["syntax.py.read-input"], code: HEAD };
const init: Slot = { right: "syntax.py.2d-list", alts: { "syntax.py.2d-list": "adj = [[] for _ in range(n + 1)]", "wrong.alias-list": "adj = [[]] * (n + 1)", "?": "adj = list(n + 1, [])" } };
const link: Slot = { right: "idea.undirected", unaware: "wrong.one-way", alts: { "idea.undirected": "    adj[a].append(b)\n    adj[b].append(a)", "wrong.one-way": "    adj[a].append(b)" } };
const adjSteps = [
  { text: "번호마다 빈 이웃 목록 만들기", uses: ["syntax.py.2d-list", "shape.adj-list"], code: "{{init}}" },
  { text: "선마다 이웃 목록에 담기", uses: ["shape.adj-list", "idea.undirected"], code: "for _ in range(m):\n    a, b = map(int, input().split())\n{{link}}" },
];

export const ROUTES: Route[] = [
  { id: "A", name: "BFS", prior: 0.5, frame: "frame.bfs",
    needs: ["syntax.py.read-input", "syntax.py.2d-list", "shape.adj-list", "idea.undirected", "idea.reach-all", "idea.mark-visited", "tool.queue", "frame.bfs"],
    slots: { init, link },
    steps: [read, ...adjSteps,
      { text: "큐에 1번을 넣고 1번을 표시", uses: ["tool.queue", "idea.mark-visited"], code: "from collections import deque\nseen = [False] * (n + 1)\nseen[1] = True\nq = deque([1])\ncount = 0" },
      { text: "꺼내고, 이웃 중 안 본 것만 표시하고 넣으며 세기", uses: ["idea.reach-all", "frame.bfs", "tool.queue", "idea.mark-visited"], code: "while q:\n    x = q.popleft()\n    for y in adj[x]:\n        if not seen[y]:\n            seen[y] = True\n            count += 1\n            q.append(y)" },
      { text: "센 수 출력", uses: [], code: "print(count)" }] },
  { id: "B", name: "재귀 DFS", prior: 0.3, frame: "frame.dfs",
    needs: ["syntax.py.read-input", "syntax.py.2d-list", "shape.adj-list", "idea.undirected", "idea.reach-all", "idea.mark-visited", "tool.recursion", "frame.dfs"],
    slots: { init, link },
    steps: [read, ...adjSteps,
      { text: "본 것 표시할 목록", uses: ["idea.mark-visited"], code: "seen = [False] * (n + 1)" },
      { text: "표시하고 이웃마다 (안 본 것이면) 다시 부르기", uses: ["idea.reach-all", "frame.dfs", "tool.recursion", "idea.mark-visited"], code: "sys.setrecursionlimit(10000)\ndef go(x):\n    seen[x] = True\n    for y in adj[x]:\n        if not seen[y]:\n            go(y)\ngo(1)" },
      { text: "1번 빼고 표시된 수 출력", uses: [], code: "print(sum(seen) - 1)" }] },
  { id: "C", name: "반복해서 훑기", prior: 0.2,
    needs: ["syntax.py.read-input", "shape.edge-list", "idea.undirected", "idea.reach-all", "idea.mark-visited", "idea.until-no-change"],
    slots: { spread: { right: "idea.undirected", unaware: "wrong.one-way", alts: {
      "idea.undirected": "        if seen[a] and not seen[b]:\n            seen[b] = True\n            changed = True\n        elif seen[b] and not seen[a]:\n            seen[a] = True\n            changed = True",
      "wrong.one-way": "        if seen[a] and not seen[b]:\n            seen[b] = True\n            changed = True" } } },
    steps: [read,
      { text: "선을 (a, b) 쌍 목록으로 담기", uses: ["shape.edge-list"], code: "edges = []\nfor _ in range(m):\n    a, b = map(int, input().split())\n    edges.append((a, b))" },
      { text: "1번을 걸린 것으로 표시", uses: ["idea.mark-visited"], code: "seen = [False] * (n + 1)\nseen[1] = True" },
      { text: "바뀐 게 없을 때까지 선 목록을 다시 훑으며 한쪽만 걸린 선의 다른 쪽을 표시", uses: ["idea.reach-all", "idea.until-no-change", "idea.undirected"], code: "changed = True\nwhile changed:\n    changed = False\n    for a, b in edges:\n{{spread}}" },
      { text: "1번 빼고 표시된 수 출력", uses: [], code: "print(sum(seen) - 1)" }] },
  { id: "D", name: "바로 연결된 것만", prior: 0.1,
    needs: ["syntax.py.read-input", "syntax.py.2d-list", "shape.adj-list", "wrong.direct-only"],
    slots: { init, link },
    steps: [read, ...adjSteps, { text: "1번의 이웃 수 출력", uses: ["wrong.direct-only"], code: "print(len(set(adj[1]) - {1}))" }] },
  { id: "E", name: "표시 없이 탐색", prior: 0.1, frame: "frame.bfs",
    needs: ["syntax.py.read-input", "syntax.py.2d-list", "shape.adj-list", "idea.undirected", "tool.queue", "frame.bfs", "wrong.no-visited"],
    slots: { init, link },
    steps: [read, ...adjSteps,
      { text: "큐에 1번 넣기", uses: ["tool.queue"], code: "from collections import deque\nq = deque([1])\ninfected = []" },
      { text: "꺼내고 이웃을 (표시 없이) 모두 넣기", uses: ["frame.bfs", "tool.queue", "wrong.no-visited"], code: "while q:\n    x = q.popleft()\n    for y in adj[x]:\n        infected.append(y)\n        q.append(y)" },
      { text: "걸린 수 출력", uses: [], code: "print(len(set(infected) - {1}))" }] },
];

export const MAP_2606: ProblemMap = { problem: "2606", title: "바이러스", lang: "python", source: "hand", madeAt: "2026-11-15T00:00:00.000Z", fragments: FRAGMENTS, routes: ROUTES,
  notes: ["손으로 쓴 지도(설계 2번 표). 길 판정은 measure()로 잰다.", "자리 link · spread의 unaware: 양방향을 모르면 모르는 줄도 모르고 한쪽만 넣는다(막히지 않음)."] };
export const routeOf = (id: string) => ROUTES.find((r) => r.id === id)!;
