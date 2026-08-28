import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlannerDayDetails,
  buildPlannerMonth,
  createLearningPlan,
  updateLearningPlan,
  type LearningPlan,
} from "../src/lib/learning-planner.ts";
import type { Deck, StudyAttempt, StudySession } from "../src/lib/types.ts";

function makeDeck(): Deck {
  return {
    id: "deck-1",
    title: "운영체제",
    boardColumn: "learning",
    subject: "컴퓨터과학",
    tags: [],
    mode: "flashcard",
    sourceText: "",
    instruction: "",
    analysis: { detectedGoal: "", sourceType: "concept", keyTopics: [], recommendedStrategy: "" },
    organizedMaterial: { title: "", sections: [] },
    cards: [{
      id: "card-1",
      type: "flashcard",
      front: "앞",
      back: "뒤",
      tags: [],
      status: "review",
      reviewSchedule: {
        algorithm: "fsrs",
        dueAt: "2026-08-20T12:00:00+09:00",
        stability: 1,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        learningSteps: 0,
        repetitions: 1,
        lapses: 0,
        state: "review",
      },
    }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeStudy(): { session: StudySession; attempt: StudyAttempt } {
  const session: StudySession = {
    id: "session-1",
    deckId: "deck-1",
    activityType: "flashcard",
    startedAt: "2026-08-20T14:00:00+09:00",
    endedAt: "2026-08-20T14:10:00+09:00",
    status: "completed",
    selectionMode: "all",
    plannedActivityIds: ["card-1"],
    plannedItemCount: 1,
    completedItemCount: 1,
    currentIndex: 1,
  };
  return {
    session,
    attempt: {
      id: "attempt-1",
      sessionId: session.id,
      activityType: "flashcard",
      activityId: "card-1",
      startedAt: session.startedAt,
      answerRevealedAt: null,
      completedAt: "2026-08-20T14:01:00+09:00",
      selfRating: "known",
      wasNew: false,
    },
  };
}

const plan: LearningPlan = {
  id: "plan-1",
  date: "2026-08-20",
  deckId: "deck-1",
  quantity: 12,
  note: "교착상태 집중",
  completed: false,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

test("선택 날짜에 자동 복습, 실제 학습, 사용자 계획을 분리한다", () => {
  const deck = makeDeck();
  const { session, attempt } = makeStudy();
  const details = buildPlannerDayDetails([deck], [session], [attempt], [plan], "2026-08-20");

  assert.equal(details.reviews[0]?.count, 1);
  assert.equal(details.records[0]?.completedCount, 1);
  assert.equal(details.records[0]?.rememberedCount, 1);
  assert.equal(details.plans[0]?.note, "교착상태 집중");
});

test("월간 날짜에 세 종류의 요약 수치를 표시한다", () => {
  const deck = makeDeck();
  const { session, attempt } = makeStudy();
  const month = buildPlannerMonth(
    [deck],
    [session],
    [attempt],
    [plan],
    new Date(2026, 7, 1, 12),
    new Date(2026, 7, 18, 12),
  );
  const day = month.days.find((item) => item.dayOfMonth === 20);

  assert.deepEqual(day && {
    reviewCount: day.reviewCount,
    studiedCount: day.studiedCount,
    planCount: day.planCount,
  }, { reviewCount: 1, studiedCount: 1, planCount: 1 });
});

test("계획의 분량을 보정하고 날짜, 덱, 메모를 수정한다", () => {
  const created = createLearningPlan(
    { date: "2026-08-21", deckId: "deck-1", quantity: 0, note: "  첫 계획  " },
    new Date("2026-08-18T00:00:00.000Z"),
    "created-plan",
  );
  assert.equal(created.quantity, 1);
  assert.equal(created.note, "첫 계획");

  const updated = updateLearningPlan(
    created,
    { date: "2026-08-22", deckId: "deck-2", quantity: 20.8, note: " 수정 " },
    new Date("2026-08-19T00:00:00.000Z"),
  );
  assert.equal(updated.date, "2026-08-22");
  assert.equal(updated.deckId, "deck-2");
  assert.equal(updated.quantity, 20);
  assert.equal(updated.note, "수정");
  assert.equal(updated.completed, false);
});
