import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cardsSchema,
  finalizeActivityDesignResult,
  materializeCards,
  validateDirectCardDrafts,
} from "../src/lib/pipeline/generate.ts";

const rawCards = JSON.parse(
  readFileSync("tools/api-generation-json/fixtures/dfs-bfs-cards-raw.json", "utf8"),
);
const rawPrepare = JSON.parse(
  readFileSync("tools/api-generation-json/fixtures/dfs-bfs-prepare-raw.json", "utf8"),
);

test("동결 DFS/BFS JSON 카드는 검증과 저장 변환 뒤 내용이 바뀌지 않는다", () => {
  const cards = cardsSchema.parse(rawCards).cards;
  validateDirectCardDrafts(cards, rawPrepare.learningUnits);

  const materialized = materializeCards(cards, "cloze");
  assert.equal(materialized.length, cards.length);
  materialized.forEach((card, index) => {
    for (const [key, value] of Object.entries(cards[index])) {
      assert.deepEqual(
        card[key as keyof typeof card],
        value,
        `${index + 1}번 카드의 ${key}가 materialize 과정에서 바뀌었습니다.`,
      );
    }
    assert.equal(card.status, "new");
    assert.ok(card.id);
  });
});

test("빈칸 수와 answers가 다르면 내용을 고치지 않고 거부한다", () => {
  const cards = cardsSchema.parse(rawCards).cards;
  const invalid = cards.map((card, index) =>
    index === 0 ? { ...card, answers: card.answers.slice(1) } : card,
  );
  assert.throws(
    () => validateDirectCardDrafts(invalid, rawPrepare.learningUnits),
    /구조화 카드 JSON 검증에 실패했습니다/,
  );
});

test("활동 설계의 목표 행동과 문제 형식은 자동 대체하지 않는다", () => {
  const unit = rawPrepare.learningUnits[0];
  const objective = {
    id: "objective-direct",
    outlineNodeId: unit.id,
    learningUnitId: unit.id,
    target: unit.target,
    terminalOperation: unit.operation,
    successCriteria: [{
      id: "criterion-direct",
      description: unit.successCriterion,
      required: true,
    }],
    importance: 3,
  };
  const blueprint = {
    id: "blueprint-direct",
    objectiveId: objective.id,
    learningUnitId: unit.id,
    relationToObjective: "direct",
    elicitedOperation: unit.operation,
    coverageCriterionIds: [objective.successCriteria[0].id],
    given: [{ type: "instruction", description: "그래프 구성 관계를 설명한다." }],
    hidden: [{ description: unit.target, reason: "target_answer" }],
    expectedResponse: { kind: "short_text", description: unit.target },
    scoringRubric: [{
      criterionId: objective.successCriteria[0].id,
      description: unit.successCriterion,
      weight: 1,
      gradingMode: "self",
    }],
    difficulty: {
      cueLevel: "medium",
      responseComplexity: "atomic",
      transferDistance: "same_context",
    },
    requiredCapabilities: [],
    recommendedType: "flashcard",
  };
  const result = finalizeActivityDesignResult(
    { objectives: [objective], blueprints: [blueprint] },
    [unit],
  );
  assert.deepEqual(result.objectives, [objective]);
  assert.deepEqual(result.blueprints, [blueprint]);

  assert.throws(
    () => finalizeActivityDesignResult({
      objectives: [{ ...objective, terminalOperation: "recall" }],
      blueprints: [blueprint],
    }, [unit]),
    /학습내용의 요구 행동이 문제 설계에서 바뀌었습니다/,
  );
});
