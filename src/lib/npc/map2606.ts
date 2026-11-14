// 가상 학습자(NPC) 풀이 조각 지도 — BOJ 2606 바이러스 (설계 docs/가상학습자_설계_v2(+gpt).md 2번, 손으로 쓴 첫 지도).
// 조각 = 풀이를 이루는 생각 · 도구 하나. 길 = 조각을 엮은 풀이. 틀린 조각(✗)은 그럴듯하지만 틀린 생각.
// 길마다 코드는 "자리"로 나뉘고, 자리마다 맞는 조각 · 틀린 조각의 코드가 있다. 길의 판정은 짐작하지 않고 채점기로 잰다(npc.test.ts).

export type Fragment = { id: string; layer: number; what: string; example: string; wrong?: boolean };
export const FRAGMENTS: Fragment[] = [
  { id: "syntax.py.list-of-lists", layer: 1, what: "빈 목록 N개를 만들 때 [[] for _ in range(N)]처럼 하나씩 따로 만든다", example: "adj = [[] for _ in range(n + 1)]" },
  { id: "shape.adj-list", layer: 2, what: "연결을 \"번호 → 이웃 목록\"으로 담는다", example: "adj[a].append(b)" },
  { id: "shape.edge-list", layer: 2, what: "연결을 (a, b) 쌍의 목록으로 담는다", example: "edges.append((a, b))" },
  { id: "idea.undirected", layer: 2, what: "양쪽으로 이어진 연결은 두 번호 모두에 서로를 넣는다", example: "adj[a].append(b)\nadj[b].append(a)" },
  { id: "idea.mark-visited", layer: 5, what: "한 번 본 것을 표시해 두고 다시 보지 않는다", example: "if not seen[y]:\n    seen[y] = True" },
  { id: "tool.queue", layer: 2, what: "넣고 앞에서 꺼내는 큐(deque)", example: "from collections import deque\nq = deque([1])\nx = q.popleft()" },
  { id: "tool.recursion", layer: 4, what: "함수가 자기를 다시 부른다", example: "def go(x):\n    for y in adj[x]:\n        go(y)" },
  { id: "idea.until-no-change", layer: 5, what: "바뀐 게 없을 때까지 전체를 다시 훑는다", example: "changed = True\nwhile changed:\n    changed = False" },
  { id: "wrong.alias-list", layer: 1, wrong: true, what: "[[]] * N으로 빈 목록 N개를 만들 수 있다(실제로는 같은 목록 하나를 N번 가리킴)", example: "adj = [[]] * (n + 1)" },
  { id: "wrong.one-way", layer: 2, wrong: true, what: "연결 (a, b)는 a의 이웃에 b만 넣으면 된다", example: "adj[a].append(b)" },
  { id: "wrong.direct-only", layer: 6, wrong: true, what: "1번과 바로 연결된 것만 세면 된다", example: "print(len(adj[1]))" },
  { id: "wrong.no-visited", layer: 5, wrong: true, what: "표시하지 않아도 언젠가 끝난다", example: "q.append(y)" },
];

const HEAD = "import sys\ninput = sys.stdin.readline\nn = int(input())\nm = int(input())";
type Slots = Record<string, string>;
/** 길 = 필요한 조각 + 코드 조립. pick(id)는 그 자리에 쓸 조각(맞는 것 또는 그 자리의 틀린 것). */
export type Route = { id: string; name: string; needs: string[]; build: (pick: (slot: string) => string) => string; slots: Record<string, { right: string; wrong?: string }> };

const adjSlots = { init: { right: "syntax.py.list-of-lists", wrong: "wrong.alias-list" }, link: { right: "idea.undirected", wrong: "wrong.one-way" } };
const CODE: Slots = {
  "syntax.py.list-of-lists": "adj = [[] for _ in range(n + 1)]",
  "wrong.alias-list": "adj = [[]] * (n + 1)",
  "idea.undirected": "    adj[a].append(b)\n    adj[b].append(a)",
  "wrong.one-way": "    adj[a].append(b)",
};
export const ROUTES: Route[] = [
  { id: "A", name: "BFS", needs: ["shape.adj-list", "idea.mark-visited", "tool.queue"], slots: { ...adjSlots, visit: { right: "idea.mark-visited", wrong: "wrong.no-visited" } },
    build: (pick) => `${HEAD}\nfrom collections import deque\n${CODE[pick("init")]}\nfor _ in range(m):\n    a, b = map(int, input().split())\n${CODE[pick("link")]}\n` +
      (pick("visit") === "idea.mark-visited"
        ? "seen = [False] * (n + 1)\nseen[1] = True\nq = deque([1])\ncount = 0\nwhile q:\n    x = q.popleft()\n    for y in adj[x]:\n        if not seen[y]:\n            seen[y] = True\n            count += 1\n            q.append(y)\nprint(count)"
        : "q = deque([1])\ninfected = []\nwhile q:\n    x = q.popleft()\n    for y in adj[x]:\n        if y != 1:\n            infected.append(y)\n            q.append(y)\nprint(len(infected))") },
  { id: "B", name: "재귀 DFS", needs: ["shape.adj-list", "idea.mark-visited", "tool.recursion"], slots: { ...adjSlots },
    build: (pick) => `${HEAD}\nsys.setrecursionlimit(10000)\n${CODE[pick("init")]}\nfor _ in range(m):\n    a, b = map(int, input().split())\n${CODE[pick("link")]}\nseen = [False] * (n + 1)\ndef go(x):\n    seen[x] = True\n    for y in adj[x]:\n        if not seen[y]:\n            go(y)\ngo(1)\nprint(sum(seen) - 1)` },
  { id: "C", name: "반복해서 훑기", needs: ["shape.edge-list", "idea.mark-visited", "idea.until-no-change"], slots: {},
    build: () => `${HEAD}\nedges = [tuple(map(int, input().split())) for _ in range(m)]\ninfected = {1}\nchanged = True\nwhile changed:\n    changed = False\n    for a, b in edges:\n        if a in infected and b not in infected:\n            infected.add(b)\n            changed = True\n        elif b in infected and a not in infected:\n            infected.add(a)\n            changed = True\nprint(len(infected) - 1)` },
  { id: "D", name: "바로 연결된 것만", needs: ["shape.adj-list", "wrong.direct-only"], slots: { ...adjSlots },
    build: (pick) => `${HEAD}\n${CODE[pick("init")]}\nfor _ in range(m):\n    a, b = map(int, input().split())\n${CODE[pick("link")]}\nprint(len(set(adj[1])))` },
];
export const routeOf = (id: string) => ROUTES.find((r) => r.id === id)!;
