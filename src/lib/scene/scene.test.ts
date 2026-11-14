// 상황 재현: 장면 검사 · 판정 넷 · 사다리 (실제로 파이썬을 돌린다, AI 없음)
import assert from "node:assert/strict";
import test from "node:test";
import { checkScene } from "./check.ts";
import { gradeScene } from "./grade.ts";
import { dueToday, firstState, formatOf, formatsFor, reflect, scopeOf, doseOf } from "./ladder.ts";
import type { Gap, Scene } from "./types.ts";

// 11651류: 점수 높은 순, 같으면 이름순 (설계 5번의 예)
const sortScene = (): Scene => ({
  id: "sc_000000000001", gapId: "gap_x", format: "write", lang: "python", distance: "near", target: "ability",
  story: "학생 (이름, 점수) 목록을 점수가 높은 순, 같으면 이름 가나다순으로.", ask: "students를 정렬하세요.", explain: "먼저 볼 기준이 앞이에요.",
  setup: "import sys\nn=int(sys.stdin.readline())\nstudents=[(lambda a:(a[0],int(a[1])))(sys.stdin.readline().split()) for _ in range(n)]",
  after: "print(students)",
  reference: "students.sort(key=lambda s: (-s[1], s[0]))",
  alsoRight: ["students.sort(key=lambda s: s[0])\nstudents.sort(key=lambda s: s[1], reverse=True)"],
  wrongs: [{ id: "mine", what: "우선순위를 거꾸로(이름 먼저)", code: "students.sort(key=lambda s: (s[0], -s[1]))" },
    { id: "nodesc", what: "점수 방향을 안 뒤집음", code: "students.sort(key=lambda s: (s[1], s[0]))" }],
  inputs: [{ role: "split", stdin: "1\nmin 80\n" }, { role: "basic", stdin: "3\nb 90\nc 80\nd 70\n" },
    { role: "split", stdin: "3\nmin 80\njia 95\nga 80\n" }, { role: "split", stdin: "3\nc 50\nb 60\na 70\n" }, { role: "split", stdin: "4\nd 1\nc 2\nb 2\na 3\n" }, { role: "split", stdin: "3\nzed 70\nann 60\nbo 70\n" }],
  createdAt: "", madeBy: "ai",
});
const gap = (over: Partial<Gap> = {}): Gap => ({ id: "gap_x", branch: "algo", kind: "문제 읽기", layer: 2, title: "정렬 우선순위", target: "ability", missed: "y 먼저", wrong: "x 먼저",
  wrongVerified: true, kernel: { lang: "python", code: "", needs: [] }, evidence: [], origin: { problemId: "p", title: "11651", lang: "python" }, topic: "sort.multi-key",
  scope: "line", dose: { level: 1 }, state: firstState(1, 0), createdAt: "", ...over });

test("장면 검사: 정답 · 오답 모양은 코드가 돌려서, 입력의 역할은 결과로 다시 정한다", async () => {
  const s = await checkScene(sortScene());
  assert.equal(s.check!.ok, true, s.check!.problems.join(" / "));
  assert.equal(s.inputs[0].role, "basic", "한 명뿐이면 누구나 맞힘 → 기본으로 고쳐 붙임");
  assert.equal(s.inputs[1].role, "split", "이름 순과 점수 순이 같으면… 거꾸로 짠 생각은 갈라진다");
  assert.notDeepEqual(s.computed!.shapes.mine, s.computed!.expected);
});

test("판정 넷: 통과(두 번 정렬도) · 같은 실수 · 다른 실수 · 원인 미확정", async () => {
  const s = await checkScene(sortScene());
  const g = gap();
  assert.equal((await gradeScene(s, g, "students.sort(key=lambda s: (-s[1], s[0]))")).verdict, "pass");
  assert.equal((await gradeScene(s, g, "students.sort(key=lambda t: t[0])\nstudents.sort(key=lambda t: -t[1])")).verdict, "pass", "능력 확인: 다른 맞는 방법도 통과");
  assert.equal((await gradeScene(s, g, "students.sort(key=lambda s: (s[0], -s[1]))")).verdict, "same");
  assert.equal((await gradeScene(s, g, "students = sorted(students, key=lambda p: (p[0], -p[1]))")).verdict, "same", "모양이 달라도 생각이 같으면 같은 실수");
  const other = await gradeScene(s, g, "students.sort(key=lambda s: (s[1], s[0]))");
  assert.equal(other.verdict, "other"); assert.equal(other.matched, "nodesc");
  assert.equal((await gradeScene(s, g, "students.reverse()")).verdict, "unclear");
  assert.equal((await gradeScene(s, g, "students.sort(key=")).verdict, "unclear", "실행 오류는 원인 미확정");
  assert.equal((await gradeScene(s, gap({ wrongVerified: false }), "students.sort(key=lambda s: (s[0], -s[1]))")).verdict, "unclear", "확인 못 한 빈틈은 같은 실수를 판정하지 않는다");
});

test("결과 맞히기: 쓴 값이 그때 생각대로 계산한 값이면 같은 실수", async () => {
  const s = await checkScene({ ...sortScene(), format: "predict", setup: "", after: "",
    reference: "q=[2,5,7]\nx=q.pop(0)\nprint(x, q)", wrongs: [{ id: "mine", what: "pop(0)이 끝에서 꺼낸다고 봄", code: "q=[2,5,7]\nx=q.pop()\nprint(x, q)" }], inputs: [{ role: "basic", stdin: "" }], alsoRight: [] });
  assert.equal(s.check!.ok, true, s.check!.problems.join(" / "));
  assert.equal((await gradeScene(s, gap(), "2 [5, 7]")).verdict, "pass");
  assert.equal((await gradeScene(s, gap(), "7 [2, 5]")).verdict, "same");
  assert.equal((await gradeScene(s, gap(), "5 [2, 7]")).verdict, "unclear");
});

