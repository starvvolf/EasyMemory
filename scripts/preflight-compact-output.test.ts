import assert from "node:assert/strict";
import test from "node:test";

import {
  expandCompactCardDraft,
  hydrateGeneratedCardContent,
} from "../src/lib/pipeline/compact-card-output.ts";
import {
  assertActivityDesignReady,
  assertGenerationSelectionReady,
  assertLearningUnitsReady,
} from "../src/lib/pipeline/preflight.ts";
import type { LearningUnit } from "../src/lib/types.ts";

const unit = (id = "LU-1"): LearningUnit => ({
  id,
  sourceId: "source.pdf",
  sourcePage: 1,
  sourceRange: "section 1",
  sourceText: "source content",
  knowledgeType: "concept",
  fixedPart: "",
  variableSlots: [],
  generalizedForm: "concept content",
  intent: "개념을 구분한다.",
  rationale: "핵심 개념",
});

test("잘못된 학습단위를 네트워크 호출 전에 차단한다", () => {
  assert.throws(() => assertLearningUnitsReady({ learningUnits: [] }), /없습니다/);
  assert.throws(
    () => assertLearningUnitsReady({ learningUnits: [unit(), unit()] }),
    /중복된/,
  );
  assert.throws(
    () => assertLearningUnitsReady({ learningUnits: [unit(), unit("LU-2")], maxLearningUnitCount: 1 }),
    /안전선/,
  );
});

test("추천 수와 생성 대상의 지원 상태를 검사한다", () => {
  assert.throws(
    () => assertActivityDesignReady([unit()], { recommendations: [] }),
    /일치하지 않습니다/,
  );
  assert.throws(
    () =>
      assertGenerationSelectionReady({
        automatic: true,
        selections: [
          {
            learningUnitId: "LU-1",
            supportLevel: "partial",
            recommendedType: "flashcard",
            includeInGeneration: true,
          },
        ],
      }),
    /부분 지원/,
  );
  assert.throws(
    () =>
      assertGenerationSelectionReady({
        automatic: false,
        selections: [
          {
            learningUnitId: "LU-1",
            supportLevel: "unsupported",
            recommendedType: null,
            includeInGeneration: true,
          },
        ],
      }),
    /미지원/,
  );
  assert.throws(
    () =>
      assertGenerationSelectionReady({
        automatic: true,
        selections: [
          {
            learningUnitId: "LU-1",
            supportLevel: "unsupported",
            recommendedType: null,
            includeInGeneration: false,
          },
        ],
      }),
    /생성할 지원 학습내용이 없습니다/,
  );
  assert.doesNotThrow(() =>
    assertGenerationSelectionReady({
      automatic: false,
      selections: [
        {
          learningUnitId: "LU-1",
          supportLevel: "partial",
          recommendedType: "flashcard",
          includeInGeneration: true,
        },
      ],
    }),
  );
});

const common = {
  type: "flashcard" as const,
  front: "질문",
  recommendationReason: "이유",
  tags: ["tag"],
  basis: "근거",
  learningUnitId: "LU-1",
  strategy: "concept" as const,
  sourceId: "source.pdf",
  sourcePage: 1,
  sourceRange: "section",
  rationale: "이유",
  difficulty: 2,
};

test("네 가지 축소 출력이 기존 CardDraft 계약으로 확장된다", () => {
  const flashcard = expandCompactCardDraft({
    ...common,
    activityType: "flashcard",
    back: "정답",
  });
  const trueFalse = expandCompactCardDraft({
    ...common,
    activityType: "true_false",
    correctBoolean: true,
  });
  const multipleChoice = expandCompactCardDraft({
    ...common,
    activityType: "multiple_choice",
    options: ["오답", "정답", "오답2"],
    correctOptionIndex: 1,
  });
  const structure = expandCompactCardDraft({
    ...common,
    activityType: "structure_recall",
    structureRecallMode: "free_input",
    structureNodes: [
      { id: "n1", parentId: null, correctLabel: "시작" },
      { id: "n2", parentId: "n1", correctLabel: "중간" },
      { id: "n3", parentId: "n2", correctLabel: "끝" },
    ],
  });

  assert.equal(flashcard.back, "정답");
  assert.equal(trueFalse.back, "O");
  assert.equal(multipleChoice.back, "정답");
  assert.equal(structure.structureNodes.length, 3);
  assert.equal(structure.structureRecallMode, "free_input");
  for (const card of [flashcard, trueFalse, multipleChoice, structure]) {
    assert.deepEqual(card.qualityNotes, []);
    assert.equal(card.qualityPassed, false);
  }
});

test("AI가 다시 쓸 필요 없는 출처와 설계 메타데이터는 서버가 복원한다", () => {
  const card = hydrateGeneratedCardContent(
    {
      learningUnitId: "LU-1",
      activityType: "true_false",
      front: "DFS는 스택을 사용한다.",
      correctBoolean: true,
      basis: "DFS는 스택 자료구조를 이용한다.",
      strategy: "recognition",
      difficulty: 1,
      explanation: "원문의 설명과 일치한다.",
    },
    {
      analysis: {
        detectedGoal: "DFS를 이해한다.",
        sourceType: "concept",
        keyTopics: ["DFS", "그래프"],
        recommendedStrategy: "회상",
      },
      learningUnit: unit(),
      recommendation: {
        learningUnitId: "LU-1",
        objectiveId: "OBJ-1",
        blueprintId: "BP-1",
        supportLevel: "supported",
        recommendedType: "true_false",
        reason: "명확한 사실 판별",
        limitation: "",
        includeInGeneration: true,
      },
    },
  );
  assert.equal(card.sourceId, "source.pdf");
  assert.equal(card.objectiveId, "OBJ-1");
  assert.equal(card.blueprintId, "BP-1");
  assert.equal(card.recommendationReason, "명확한 사실 판별");
  assert.deepEqual(card.tags, ["DFS", "그래프"]);
  assert.equal(card.back, "O");
});
