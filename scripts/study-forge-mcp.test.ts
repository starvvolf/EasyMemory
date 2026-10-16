import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { StudyForgeMcpService } from "../tools/study-forge-mcp/service.ts";
import { createStudyForgeMcpServer } from "../tools/study-forge-mcp/server.ts";
import {
  stageOutputJsonSchema,
  stageValidationGuidance,
} from "../tools/study-forge-mcp/contracts.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { selectNewPublishedMcpDecks } from "../src/lib/mcp-deck-import.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  repositoryRoot,
  "tools",
  "study-forge-mcp",
  "data",
  "materials",
  "opic-person-description.json",
);
async function createTestService(t: test.TestContext) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "study-forge-mcp-"));
  await mkdir(path.join(dataRoot, "materials"), { recursive: true });
  await mkdir(path.join(dataRoot, "runs"), { recursive: true });
  await copyFile(fixturePath, path.join(dataRoot, "materials", "fixture.json"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return { dataRoot, service: new StudyForgeMcpService(dataRoot) };
}

const analyzeResult = {
  files: [
    {
      fileName: "opic-person-description-fixture.txt",
      documentType: "OPIc speaking pattern handout",
      summary: "인물 묘사에 재사용하는 일곱 표현과 적용 예시, 쉐도잉 안내가 있다.",
      keyTopics: ["인물 소개", "관계 변화", "최종 평가"],
      outline: [
        { heading: "인물 묘사 패턴", points: ["PATTERN #1~#7"] },
        { heading: "학습 방법", points: ["쉐도잉"] },
      ],
      sourceOutline: {
        title: "OPIc 인물 묘사 패턴",
        summary: "패턴, 반복 예시, 학습 방법의 순서로 구성된다.",
        nodes: [
          {
            id: "outline-patterns",
            parentId: null,
            order: 1,
            title: "인물 묘사 패턴",
            summary: "PATTERN #1~#7",
            sourceRefs: [
              { fileName: "opic-person-description-fixture.txt", pageNumbers: [1, 2] },
            ],
            sourceEvidence: "PATTERN #1~#7",
            selectedByDefault: true,
            structureTags: ["틀"],
            importance: 3,
          },
        ],
      },
      suggestedRole: "핵심 표현 학습 자료",
    },
  ],
};

const planResult = {
  summary: "인물 묘사 표현을 생산적으로 인출한다.",
  question: "어느 범위를 학습할까요?",
  groups: [
    {
      id: "core-patterns",
      title: "핵심 패턴",
      description: "반복 가능한 인물 묘사 표현",
      itemCount: 1,
      itemLabel: "패턴",
      selectionInstruction: "한국어 의도에서 영어 표현을 떠올립니다.",
    },
    {
      id: "all-content",
      title: "전체 내용",
      description: "쉐도잉 안내를 포함한 전체 자료",
      itemCount: 2,
      itemLabel: "영역",
      selectionInstruction: "자료 전체를 학습합니다.",
    },
  ],
  recommendedGroupId: "core-patterns",
};

const prepareResult = {
  analysis: {
    detectedGoal: "인물 소개 표현을 직접 말한다.",
    sourceType: "script",
    keyTopics: ["인물 소개"],
    recommendedStrategy: "한국어 의도에서 영어 템플릿을 생성한다.",
    extractedMaterial: "I'd like to talk about [person]. His/Her name is [name].",
    primaryKnowledgeType: "speaking_pattern",
    learningUnits: [
      {
        id: "lu-introduction",
        sourceId: "opic-person-description-fixture.txt",
        sourcePage: 1,
        sourceRange: "PATTERN #1",
        sourceText: "I'd like to talk about my classmate. His name is Tom.",
        knowledgeType: "speaking_pattern",
        fixedPart: "I'd like to talk about; His/Her name is",
        variableSlots: [
          { name: "person", example: "my classmate" },
          { name: "name", example: "Tom" },
        ],
        generalizedForm: "I'd like to talk about [person]. His/Her name is [name].",
        target: "말할 인물과 이름을 소개한다.",
        operation: "recall",
        successCriterion: "한국어 의도에서 영어 소개 템플릿을 말한다.",
        rationale: "반복 스크립트의 공통 도입 표현이다.",
      },
    ],
  },
  organizedMaterial: {
    title: "인물 묘사 핵심 패턴",
    sections: [
      {
        heading: "인물 소개",
        content: "I'd like to talk about [person]. His/Her name is [name].",
        learningUnitIds: ["lu-introduction"],
      },
    ],
  },
};

const activityDesignResult = {
  objectives: [
    {
      id: "objective:lu-introduction",
      outlineNodeId: "lu-introduction",
      learningUnitId: "lu-introduction",
      target: "말할 인물과 이름을 영어로 소개한다.",
      terminalOperation: "recall",
      successCriteria: [{
        id: "criterion:lu-introduction",
        description: "한국어 의도에서 영어 소개 표현을 말한다.",
        required: true,
      }],
      importance: 3,
    },
  ],
  blueprints: [
    {
      id: "blueprint:lu-introduction",
      objectiveId: "objective:lu-introduction",
      learningUnitId: "lu-introduction",
      relationToObjective: "direct",
      elicitedOperation: "recall",
      coverageCriterionIds: ["criterion:lu-introduction"],
      given: [{ type: "instruction", description: "한국어 소개 의도를 제시한다." }],
      hidden: [{ description: "영어 소개 표현", reason: "target_answer" }],
      expectedResponse: { kind: "short_text", description: "영어 소개 표현" },
      scoringRubric: [{
        criterionId: "criterion:lu-introduction",
        description: "정답 표현과 의미가 일치한다.",
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
    },
  ],
};

const prepareAuthoringResult = prepareResult.analysis;

const cardsResult = {
  cards: [
    {
      type: "flashcard",
      activityType: "flashcard",
      front: "저는 [인물]에 대해 이야기하려 합니다. 그 사람의 이름은 [이름]입니다.",
      back: "I'd like to talk about [person]. His/Her name is [name].",
      clozeText: "",
      answer: "",
      answers: [],
      options: [],
      correctOptionIndex: 0,
      correctBoolean: false,
      structureNodes: [],
      recommendationReason: "영어 표현을 직접 생성한다.",
      hint: "",
      tags: ["OPIc", "인물 묘사"],
      basis: "PATTERN #1",
      learningUnitId: "lu-introduction",
      objectiveId: "objective:lu-introduction",
      blueprintId: "blueprint:lu-introduction",
      strategy: "production",
      sourceId: "opic-person-description-fixture.txt",
      sourcePage: 1,
      sourceRange: "PATTERN #1",
      rationale: "인물 소개 발화 기능을 하나만 묻는다.",
      difficulty: 2,
      qualityPassed: true,
      qualityNotes: [],
      qualityStatus: "passed",
      explanation: "원문의 PATTERN #1을 변수형으로 일반화했다.",
    },
  ],
};

test("고정 fixture를 다섯 단계로 조회, 검증, 불변 저장한다", async (t) => {
  const { dataRoot, service } = await createTestService(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("테스트 중 네트워크 호출은 허용되지 않습니다.");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const materials = await service.listMaterials();
  assert.equal(materials[0].id, "opic-person-description");

  const submissions = [
    ["analyze", analyzeResult],
    ["plan", planResult],
    ["prepare", prepareAuthoringResult],
    ["activity-design", activityDesignResult],
    ["cards", cardsResult],
  ] as const;
  let runId: string | undefined;
  for (const [stage, result] of submissions) {
    const stageInput = await service.getStageInput({
      materialId: "opic-person-description",
      stage,
      runId,
    });
    const submitted = await service.submitStageResult({
      materialId: "opic-person-description",
      stage,
      runId,
      inputChecksum: stageInput.inputChecksum,
      result,
    });
    runId = submitted.runId;
  }

  const status = await service.getRunStatus(runId!);
  assert.deepEqual(status.completedStages, [
    "analyze",
    "plan",
    "prepare",
    "activity-design",
    "cards",
  ]);
  assert.equal(status.nextStage, null);
  assert.equal(status.artifacts.length, 5);
  assert.equal(status.artifacts[4].parentArtifactIds[0], status.artifacts[3].id);
  assert.equal(status.artifacts.every((artifact) => artifact.sourceChecksum === status.sourceChecksum), true);

  const firstArtifactPath = path.join(
    dataRoot,
    "runs",
    runId!,
    "artifacts",
    status.artifacts[0].fileName,
  );
  const firstContents = await readFile(firstArtifactPath, "utf8");
  const repeatInput = await service.getStageInput({
    materialId: "opic-person-description",
    stage: "analyze",
    runId,
  });
  await service.submitStageResult({
    materialId: "opic-person-description",
    stage: "analyze",
    runId,
    inputChecksum: repeatInput.inputChecksum,
    result: analyzeResult,
  });
  assert.equal(await readFile(firstArtifactPath, "utf8"), firstContents);
  assert.equal((await readdir(path.dirname(firstArtifactPath))).length, 6);
});

test("잘못된 결과는 artifact 전에 거부하고 실패 시도를 run에 기록한다", async (t) => {
  const { dataRoot, service } = await createTestService(t);
  const stageInput = await service.getStageInput({
    materialId: "opic-person-description",
    stage: "analyze",
  });
  await assert.rejects(
    service.submitStageResult({
      materialId: "opic-person-description",
      stage: "analyze",
      inputChecksum: stageInput.inputChecksum,
      result: { files: [] },
    }),
  );
  const runIds = await readdir(path.join(dataRoot, "runs"));
  assert.equal(runIds.length, 1);
  const status = await service.getRunStatus(runIds[0]);
  assert.equal(status.artifacts.length, 0);
  assert.equal(status.attempts.length, 1);
  assert.equal(status.attempts[0].outcome, "rejected");
  assert.equal(status.attempts[0].stage, "analyze");
});

test("MCP 도구가 네트워크 없이 목록과 단계 입력을 반환한다", async (t) => {
  const { service } = await createTestService(t);
  const server = createStudyForgeMcpServer(service);
  const client = new Client({ name: "study-forge-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "cancel_chatgpt_pdf_run",
      "claim_study_generation_request",
      "configure_chatgpt_pdf_run",
      "configure_run",
      "get_active_coding_session",
      "get_chatgpt_pdf_next_stage",
      "get_chatgpt_pdf_result",
      "get_next_stage",
      "get_project",
      "get_run_result",
      "get_run_status",
      "get_study_generation_source_pages",
      "list_chatgpt_pdf_runs",
      "list_materials",
      "list_projects",
      "list_study_generation_requests",
      "prepare_authoring_packet",
      "publish_chatgpt_pdf_run",
      "publish_run_to_deck",
      "record_study_generation_stage",
      "reuse_chatgpt_pdf_analyze_output",
      "reuse_chatgpt_pdf_stage_prefix",
      "start_chatgpt_pdf_run",
      "submit_chatgpt_pdf_stage",
      "submit_next_stage_result",
    ],
  );
  const listed = await client.callTool({ name: "list_materials", arguments: {} });
  assert.equal(
    (listed.structuredContent as { materials: Array<{ id: string }> }).materials[0].id,
    "opic-person-description",
  );
  const stageInput = await client.callTool({
    name: "get_next_stage",
    arguments: { materialId: "opic-person-description" },
  });
  const stageContent = (stageInput.structuredContent as { stageInput: unknown }).stageInput as {
    inputChecksum: string;
    outputContract: Record<string, unknown>;
    validationGuidance: {
      rules: string[];
      enumValuesByPath: Record<string, unknown[]>;
    };
  };
  assert.match(
    stageContent.inputChecksum,
    /^sha256:[a-f0-9]{64}$/,
  );
  const structureTagValues = Object.entries(
    stageContent.validationGuidance.enumValuesByPath,
  ).find(([path]) => path.endsWith(".structureTags[]"))?.[1];
  assert.deepEqual(structureTagValues, ["절차", "목록", "관계", "비교", "수치", "공식", "예외", "틀"]);
  assert.match(stageContent.validationGuidance.rules.join("\n"), /최대 4개/);
  assert.match(JSON.stringify(stageContent.outputContract), /"structureTags"/);
  assert.match(JSON.stringify(stageContent.outputContract), /"틀"/);
});

test("Activity Design 입력이 실제 renderer 능력과 자동 생성 정책을 먼저 설명한다", async (t) => {
  const { service } = await createTestService(t);
  let runId: string | undefined;
  for (const [stage, result] of [
    ["analyze", analyzeResult],
    ["plan", planResult],
    ["prepare", prepareAuthoringResult],
  ] as const) {
    const input = await service.getStageInput({
      materialId: "opic-person-description",
      stage,
      runId,
    });
    runId = (await service.submitStageResult({
      materialId: "opic-person-description",
      stage,
      runId,
      inputChecksum: input.inputChecksum,
      result,
    })).runId;
  }
  const guidance = (
    await service.getStageInput({
      materialId: "opic-person-description",
      stage: "activity-design",
      runId,
    })
  ).validationGuidance;

  assert.deepEqual(guidance.activitySupport?.rendererCapabilities.flashcard, [
    "text_prompt",
    "short_text",
    "self_scoring",
  ]);
  assert.deepEqual(guidance.activitySupport?.automaticGenerationPolicy, {
    includeExact: true,
    includeScaffold: true,
    includeProxy: false,
    includeUnsupported: false,
  });
  assert.match(guidance.rules.join("\n"), /apply 목표를.*recall로 바꾸지/);
  assert.match(
    guidance.activitySupport?.classificationRules.join("\n") ?? "",
    /flashcard.*자기채점 apply.*scaffold/,
  );
});

test("참조된 JSON Schema의 enum도 제출 전에 정확히 공개한다", () => {
  const contract = stageOutputJsonSchema("prepare");
  const guidance = stageValidationGuidance("prepare", contract);
  const knowledgeTypeValues = Object.entries(guidance.enumValuesByPath)
    .find(([path]) => path.endsWith(".knowledgeType"))?.[1];
  assert.ok(knowledgeTypeValues?.includes("relationship"));
  assert.equal(knowledgeTypeValues?.includes("comparison"), false);
});

test("다음 단계 도구가 ID와 checksum 없이 같은 run을 끝까지 이어간다", async (t) => {
  const { service } = await createTestService(t);
  const results = [analyzeResult, planResult, prepareAuthoringResult, activityDesignResult, cardsResult];
  let next = await service.getNextStage({ materialId: "opic-person-description" });
  for (const result of results) {
    assert.equal(next.completed, false);
    next = await service.submitNextStageResult({ runId: next.runId, result });
  }
  assert.equal(next.completed, true);
  const status = await service.getRunStatus(next.runId);
  assert.equal(status.attempts.length, 5);
  assert.equal(status.attempts.every((attempt) => attempt.outcome === "accepted"), true);
});

test("뒤 단계 입력은 전체 prior artifact 대신 필요한 투영본만 반환한다", async (t) => {
  const { service } = await createTestService(t);
  const results = [analyzeResult, planResult, prepareAuthoringResult, activityDesignResult];
  let next = await service.getNextStage({ materialId: "opic-person-description" });
  for (const result of results) {
    next = await service.submitNextStageResult({ runId: next.runId, result });
  }
  assert.equal(next.nextStage, "cards");
  const input = (next.stageInput as { input: Record<string, unknown> }).input;
  assert.equal(Object.hasOwn(input, "prepared"), false);
  assert.equal(Object.hasOwn(input, "learningUnits"), false);
  assert.equal(Object.hasOwn(input, "activityDesign"), false);
  assert.equal(Object.hasOwn(input, "cardTasks"), true);
  assert.equal(JSON.stringify(input).includes("supportAssessments"), false);
  assert.equal(JSON.stringify(input).includes("extractedMaterial"), false);
});

test("완료 run의 카드를 조회하고 승인 후 덱으로 한 번만 발행한다", async (t) => {
  const { service } = await createTestService(t);
  const results = [analyzeResult, planResult, prepareAuthoringResult, activityDesignResult, cardsResult];
  let next = await service.getNextStage({ materialId: "opic-person-description" });
  for (const result of results) {
    next = await service.submitNextStageResult({ runId: next.runId, result });
  }
  const result = await service.getRunResult(next.runId);
  assert.equal(result.cardCount, 1);
  assert.equal(result.cards[0].front, cardsResult.cards[0].front);
  await assert.rejects(
    service.publishRunToDeck({ runId: next.runId, confirmPublish: false }),
  );
  const published = await service.publishRunToDeck({
    runId: next.runId,
    confirmPublish: true,
  });
  const repeated = await service.publishRunToDeck({
    runId: next.runId,
    confirmPublish: true,
  });
  assert.equal(repeated.deckId, published.deckId);
  const decks = await service.listPublishedDecks();
  assert.equal(decks.length, 1);
  assert.equal(decks[0].id, published.deckId);
  const selected = selectNewPublishedMcpDecks({ decks }, []);
  assert.equal(selected.length, 1);
  assert.equal(
    selectNewPublishedMcpDecks({ decks }, selected).length,
    0,
  );
});
