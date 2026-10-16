import assert from "node:assert/strict";
import test from "node:test";

import {
  abandonStudySession,
  advanceStudySession,
  createStudyAttempt,
  createStudySession,
  findLatestActiveStudySession,
  restoreStudySessionState,
} from "../src/lib/study-session.ts";
import type { StudyAttempt, StudySession } from "../src/lib/types.ts";

test("세션은 선택된 카드 순서와 첫 카드 위치에서 시작한다", () => {
  const session = createStudySession(
    "deck-1",
    "random",
    ["card-2", "card-1"],
    "2026-08-12T00:00:00.000Z",
    "session-1",
  );

  assert.equal(session.status, "active");
  assert.equal(session.selectionMode, "random");
  assert.deepEqual(session.plannedActivityIds, ["card-2", "card-1"]);
  assert.equal(session.plannedItemCount, session.plannedActivityIds.length);
  assert.equal(session.completedItemCount, 0);
  assert.equal(session.currentIndex, 0);
  assert.equal(session.endedAt, null);
});

test("세션 생성 후 카드 상태가 바뀌어도 계획된 카드 순서는 유지된다", () => {
  const plannedIds = ["card-5", "card-2", "card-4"];
  const session = createStudySession(
    "deck-1",
    "random",
    plannedIds,
    "2026-08-12T00:00:00.000Z",
    "session-1",
  );
  plannedIds.reverse();

  assert.deepEqual(session.plannedActivityIds, ["card-5", "card-2", "card-4"]);
});

test("카드별 attempt는 자기평가와 당시 new 여부를 보존한다", () => {
  const attempt = createStudyAttempt({
    id: "attempt-1",
    sessionId: "session-1",
    activityId: "card-1",
    learningUnitId: "LU-01",
    startedAt: "2026-08-12T00:00:00.000Z",
    answerRevealedAt: "2026-08-12T00:00:03.000Z",
    completedAt: "2026-08-12T00:00:05.000Z",
    selfRating: "review",
    wasNew: true,
  });

  assert.equal(attempt.activityType, "flashcard");
  assert.equal(attempt.selfRating, "review");
  assert.equal(attempt.wasNew, true);
  assert.equal(attempt.answerRevealedAt, "2026-08-12T00:00:03.000Z");
});

test("같은 카드를 다시 학습해도 별도 attempt로 남는다", () => {
  const shared = {
    sessionId: "session-1",
    activityId: "card-1",
    startedAt: "2026-08-12T00:00:00.000Z",
    answerRevealedAt: "2026-08-12T00:00:03.000Z",
    completedAt: "2026-08-12T00:00:05.000Z",
    wasNew: false,
  } as const;
  const first = createStudyAttempt({
    ...shared,
    id: "attempt-1",
    selfRating: "review",
  });
  const second = createStudyAttempt({
    ...shared,
    id: "attempt-2",
    selfRating: "known",
  });

  assert.equal(first.activityId, second.activityId);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(
    [first, second].map((attempt) => attempt.selfRating),
    ["review", "known"],
  );
});

test("마지막 카드가 완료되면 session이 completed가 된다", () => {
  const started = createStudySession(
    "deck-1",
    "all",
    ["card-1", "card-2"],
    "2026-08-12T00:00:00.000Z",
    "session-1",
  );
  const afterFirst = advanceStudySession(started, "2026-08-12T00:00:05.000Z");
  const completed = advanceStudySession(afterFirst, "2026-08-12T00:00:10.000Z");

  assert.equal(afterFirst.status, "active");
  assert.equal(afterFirst.completedItemCount, 1);
  assert.equal(afterFirst.currentIndex, 1);
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedItemCount, 2);
  assert.equal(completed.currentIndex, 2);
  assert.equal(completed.endedAt, "2026-08-12T00:00:10.000Z");
});

test("중간에 나간 active session은 진행량을 유지한 채 abandoned가 된다", () => {
  const started = createStudySession(
    "deck-1",
    "all",
    ["card-1", "card-2", "card-3"],
    "2026-08-12T00:00:00.000Z",
    "session-1",
  );
  const progressed = advanceStudySession(started, "2026-08-12T00:00:05.000Z");
  const abandoned = abandonStudySession(progressed, "2026-08-12T00:00:07.000Z");

  assert.equal(abandoned.status, "abandoned");
  assert.equal(abandoned.completedItemCount, 1);
  assert.equal(abandoned.currentIndex, 1);
  assert.equal(abandoned.endedAt, "2026-08-12T00:00:07.000Z");
});

test("가장 최근 active 세션을 덱별로 찾는다", () => {
  const older = createStudySession(
    "deck-1", "all", ["card-1"], "2026-08-12T00:00:00.000Z", "older",
  );
  const newer = createStudySession(
    "deck-1", "all", ["card-2"], "2026-08-12T01:00:00.000Z", "newer",
  );
  const otherDeck = createStudySession(
    "deck-2", "all", ["card-3"], "2026-08-12T02:00:00.000Z", "other",
  );
  assert.equal(findLatestActiveStudySession([older, otherDeck, newer], "deck-1")?.id, "newer");
});

test("저장된 시도로 진행 중 세션의 누적 수치와 오답 목록을 복원한다", () => {
  const session: StudySession = {
    ...createStudySession(
      "deck-1",
      "all",
      ["flash", "ox", "pending"],
      "2026-08-12T00:00:00.000Z",
      "session-1",
    ),
    completedItemCount: 2,
    currentIndex: 2,
  };
  const attempts: StudyAttempt[] = [
    {
      id: "attempt-1",
      sessionId: session.id,
      activityType: "flashcard",
      activityId: "flash",
      startedAt: session.startedAt,
      answerRevealedAt: "2026-08-12T00:00:01.000Z",
      completedAt: "2026-08-12T00:00:02.000Z",
      selfRating: "known",
      wasNew: true,
    },
    {
      id: "attempt-2",
      sessionId: session.id,
      activityType: "graded_problem",
      activityId: "ox",
      startedAt: "2026-08-12T00:00:02.000Z",
      completedAt: "2026-08-12T00:00:03.000Z",
      isCorrect: false,
      userAnswer: false,
      correctAnswer: true,
    },
    {
      id: "other-session-attempt",
      sessionId: "other",
      activityType: "graded_problem",
      activityId: "pending",
      startedAt: session.startedAt,
      completedAt: session.startedAt,
      isCorrect: false,
      userAnswer: false,
      correctAnswer: true,
    },
  ];

  assert.deepEqual(restoreStudySessionState(session, attempts), {
    studyIndex: 2,
    knownCount: 1,
    reviewCount: 1,
    reviewActivityIds: ["ox"],
  });
});
