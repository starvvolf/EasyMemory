// 배울 순서·분야 집중 (11/11). 설문·빠른 확인은 11/12에 없앰(사용자 "시작하기 전에 점검 필요 없지 않냐"). AI 없음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { learningOrder, nextActions } from "./policy.ts";
import { EMPTY, ORDERED, type Profile } from "./profile.ts";
import { computeState, type TutorEvent } from "./state.ts";
import type { ProblemModel } from "./problem-model.ts";

const model = (number: string, patterns: string[]): ProblemModel => ({
  number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "", statement: "", inputText: "", outputText: "", summary: "요약", maxN: 1000, patterns, signals: ["s"],
  approaches: [{ name: "A", verdict: "best", why: "" }, { name: "B", verdict: "wrong", why: "" }, { name: "C", verdict: "slow", why: "" }],
  state: { right: "r", wrong: ["w1", "w2"] }, update: "u", complexity: "n", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" });
let t = 0;
const ev = (e: Partial<TutorEvent>): TutorEvent => ({ id: `e${t}`, at: new Date(Date.UTC(2026, 10, 11, 0, t++)).toISOString(), kind: "drill", number: "1", patterns: ["count-array"], grade: 3, ...e });
const prof = (p: Partial<Profile>): Profile => ({ ...EMPTY, focus: [], ...p });
const models: Record<string, ProblemModel> = {};
let n = 100;
for (const id of ["count-array", "exist-table", "stack-match", "queue-sim", "bfs-distance", "dijkstra"]) for (let i = 0; i < 4; i++) { const k = String(n++); models[k] = model(k, [id]); }

test("커리큘럼 순서: 기본기·배열이 먼저, 그래프 심화가 나중", () => {
  const ids = ORDERED.map((p) => p.id);
  assert.ok(ids.indexOf("count-array") < ids.indexOf("stack-match"));
  assert.ok(ids.indexOf("stack-match") < ids.indexOf("bfs-distance"));
  assert.ok(ids.indexOf("bfs-distance") < ids.indexOf("dijkstra"));
  assert.equal(ids.length, 42, "44개 중 합쳐진 둘(방문 표시·안정 정렬)은 따로 배우지 않는다");
});

test("분야 집중: 고른 패턴만, 복습은 하나만, 다 하면 원래 순서로", () => {
  const p = prof({ focus: ["bfs-distance"] });
  const state = computeState([]);
  const next = nextActions(state, models, new Date(), 5, p);
  assert.ok(next.length && next.every((a) => a.pattern === "bfs-distance"));
  assert.equal(learningOrder(state, p).focused, true);
  // 집중한 것이 단단해지면 집중은 저절로 풀린다.
  const solid = [ev({ number: "116", patterns: ["bfs-distance"], ability: "recognize", ok: true }), ev({ number: "117", patterns: ["bfs-distance"], ability: "recognize", ok: true }),
    ev({ number: "118", patterns: ["bfs-distance"], ability: "design", ok: true, kind: "design" }), ev({ number: "119", patterns: ["bfs-distance"], ability: "execute", ok: true, kind: "implement" })];
  const after = learningOrder(computeState(solid), p);
  assert.equal(after.focused, false);
  assert.equal(after.list[0].id, "fast-io", "커리큘럼 첫 칸(기본기)");
});

test("시작 전 점검 없음: 처음이면 진단 문제 없이 바로 커리큘럼 맨 앞 패턴부터", () => {
  const next = nextActions(computeState([]), models);
  assert.ok(next.length > 0);
  assert.ok(!next.some((a) => a.why.includes("처음이라") || a.why.includes("확인해요")), "진단·확인 문제 없음");
  const first = ORDERED.find((p) => Object.values(models).some((m) => m.patterns.includes(p.id)))!;
  assert.equal(next[0].pattern, first.id);
});
