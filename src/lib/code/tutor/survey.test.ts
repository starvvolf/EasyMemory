// 설문·빠른 확인·분야 집중 (11/11, 사용자 시뮬레이션에서 정함). AI 없음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { learningOrder, nextActions, pendingChecks } from "./policy.ts";
import { EMPTY, levelOf, ORDERED, type Profile } from "./profile.ts";
import { computeState, type TutorEvent } from "./state.ts";
import type { ProblemModel } from "./problem-model.ts";

const model = (number: string, patterns: string[]): ProblemModel => ({
  number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "", statement: "", inputText: "", outputText: "", summary: "요약", maxN: 1000, patterns, signals: ["s"],
  approaches: [{ name: "A", verdict: "best", why: "" }, { name: "B", verdict: "wrong", why: "" }, { name: "C", verdict: "slow", why: "" }],
  state: { right: "r", wrong: ["w1", "w2"] }, update: "u", complexity: "n", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" });
let t = 0;
const ev = (e: Partial<TutorEvent>): TutorEvent => ({ id: `e${t}`, at: new Date(Date.UTC(2026, 10, 11, 0, t++)).toISOString(), kind: "drill", number: "1", patterns: ["count-array"], grade: 3, ...e });
const prof = (p: Partial<Profile>): Profile => ({ ...EMPTY, surveyed: true, levels: {}, checked: {}, focus: [], ...p });
const models: Record<string, ProblemModel> = {};
let n = 100;
for (const id of ["count-array", "exist-table", "stack-match", "queue-sim", "bfs-distance", "dijkstra"]) for (let i = 0; i < 4; i++) { const k = String(n++); models[k] = model(k, [id]); }
const soon = (es: TutorEvent[]) => new Date(Date.parse(es.at(-1)?.at ?? "2026-11-11T00:00:00Z") + 60_000);

test("쉬운 순서: 기본 도구가 먼저, 그래프 심화가 나중", () => {
  const ids = ORDERED.map((p) => p.id);
  assert.ok(ids.indexOf("count-array") < ids.indexOf("stack-match"));
  assert.ok(ids.indexOf("stack-match") < ids.indexOf("bfs-distance"));
  assert.ok(ids.indexOf("bfs-distance") < ids.indexOf("dijkstra"));
  assert.equal(ids.length, 44);
});

test("설문 뒤: 알아요·잘해요만 쉬운 것부터 한 문제씩 확인하고, 확인이 남으면 배우기보다 먼저", () => {
  const p = prof({ levels: { "stack-match": "know", "count-array": "good", dijkstra: "none" } });
  const state = computeState([]);
  assert.deepEqual(pendingChecks(state, p).map((x) => x.id), ["count-array", "stack-match"]);
  const next = nextActions(state, models, new Date(), 5, p);
  assert.ok(next.length && next.every((a) => a.check && a.kind === "drill" && a.mixed), "only checks");
  assert.equal(next[0].pattern, "count-array");
  assert.match(next[0].why, /잘해요/);
  // 설문을 하면 예전 6문제 진단은 없다.
  assert.equal(nextActions(state, models, new Date(), 5, prof({})).filter((a) => a.why.includes("처음이라")).length, 0);
});

test("확인 결과: 잘해요+맞힘은 건너뛰고, 알아요+맞힘은 시범 없이 계획으로, 틀리면 한 칸 내림", () => {
  const p = prof({ levels: { "count-array": "good", "exist-table": "know", "stack-match": "good" }, checked: { "count-array": "pass", "exist-table": "pass", "stack-match": "fail" } });
  assert.equal(levelOf(p, "stack-match"), "know");
  assert.equal(levelOf(p, "exist-table"), "know");
  const events = [ev({ number: "100", patterns: ["count-array"], ability: "recognize", ok: true, mixed: true }), ev({ number: "104", patterns: ["exist-table"], ability: "recognize", ok: true, mixed: true }),
    ev({ number: "108", patterns: ["stack-match"], ability: "recognize", ok: false, mixed: true })];
  const state = computeState(events);
  const order = learningOrder(state, p).list.map((x) => x.id);
  assert.ok(!order.includes("count-array"), "잘해요 + 확인 통과는 배우기에서 뺀다");
  assert.equal(order[0], "exist-table");
  const next = nextActions(state, models, soon(events), 5, p);
  assert.equal(next[0].pattern, "exist-table");
  assert.equal(next[0].kind, "design", "알아요 + 확인 통과: 시범 없이, 확인 1번을 쳐서 계획 세우기로");
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
  assert.equal(after.list[0].id, "count-array");
});

test("설문 없이(예전처럼): 처음엔 진단, 순서는 목록 순서", () => {
  const next = nextActions(computeState([]), models);
  assert.ok(next.length && next.every((a) => a.mixed && !a.check));
});
