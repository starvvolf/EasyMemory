import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_RULES, askedObjectives, diagnoseBox, isWeak, mergeMemory, parseRules, planToday, renderMemoryAuto, type PlanDeck, type PlanRecord } from "./plan.ts";

const NOW = new Date(2026, 9, 15, 10, 0).getTime(); // 2026-10-15 10:00 local
const DAY = 864e5;
function deck(id: string, source: string, objectives: number, perObjective = 1, support: number[] = []): PlanDeck {
  const objs = Array.from({ length: objectives }, (_, index) => ({ id: `${id}-o${index}`, statement: `목표 ${index}`, recall: `답 ${index}`, pages: [index + 1], importance: support.includes(index) ? "support" as const : "core" as const }));
  const items = objs.flatMap((objective, index) => Array.from({ length: perObjective }, (_, k) => ({ id: `${objective.id}-q${k}`, objectiveId: objective.id, format: "card" as const, page: index + 1 })));
  return { id, title: id, sourceCatalogId: source, items, objectives: objs };
}
const settings = { subjects: [{ name: "그래픽스", exam: "2026-10-20" }, { name: "윤리", exam: "2026-10-25" }], of: { srcG: "그래픽스", srcE: "윤리" } };

test("규칙 MD: 키-값 줄만 읽고, 모르는 키·범위 밖 값은 경고", () => {
  const { rules, warnings } = parseRules("# 제목\n설명\n- [하루-시간] 120분\n- [시간-떠올리기] 30초\n- [첫훑기] 아니오\n- [없는키] 3\n- [마지막-복습일] 99\n");
  assert.equal(rules.dailyMinutes, 120);
  assert.equal(rules.seconds.card, 30);
  assert.equal(rules.diagnose, false);
  assert.equal(rules.finalDays, 7);
  assert.equal(warnings.length, 2);
});

test("저장소의 학습규칙/오늘할것.md는 경고 없이 읽힌다", () => {
  const { warnings } = parseRules(readFileSync(new URL("../../../학습규칙/오늘할것.md", import.meta.url), "utf8"));
  assert.deepEqual(warnings, []);
});

test("약점: 마지막 시도가 틀림·잘 모름·정답 보기면 약점, 혼자 맞히면 빠진다", () => {
  const record: PlanRecord = { events: [{ t: 1, item: "a", kind: "rate", rating: "forgot" }], sched: {} };
  assert.equal(isWeak(record, "a"), true);
  record.events.push({ t: 2, item: "a", kind: "rate", rating: "remembered" });
  assert.equal(isWeak(record, "a"), false);
  record.events.push({ t: 3, item: "a", kind: "reveal" });
  assert.equal(isWeak(record, "a"), true);
});

test("오늘 할 것: 시험이 가까운 과목부터, 새 문제는 마지막 복습일 전까지 나눠서", () => {
  const g = deck("g", "srcG", 40); const e = deck("e", "srcE", 40);
  const plan = planToday({ decks: [e, g], records: {}, settings, rules: { ...DEFAULT_RULES, dailyMinutes: 600 }, now: NOW });
  const graphics = plan.subjects.find((subject) => subject.name === "그래픽스")!;
  // D-5, last review day 1 → 4 learning days → 10 a day; ethics D-10 → 9 days → 5 a day.
  assert.equal(graphics.daysLeft, 5);
  assert.equal(graphics.quota, 10);
  assert.equal(graphics.learnUntil, "2026-10-18");
  assert.equal(plan.subjects.find((subject) => subject.name === "윤리")!.quota, 5);
  assert.equal(plan.queue[0].subject, "그래픽스");
  assert.equal(plan.queue.length, 15);
  assert.ok(plan.queue.every((ref) => ref.reason === "diagnose"));
});

test("첫 훑기는 핵심 목표의 첫 문제만, 보조 목표와 같은 목표의 두 번째 문제는 새 문제", () => {
  const g = deck("g", "srcG", 3, 2, [2]);
  const plan = planToday({ decks: [g], records: {}, settings, rules: { ...DEFAULT_RULES, dailyMinutes: 600, newPerDayMax: 60 }, now: NOW });
  const reasons = plan.queue.map((ref) => `${ref.itemId}:${ref.reason}`);
  assert.deepEqual(reasons.filter((entry) => entry.endsWith("diagnose")), ["g-o0-q0:diagnose", "g-o1-q0:diagnose"]);
  assert.equal(plan.subjects[0].counts.fresh, 6);
});

test("시험 직전(D-1)에는 새 문제 없이 약점·복습만, 시험이 지나면 빠진다", () => {
  const g = deck("g", "srcG", 4);
  const record: PlanRecord = { events: [{ t: NOW - 2 * DAY, item: "g-o0-q0", kind: "rate", rating: "forgot" }],
    sched: { "g-o0-q0": { box: 0, due: NOW - DAY, seen: true }, "g-o1-q0": { box: 1, due: NOW - 1000, seen: true } } };
  const final = planToday({ decks: [g], records: { g: record }, settings: { ...settings, subjects: [{ name: "그래픽스", exam: "2026-10-16" }] }, now: NOW });
  assert.equal(final.subjects[0].phase, "final");
  assert.deepEqual(final.queue.map((ref) => ref.reason), ["weak", "due"]);
  assert.ok(final.notes.some((note) => note.includes("시험 직전")));
  const over = planToday({ decks: [g], records: { g: record }, settings: { ...settings, subjects: [{ name: "그래픽스", exam: "2026-10-10" }] }, now: NOW });
  assert.equal(over.subjects[0].phase, "over");
  assert.equal(over.queue.length, 0);
});

