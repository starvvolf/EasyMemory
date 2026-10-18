import assert from "node:assert/strict";
import test from "node:test";

import {
  applyActivityDesignSelections,
  assessBlueprintSupport,
  defaultGenerationPolicy,
  ensureMemorizationCoverage,
  recommendationFromBlueprint,
} from "../src/lib/practice-blueprint.ts";
import type { ActivityDesign, PracticeBlueprint } from "../src/lib/types.ts";

function blueprint(
  patch: Partial<PracticeBlueprint> = {},
): PracticeBlueprint {
  return {
    id: "BP-1",
    objectiveId: "OBJ-1",
    learningUnitId: "LU-1",
    relationToObjective: "direct",
    elicitedOperation: "recall",
    coverageCriterionIds: ["C-1"],
    given: [{ type: "instruction", description: "용어를 묻는다." }],
    hidden: [{ description: "정답 용어", reason: "target_answer" }],
    expectedResponse: { kind: "short_text", description: "짧은 용어" },
    scoringRubric: [{
      criterionId: "C-1",
      description: "정답 용어를 말한다.",
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
    ...patch,
  };
}

test("직접 회상 설계서는 플래시카드로 정확히 지원된다", () => {
  const assessment = assessBlueprintSupport(blueprint(), "flashcard");
  assert.equal(assessment.level, "exact");
  assert.equal(assessment.preservesOperation, true);
  assert.equal(
    recommendationFromBlueprint(
      blueprint(),
      assessment,
      defaultGenerationPolicy,
    ).includeInGeneration,
    true,
  );
});

test("새 입력에 적용한 답을 펼쳐 비교하는 플래시카드는 보조 적용 훈련으로 포함된다", () => {
  const applyBlueprint = blueprint({
    relationToObjective: "direct",
    elicitedOperation: "apply",
    given: [{ type: "data", description: "새로운 구체 입력" }],
    hidden: [{ description: "입력에 규칙을 적용한 답", reason: "required_inference" }],
    expectedResponse: { kind: "structured_text", description: "적용 결과와 근거" },
    scoringRubric: [{
      criterionId: "C-1",
      description: "모범 답과 비교한다.",
      weight: 1,
      gradingMode: "self",
    }],
    recommendedType: "flashcard",
  });
  const assessment = assessBlueprintSupport(applyBlueprint, "flashcard");
  assert.equal(assessment.preservesOperation, true);
  assert.equal(assessment.level, "scaffold");
  assert.equal(
    recommendationFromBlueprint(applyBlueprint, assessment).includeInGeneration,
    true,
  );
});

test("텍스트 격자의 숫자 답은 플래시카드 자기확인으로 보존한다", () => {
  const numericApply = blueprint({
    elicitedOperation: "apply",
    given: [{
      type: "data",
      description: "텍스트로 표현한 3×3 격자와 이동 조건",
    }],
    hidden: [{ description: "연결 영역 수", reason: "required_inference" }],
    expectedResponse: { kind: "numeric", description: "연결 영역 수" },
    scoringRubric: [{
      criterionId: "C-1",
      description: "정답 수와 비교한다.",
      weight: 1,
      gradingMode: "rule",
    }],
    requiredCapabilities: ["numeric", "graph_annotation"],
    recommendedType: "flashcard",
  });
  const assessment = assessBlueprintSupport(numericApply, "flashcard");
  assert.equal(assessment.level, "scaffold");
  assert.equal(assessment.preservesOperation, true);
  assert.deepEqual(assessment.missingCapabilities, []);
  assert.equal(
    recommendationFromBlueprint(numericApply, assessment).includeInGeneration,
    true,
  );
});

test("코드·음성·그래프 입력이 필요한 설계서는 현재 화면에서 미지원이다", () => {
  for (const capability of ["code", "audio", "graph_annotation"]) {
    const assessment = assessBlueprintSupport(
      blueprint({ requiredCapabilities: [capability] }),
      "flashcard",
    );
    assert.equal(assessment.level, "unsupported");
    assert.ok(assessment.missingCapabilities.includes(capability));
  }
});

test("사용자가 문제 형식을 바꾸면 지원 판정과 자동 포함 여부를 다시 계산한다", () => {
  const bp = blueprint();
  const exact = assessBlueprintSupport(bp, "flashcard");
  const design: ActivityDesign = {
    objectives: [{
      id: "OBJ-1",
      outlineNodeId: "outline-1",
      learningUnitId: "LU-1",
      target: "용어를 회상한다.",
      terminalOperation: "recall",
      successCriteria: [{ id: "C-1", description: "용어를 말한다.", required: true }],
      importance: 2,
    }],
    blueprints: [bp],
    supportAssessments: [exact],
    policy: defaultGenerationPolicy,
    recommendations: [recommendationFromBlueprint(bp, exact)],
  };

  const changed = applyActivityDesignSelections({
    design,
    selectedTypes: { "BP-1": "multiple_choice" },
    selectedIncludes: {},
    mode: "automatic",
  });
  assert.equal(changed.recommendations[0].recommendedType, "multiple_choice");
  assert.equal(changed.recommendations[0].assessmentLevel, "proxy");
  assert.equal(changed.recommendations[0].includeInGeneration, false);
});

test("보조 훈련은 자동 포함하지만 대체 연습은 자동 포함하지 않는다", () => {
  const scaffold = blueprint({ relationToObjective: "scaffold" });
  const proxy = blueprint({ relationToObjective: "proxy" });
  const scaffoldAssessment = assessBlueprintSupport(scaffold, "flashcard");
  const proxyAssessment = assessBlueprintSupport(proxy, "flashcard");
  assert.equal(scaffoldAssessment.level, "scaffold");
  assert.equal(proxyAssessment.level, "proxy");
  assert.equal(recommendationFromBlueprint(scaffold, scaffoldAssessment).includeInGeneration, true);
  assert.equal(recommendationFromBlueprint(proxy, proxyAssessment).includeInGeneration, false);
});

test("현재 형식으로 남지 못한 필수 기준은 플래시카드 통암기로 보충한다", () => {
  const unsupported = blueprint({
    requiredCapabilities: ["audio"],
    elicitedOperation: "apply",
    expectedResponse: { kind: "audio", description: "직접 말한 답변" },
  });
  const result = ensureMemorizationCoverage(
    [{
      id: "OBJ-1",
      outlineNodeId: "outline-1",
      learningUnitId: "LU-1",
      target: "새 정보로 답변을 직접 말한다.",
      terminalOperation: "apply",
      successCriteria: [{
        id: "C-1",
        description: "핵심 문장 패턴과 적용 순서를 정확히 사용한다.",
        required: true,
      }],
      importance: 3,
    }],
    [unsupported],
  );

  assert.equal(result.length, 1);
  const fallback = result[0];
  assert.equal(fallback.recommendedType, "flashcard");
  assert.equal(fallback.relationToObjective, "scaffold");
  assert.deepEqual(fallback.coverageCriterionIds, ["C-1"]);
  assert.equal(
    recommendationFromBlueprint(
      fallback,
      assessBlueprintSupport(fallback, fallback.recommendedType),
    ).includeInGeneration,
    true,
  );
});

test("이미 문제에 포함되는 필수 기준은 통암기 카드를 중복 추가하지 않는다", () => {
  const result = ensureMemorizationCoverage(
    [{
      id: "OBJ-1",
      outlineNodeId: "outline-1",
      learningUnitId: "LU-1",
      target: "용어를 회상한다.",
      terminalOperation: "recall",
      successCriteria: [{ id: "C-1", description: "용어를 말한다.", required: true }],
      importance: 2,
    }],
    [blueprint()],
  );
  assert.equal(result.length, 1);
});
