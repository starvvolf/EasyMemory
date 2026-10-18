import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompactActivityDesignInput,
  createCompactCardGenerationInput,
  finalLearningContent,
} from "../src/lib/pipeline/compact-input.ts";
import type { AnalysisResult, LearningUnit } from "../src/lib/types.ts";

const unit: LearningUnit = {
  id: "LU-1",
  sourceId: "opic.pdf",
  sourcePage: 1,
  sourceRange: "Pattern 5",
  sourceText: "I first got to know him when I went to my first class.",
  knowledgeType: "speaking_pattern",
  fixedPart: "I first got to know [person] when [situation].",
  variableSlots: [
    { name: "person", example: "him" },
    { name: "situation", example: "I went to my first class" },
  ],
  generalizedForm: "I first got to know [사람] when [상황].",
  target: "경험을 설명할 때 처음 알게 된 계기를 말하는 문장 패턴",
  operation: "apply",
  successCriterion: "새로운 인물과 상황을 넣어 문장을 직접 완성한다.",
  rationale: "여러 인물 주제에서 재사용된다.",
  reviewedText: "I first got to know [사람] when [상황].",
};

const analysis: AnalysisResult = {
  detectedGoal: "인물 묘사 패턴을 직접 말한다.",
  sourceType: "script",
  keyTopics: ["인물 묘사"],
  recommendedStrategy: "의도에서 표현을 생성",
  learningUnits: [unit],
};

test("검토한 최종 내용을 원문보다 우선한다", () => {
  assert.equal(finalLearningContent(unit), unit.reviewedText);
});

test("원문 유지 모드는 일반화 문장 대신 실제 원문을 문제 입력으로 보낸다", () => {
  const activityInput = createCompactActivityDesignInput(
    analysis,
    [unit],
    "preserve",
  );
  assert.equal(activityInput.units[0].finalContent, unit.sourceText);

  const cardInput = createCompactCardGenerationInput(
    analysis,
    [unit],
    {
      recommendations: [
        {
          learningUnitId: unit.id,
          supportLevel: "supported",
          recommendedType: "flashcard",
          reason: "원문 회상",
          limitation: "",
          includeInGeneration: true,
        },
      ],
    },
    "preserve",
  );
  assert.equal(cardInput.units[0].finalContent, unit.sourceText);
  assert.equal(cardInput.units[0].finalContent.includes("[사람]"), false);
});

test("문제 추천 입력에는 학습 대상·주 행동·성공 기준을 남기고 지식 유형을 제외한다", () => {
  const compact = createCompactActivityDesignInput(analysis, [unit]);
  assert.deepEqual(Object.keys(compact.units[0]), [
    "learningUnitId",
    "target",
    "operation",
    "successCriterion",
    "finalContent",
    "pageRefs",
  ]);
  assert.deepEqual(compact.sourcePages, []);
  assert.equal(compact.units[0].operation, "apply");
  assert.match(compact.units[0].successCriterion, /직접 완성/);
  assert.match(compact.units[0].finalContent, /\[사람\]/);
  assert.equal(JSON.stringify(compact).includes("knowledgeType"), false);
  assert.equal(JSON.stringify(compact).includes("rationale"), false);
});

test("과거 intent만 있는 학습단위도 문제 추천 입력으로 읽는다", () => {
  const legacyUnit: LearningUnit = {
    ...unit,
    target: undefined,
    operation: undefined,
    successCriterion: undefined,
    intent: "과거 학습 의도",
  };
  const compact = createCompactActivityDesignInput(analysis, [legacyUnit]);
  assert.equal(compact.units[0].target, "과거 학습 의도");
  assert.equal(compact.units[0].operation, null);
  assert.equal(compact.units[0].successCriterion, "과거 학습 의도");
});

test("문제 생성 입력에는 AI 판단에 필요한 최종 내용과 방식만 보존한다", () => {
  const compact = createCompactCardGenerationInput(analysis, [unit], {
    recommendations: [
      {
        learningUnitId: "LU-1",
        supportLevel: "supported",
        recommendedType: "flashcard",
        reason: "의도에서 표현을 직접 떠올린다.",
        limitation: "",
        includeInGeneration: true,
      },
    ],
  });
  assert.equal(compact.units[0].activityType, "flashcard");
  assert.match(compact.units[0].finalContent, /\[상황\]/);
  assert.deepEqual(compact.units[0].pageRefs, []);
  assert.equal("sourcePage" in compact.units[0], false);
  assert.equal("recommendationReason" in compact.units[0], false);
});

test("같은 원문 페이지는 공통 컨텍스트에 한 번만 두고 학습 단위는 참조한다", () => {
  const pageText = "PATTERN #1부터 #3까지의 원문과 예문 ".repeat(80);
  const units = Array.from({ length: 4 }, (_, index): LearningUnit => ({
    ...unit,
    id: `LU-${index + 1}`,
    target: `패턴 ${index + 1}을 직접 말한다`,
    successCriterion: `패턴 ${index + 1}을 정확히 말한다`,
    reviewedText: [
      `목차: 패턴 ${index + 1}`,
      `원문 근거 요약: 패턴 ${index + 1}의 말하기 표현`,
      `해당 원문 페이지 1: ${pageText}`,
    ].join("\n"),
  }));
  const legacyPayload = {
    learningGoal: analysis.detectedGoal,
    units: units.map((item) => ({
      learningUnitId: item.id,
      target: item.target,
      operation: item.operation,
      successCriterion: item.successCriterion,
      finalContent: item.reviewedText,
    })),
  };
  const compact = createCompactActivityDesignInput(
    { ...analysis, learningUnits: units },
    units,
  );

  assert.equal(compact.sourcePages.length, 1);
  assert.equal(compact.sourcePages[0].text, pageText.trim());
  assert.ok(compact.units.every((item) => item.pageRefs[0] === "opic.pdf#page-1"));
  assert.ok(compact.units.every((item) => !item.finalContent.includes(pageText)));
  assert.ok(
    Buffer.byteLength(JSON.stringify(compact), "utf8") <
      Buffer.byteLength(JSON.stringify(legacyPayload), "utf8") * 0.6,
  );
});

test("같은 페이지 번호의 원문이 충돌하면 안전하게 단위 안에 보존한다", () => {
  const units = ["첫 번째 원문", "서로 다른 두 번째 원문"].map(
    (text, index): LearningUnit => ({
      ...unit,
      id: `conflict-${index + 1}`,
      reviewedText: `근거 요약\n해당 원문 페이지 1: ${text}`,
    }),
  );
  const compact = createCompactActivityDesignInput(analysis, units);
  assert.deepEqual(compact.sourcePages, []);
  assert.ok(compact.units[0].finalContent.includes("첫 번째 원문"));
  assert.ok(compact.units[1].finalContent.includes("두 번째 원문"));
});
