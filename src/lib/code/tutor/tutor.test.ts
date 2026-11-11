import { test } from "node:test";
import assert from "node:assert/strict";
import { checkModel, tutorTargets, type ProblemModel } from "./problem-model.ts";
import { PATTERNS, PATTERN_IDS, TUTOR_CHAPTERS } from "./patterns.ts";
import { nextActions } from "./policy.ts";
import { computeState, gradeOf, type TutorEvent } from "./state.ts";
import { LADDER } from "../grade.ts";

const model = (number: string, patterns: string[], role: "lecture" | "basic" = "basic", extra: Partial<ProblemModel> = {}): ProblemModel => ({
  number, title: `문제 ${number}`, chapter: "0x09", role, url: "", statement: "", inputText: "", outputText: "", summary: "요약", maxN: 1000, patterns, signals: ["격자"],
  approaches: [{ name: "BFS", verdict: "best", why: "" }, { name: "DFS", verdict: "ok", why: "" }, { name: "완전 탐색", verdict: "slow", why: "" }],
  state: { right: "방문 배열", wrong: ["합계", "포인터"] }, update: "넣을 때 표시", complexity: "n", pitfalls: [],
  walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "", ...extra });
let t = 0;
const ev = (e: Partial<TutorEvent>): TutorEvent => ({ id: `e${t}`, at: new Date(Date.UTC(2026, 10, 8, 0, t++)).toISOString(), kind: "drill", number: "1", patterns: ["visited"], grade: 3, ...e });

test("패턴 목록: id가 겹치지 않고, 사다리 칸·튜터 단원에 이어진다", () => {
  assert.equal(new Set(PATTERN_IDS).size, PATTERN_IDS.length);
  const ladder = new Set(LADDER.flatMap((s) => s.abilities.map((a) => a.id)));
  for (const p of PATTERNS) assert.ok(ladder.has(p.ability), `${p.id} → ${p.ability}`);
  for (const c of TUTOR_CHAPTERS) assert.ok(PATTERNS.some((p) => p.chapters.includes(c)), c);
  const targets = tutorTargets();
  assert.equal(new Set(targets.map((t) => t.number)).size, targets.length, "한 번호는 한 번(두 단원에 나오는 10814 등)");
  assert.ok(targets.filter((t) => ["0x03", "0x04", "0x05", "0x06", "0x07", "0x08", "0x09", "0x0B", "0x0C", "0x0E", "0x0F"].includes(t.chapter)).length === 74, "기본 단원 74개는 그대로");
  assert.ok(targets.some((x) => x.number === "1926" && x.role === "lecture"));
});

test("모델 검사: 목록 밖 패턴·두 개의 best·문제 글에 없는 N·튜터 밖 대조 문제는 고친다", () => {
  const target = { number: "1926", title: "그림", chapter: "0x09", chapterTitle: "BFS", role: "lecture" as const, solution: "" };
  const c = checkModel({ patterns: ["visited", "없는패턴"], maxN: 777, approaches: [{ name: "A", verdict: "best", why: "" }, { name: "B", verdict: "best", why: "" }, { name: "C", verdict: "wrong", why: "" }],
    state: { right: "r", wrong: ["w1", "w2"] }, complexity: "n²", contrast: { number: "9999", differs: "d" }, predict: { question: "q", input: "1 1\n1" } },
    { target, statementText: "1 ≤ n ≤ 500", pool: ["1926", "2178"] });
  assert.deepEqual(c.patterns, ["visited"]);
  assert.equal(c.approaches.filter((a) => a.verdict === "best").length, 1);
  assert.equal(c.maxN, null, "777 is not in the problem text");
  assert.equal(c.contrast, undefined);
  assert.ok(c.predictDraft, "the prediction is kept as a draft until the lecture code runs it");
  const empty = checkModel({ patterns: [], approaches: [{ name: "A", verdict: "best", why: "" }] }, { target, statementText: "", pool: [] });
  assert.equal(empty.patterns.length, 1, "falls back to the chapter's first pattern");
  assert.deepEqual(empty.approaches, [], "fewer than three choices is no drill");
});

test("증거 등급: 도움 → E1, 본 문제 → E2, 새 문제 → E3, 단원 숨긴 새 문제 → E4", () => {
  const events = [ev({ kind: "walkthrough", number: "1", ability: undefined, grade: 0 })];
  assert.equal(gradeOf(events, "1", "recognize", {}), 2);
  assert.equal(gradeOf(events, "2", "recognize", {}), 3);
  assert.equal(gradeOf(events, "2", "recognize", { mixed: true }), 4);
  assert.equal(gradeOf(events, "2", "recognize", { hinted: true, mixed: true }), 1);
});

