import assert from "node:assert/strict";
import test from "node:test";

import {
  materializeCards,
  runActivityDesign,
  runCardGeneration,
  validateBlueprintItem,
  type CardDraft,
} from "../src/lib/pipeline/generate.ts";
import type { AnalysisResult, Card, OrganizedMaterial, PracticeBlueprint } from "../src/lib/types.ts";

const analysis: AnalysisResult = {
  detectedGoal: "탐색 방법을 구분한다.",
  sourceType: "concept",
  keyTopics: ["DFS", "BFS"],
  recommendedStrategy: "비교와 구조 복원",
  primaryKnowledgeType: "relationship",
  learningUnits: [
    {
      id: "LU-1",
      sourceId: "sample.pdf",
      sourcePage: 1,
      sourceRange: "DFS",
      sourceText: "DFS는 스택을 사용한다.",
      knowledgeType: "fact",
      fixedPart: "",
      variableSlots: [],
      generalizedForm: "",
      target: "DFS가 사용하는 핵심 자료구조",
      operation: "recall",
      successCriterion: "자료 없이 DFS의 핵심 자료구조를 말한다.",
      rationale: "핵심 사실",
    },
    {
      id: "LU-2",
      sourceId: "sample.pdf",
      sourcePage: 2,
      sourceRange: "탐색 구조",
      sourceText: "그래프 탐색은 DFS와 BFS로 나뉜다.",
      knowledgeType: "relationship",
      fixedPart: "",
      variableSlots: [],
      generalizedForm: "",
      target: "DFS와 BFS가 이루는 그래프 탐색의 분류 구조",
      operation: "reconstruct",
      successCriterion: "그래프 탐색 아래에 DFS와 BFS를 올바르게 배치한다.",
      rationale: "세 요소의 상하 관계",
    },
  ],
};

const material: OrganizedMaterial = {
  title: "탐색",
  sections: [
    { heading: "DFS", content: "DFS는 스택을 사용한다.", learningUnitIds: ["LU-1"] },
    { heading: "구조", content: "그래프 탐색은 DFS와 BFS로 나뉜다.", learningUnitIds: ["LU-2"] },
  ],
};

