import assert from "node:assert/strict";
import test from "node:test";

import { selectStudyActivityIds } from "../src/lib/study-selection.ts";
import type { Card, CardStatus } from "../src/lib/types.ts";

function card(id: string, status: CardStatus): Card {
  return {
    id,
    type: "flashcard",
    front: id,
    back: `${id}-back`,
    status,
  };
}

const cards = [
  card("card-1", "new"),
  card("card-2", "review"),
  card("card-3", "known"),
  card("card-4", "review"),
  card("card-5", "new"),
  card("card-6", "known"),
];

test("all은 기존 덱 순서의 모든 카드를 선택한다", () => {
  assert.deepEqual(selectStudyActivityIds(cards, "all"), cards.map(({ id }) => id));
});

test("random은 요청한 개수만 한 번 정한 순서로 반환한다", () => {
  const selected = selectStudyActivityIds(cards, "random", 5, () => 0.25);
  assert.equal(selected.length, 5);
  assert.equal(new Set(selected).size, 5);
  assert.ok(selected.every((id) => cards.some((card) => card.id === id)));
});

test("review_only는 review 카드만 기존 순서로 선택한다", () => {
  assert.deepEqual(selectStudyActivityIds(cards, "review_only"), [
    "card-2",
    "card-4",
  ]);
});

test("new_only는 new 카드만 기존 순서로 선택한다", () => {
  assert.deepEqual(selectStudyActivityIds(cards, "new_only"), [
    "card-1",
    "card-5",
  ]);
});

test("대상이 없는 모드는 빈 목록을 반환한다", () => {
  assert.deepEqual(
    selectStudyActivityIds([card("known", "known")], "review_only"),
    [],
  );
});
