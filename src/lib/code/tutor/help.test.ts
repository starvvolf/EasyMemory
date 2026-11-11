// 도움 네 칸 · 뼈대 코드 · 혼자 다시 풀기 · 풀이 일지 (11/11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkBlanks, rungText, skeletonText } from "./help.ts";
import { solveLogs, weekLine } from "./journal.ts";
import type { Lesson } from "./lessons.ts";
import { nextActions, redoList } from "./policy.ts";
import type { ProblemModel } from "./problem-model.ts";
import { computeState, type TutorEvent } from "./state.ts";
import { isResolved } from "./summary.ts";

const model = (number: string, patterns = ["bfs-distance"]): ProblemModel => ({ number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "", statement: "", inputText: "", outputText: "", summary: "요약", maxN: 1000, patterns, signals: ["최소 이동 횟수"],
  approaches: [{ name: "BFS로 거리 적기", verdict: "best", why: "가까운 곳부터" }, { name: "DFS", verdict: "wrong", why: "" }, { name: "완전 탐색", verdict: "slow", why: "" }],
  state: { right: "거리 배열", wrong: ["합계", "포인터"] }, update: "넣을 때 이전 거리 + 1", complexity: "n", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" });
const day = (d: number, m = 0) => new Date(Date.UTC(2026, 10, 1 + d, 0, m)).toISOString();
let t = 0;
const ev = (e: Partial<TutorEvent>): TutorEvent => ({ id: `e${t++}`, at: day(0), kind: "drill", number: "1", patterns: ["bfs-distance"], grade: 3, ...e });

test("도움 1~3칸은 교육용 모델에서(AI 없음): 눈여겨볼 곳 → 방법 이름 → 계획, 앞 칸에 뒤 칸 내용이 새지 않는다", () => {
  const m = model("2178");
  assert.match(rungText(m, 1), /최소 이동 횟수/); assert.match(rungText(m, 1), /1,000/);
  assert.ok(!rungText(m, 1).includes("BFS") && !rungText(m, 1).includes("거리 배열"), "1칸은 방법도 계획도 말하지 않는다");
  assert.match(rungText(m, 2), /BFS/); assert.ok(!rungText(m, 2).includes("넣을 때"), "2칸은 계획을 말하지 않는다");
  assert.match(rungText(m, 3), /거리 배열/); assert.match(rungText(m, 3), /O\(n\)/);
});

test("뼈대 검사: 알맹이 있는 줄 2~5개만, 한마디에 그 줄 코드가 그대로 있으면 버린다. 화면에는 비운 줄 자리에 한마디만", () => {
  const full = ["import sys", "n = int(input())", "dist = [-1] * n", "queue = [0]", "dist[0] = 0", "while queue:", "    cur = queue.pop(0)", "    for nxt in graph[cur]:", "        if dist[nxt] == -1:", "            dist[nxt] = dist[cur] + 1", "            queue.append(nxt)", "print(dist[n - 1])"].join("\n");
  const ok = checkBlanks(full, [{ line: 9, hint: "다음 칸의 거리를 적어요" }, { line: 8, hint: "아직 안 간 칸인지 봐요" }, { line: 0, hint: "가져오기" }, { line: 99, hint: "밖" }, { line: 10, hint: "queue.append(nxt)" }]);
  assert.deepEqual(ok?.map((b) => b.line), [8, 9], "import·범위 밖·코드를 그대로 담은 한마디는 빠진다");
  assert.equal(checkBlanks(full, [{ line: 9, hint: "하나뿐" }]), null);
  const shown = skeletonText({ full, blanks: ok!, lang: "python" });
  assert.ok(!shown.includes("dist[cur] + 1"), "비운 줄의 코드는 화면에 가지 않는다");
  assert.match(shown.split("\n")[9], /^ {12}# ____ 여기를 채워요: 다음 칸의 거리를 적어요$/);
  assert.equal(shown.split("\n").length, full.split("\n").length);
});

test("혼자 다시 풀기: 도움 받고 통과한 문제는 하루 뒤 맨 앞 할 일로, 혼자 통과하면 사라지고 그때의 카드는 해결됨", () => {
  const models = { "2178": model("2178"), "7562": model("7562"), "1697": model("1697") };
  const helped = [ev({ kind: "walkthrough", number: "2178", at: day(0), grade: 0 }), ev({ kind: "help", number: "2178", at: day(0, 5), grade: 0, help: 2 }),
    ev({ kind: "implement", number: "2178", ability: "execute", ok: true, hinted: true, help: 2, grade: 1, at: day(0, 30) })];
  assert.equal(computeState(helped).patterns["bfs-distance"].abilities.execute.assisted.s, 1);
  assert.deepEqual(redoList(computeState(helped), new Date(day(0, 60))).map((r) => [r.number, r.due]), [["2178", false]], "같은 날에는 아직");
  const next = nextActions(computeState(helped), models, new Date(day(1, 31)));
  assert.equal(next[0].redo, true); assert.equal(next[0].number, "2178"); assert.equal(next[0].kind, "implement");
  const redone = [...helped, ev({ kind: "implement", number: "2178", ability: "execute", ok: true, redo: true, grade: 2, at: day(2) })];
  assert.deepEqual(redoList(computeState(redone), new Date(day(5))), []);
  const card = { id: "ls_1", at: day(0, 30), pattern: "bfs-distance", number: "2178", title: "", kind: "implement", situation: "", gap: "방법을 못 떠올림", fix: "", cue: "", refined: "code" } as Lesson;
  assert.equal(isResolved(card, helped), false);
  assert.equal(isResolved(card, redone), true, "직접 짜기는 같은 문제를 혼자 다시 풀어도 해결");
});

test("처음 짜 보는 패턴은 뼈대에서 채우기부터, 한 번 해 본 뒤에는 다른 문제를 혼자", () => {
  const models = { "2178": model("2178"), "7562": model("7562"), "1697": model("1697"), "5014": model("5014") };
  const base = [ev({ kind: "walkthrough", number: "2178", grade: 0, at: day(0) }), ev({ number: "7562", ability: "recognize", ok: true, at: day(0, 1) }), ev({ number: "1697", ability: "recognize", ok: true, at: day(0, 2) }),
    ev({ kind: "design", number: "5014", ability: "design", ok: true, at: day(0, 3) })];
  const soon = new Date(day(0, 4));
  const first = nextActions(computeState(base), models, soon).find((a) => a.kind === "implement")!;
  assert.equal(first.fill, true); assert.match(first.why, /뼈대/);
  const filled = [...base, ev({ kind: "implement", number: first.number, ability: "execute", ok: true, hinted: true, help: 4, fill: true, grade: 1, at: day(0, 20) })];
  const second = nextActions(computeState(filled), models, new Date(day(0, 21))).find((a) => a.kind === "implement" && !a.redo)!;
  assert.ok(!second.fill); assert.notEqual(second.number, first.number, "다른 문제를 혼자");
});

test("풀이 일지: 문제마다 한 장, 막힌 곳은 가장 앞 단계, 도움 칸·다시 풀기 상태, 이번 주 한 줄", () => {
  const events = [
    ev({ kind: "walkthrough", number: "2178", grade: 0, at: day(0) }), ev({ kind: "help", number: "2178", grade: 0, help: 1, at: day(0, 1) }), ev({ kind: "help", number: "2178", grade: 0, help: 3, at: day(0, 2) }),
    ev({ kind: "implement", number: "2178", ability: "execute", ok: true, hinted: true, help: 3, grade: 1, at: day(0, 30) }),
    ev({ number: "7562", ability: "recognize", ok: false, at: day(1) }), ev({ kind: "implement", number: "7562", ability: "execute", ok: true, hinted: true, help: 4, grade: 1, at: day(1, 30) }),
    ev({ kind: "implement", number: "7562", ability: "execute", ok: true, redo: true, grade: 2, at: day(3) }),
    ev({ kind: "implement", number: "1697", ability: "execute", ok: true, grade: 3, at: day(2) }),
    ev({ kind: "walkthrough", number: "9999", grade: 0, at: day(2) }),
  ];
  const lessons = [{ id: "ls_a", at: day(0, 30), pattern: "bfs-distance", number: "2178", title: "미로 탐색", kind: "implement", situation: "s", gap: "무엇을 적어 둘지 몰랐어요", fix: "넣을 때 거리 + 1", cue: "최소 이동", refined: "code" } as Lesson];
  const logs = solveLogs(events, lessons, { "2178": "미로 탐색" }, new Date(day(3, 10)));
  assert.deepEqual(logs.map((l) => l.number), ["7562", "1697", "2178"], "풀이 과정만 본 9999는 없다, 최근 것부터");
  const a = logs.find((l) => l.number === "2178")!;
  assert.equal(a.stuck, "recognize", "1칸을 열었으니 가장 앞 단계는 방법 떠올리기"); assert.equal(a.help, 3); assert.equal(a.redo, "due"); assert.equal(a.gap, "무엇을 적어 둘지 몰랐어요");
  const b = logs.find((l) => l.number === "7562")!;
  assert.equal(b.redo, "done"); assert.equal(b.alone, false);
  const c = logs.find((l) => l.number === "1697")!;
  assert.equal(c.stuck, null); assert.equal(c.alone, true); assert.equal(c.redo, "none");
  const w = weekLine(logs, new Date(day(3, 10)));
  assert.equal(w.problems, 3); assert.equal(w.redoAll, 2); assert.equal(w.redone, 1);
  assert.match(w.text, /이번 주 3문제/); assert.match(w.text, /혼자 다시 풀기 2개 중 1개 성공/);
});

test("도움 칸 열기와 뼈대 만들기: 앞 칸부터, 연 칸은 기록에, 뼈대는 테스트를 통과해야 저장, 풀이는 도움 받은 것으로 남고 카드는 사람이 확인", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-help-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake"; process.env.RECALLER_AFTER_SAVE = "off";
  const { setFakeModelResponder } = await import("../../ai/model.ts");
  try {
    const { saveProblem, submit, readDrafts } = await import("../problems.ts");
    const reference = "const n=Number(require('fs').readFileSync(0,'utf8').trim());\nconsole.log(n*2);";
    const p = await saveProblem({ title: "BOJ 2178번 두 배", statement: "수를 두 배로", inputText: "n", outputText: "2n", examples: [{ input: "2\n", output: "4\n" }], tests: [{ input: "5\n", output: "10\n" }], timeLimitMs: 2000,
      kind: "full", templates: {}, reference: { lang: "javascript", code: reference }, knowledge: [], folder: "알고리즘", source: { kind: "manual", title: "t" } } as never);
    await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
    await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify({ "2178": { ...model("2178"), problemId: p.id } }));
    const { helpState, openHelp } = await import("./help.ts");
    assert.equal((await helpState(p.id))?.opened, 0);
    assert.equal(await helpState("cp_none"), null, "재료가 없는 문제에는 도움 칸이 없다");
    await assert.rejects(() => openHelp(p.id, 3, "javascript"), /작은 도움부터/);
    assert.match((await openHelp(p.id, 1, "javascript")).text, /최소 이동 횟수/);
    await openHelp(p.id, 1, "javascript");
    await openHelp(p.id, 2, "javascript"); await openHelp(p.id, 3, "javascript");
    const { readEvents } = await import("./state.ts");
    assert.deepEqual((await readEvents()).filter((e) => e.kind === "help").map((e) => e.help), [1, 2, 3], "같은 칸을 다시 열어도 한 번만 남는다");
    // 4칸: 처음엔 틀린 코드(테스트 실패) → 이유를 붙여 한 번 더 → 통과한 것만 저장.
    const good = { code: "const fs = require('fs');\nconst text = fs.readFileSync(0, 'utf8');\nconst n = Number(text.trim());\nconst answer = n * 2;\nconsole.log(answer);", blanks: [{ line: 2, hint: "입력을 수로 바꿔요" }, { line: 3, hint: "두 배로 만들어요" }] };
    let calls = 0;
    setFakeModelResponder(() => JSON.stringify(calls++ === 0 ? { ...good, code: good.code.replace("n * 2", "n * 3") } : good));
    const r = await openHelp(p.id, 4, "javascript");
    assert.equal(calls, 2); assert.ok(r.skeleton && !r.skeleton.includes("n * 2") && r.skeleton.includes("____ 여기를 채워요: 두 배로 만들어요"));
    calls = 0; await openHelp(p.id, 4, "javascript");
    assert.equal(calls, 0, "만들어 둔 뼈대는 다시 만들지 않는다");
    // 통과하면: 도움 4칸까지 받은 풀이로 남고, 카드가 생기고, 사람이 확인하면 표시된다.
    const { notePlainSolve, syncTutorImplement, startFill } = await import("./service.ts");
    await notePlainSolve(p.id);
    await submit(p.id, "javascript", good.code, "submit", 0);
    await syncTutorImplement();
    const done = (await readEvents()).find((e) => e.kind === "implement")!;
    assert.equal(done.hinted, true); assert.equal(done.help, 4); assert.equal(done.grade, 1);
    const { readLessons, confirmLesson } = await import("./lessons.ts");
    const card = (await readLessons()).find((l) => l.kind === "implement")!;
    assert.match(card.gap, /코드로 옮기다/); assert.ok(!card.confirmed);
    await confirmLesson(card.id, "큐에 넣을 때 거리를 안 적었어요");
    const after = (await readLessons()).find((l) => l.id === card.id)!;
    assert.equal(after.gap, "큐에 넣을 때 거리를 안 적었어요"); assert.equal(after.confirmed, true);
    // 뼈대에서 시작하기: 쓰던 코드에 뼈대가 들어간다.
    await startFill("2178", "javascript");
    assert.match((await readDrafts(p.id)).javascript ?? "", /여기를 채워요/);
  } finally {
    setFakeModelResponder(null); delete process.env.STUDY_FORGE_MODEL_PROVIDER; delete process.env.RECALLER_AFTER_SAVE;
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
