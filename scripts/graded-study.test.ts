import assert from "node:assert/strict";
import test from "node:test";

import {
  recordAutomaticallyGradedResult,
  summarizeAutomaticallyGradedAttempts,
  type AutomaticallyGradedAttempt,
  type AutomaticallyGradedSession,
} from "../src/lib/graded-study.ts";

function session(): AutomaticallyGradedSession {
  return {
    id: "session-1",
    status: "active",
    endedAt: null,
    plannedActivityIds: ["problem-1", "problem-2"],
    plannedItemCount: 2,
    completedItemCount: 0,
    currentIndex: 0,
  };
}

test("외부 채점 결과와 사용자 답·실제 정답을 그대로 기록한다", () => {
  const result = recordAutomaticallyGradedResult(session(), {
    attemptId: "attempt-1",
    activityId: "problem-1",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:05.000Z",
    isCorrect: false,
    userAnswer: "X",
    correctAnswer: "O",
  });

  assert.equal(result.attempt.activityType, "graded_problem");
  assert.equal(result.attempt.isCorrect, false);
  assert.equal(result.attempt.userAnswer, "X");
  assert.equal(result.attempt.correctAnswer, "O");
  assert.equal(result.session.currentIndex, 1);
  assert.equal(result.session.completedItemCount, 1);
});

test("마지막 자동 채점 결과를 기록하면 기존 세션 진행 규칙으로 완료된다", () => {
  const first = recordAutomaticallyGradedResult(session(), {
    attemptId: "attempt-1",
    activityId: "problem-1",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:05.000Z",
    isCorrect: true,
    userAnswer: "O",
    correctAnswer: "O",
  });
  const second = recordAutomaticallyGradedResult(first.session, {
    attemptId: "attempt-2",
    activityId: "problem-2",
    startedAt: "2026-08-12T00:00:05.000Z",
    completedAt: "2026-08-12T00:00:10.000Z",
    isCorrect: false,
    userAnswer: ["B", "A"],
    correctAnswer: ["A", "B"],
  });

  assert.equal(second.session.status, "completed");
  assert.equal(second.session.currentIndex, 2);
  assert.equal(second.session.endedAt, "2026-08-12T00:00:10.000Z");
});

test("현재 세션 순서와 다른 문제 결과는 기록하지 않는다", () => {
  assert.throws(
    () =>
      recordAutomaticallyGradedResult(session(), {
        attemptId: "attempt-2",
        activityId: "problem-2",
        startedAt: "2026-08-12T00:00:00.000Z",
        completedAt: "2026-08-12T00:00:05.000Z",
        isCorrect: true,
        userAnswer: 2,
        correctAnswer: 2,
      }),
    /current session item/,
  );
});

test("완료 요약은 계획 순서대로 오답 재학습 대상을 반환한다", () => {
  const attempts: AutomaticallyGradedAttempt[] = [
    {
      id: "attempt-3",
      sessionId: "session-1",
      activityType: "graded_problem",
      activityId: "problem-3",
      startedAt: "2026-08-12T00:00:10.000Z",
      completedAt: "2026-08-12T00:00:15.000Z",
      isCorrect: false,
      userAnswer: { left: "B", right: "A" },
      correctAnswer: { left: "A", right: "B" },
    },
    {
      id: "attempt-1",
      sessionId: "session-1",
      activityType: "graded_problem",
      activityId: "problem-1",
      startedAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:00:05.000Z",
      isCorrect: false,
      userAnswer: false,
      correctAnswer: true,
    },
    {
      id: "attempt-2",
      sessionId: "session-1",
      activityType: "graded_problem",
      activityId: "problem-2",
      startedAt: "2026-08-12T00:00:05.000Z",
      completedAt: "2026-08-12T00:00:10.000Z",
      isCorrect: true,
      userAnswer: 2,
      correctAnswer: 2,
    },
  ];

  assert.deepEqual(
    summarizeAutomaticallyGradedAttempts(
      ["problem-1", "problem-2", "problem-3"],
      attempts,
    ),
    {
      completedItemCount: 3,
      correctCount: 1,
      incorrectCount: 2,
      incorrectActivityIds: ["problem-1", "problem-3"],
    },
  );
});