function responseJson(output: unknown) {
  return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("AI는 LearningUnit마다 학습목표와 문제 설계서를 하나씩 만든다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({
      objectives: [
        {
          id: "OBJ-1",
          outlineNodeId: "LU-1",
          learningUnitId: "LU-1",
          target: "DFS가 사용하는 핵심 자료구조를 말한다.",
          terminalOperation: "apply",
          successCriteria: [{ id: "C-1", description: "스택이라고 말한다.", required: true }],
          importance: 2,
        },
        {
          id: "OBJ-2",
          outlineNodeId: "LU-2",
          learningUnitId: "LU-2",
          target: "그래프 탐색의 분류 구조를 복원한다.",
          terminalOperation: "reconstruct",
          successCriteria: [{ id: "C-2", description: "DFS와 BFS를 배치한다.", required: true }],
          importance: 2,
        },
      ],
      blueprints: [
        {
          id: "BP-1", objectiveId: "OBJ-1", learningUnitId: "LU-1",
          relationToObjective: "direct", elicitedOperation: "reconstruct",
          coverageCriterionIds: ["C-1"],
          given: [{ type: "instruction", description: "자료구조를 묻는다." }],
          hidden: [{ description: "스택", reason: "target_answer" }],
          expectedResponse: { kind: "structured_text", description: "스택" },
          scoringRubric: [{ criterionId: "C-1", description: "스택", weight: 1, gradingMode: "self" }],
          difficulty: { cueLevel: "medium", responseComplexity: "atomic", transferDistance: "same_context" },
          requiredCapabilities: [], recommendedType: "flashcard",
        },
        {
          id: "BP-2", objectiveId: "OBJ-2", learningUnitId: "LU-2",
          relationToObjective: "direct", elicitedOperation: "reconstruct",
          coverageCriterionIds: ["C-2"],
          given: [{ type: "instruction", description: "분류 틀을 제시한다." }],
          hidden: [{ description: "DFS와 BFS", reason: "target_answer" }],
          expectedResponse: { kind: "unordered_structure", description: "DFS와 BFS 배치" },
          scoringRubric: [{ criterionId: "C-2", description: "두 항목 배치", weight: 1, gradingMode: "exact" }],
          difficulty: { cueLevel: "medium", responseComplexity: "multi_part", transferDistance: "same_context" },
          requiredCapabilities: [], recommendedType: "structure_recall",
        },
      ],
    });
  };
  try {
    const result = await runActivityDesign(analysis, material, {
      instruction: "문제 만들기 방향:\n새로운 상황에서 판단하는 문제를 우선한다.",
    });
    assert.deepEqual(result.recommendations.map((item) => item.learningUnitId), ["LU-1", "LU-2"]);
    assert.equal(result.recommendations.every((item) => item.includeInGeneration), true);
    assert.equal(result.blueprints?.[0].recommendedType, "flashcard");
    assert.equal(result.blueprints?.[0].elicitedOperation, "reconstruct");
    assert.equal(result.blueprints?.[0].relationToObjective, "scaffold");
    assert.equal(result.objectives?.[0].terminalOperation, "recall");
    assert.deepEqual(result.blueprints?.[0].requiredCapabilities, []);
    assert.equal(result.supportAssessments, undefined);
    assert.equal(result.policy, undefined);
    const body = requestBody as {
      input: Array<{ content: string }>;
      text: {
        format: {
          schema: {
            properties: {
              objectives: {
                minItems: number;
                maxItems: number;
                items: {
                  properties: { successCriteria: { maxItems: number } };
                };
              };
              blueprints: {
                minItems: number;
                maxItems: number;
                items: {
                  properties: {
                    coverageCriterionIds: { maxItems: number };
                    scoringRubric: { maxItems: number };
                  };
                };
              };
            };
          };
        };
      };
    };
    const prompt = body.input[1].content;
    assert.match(prompt, /given에는 학생에게 보여줄 완성된 입력/);
    assert.match(prompt, /LearningUnit마다 LearningObjective 하나와 PracticeBlueprint 하나/);
    assert.match(prompt, /다시 쪼개거나 합치지 않습니다/);
    assert.match(prompt, /관련은 있지만 숙련 증거가 아니면 proxy/);
    assert.match(prompt, /단서를 보고 답을 먼저 떠올린 뒤 뒷면과 자기 확인/);
    assert.match(prompt, /사용자 문제 방향/);
    assert.match(prompt, /설명에만 반복하지 않습니다/);
    assert.match(prompt, /successCriteria와 scoringRubric은 각각 하나/);
    assert.match(prompt, /실제로 풀 수 있는 구체 입력 하나/);
    assert.match(prompt, /한 설계에는 하나의 구체 사례와 하나의 정답/);
    assert.match(prompt, /텍스트로 제시한 숫자·간선·격자는 별도 기능이 아닙니다/);
    assert.match(prompt, /먼저 수행한 뒤 back과 비교하는 flashcard scaffold/);
    assert.match(prompt, /풀어 확정한 target_answer/);
    assert.match(prompt, /numeric 응답이면 실제 숫자 정답/);
    assert.match(prompt, /"operation": "recall"/);
    assert.doesNotMatch(prompt, /"knowledgeType"/);
    assert.equal(body.text.format.schema.properties.objectives.minItems, 2);
    assert.equal(body.text.format.schema.properties.objectives.maxItems, 2);
    assert.equal(
      body.text.format.schema.properties.objectives.items.properties.successCriteria.maxItems,
      1,
    );
    assert.equal(body.text.format.schema.properties.blueprints.minItems, 2);
    assert.equal(body.text.format.schema.properties.blueprints.maxItems, 2);
    assert.equal(
      body.text.format.schema.properties.blueprints.items.properties.coverageCriterionIds.maxItems,
      1,
    );
    assert.equal(
      body.text.format.schema.properties.blueprints.items.properties.scoringRubric.maxItems,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("숫자 문제는 설계 단계에서 실제 정답 숫자를 확정해야 한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseJson({
    objectives: [{
      id: "OBJ-N",
      outlineNodeId: "LU-1",
      learningUnitId: "LU-1",
      target: "새 격자의 연결 영역 수를 구한다.",
      terminalOperation: "recall",
      successCriteria: [{ id: "C-N", description: "영역 수를 구한다.", required: true }],
      importance: 3,
    }],
    blueprints: [{
      id: "BP-N",
      objectiveId: "OBJ-N",
      learningUnitId: "LU-1",
      relationToObjective: "direct",
      elicitedOperation: "recall",
      coverageCriterionIds: ["C-N"],
      given: [{ type: "data", description: "3×3 텍스트 격자" }],
      hidden: [{ description: "연결 영역의 개수", reason: "target_answer" }],
      expectedResponse: { kind: "numeric", description: "영역 수" },
      scoringRubric: [{
        criterionId: "C-N",
        description: "정답 숫자와 비교한다.",
        weight: 1,
        gradingMode: "self",
      }],
      difficulty: {
        cueLevel: "medium",
        responseComplexity: "atomic",
        transferDistance: "near_transfer",
      },
      requiredCapabilities: [],
      recommendedType: "flashcard",
    }],
  });
  try {
    await assert.rejects(
      () => runActivityDesign(
        { ...analysis, learningUnits: analysis.learningUnits?.slice(0, 1) },
        { ...material, sections: material.sections.slice(0, 1) },
      ),
      /숫자 문제 설계서에는 아라비아 숫자로 확정한 정답/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("생성 초안의 자동 채점 필드를 저장용 문제로 보존한다", () => {
  const draft: CardDraft = {
    type: "flashcard",
    activityType: "multiple_choice",
    front: "BFS가 사용하는 자료구조는?",
    back: "큐",
    clozeText: "",
    answer: "",
    answers: [],
    options: ["스택", "큐", "힙"],
    correctOptionIndex: 1,
    correctBoolean: false,
    structureNodes: [],
    recommendationReason: "여러 자료구조 중 구분",
    hint: "",
    tags: [],
    basis: "BFS는 큐를 사용한다.",
    learningUnitId: "LU-1",
    strategy: "recognition",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "BFS",
    rationale: "자료구조 선택",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    explanation: "DFS는 스택을 사용한다.",
  };
  const [result] = materializeCards([draft], "flashcard");
  assert.equal(result.activityType, "multiple_choice");
  assert.deepEqual(result.options, ["스택", "큐", "힙"]);
  assert.equal(result.correctOptionIndex, 1);
  assert.equal(result.recommendationReason, "여러 자료구조 중 구분");
});

test("보기형 구조복원은 문제 문장에서 답 목록을 제거하고 개별 정답만 보존한다", () => {
  const draft: CardDraft = {
    type: "flashcard",
    activityType: "structure_recall",
    front: "답변 순서를 완성하세요.\n\n보기: 소개 / 외모 / 계기 / 평가",
    back: "",
    clozeText: "",
    answer: "",
    answers: [],
    options: [],
    correctOptionIndex: 0,
    correctBoolean: false,
    structureNodes: [
      { id: "n1", parentId: null, correctLabel: "소개" },
      { id: "n2", parentId: "n1", correctLabel: "외모" },
      { id: "n3", parentId: "n2", correctLabel: "계기" },
      { id: "n4", parentId: "n3", correctLabel: "평가" },
    ],
    structureRecallMode: "word_bank",
    recommendationReason: "순서 복원",
    hint: "",
    tags: [],
    basis: "소개, 외모, 계기, 평가 순서",
    learningUnitId: "LU-structure",
    strategy: "procedure",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "답변 순서",
    rationale: "순서 복원",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    explanation: "DFS는 스택을 사용한다.",
  };
  const [card] = materializeCards([draft], "flashcard");
  assert.equal(card.front, "답변 순서를 완성하세요.");
  assert.deepEqual(
    card.structureNodes?.map((node) => node.correctLabel),
    ["소개", "외모", "계기", "평가"],
  );
});

test("품질 문턱은 정답 노출과 잘못된 원문 연결을 차단한다", () => {
  const unit = analysis.learningUnits![0];
  const blueprint: PracticeBlueprint = {
    id: "BP-quality",
    objectiveId: "OBJ-quality",
    learningUnitId: unit.id,
    relationToObjective: "direct",
    elicitedOperation: "recall",
    coverageCriterionIds: ["C-quality"],
    given: [{ type: "instruction", description: "자료구조를 묻는다." }],
    hidden: [{ description: "스택", reason: "target_answer" }],
    expectedResponse: { kind: "short_text", description: "스택" },
    scoringRubric: [{ criterionId: "C-quality", description: "스택", weight: 1, gradingMode: "self" }],
    difficulty: { cueLevel: "medium", responseComplexity: "atomic", transferDistance: "same_context" },
    requiredCapabilities: [],
    recommendedType: "flashcard",
  };
  const card: Card = {
    id: "card-quality",
    type: "flashcard",
    activityType: "flashcard",
    front: "DFS가 사용하는 스택은 무엇인가?",
    back: "스택",
    tags: [],
    status: "new",
    basis: "원문에 없는 근거",
    explanation: "설명",
    learningUnitId: unit.id,
    objectiveId: blueprint.objectiveId,
    blueprintId: blueprint.id,
    sourceId: "wrong-source.pdf",
    sourcePage: unit.sourcePage,
    sourceRange: unit.sourceRange,
  };
  const issues = validateBlueprintItem(card, blueprint, unit);
  assert.ok(issues.some((issue) => issue.includes("정답이 그대로 노출")));
  assert.ok(issues.some((issue) => issue.includes("출처 연결")));
});

test("새 문제 생성은 기존 Recall 카드 규칙과 분리된 전용 프롬프트를 쓴다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  const draft: CardDraft = {
    type: "flashcard",
    activityType: "true_false",
    front: "DFS는 스택을 사용한다.",
    back: "O",
    clozeText: "",
    answer: "",
    answers: [],
    options: [],
    correctOptionIndex: 0,
    correctBoolean: true,
    structureNodes: [],
    recommendationReason: "명확한 사실 판별",
    hint: "",
    tags: ["DFS"],
    basis: "DFS는 스택 자료구조를 이용한다.",
    learningUnitId: "LU-1",
    strategy: "recognition",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "DFS",
    rationale: "자료구조 판별",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    explanation: "DFS는 스택을 사용한다.",
  };
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({ cards: [draft] });
  };
  try {
    const oneUnitAnalysis = { ...analysis, learningUnits: analysis.learningUnits?.slice(0, 1) };
    const oneUnitMaterial = { ...material, sections: material.sections.slice(0, 1) };
    const activityDesign = {
      recommendations: [
        {
          learningUnitId: "LU-1",
          supportLevel: "supported" as const,
          recommendedType: "true_false" as const,
          reason: "명확한 사실 판별",
          limitation: "",
          includeInGeneration: true,
        },
      ],
    };
    const result = await runCardGeneration(
      "flashcard",
      oneUnitMaterial,
      oneUnitAnalysis,
      "문제 만들기 방향:\n암기보다 판단 문제를 우선한다.",
      JSON.stringify({ countPolicy: "soft_budget", learningUnitSoftBudget: { max: 1 } }),
      "",
      "",
      "",
      JSON.stringify(activityDesign),
    );
    assert.equal(result.cards[0].activityType, "true_false");
    const body = requestBody as { input: Array<{ content: string }> };
    const prompt = body.input[1].content;
    assert.match(prompt, /LearningUnit마다 문제 하나/);
    assert.match(prompt, /explanation은 정답 이유를 짧게/);
    assert.match(prompt, /structureRecallMode/);
    assert.match(prompt, /word_bank/);
    assert.match(prompt, /free_input/);
    assert.match(prompt, /형제 노드는 순서 없는/);
    assert.match(prompt, /한 카드에는 한 종류의 관계/);
    assert.match(prompt, /암기보다 판단 문제를 우선한다/);
    assert.match(prompt, /지시 문구를 front에 복사하지 않습니다/);
    assert.doesNotMatch(prompt, /CardContract/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("자동 흐름은 부분 지원 항목을 호출 전에 제외하고 지원 항목만 생성한다", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPrompt = "";
  const draft: CardDraft = {
    type: "flashcard",
    activityType: "true_false",
    front: "DFS는 스택을 사용한다.",
    back: "O",
    clozeText: "",
    answer: "",
    answers: [],
    options: [],
    correctOptionIndex: 0,
    correctBoolean: true,
    structureNodes: [],
    recommendationReason: "명확한 사실 판별",
    hint: "",
    tags: ["DFS"],
    basis: "DFS는 스택을 사용한다.",
    learningUnitId: "LU-1",
    strategy: "recognition",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "DFS",
    rationale: "자료구조 판별",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    explanation: "DFS는 스택을 사용한다.",
  };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: Array<{ content: string }> };
    requestedPrompt = body.input[1].content;
    return responseJson({ cards: [draft] });
  };
  try {
    const activityDesign = {
      recommendations: [
        {
          learningUnitId: "LU-1",
          supportLevel: "supported" as const,
          recommendedType: "true_false" as const,
          reason: "명확한 사실 판별",
          limitation: "",
          includeInGeneration: true,
        },
        {
          learningUnitId: "LU-2",
          supportLevel: "partial" as const,
          recommendedType: "structure_recall" as const,
          reason: "구조의 일부만 복원",
          limitation: "실제 탐색 수행은 훈련하지 못함",
          includeInGeneration: false,
        },
      ],
    };
    const result = await runCardGeneration(
      "flashcard",
      material,
      analysis,
      "",
      JSON.stringify({ countPolicy: "soft_budget", learningUnitSoftBudget: { max: 2 } }),
      "",
      "",
      "",
      JSON.stringify(activityDesign),
      { activitySelectionMode: "automatic" },
    );
    assert.deepEqual(result.cards.map((card) => card.learningUnitId), ["LU-1"]);
    assert.match(requestedPrompt, /"learningUnitId": "LU-1"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("생성 대상으로 남은 항목이 없으면 OpenAI 호출 전에 중단한다", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("호출되면 안 됩니다.");
  };
  try {
    const oneUnitAnalysis = { ...analysis, learningUnits: analysis.learningUnits?.slice(0, 1) };
    const oneUnitMaterial = { ...material, sections: material.sections.slice(0, 1) };
    await assert.rejects(
      () =>
        runCardGeneration(
          "flashcard",
          oneUnitMaterial,
          oneUnitAnalysis,
          "",
          JSON.stringify({ countPolicy: "soft_budget", learningUnitSoftBudget: { max: 1 } }),
          "",
          "",
          "",
          JSON.stringify({
            recommendations: [
              {
                learningUnitId: "LU-1",
                supportLevel: "unsupported",
                recommendedType: null,
                reason: "현재 형식으로 직접 훈련 불가",
                limitation: "수행형 채점이 필요함",
                includeInGeneration: false,
              },
            ],
          }),
        ),
      /생성할 지원 학습내용이 없습니다/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("하나의 LearningUnit에 문제 설계서가 둘이면 생성 전에 차단한다", async () => {
  const originalFetch = globalThis.fetch;
  const oneUnitAnalysis = {
    ...analysis,
    learningUnits: analysis.learningUnits?.slice(0, 1).map((unit) => ({
      ...unit,
      sourceText: "DFS는 스택을 사용해 한 경로를 끝까지 탐색한 뒤 되돌아간다.",
    })),
  };
  const oneUnitMaterial = {
    ...material,
    sections: material.sections.slice(0, 1).map((section) => ({
      ...section,
      content: "DFS는 스택을 사용해 한 경로를 끝까지 탐색한 뒤 되돌아간다.",
    })),
  };
  const objective = {
    id: "OBJ-1",
    outlineNodeId: "LU-1",
    learningUnitId: "LU-1",
    target: "DFS의 자료구조와 사용 이유를 회상한다.",
    terminalOperation: "recall" as const,
    successCriteria: [
      { id: "C-1", description: "스택과 깊이 우선 진행의 관계를 말한다.", required: true },
    ],
    importance: 2 as const,
  };
  const blueprint = (id: string, criterionId: string, answer: string) => ({
    id,
    objectiveId: "OBJ-1",
    learningUnitId: "LU-1",
    relationToObjective: "direct" as const,
    elicitedOperation: "recall" as const,
    coverageCriterionIds: [criterionId],
    given: [{ type: "instruction" as const, description: "DFS의 한 측면을 묻는다." }],
    hidden: [{ description: answer, reason: "target_answer" as const }],
    expectedResponse: { kind: "short_text" as const, description: answer },
    scoringRubric: [{ criterionId, description: answer, weight: 1, gradingMode: "self" as const }],
    difficulty: { cueLevel: "medium" as const, responseComplexity: "atomic" as const, transferDistance: "same_context" as const },
    requiredCapabilities: [],
    recommendedType: "flashcard" as const,
  });
  const blueprints = [
    blueprint("BP-1", "C-1", "스택"),
    blueprint("BP-2", "C-1", "한 경로를 끝까지 탐색한 뒤 되돌아감"),
  ];
  const activityDesign = {
    objectives: [objective],
    blueprints,
    policy: { includeExact: true as const, includeScaffold: true, includeProxy: false, includeUnsupported: false as const },
    recommendations: blueprints.map((item) => ({
      learningUnitId: "LU-1",
      objectiveId: "OBJ-1",
      blueprintId: item.id,
      assessmentLevel: "exact" as const,
      supportLevel: "supported" as const,
      recommendedType: "flashcard" as const,
      reason: "직접 회상",
      limitation: "",
      includeInGeneration: true,
    })),
  };
  const makeDraft = (id: string, front: string, back: string): CardDraft => ({
    type: "flashcard",
    activityType: "flashcard",
    front,
    back,
    clozeText: "",
    answer: "",
    answers: [],
    options: [],
    correctOptionIndex: 0,
    correctBoolean: false,
    structureNodes: [],
    recommendationReason: "직접 회상",
    hint: "",
    tags: ["DFS"],
    basis: "DFS는 스택을 사용해 한 경로를 끝까지 탐색한 뒤 되돌아간다.",
    learningUnitId: "LU-1",
    objectiveId: "OBJ-1",
    blueprintId: id,
    strategy: "concept",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "DFS",
    rationale: "설계서 변환",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    qualityStatus: "not_run",
    explanation: "원문에서 정답을 확인할 수 있다.",
  });
  globalThis.fetch = async () => responseJson({ cards: [
    makeDraft("BP-1", "DFS가 사용하는 핵심 자료구조는?", "스택"),
  ] });
  try {
    await assert.rejects(
      () => runCardGeneration(
        "flashcard",
        oneUnitMaterial,
        oneUnitAnalysis,
        "",
        JSON.stringify({ countPolicy: "soft_budget", learningUnitSoftBudget: { max: 1 } }),
        "",
        "",
        "",
        JSON.stringify(activityDesign),
      ),
      /문제가 여러 개 선택/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
