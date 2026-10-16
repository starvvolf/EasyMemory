import assert from "node:assert/strict";
import test from "node:test";
import { coachCards, GEN_NOTES } from "./coach.ts";
import { DEFAULT_RULES, type TodayPlan } from "./plan.ts";

const plan = (over: Partial<TodayPlan> = {}): TodayPlan => ({ date: "2026-10-19", budgetMinutes: 90, plannedMinutes: 90, needMinutes: 80, doneToday: 0, subjects: [], queue: [], notes: [], ...over });
const subject = (name: string, phase: "learn" | "final", weak: number, daysLeft = 5) => ({ name, exam: "", daysLeft, phase, counts: { items: 100, solid: 0, weak, asked: 0, due: 0, fresh: 0, diagnose: 0 },
  picked: { weak: 0, asked: 0, due: 0, diagnose: 0, new: 0 }, quota: 0, learnUntil: null, minutes: 0, doneToday: 0 });
const base = { rules: DEFAULT_RULES, counts: {}, waiting: 0, unassigned: 0, subjectsWithoutDate: [] };

test("코치: 시험 전날 카드, 밀린 양 카드, 약점 더미 카드", () => {
  const cards = coachCards({ ...base, plan: plan({ needMinutes: 200, subjects: [subject("그래픽스", "final", 4, 1), subject("윤리", "learn", 20)] }) });
  assert.deepEqual(cards.map((card) => card.id.split(":")[0]), ["final", "backlog", "weakpile"]);
  assert.deepEqual(cards[1].actions[0], { label: "하루 210분으로", do: "minutes", minutes: 210 });
});

test("코치: 장부 원인이 문턱을 넘으면 개선 카드, 이미 넣은 메모는 다시 권하지 않음, 닫은 카드는 다시 안 나옴", () => {
  const cards = coachCards({ ...base, plan: plan(), counts: { "지엽": 3, "인정답안누락": 2 } });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "improve:지엽:1");
  assert.deepEqual(cards[0].actions.map((action) => action.do), ["genNote", "propose"]);
  const again = coachCards({ ...base, plan: plan(), counts: { "지엽": 3 }, prefs: { genNote: GEN_NOTES["지엽"], coachSeen: {} } });
  assert.deepEqual(again[0].actions.map((action) => action.do), ["propose"]);
  assert.equal(coachCards({ ...base, plan: plan(), counts: { "지엽": 4 }, prefs: { coachSeen: { "improve:지엽:1": "x" } } }).length, 0);
  assert.equal(coachCards({ ...base, plan: plan(), counts: { "지엽": 6 }, prefs: { coachSeen: { "improve:지엽:1": "x" } } }).length, 1);
});