test("상태: 혼자·도움을 따로, 새 문제 승리로 도움 수준이 오르고, 연속 실패로 내려간다", () => {
  const events = [ev({ kind: "walkthrough", number: "1", ability: undefined, grade: 0 }),
    ev({ number: "2", ability: "recognize", ok: true }), ev({ number: "3", ability: "recognize", ok: true }), ev({ number: "4", ability: "recognize", ok: true, hinted: true, grade: 1 })];
  const s = computeState(events).patterns.visited.abilities.recognize;
  assert.deepEqual(s.independent, { s: 2, n: 2 }); assert.deepEqual(s.assisted, { s: 1, n: 1 });
  assert.equal(s.freshWins, 2); assert.equal(s.help, 2); assert.equal(s.box, 1);
  const worse = computeState([...events, ev({ number: "5", ability: "recognize", ok: false }), ev({ number: "6", ability: "recognize", ok: false })]).patterns.visited.abilities.recognize;
  assert.equal(worse.failStreak, 2); assert.equal(worse.help, 1); assert.equal(worse.box, 0);
});

test("다음 할 일: 처음엔 진단, 새 패턴은 시범 → 드릴, 드릴 둘 뒤 설계, 설계 뒤 구현", () => {
  const models = { "1926": model("1926", ["fast-io"], "lecture"), "2667": model("2667", ["fast-io"]), "1012": model("1012", ["fast-io"]), "2583": model("2583", ["fast-io"]), "2468": model("2468", ["fast-io"]) };
  // 사건 시각이 고정이라, "지금"을 마지막 사건 1분 뒤로 둔다(아니면 날이 지나 복습이 먼저 나온다, 11/9).
  const soon = (es: TutorEvent[]) => new Date(Date.parse(es.at(-1)!.at) + 60_000);
  const diag = nextActions(computeState([]), models);
  assert.ok(diag.length >= 1 && diag.every((a) => a.kind === "drill" && a.mixed), "diagnosis hides the chapter");
  let events: TutorEvent[] = [ev({ number: "9", patterns: ["count-array"], ability: "recognize", ok: true })];
  let next = nextActions(computeState(events), models, soon(events));
  assert.equal(next[0].kind, "walkthrough"); assert.equal(next[0].number, "1926", "a lecture problem first");
  assert.equal(next[1].kind, "drill"); assert.notEqual(next[1].number, "1926");
  events = [...events, ev({ patterns: ["fast-io"], kind: "walkthrough", number: "1926", ability: undefined, grade: 0 }), ev({ patterns: ["fast-io"], number: "2667", ability: "recognize", ok: true }), ev({ patterns: ["fast-io"], number: "1012", ability: "recognize", ok: true })];
  next = nextActions(computeState(events), models, soon(events));
  assert.equal(next[0].kind, "design");
  assert.ok(!["1926"].includes(next[0].number), "a problem seen in the walkthrough is not a fresh test");
  events = [...events, ev({ patterns: ["fast-io"], kind: "design", number: next[0].number, ability: "design", ok: true })];
  next = nextActions(computeState(events), models, soon(events));
  assert.equal(next[0].kind, "implement");
  // 구현을 두 번 틀리면 설계로 한 칸 물러난다.
  events = [...events, ev({ patterns: ["fast-io"], kind: "implement", number: "2468", ability: "execute", ok: false }), ev({ patterns: ["fast-io"], kind: "implement", number: "2583", ability: "execute", ok: false })];
  next = nextActions(computeState(events), models, soon(events));
  assert.equal(next.find((a) => a.pattern === "fast-io" && a.kind !== "walkthrough")?.kind, "design");
});

test("다음 할 일: 날짜가 된 복습이 먼저이고 단원을 숨긴다", () => {
  const models = { "1926": model("1926", ["visited"], "lecture"), "2667": model("2667", ["visited"]), "1012": model("1012", ["visited"]) };
  const events = [ev({ kind: "walkthrough", number: "1926", ability: undefined, grade: 0 }), ev({ number: "2667", ability: "recognize", ok: true })];
  const later = new Date(Date.parse(events[1].at) + 11 * 60_000);
  const next = nextActions(computeState(events), models, later);
  assert.equal(next[0].mixed, true); assert.match(next[0].why, /다시 볼 날/);
});
