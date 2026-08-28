import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableStructureRecallChoices,
  getLearningActivityType,
  getStructureRecallMode,
  getStructureRecallChoices,
  gradeStudyAnswer,
  validateLearningActivity,
  validateLearningActivities,
} from "../src/lib/learning-activity.ts";
import type { Card } from "../src/lib/types.ts";

function card(patch: Partial<Card>): Card {
  return {
    id: "card-1",
    type: "flashcard",
    front: "문제",
    back: "정답",
    tags: [],
    status: "new",
    ...patch,
  };
}

test("기존 카드는 문제 종류가 없어도 플래시카드로 유지된다", () => {
  assert.equal(getLearningActivityType(card({})), "flashcard");
  assert.deepEqual(validateLearningActivity(card({})), []);
});

test("OX는 boolean 정답으로 자동 채점한다", () => {
  const activity = card({ activityType: "true_false", correctBoolean: true });
  assert.equal(gradeStudyAnswer(activity, true), true);
  assert.equal(gradeStudyAnswer(activity, false), false);
});

test("객관식은 정답 선택지 번호로 자동 채점한다", () => {
  const activity = card({
    activityType: "multiple_choice",
    options: ["스택", "큐", "힙"],
    correctOptionIndex: 1,
  });
  assert.deepEqual(validateLearningActivity(activity), []);
  assert.equal(gradeStudyAnswer(activity, 1), true);
  assert.equal(gradeStudyAnswer(activity, 0), false);
});

test("객관식은 빈 선택지를 허용하지 않는다", () => {
  const activity = card({
    activityType: "multiple_choice",
    options: ["스택", "   "],
    correctOptionIndex: 0,
  });
  assert.equal(validateLearningActivity(activity).length, 1);
});

test("같은 부모 아래의 구조복원 항목은 순서 없이 채점한다", () => {
  const activity = card({
    activityType: "structure_recall",
    structureNodes: [
      { id: "root", parentId: null, correctLabel: "탐색" },
      { id: "left", parentId: "root", correctLabel: "DFS" },
      { id: "right", parentId: "root", correctLabel: "BFS" },
    ],
  });
  assert.deepEqual(validateLearningActivity(activity), []);
  assert.equal(
    gradeStudyAnswer(activity, { root: "탐색", left: "DFS", right: "BFS" }),
    true,
  );
  assert.equal(
    gradeStudyAnswer(activity, { root: "탐색", left: "BFS", right: "DFS" }),
    true,
  );
});

test("부모와 자식으로 이어진 구조복원 흐름은 순서를 유지한다", () => {
  const activity = card({
    activityType: "structure_recall",
    structureNodes: [
      { id: "first", parentId: null, correctLabel: "요청" },
      { id: "second", parentId: "first", correctLabel: "할당" },
      { id: "third", parentId: "second", correctLabel: "반납" },
    ],
  });
  assert.equal(
    gradeStudyAnswer(activity, { first: "요청", second: "할당", third: "반납" }),
    true,
  );
  assert.equal(
    gradeStudyAnswer(activity, { first: "요청", second: "반납", third: "할당" }),
    false,
  );
});

test("기존 구조복원은 보기형으로 유지된다", () => {
  assert.equal(
    getStructureRecallMode(card({ activityType: "structure_recall" })),
    "word_bank",
  );
});

test("답 없는 빈칸형은 짧은 답을 직접 입력하고 공백·대소문자는 허용한다", () => {
  const activity = card({
    activityType: "structure_recall",
    structureRecallMode: "free_input",
    structureNodes: [
      { id: "root", parentId: null, correctLabel: "Request" },
      { id: "use", parentId: "root", correctLabel: "사용" },
    ],
  });
  assert.deepEqual(validateLearningActivity(activity), []);
  assert.equal(
    gradeStudyAnswer(activity, { root: "  request  ", use: "사용" }),
    true,
  );
});

test("답 없는 빈칸형도 같은 부모 아래 항목은 순서 없이 채점한다", () => {
  const activity = card({
    activityType: "structure_recall",
    structureRecallMode: "free_input",
    structureNodes: [
      { id: "root", parentId: null, correctLabel: "데드락 필요조건" },
      { id: "left", parentId: "root", correctLabel: "상호 배제" },
      { id: "right", parentId: "root", correctLabel: "비선점" },
    ],
  });
  assert.equal(
    gradeStudyAnswer(activity, {
      root: "데드락 필요조건",
      left: " 비선점 ",
      right: "상호 배제",
    }),
    true,
  );
});