test("빈칸(표현 확인): 빈칸 자리에만 쓰게, 비워 두면 안 풀림", async () => {
  const s = await checkScene({ ...sortScene(), format: "blank", target: "form", template: "students.sort(key=lambda s: ____)", reference: "(-s[1], s[0])", alsoRight: [],
    wrongs: [{ id: "mine", what: "튜플 대신 하나만", code: "-s[1]" }] });
  assert.equal(s.check!.ok, true, s.check!.problems.join(" / "));
  assert.equal((await gradeScene(s, gap({ target: "form" }), "(-s[1], s[0])")).verdict, "pass");
  assert.equal((await gradeScene(s, gap({ target: "form" }), "-s[1]")).verdict, "same");
});

test("나쁜 장면은 떨어진다: 그때 생각도 맞는 장면 · 다른 맞는 방법을 막는 장면", async () => {
  const bad1 = await checkScene({ ...sortScene(), wrongs: [{ id: "mine", what: "두 번 정렬", code: "students.sort(key=lambda s: s[0])\nstudents.sort(key=lambda s: -s[1])" }] });
  assert.equal(bad1.check!.ok, false);
  assert.ok(bad1.check!.problems.some((p) => p.includes("모든 입력에서 맞아요")));
  const bad2 = await checkScene({ ...sortScene(), reference: "students.sort(key=lambda s: (-s[1], s[0]))", alsoRight: ["students.sort(key=lambda s: s[1])"] });
  assert.ok(bad2.check!.problems.some((p) => p.includes("다른 맞는 방법")));
});

test("사다리 · 범위 · 세기: 틀린 횟수는 범위를 키우지 않고, 통과하면 멀리 · 같은 실수면 가까이, 응용 통과 = 앎", () => {
  assert.equal(scopeOf("문법", { wrongTries: 3 }), "line");
  assert.equal(scopeOf("알고리즘 구현", { tutorCode: true }), "function");
  assert.equal(doseOf({ helpRung: 4 }), 3); assert.equal(doseOf({ wrongTries: 2 }), 2); assert.equal(doseOf({}), 1);
  let g = gap();
  assert.equal(g.state.distance, "near");
  g = reflect(g, "pass", {}, 0); assert.equal(g.state.distance, "far");
  g = reflect(g, "same", {}, 0); assert.equal(g.state.distance, "near"); assert.equal(g.dose.level, 2);
  g = reflect(g, "same", {}, 0); assert.equal(g.state.distance, "same", "같은 실수 두 번 연속 → 똑같이");
  g = reflect(g, "pass", {}, 0); g = reflect(g, "pass", {}, 0); assert.equal(g.state.distance, "far"); assert.equal(g.state.known, false);
  g = reflect(g, "pass", {}, 0); assert.equal(g.state.known, true, "응용 통과 = 앎");
  const h = reflect(gap(), "pass", { hinted: true }, 0); assert.equal(h.state.distance, "near", "힌트 보고 통과는 몰랐음");
  assert.equal(formatOf({ ...gap(), scope: "piece", state: { ...gap().state, distance: "same" } }, true), "fix");
  assert.equal(formatsFor({ ...gap(), scope: "line", state: { ...gap().state, distance: "same" } }, { hasWrongSubmission: true })[0], "blank", "한 줄 범위의 똑같이 = 그 줄만 다시 쓰기");
  assert.equal(formatOf({ ...gap(), kind: "한 줄 읽기" }, false), "predict");
  const due = dueToday([gap({ id: "a", layer: 5, scope: "piece" }), gap({ id: "b", layer: 1 })], Date.now() + 9e9);
  assert.equal(due.gaps[0].id, "b", "낮은 층부터");
});

test("모든 입력에서 틀리는 생각: 기본 입력 없이 가르는 입력 셋 · 같은 예외면 같은 실수 · 문법 오류는 아님", async () => {
  const base: Scene = { id: "sc_000000000009", gapId: "gap_x", format: "blank", lang: "python", distance: "near", target: "form",
    story: "문구를 n번", ask: "빈칸", explain: "range(n)", setup: "n = int(input())\nw = input()", after: "print('끝')", template: "for _ in ____:\n    print(w)",
    reference: "range(n)", alsoRight: [], wrongs: [{ id: "mine", what: "정수를 바로 돌림", code: "n" }],
    inputs: [{ role: "basic", stdin: "1\na" }, { role: "basic", stdin: "2\nb" }, { role: "basic", stdin: "3\nc" }], createdAt: "", madeBy: "ai" };
  const s = await checkScene(base);
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeScene(s, { wrongVerified: true }, "n")).verdict, "same", "같은 TypeError");
  assert.equal((await gradeScene(s, { wrongVerified: true }, "range(n + 1)")).verdict, "unclear");
  assert.equal((await gradeScene(s, { wrongVerified: false }, "n")).verdict, "unclear", "확인 못 한 빈틈은 같은 실수를 내지 않음");
  const two = await checkScene({ ...base, inputs: base.inputs.slice(0, 2) });
  assert.equal(two.check?.ok, false, "모든 입력에서 틀리면 셋 이상");
  const syn = await checkScene({ ...base, wrongs: [{ id: "mine", what: "?", code: "range(n" }] });
  assert.equal(syn.check?.ok, false, "그때 생각이 문법 오류면 장면이 아님");
});