test("오늘 이미 푼 문제는 다시 내지 않고(틀렸어도) 오늘 한 것으로 센다", () => {
  const g = deck("g", "srcG", 2);
  const record: PlanRecord = { events: [{ t: NOW - 3600e3, item: "g-o0-q0", kind: "rate", rating: "forgot" }], sched: { "g-o0-q0": { box: 0, due: NOW + DAY, seen: true } } };
  const plan = planToday({ decks: [g], records: { g: record }, settings, now: NOW });
  assert.equal(plan.doneToday, 1);
  assert.ok(!plan.queue.some((ref) => ref.itemId === "g-o0-q0"));
});

test("하루 시간을 넘기면 시험 임박 과목의 약점·복습은 남기고 먼 과목 새 문제를 줄인다", () => {
  const g = deck("g", "srcG", 10); const e = deck("e", "srcE", 200);
  const events = g.items.map((item, index) => ({ t: NOW - 2 * DAY + index, item: item.id, kind: "rate", rating: "forgot" }));
  const sched = Object.fromEntries(g.items.map((item) => [item.id, { box: 0, due: NOW - 1, seen: true }]));
  const plan = planToday({ decks: [g, e], records: { g: { events, sched } }, settings, rules: { ...DEFAULT_RULES, dailyMinutes: 10 }, now: NOW });
  assert.equal(plan.queue.filter((ref) => ref.reason === "weak").length, 10);
  assert.ok(plan.needMinutes > plan.budgetMinutes);
  assert.ok(plan.plannedMinutes <= 10);
  assert.ok(plan.notes.some((note) => note.includes("필요해요")));
});

test("읽다가 물어본 목표는 그 뒤에 혼자 맞히기 전까지 '물어봄'으로 오늘 할 것에 들어간다", () => {
  const g = deck("g", "srcG", 3);
  const record: PlanRecord = { events: [{ t: NOW - 3 * DAY, item: "g-o1-q0", kind: "rate", rating: "remembered" }], sched: { "g-o1-q0": { box: 2, due: NOW + 5 * DAY, seen: true } } };
  const notes = { srcG: [{ page: 2, quote: "homogeneous", askedAt: new Date(NOW - DAY).toISOString() }] };
  assert.deepEqual([...askedObjectives(g, record, notes.srcG).keys()], ["g-o1"]);
  const plan = planToday({ decks: [g], records: { g: record }, settings, notes, now: NOW });
  assert.ok(plan.queue.some((ref) => ref.itemId === "g-o1-q0" && ref.reason === "asked"));
});

test("첫 훑기에서 혼자 맞히면 7일 이상 간격의 상자로", () => {
  const intervals = [10 * 60e3, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
  assert.equal(diagnoseBox(intervals, 7), 3);
  assert.equal(diagnoseBox(intervals, 100), 5);
});

test("메모 MD: 자동 부분만 바꾸고 내 메모·에이전트 메모는 그대로", () => {
  const g = deck("g", "srcG", 2);
  const record: PlanRecord = { events: [{ t: NOW - DAY, item: "g-o0-q0", kind: "rate", rating: "forgot" }], sched: { "g-o0-q0": { box: 0, due: NOW, seen: true } } };
  const auto = renderMemoryAuto({ subject: "그래픽스", decks: [g], records: { g: record }, settings, now: NOW });
  assert.match(auto, /D-5/);
  assert.match(auto, /\[g · g-o0\] 목표 0 — 떠올릴 것: 답 0 \(놓침 1번/);
  const first = mergeMemory(null, "그래픽스", auto);
  const edited = first.replace("(공부하면서 직접 적는 곳. Recaller는 이 아래를 고치지 않아요.)", "회전 행렬 부호 자꾸 헷갈림");
  const again = mergeMemory(edited, "그래픽스", auto.replace("놓침 1번", "놓침 2번"));
  assert.match(again, /회전 행렬 부호 자꾸 헷갈림/);
  assert.match(again, /놓침 2번/);
  assert.doesNotMatch(again, /놓침 1번/);
});

test("하루 새 문제 몫은 아침 기준으로 고정: 오늘 처음 푼 것도 몫에 들어간다", () => {
  const g = deck("g", "srcG", 40);
  const done = g.items.slice(0, 10);
  const record: PlanRecord = { events: done.map((item, index) => ({ t: NOW - 3600e3 + index, item: item.id, kind: "rate", rating: "remembered" })),
    sched: Object.fromEntries(done.map((item) => [item.id, { box: 3, due: NOW + 7 * DAY, seen: true }])) };
  const plan = planToday({ decks: [g], records: { g: record }, settings, rules: { ...DEFAULT_RULES, dailyMinutes: 600 }, now: NOW });
  assert.equal(plan.subjects[0].quota, 10);
  assert.equal(plan.queue.length, 0);
});

test("내 조정: 하루 시간 덮어쓰기, '핵심만' 자료는 보조 목표 문제를 빼고 센다", () => {
  const g = deck("g", "srcG", 4, 1, [2, 3]);
  const base = planToday({ decks: [g], records: {}, settings, now: NOW });
  assert.equal(base.subjects[0].counts.items, 4);
  const mine = planToday({ decks: [g], records: {}, settings: { ...settings, prefs: { dailyMinutes: 45, detail: { srcG: "core" } } }, now: NOW });
  assert.equal(mine.budgetMinutes, 45);
  assert.equal(mine.subjects[0].counts.items, 2);
});