test("답 없는 빈칸형은 긴 서술 답을 거부한다", () => {
  const activity = card({
    activityType: "structure_recall",
    structureRecallMode: "free_input",
    structureNodes: [
      { id: "root", parentId: null, correctLabel: "시작" },
      { id: "long", parentId: "root", correctLabel: "여러 표현으로 답할 수 있어서 자동 채점하기에 지나치게 긴 서술형 정답입니다" },
    ],
  });
  assert.match(validateLearningActivity(activity)[0], /짧고 한 가지/);
});

test("구조복원 선택지는 세션별로 안정적이며 정답 배열 순서를 노출하지 않는다", () => {
  const nodes = [
    { id: "root", parentId: null, correctLabel: "탐색" },
    { id: "left", parentId: "root", correctLabel: "DFS" },
    { id: "right", parentId: "root", correctLabel: "BFS" },
  ];
  const first = getStructureRecallChoices(nodes, "session-1", "card-1");
  const second = getStructureRecallChoices(nodes, "session-1", "card-1");
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, nodes.map((node) => node.correctLabel));
  assert.deepEqual([...first].sort(), ["BFS", "DFS", "탐색"].sort());
});

test("구조복원 선택지는 다른 자리에서 사용한 답을 제외하되 현재 답은 유지한다", () => {
  const choices = ["BFS", "탐색", "DFS"];
  assert.deepEqual(
    getAvailableStructureRecallChoices(
      choices,
      { root: "탐색", left: "DFS" },
      "left",
    ),
    ["BFS", "DFS"],
  );
});

test("구조복원은 여러 최상위 항목을 순서 없이 채점하고 순환 관계는 거부한다", () => {
  const multipleRoots = card({
    activityType: "structure_recall",
    structureNodes: [
      { id: "root-1", parentId: null, correctLabel: "A" },
      { id: "root-2", parentId: null, correctLabel: "B" },
    ],
  });
  const cyclic = card({
    activityType: "structure_recall",
    structureNodes: [
      { id: "root", parentId: null, correctLabel: "A" },
      { id: "left", parentId: "right", correctLabel: "B" },
      { id: "right", parentId: "left", correctLabel: "C" },
    ],
  });
  assert.deepEqual(validateLearningActivity(multipleRoots), []);
  assert.equal(
    gradeStudyAnswer(multipleRoots, { "root-1": "B", "root-2": "A" }),
    true,
  );
  assert.match(validateLearningActivity(cyclic)[0], /순환/);
});

test("저장 전 검사는 네 문제 형식의 정상 카드를 모두 통과시킨다", () => {
  const activities = [
    card({ id: "flashcard" }),
    card({ id: "true-false", activityType: "true_false", correctBoolean: false }),
    card({
      id: "multiple-choice",
      activityType: "multiple_choice",
      options: ["DFS", "BFS"],
      correctOptionIndex: 1,
    }),
    card({
      id: "structure-recall",
      activityType: "structure_recall",
      structureNodes: [
        { id: "root", parentId: null, correctLabel: "탐색" },
        { id: "child", parentId: "root", correctLabel: "BFS" },
      ],
    }),
  ];

  assert.deepEqual(validateLearningActivities(activities), {
    isValid: true,
    invalidCount: 0,
    firstInvalid: null,
  });
});

test("저장 전 검사는 형식별 오류를 세고 가장 앞선 오류 위치를 반환한다", () => {
  const activities = [
    card({ id: "valid-first" }),
    card({ id: "invalid-flashcard", back: "", answer: "" }),
    card({ id: "invalid-true-false", activityType: "true_false" }),
    card({
      id: "invalid-multiple-choice",
      activityType: "multiple_choice",
      options: ["같음", "같음"],
      correctOptionIndex: 0,
    }),
    card({
      id: "invalid-structure-recall",
      activityType: "structure_recall",
      structureNodes: [{ id: "only", parentId: null, correctLabel: "하나" }],
    }),
  ];

  assert.deepEqual(validateLearningActivities(activities), {
    isValid: false,
    invalidCount: 4,
    firstInvalid: {
      index: 1,
      cardId: "invalid-flashcard",
      issues: ["플래시카드 정답이 필요합니다."],
    },
  });
});
