// 형식별 검사 · 채점 (설계 3 · 5 · 6번): 순서 맞추기 · 반례 만들기 · 담기 그리기(값 · 모양) · 오류 읽기 · 표현 구조 검사 · 섞은 장면 · 고르기 표 · 아래층부터.
// 파이썬을 실제로 돌린다(AI 없음).
import assert from "node:assert/strict";
import test from "node:test";
import { checkScene } from "./check.ts";
import { gradeScene } from "./grade.ts";
import { dueToday, firstState, formatsFor } from "./ladder.ts";
import type { Gap, Scene } from "./types.ts";

const base = (o: Partial<Scene>): Scene => ({ id: "sc_00000000000a", gapId: "gap_x", format: "write", lang: "python", distance: "near", target: "ability",
  story: "", ask: "", explain: "", setup: "", after: "", reference: "", alsoRight: [], wrongs: [], inputs: [], createdAt: "", madeBy: "ai", ...o });
const V = { wrongVerified: true };

test("순서 맞추기: 섞인 줄 · 같은 줄의 다른 순서가 그때 생각 · 맞춘 순서는 통과", async () => {
  const s = await checkScene(base({ format: "order", setup: "n = int(input())", after: "print(total)",
    reference: "total = 0\nfor i in range(1, n + 1):\n    total += i\n    total *= 1",
    wrongs: [{ id: "mine", what: "합을 반복 안에서 0으로", code: "for i in range(1, n + 1):\n    total = 0\n    total += i\n    total *= 1" }],
    inputs: [{ role: "basic", stdin: "1" }, { role: "basic", stdin: "3" }, { role: "basic", stdin: "4" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal(s.pieces?.length, 4);
  assert.notDeepEqual(s.pieces, ["total = 0", "for i in range(1, n + 1):", "total += i", "total *= 1"], "원래 순서와 다르게 섞음");
  assert.equal((await gradeScene(s, V, "total = 0\nfor i in range(1, n + 1):\n    total += i\n    total *= 1")).verdict, "pass");
  assert.equal((await gradeScene(s, V, "for i in range(1, n + 1):\n    total = 0\n    total += i\n    total *= 1")).verdict, "same");
});

test("반례 만들기: 틀린 코드가 틀리는 입력이면 통과, 같은 답이면 미확정, 조건에 안 맞으면 다시", async () => {
  const s = await checkScene(base({ format: "counter",
    reference: "n = int(input())\na = list(map(int, input().split()))\nprint(max(a))",
    wrongs: [{ id: "mine", what: "최댓값을 0에서 시작", code: "n = int(input())\na = list(map(int, input().split()))\nm = 0\nfor x in a:\n    if x > m:\n        m = x\nprint(m)" }],
    validator: "import sys\nlines = sys.stdin.read().split('\\n')\ntry:\n    n = int(lines[0]); a = list(map(int, lines[1].split()))\n    assert 1 <= n <= 10 and len(a) == n and all(-100 <= x <= 100 for x in a)\nexcept Exception:\n    print('형식: 첫 줄 n(1~10), 둘째 줄 정수 n개(-100~100)'); sys.exit(1)",
    inputs: [{ role: "split", stdin: "2\n-3 -5" }, { role: "split", stdin: "1\n-1" }, { role: "basic", stdin: "3\n1 2 3" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeScene(s, V, "3\n-1 -2 -3")).verdict, "pass");
  assert.equal((await gradeScene(s, V, "3\n1 2 3")).verdict, "unclear");
  assert.ok((await gradeScene(s, V, "hello")).invalid, "조건에 안 맞는 입력은 기록하지 않고 다시");
});

test("담기 그리기(값): 만든 값과 같으면 통과, 그때 생각의 값이면 같은 실수", async () => {
  const s = await checkScene(base({ format: "draw", draw: { mode: "value" },
    reference: "n, m = map(int, input().split())\nadj = [[] for _ in range(n + 1)]\nfor _ in range(m):\n    a, b = map(int, input().split())\n    adj[a].append(b)\n    adj[b].append(a)\nprint(repr(adj))",
    wrongs: [{ id: "mine", what: "한쪽에만 넣음", code: "n, m = map(int, input().split())\nadj = [[] for _ in range(n + 1)]\nfor _ in range(m):\n    a, b = map(int, input().split())\n    adj[a].append(b)\nprint(repr(adj))" }],
    inputs: [{ role: "basic", stdin: "3 2\n1 2\n1 3" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeScene(s, V, "[[], [2, 3], [1], [1]]")).verdict, "pass");
  assert.equal((await gradeScene(s, V, "[[],[2,3],[],[]]")).verdict, "same");
  assert.ok((await gradeScene(s, V, "adj 리스트")).invalid);
});

test("담기 그리기(모양): 어떤 모양이든 관계를 다 담으면 통과, 한쪽만 담으면 같은 실수", async () => {
  const checker = "def ok(v):\n    if isinstance(v, dict):\n        it = [(a, b) for a, bs in v.items() for b in bs]\n    elif v and all(isinstance(x, tuple) for x in v):\n        it = [tuple(x) for x in v] + [(b, a) for a, b in v]\n    else:\n        it = [(a, b) for a, bs in enumerate(v) for b in bs]\n    return set(it) == {(1, 2), (2, 1), (1, 3), (3, 1)}";
  const mineCheck = "def ok(v):\n    if isinstance(v, list) and len(v) == 4 and all(isinstance(x, list) for x in v):\n        return v[1] and not v[2] and not v[3]\n    return False";
  const s = await checkScene(base({ format: "draw", draw: { mode: "shape", checker, mineCheck },
    reference: "print([[], [2, 3], [1], [1]])", alsoRight: ["print([(1, 2), (1, 3)])"],
    wrongs: [{ id: "mine", what: "한쪽에만", code: "print([[], [2, 3], [], []])" }], inputs: [{ role: "basic", stdin: "1-2, 1-3" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeScene(s, V, "{1: [2, 3], 2: [1], 3: [1]}")).verdict, "pass", "딕셔너리 모양도 통과");
  assert.equal((await gradeScene(s, V, "[[], [2, 3], [], []]")).verdict, "same");
});

test("오류 읽기: 오류 문구는 실제로 돌려서 얻고(경로 지움), 고른 보기로 판정", async () => {
  const s = await checkScene(base({ format: "error", reference: "a = [1, 2, 3]\ni = int(input())\nprint(a[i])", inputs: [{ role: "basic", stdin: "3" }],
    choices: [{ text: "3번 줄: 리스트 칸은 0부터라 a[3]이 없다", thought: "right" }, { text: "2번 줄: input을 int로 바꾼 것", thought: "mine" }, { text: "1번 줄: 리스트를 만드는 법", thought: "syntax" }],
    wrongs: [{ id: "mine", what: "", code: "" }, { id: "syntax", what: "", code: "" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.match(s.errorText ?? "", /IndexError/);
  assert.doesNotMatch(s.errorText ?? "", /recaller-code/);
  assert.equal((await gradeScene(s, V, "0")).verdict, "pass");
  assert.equal((await gradeScene(s, V, "1")).verdict, "same");
  assert.equal((await gradeScene(s, { wrongVerified: false }, "1")).verdict, "unclear", "확인 못 한 빈틈은 같은 실수를 내지 않음");
});

test("표현 확인: 출력이 맞아도 그 표현을 안 쓰면 다시(기록 안 함)", async () => {
  const s = await checkScene(base({ format: "write", target: "form", setup: "import sys\nn = int(sys.stdin.readline())", after: "print(sum(xs))",
    reference: "xs = [int(sys.stdin.readline()) for _ in range(n)]", structure: { must: [{ pattern: "sys\\.stdin\\.readline", why: "sys.stdin.readline" }] },
    wrongs: [{ id: "mine", what: "input()을 n번", code: "xs = [int(input()) for _ in range(n - 1)]" }],
    inputs: [{ role: "basic", stdin: "2\n1\n2" }, { role: "basic", stdin: "3\n1\n2\n3" }, { role: "basic", stdin: "1\n5" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  const g = await gradeScene(s, V, "xs = [int(input()) for _ in range(n)]");
  assert.equal(g.matched, "structure");
  assert.equal((await gradeScene(s, V, "xs = []\nfor _ in range(n):\n    xs.append(int(sys.stdin.readline()))")).verdict, "pass");
});

test("섞은 장면: 빈틈마다 그때 생각, 같은 실수는 그 빈틈으로", async () => {
  const s = await checkScene(base({ format: "function", setup: "n = int(input())", after: "print(solve(n))", mix: ["gap_a", "gap_b"],
    reference: "def solve(n):\n    s = 0\n    for i in range(n):\n        s += i\n    return s",
    wrongs: [{ id: "mine-1", what: "range 끝", code: "def solve(n):\n    s = 0\n    for i in range(n + 1):\n        s += i\n    return s", gapId: "gap_a" },
      { id: "mine-2", what: "누적을 대입으로", code: "def solve(n):\n    s = 0\n    for i in range(n):\n        s = i\n    return s", gapId: "gap_b" }],
    inputs: [{ role: "basic", stdin: "0" }, { role: "basic", stdin: "3" }, { role: "basic", stdin: "5" }, { role: "basic", stdin: "6" }] }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  const g = await gradeScene(s, V, "def solve(n):\n    s = 0\n    for i in range(n):\n        s = i\n    return s");
  assert.equal(g.verdict, "same"); assert.equal(g.gapId, "gap_b");
});

const gap = (o: Partial<Gap> = {}): Gap => ({ id: "gap_1", branch: "algo", kind: "알고리즘 원리", layer: 5, title: "t", target: "ability", missed: "m", wrong: "w", wrongVerified: true, wrongVerdict: "WA",
  kernel: { lang: "python", code: "", needs: [] }, evidence: [], origin: { problemId: "cp_a", title: "A", lang: "python" }, topic: "x", scope: "piece", dose: { level: 1 }, state: firstState(1, 0), createdAt: "", ...o });

test("고르기 표(설계 4번): 종류마다 형식 순서, 출력으로 안 드러나면 고치기 · 반례를 빼고, 고르기의 응용은 변형 문제", () => {
  assert.deepEqual(formatsFor(gap(), { hasWrongSubmission: false }), ["predict", "counter"]);
  assert.deepEqual(formatsFor(gap({ wrongVerdict: "TLE" }), { hasWrongSubmission: false }), ["predict"], "느려지기만 하는 빈틈은 횟수 맞히기만");
  assert.deepEqual(formatsFor(gap({ kind: "경계 · 예외" }), { hasWrongSubmission: false }), ["counter", "fix"]);
  assert.deepEqual(formatsFor(gap({ kind: "알고리즘 구현" }), { hasWrongSubmission: false }), ["order", "blank"]);
  assert.deepEqual(formatsFor(gap({ kind: "알고리즘 구현", scope: "function" }), { hasWrongSubmission: false }), ["function", "order"]);
  assert.deepEqual(formatsFor(gap({ kind: "자료 담기" }), { hasWrongSubmission: false }), ["choice", "draw"]);
  assert.equal(formatsFor(gap({ kind: "알고리즘 고르기", state: { ...firstState(1, 0), distance: "far" } }), { hasWrongSubmission: false })[0], "variant");
  assert.deepEqual(formatsFor(gap({ target: "form", kind: "문법" }), { hasWrongSubmission: false }), ["write", "blank"]);
});

test("아래층부터: 같은 풀이의 문법 빈틈이 통과 전이면 함수 범위 장면은 미룸", () => {
  const due = { ...firstState(1, 0), due: new Date(0).toISOString() };
  const r = dueToday([gap({ id: "gap_f", kind: "알고리즘 구현", scope: "function", layer: 4, state: due }), gap({ id: "gap_s", kind: "문법", layer: 1, scope: "line", state: due })], Date.now());
  assert.deepEqual(r.gaps.map((g) => g.id), ["gap_s"]);
  assert.equal(r.waiting, 1);
});
