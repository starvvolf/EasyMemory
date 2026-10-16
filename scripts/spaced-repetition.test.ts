import assert from "node:assert/strict";
import test from "node:test";
import type { Card } from "../src/lib/types.ts";
import {
  getRetrievability,
  isReviewDue,
  scheduleNextReview,
} from "../src/lib/spaced-repetition.ts";
import { selectStudyActivityIds } from "../src/lib/study-selection.ts";

const reviewedAt = new Date("2026-08-15T00:00:00.000Z");

test("첫 학습 결과를 FSRS 상태와 다음 복습일로 저장한다", () => {
  const remembered = scheduleNextReview(undefined, true, reviewedAt);
  const forgotten = scheduleNextReview(undefined, false, reviewedAt);

  assert.equal(remembered.algorithm, "fsrs");
  assert.equal(remembered.repetitions, 1);
  assert.equal(remembered.lastReviewAt, reviewedAt.toISOString());
  assert.ok(remembered.stability > 0);
  assert.ok(remembered.difficulty > 0);
  assert.ok(new Date(remembered.dueAt) > reviewedAt);
  assert.ok(new Date(forgotten.dueAt) < new Date(remembered.dueAt));
});

test("같은 문제를 다시 맞히면 기존 기록을 이어서 갱신한다", () => {
  const first = scheduleNextReview(undefined, true, reviewedAt);
  const secondReviewAt = new Date(first.dueAt);
  const second = scheduleNextReview(first, true, secondReviewAt);

  assert.equal(second.repetitions, 2);
  assert.equal(second.lastReviewAt, secondReviewAt.toISOString());
  assert.ok(new Date(second.dueAt) > secondReviewAt);
  assert.ok(second.stability >= first.stability);
});

test("기억 가능성은 마지막 복습 이후 시간이 지날수록 낮아진다", () => {
  const schedule = scheduleNextReview(undefined, true, reviewedAt);
  const shortlyAfter = getRetrievability(
    schedule,
    new Date("2026-08-15T00:01:00.000Z"),
  );
  const muchLater = getRetrievability(
    schedule,
    new Date("2026-08-20T00:00:00.000Z"),
  );

  assert.notEqual(shortlyAfter, null);
  assert.notEqual(muchLater, null);
  assert.ok(shortlyAfter! > muchLater!);
});

test("오늘 복습은 예정 시간이 지난 카드만 선택한다", () => {
  const dueSchedule = scheduleNextReview(undefined, false, reviewedAt);
  const futureSchedule = scheduleNextReview(undefined, true, reviewedAt);
  const cards = [
    makeCard("due", dueSchedule),
    makeCard("future", futureSchedule),
    makeCard("legacy"),
  ];
  const now = new Date("2026-08-15T00:02:00.000Z");

  assert.equal(isReviewDue(cards[0], now), true);
  assert.equal(isReviewDue(cards[1], now), false);
  assert.deepEqual(
    selectStudyActivityIds(cards, "due", undefined, Math.random, now),
    ["due"],
  );
});

function makeCard(
  id: string,
  reviewSchedule?: Card["reviewSchedule"],
): Card {
  return {
    id,
    type: "flashcard",
    front: id,
    back: id,
    tags: [],
    status: "known",
    reviewSchedule,
  };
}
