import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLearningCalendar,
  buildLearningHistory,
  buildLearningManagerSnapshot,
} from "../src/lib/learning-manager.ts";
import type { Deck, StudyAttempt, StudySession } from "../src/lib/types.ts";

function makeDeck(id: string): Deck {
  return {
    id,
    title: id === "urgent" ? "데드락" : "OPIc",
    boardColumn: "learning",
    subject: "테스트",
    tags: [],
    mode: "flashcard",
    sourceText: "",
    instruction: "",
    analysis: {
      detectedGoal: "",
      sourceType: "concept",
      keyTopics: [],
      recommendedStrategy: "",
    },
    organizedMaterial: { title: "", sections: [] },
    cards: [
      {
        id: `${id}-due`,
        front: "앞",
        back: "뒤",
        tags: [],
        status: "review",
        reviewSchedule: {
          algorithm: "fsrs",
          dueAt: "2026-08-16T00:00:00.000Z",
          stability: 1,
          difficulty: 5,
          elapsedDays: 1,
          scheduledDays: 1,
          learningSteps: 0,
          repetitions: 1,
          lapses: 0,
          state: "review",
        },
      },
      {
        id: `${id}-new`,
        front: "앞",
        back: "뒤",
        tags: [],
        status: "new",
      },
    ],
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

test("오늘 할 복습과 최근 학습 기록을 덱별로 집계한다", () => {
  const urgent = makeDeck("urgent");
  urgent.cards.push({
    ...urgent.cards[0],
    id: "urgent-due-2",
  });
  const casual = makeDeck("casual");
  const sessions: StudySession[] = [
    {
      id: "session-1",
      deckId: "urgent",
      activityType: "flashcard",
      startedAt: "2026-08-17T09:00:00.000Z",
      endedAt: "2026-08-17T09:05:00.000Z",
      status: "completed",
      selectionMode: "all",
      plannedActivityIds: ["urgent-due"],
      plannedItemCount: 1,
      completedItemCount: 1,
      currentIndex: 1,
    },
  ];
  const attempts: StudyAttempt[] = [
    {
      id: "attempt-1",
      sessionId: "session-1",
      activityType: "flashcard",
      activityId: "urgent-due",
      startedAt: "2026-08-17T09:00:00.000Z",
      answerRevealedAt: "2026-08-17T09:00:03.000Z",
      completedAt: "2026-08-17T09:00:05.000Z",
      selfRating: "review",
      wasNew: false,
    },
  ];

  const snapshot = buildLearningManagerSnapshot(
    [casual, urgent],
    sessions,
    attempts,
    new Date("2026-08-17T12:00:00+09:00"),
  );

  assert.equal(snapshot.dueCount, 3);
  assert.equal(snapshot.newCount, 2);
  assert.equal(snapshot.todayCompletedCount, 1);
  assert.equal(snapshot.todayReviewCount, 1);
  assert.equal(snapshot.recommendedDeckId, "urgent");
  assert.equal(snapshot.decks[0].completedAttemptCount, 1);
  assert.equal(snapshot.recentDays.at(-1)?.completedCount, 1);
});

test("학습 시도 기록이 없어도 복습 예정 덱을 추천한다", () => {
  const snapshot = buildLearningManagerSnapshot(
    [makeDeck("casual")],
    [],
    [],
    new Date("2026-08-17T12:00:00+09:00"),
  );

  assert.equal(snapshot.recommendedDeckId, "casual");
  assert.match(snapshot.recommendationReason, /복습 예정/);
  assert.equal(snapshot.activeSessionCount, 0);
});

test("월간 캘린더에 실제 풀이와 예정 복습을 따로 표시한다", () => {
  const deck = makeDeck("urgent");
  const attempts: StudyAttempt[] = [{
    id: "attempt-calendar",
    sessionId: "session-calendar",
    activityType: "flashcard",
    activityId: "urgent-due",
    startedAt: "2026-08-17T09:00:00+09:00",
    answerRevealedAt: null,
    completedAt: "2026-08-17T09:01:00+09:00",
    selfRating: "known",
    wasNew: false,
  }];
  const calendar = buildLearningCalendar(
    [deck],
    attempts,
    new Date("2026-08-01T12:00:00+09:00"),
    new Date("2026-08-17T12:00:00+09:00"),
  );

  assert.equal(calendar.month, 8);
  assert.equal(calendar.days.find((day) => day.dayOfMonth === 17)?.completedCount, 1);
  assert.equal(calendar.days.find((day) => day.dayOfMonth === 16)?.scheduledReviewCount, 1);
  assert.equal(calendar.days.find((day) => day.dayOfMonth === 17)?.isToday, true);
});

test("세션마다 계획·완료·결과를 학습 기록으로 정리한다", () => {
  const deck = makeDeck("urgent");
  const session: StudySession = {
    id: "history-session",
    deckId: deck.id,
    activityType: "flashcard",
    startedAt: "2026-08-17T09:00:00.000Z",
    endedAt: "2026-08-17T09:05:00.000Z",
    status: "completed",
    selectionMode: "all",
    plannedActivityIds: ["urgent-due", "urgent-new"],
    plannedItemCount: 2,
    completedItemCount: 2,
    currentIndex: 2,
  };
  const attempts: StudyAttempt[] = [
    {
      id: "history-known",
      sessionId: session.id,
      activityType: "flashcard",
      activityId: "urgent-due",
      startedAt: session.startedAt,
      answerRevealedAt: null,
      completedAt: "2026-08-17T09:01:00.000Z",
      selfRating: "known",
      wasNew: false,
    },
    {
      id: "history-review",
      sessionId: session.id,
      activityType: "graded_problem",
      activityId: "urgent-new",
      startedAt: session.startedAt,
      completedAt: "2026-08-17T09:02:00.000Z",
      isCorrect: false,
      userAnswer: false,
      correctAnswer: true,
    },
  ];

  assert.deepEqual(buildLearningHistory([deck], [session], attempts)[0], {
    sessionId: session.id,
    deckId: deck.id,
    deckTitle: "데드락",
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: "completed",
    plannedCount: 2,
    completedCount: 2,
    rememberedCount: 1,
    reviewCount: 1,
  });
});
