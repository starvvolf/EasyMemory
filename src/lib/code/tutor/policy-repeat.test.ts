import { test } from "node:test";
import assert from "node:assert/strict";
import { nextActions } from "./policy.ts";
import { computeState, type TutorEvent } from "./state.ts";
import type { ProblemModel } from "./problem-model.ts";

const m = (number: string, role: "lecture" | "basic") => ({ number, title: `문제 ${number}`, chapter: "0x09", role, url: "u", statement: "s", inputText: "i", outputText: "o", summary: "s",
  maxN: 500, patterns: ["components"], signals: ["연결된 영역"], approaches: [{ name: "BFS", verdict: "best", why: "w" }, { name: "정렬", verdict: "wrong", why: "w" }],
  state: { right: "방문 배열", wrong: ["합계"] }, update: "u", complexity: "n²", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" }) as unknown as ProblemModel;

test("방금 답을 본 문제를 바로 또 묻지 않는다(11/11 시험): 다른 재료가 없으면 기다린다, 30분 지나면 다시", () => {
  const models = { "1926": m("1926", "lecture"), "2667": m("2667", "basic") };
  const now = new Date("2026-11-11T12:00:00.000Z");
  const ev = (o: Partial<TutorEvent>): TutorEvent => ({ id: Math.random().toString(), at: "2026-11-11T11:00:00.000Z", kind: "walkthrough", number: "1926", patterns: ["components"], grade: 0, ...o });
  const events = [ev({}), ev({ kind: "drill", number: "2667", ability: "recognize", ok: false, grade: 0, at: "2026-11-11T11:59:00.000Z" })];
  const acts = nextActions(computeState(events), models, now);
  assert.ok(!acts.some((a) => a.kind === "drill" && a.number === "2667"), "1분 전에 답을 본 2667을 또 내지 않는다");
  const later = nextActions(computeState(events), models, new Date("2026-11-11T12:40:00.000Z"));
  assert.ok(later.some((a) => a.kind === "drill" && a.number === "2667"), "30분이 지나면 다시 낼 수 있다");
});

test("방금 비교한 문제를 또 비교하지 않는다(11/11 시험)", () => {
  const a = { ...m("1926", "basic"), contrast: { number: "2667", differs: "d" } } as unknown as ProblemModel;
  const models = { "1926": a, "2667": m("2667", "basic"), "1012": m("1012", "basic") };
  const now = new Date("2026-11-11T12:00:00.000Z");
  const ev = (o: Partial<TutorEvent>): TutorEvent => ({ id: Math.random().toString(), at: "2026-11-11T11:50:00.000Z", kind: "drill", number: "1012", patterns: ["components"], ability: "recognize", ok: false, grade: 0, ...o });
  const base = [ev({ kind: "walkthrough", ability: undefined, ok: undefined, at: "2026-11-11T11:00:00.000Z" }), ev({}), ev({ number: "2667", at: "2026-11-11T11:51:00.000Z" })];
  assert.ok(nextActions(computeState(base), models, now).some((x) => x.kind === "contrast"), "두 번 연속 틀리면 비교");
  const after = [...base, ev({ kind: "contrast", number: "1926", ability: undefined, ok: true, at: "2026-11-11T11:55:00.000Z" })];
  assert.ok(!nextActions(computeState(after), models, now).some((x) => x.kind === "contrast"), "방금 비교했으면 또 비교하지 않는다");
});

test("비교는 연속 틀림 한 번에 한 번만: 다른 비교 문제가 있어도 다시 알아채기로", () => {
  const c = (n: string, o: string) => ({ ...m(n, "basic"), contrast: { number: o, differs: "d" } }) as unknown as ProblemModel;
  const models = { "1926": c("1926", "2667"), "2667": c("2667", "1926"), "1012": m("1012", "basic"), "4963": m("4963", "basic") };
  const now = new Date("2026-11-11T12:00:00.000Z");
  const ev = (o: Partial<TutorEvent>): TutorEvent => ({ id: Math.random().toString(), at: "2026-11-11T11:50:00.000Z", kind: "drill", number: "1012", patterns: ["components"], ability: "recognize", ok: false, grade: 0, ...o });
  const events = [ev({ kind: "walkthrough", ability: undefined, ok: undefined, at: "2026-11-11T11:00:00.000Z" }), ev({}), ev({ number: "4963", at: "2026-11-11T11:51:00.000Z" }),
    ev({ kind: "contrast", number: "1926", ability: undefined, ok: true, at: "2026-11-11T11:55:00.000Z" })];
  const acts = nextActions(computeState(events), models, now);
  assert.ok(!acts.some((x) => x.kind === "contrast"), "2667도 비교 문제지만 또 비교하지 않는다");
  assert.ok(acts.some((x) => x.kind === "drill"), "알아채기 문제로");
});
