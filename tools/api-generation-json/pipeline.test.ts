import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  JSON_ENGINE_MODEL,
  JSON_ENGINE_REASONING,
  STAGE_PROMPTS,
  StageValidationError,
  createOpenAiJsonGenerator,
  materializeAppResult,
  runJsonPipeline,
  validateStageOutput,
  type RunInput,
  type StageGenerator,
  type StageOutputs,
  type StageRequest,
} from "./pipeline.ts";
import { cardsSchema, prepareSchema, recallSchema, type CardsOutput, type PrepareOutput, type RecallOutput } from "./schemas.ts";

test("고정 프롬프트는 특정 평가 자료나 정답을 포함하지 않는다", () => {
  const prompts = JSON.stringify(STAGE_PROMPTS);
  assert.doesNotMatch(prompts, /DFS|BFS|데드락|오픽|Pattern 1/i);
  assert.match(prompts, /인출 대상·조건·목표/);
});

const baseInput: RunInput = {
  pdfPath: "C:/fixture/05 DFS BFS.pdf",
  fileName: "05 DFS BFS.pdf",
  pdfSha256: "fixture",
  pageCount: 22,
  title: "DFS BFS",
  learningGoal: "그래프 탐색을 구현하고 적용한다.",
  instruction: "원문 조건을 보존한다.",
  sourceExpressionMode: "adapt",
};

function recall(mode: "flashcard" | "cloze" | "translation" = "cloze"): RecallOutput {
  const option = (id: string) => ({
    id,
    title: id,
    cue: "단서",
    target: "답",
    unit: "LearningUnit",
    instruction: "직접 인출한다.",
    mode,
    variants: [
      {
        id: `${id}-template`,
        label: "템플릿",
        description: "원문 템플릿",
        slotMode: "template" as const,
        exampleSource: "source" as const,
        preservePlaceholders: true,
        sample: { title: "예시", cue: "____", target: "답", supportingInfo: "근거" },
      },
      {
        id: `${id}-filled`,
        label: "완성",
        description: "완성 예시",
        slotMode: "filled_example" as const,
        exampleSource: "generated" as const,
        preservePlaceholders: false,
        sample: { title: "예시", cue: "질문", target: "답", supportingInfo: "근거" },
      },
    ],
  });
  return { question: "방식", recommendedOptionId: "option-1", options: [option("option-1"), option("option-2")] };
}

async function rawDfsCards() {
  return cardsSchema.parse(JSON.parse(await readFile(
    new URL("./fixtures/dfs-bfs-cards-raw.json", import.meta.url),
    "utf8",
  )));
}

async function rawDfsPrepare() {
  return prepareSchema.parse(JSON.parse(await readFile(
    new URL("./fixtures/dfs-bfs-prepare-raw.json", import.meta.url),
    "utf8",
  )));
}

async function rawDfsRecall() {
  return recallSchema.parse(JSON.parse(await readFile(
    new URL("./fixtures/dfs-bfs-recall-raw.json", import.meta.url),
    "utf8",
  )));
}

function priorForCards(prepare: PrepareOutput, recallOutput: RecallOutput): StageOutputs {
  return {
    recall: recallOutput,
    prepare,
  };
}

test("실제 DFS 16개 raw JSON은 내용 변경 없이 앱 메타데이터만 연결된다", async () => {
  const raw = await rawDfsCards();
  const prepare = await rawDfsPrepare();
  const recallOutput = await rawDfsRecall();
  const parsed = validateStageOutput("cards", raw, priorForCards(prepare, recallOutput), baseInput) as CardsOutput;
  const result = materializeAppResult(parsed);
  assert.equal(result.contentPreserved, true);
  assert.equal(result.generatedCards.length, 16);
  assert.deepEqual(result.appCards.map((card) => {
    const content = { ...card } as Partial<typeof card>;
    delete content.id;
    return content;
  }), raw.cards);
  assert.equal(result.generatedContentSha256, result.appContentSha256);
  assert.deepEqual(result.contentTransformsApplied, []);
  for (const card of result.generatedCards) {
    assert.equal(card.clozeText.match(/____/g)?.length ?? 0, card.answers.length);
  }
  assert.equal(result.generatedCards[4].clozeText, raw.cards[4].clozeText);
  assert.equal(result.generatedCards[4].answers.length, 4);
});

test("잘못된 빈칸·답과 참조는 조용히 고치지 않고 항목별 오류로 반환한다", async () => {
  const raw = await rawDfsCards();
  const prepare = await rawDfsPrepare();
  const recallOutput = await rawDfsRecall();
  const broken = structuredClone(raw);
  broken.cards[4].clozeText += " ____";
  broken.cards[4].sourcePage = 22;
  broken.cards[4].qualityPassed = true;
  broken.cards[4].qualityStatus = "passed";
  await assert.rejects(
    async () => validateStageOutput("cards", broken, priorForCards(prepare, recallOutput), baseInput),
    (error: unknown) => {
      assert.ok(error instanceof StageValidationError);
      assert.ok(error.issues.some((issue) => issue.includes("cards.4") && issue.includes("빈칸 수")));
      assert.ok(error.issues.some((issue) => issue.includes("cards.4") && issue.includes("sourceId/sourcePage/sourceRange")));
      assert.ok(error.issues.some((issue) => issue.includes("cards.4") && issue.includes("품질 검수")));
      return true;
    },
  );
  assert.notDeepEqual(broken, raw);
});

test("잘못된 Recall 추천 관계를 첫 항목으로 바꾸지 않고 거부한다", () => {
  const broken = recall();
  broken.recommendedOptionId = "missing-option";
  assert.throws(
    () => validateStageOutput("recall", broken, {}, baseInput),
    (error: unknown) => error instanceof StageValidationError &&
      error.issues.some((issue) => issue.includes("recommendedOptionId")),
  );
  assert.equal(broken.recommendedOptionId, "missing-option");
});

function fullOutputs() {
  const analyze = {
    documentType: "강의자료",
    summary: "그래프 탐색",
    keyTopics: ["DFS"],
    outline: [{ heading: "DFS", points: ["절차"] }],
    sourceOutline: {
      title: "DFS",
      summary: "탐색",
      nodes: [{
        id: "n1",
        parentId: null,
        order: 1,
        title: "DFS",
        summary: "깊이 우선",
        sourceRefs: [{ fileName: "fixture.pdf", pageNumbers: [1] }],
        sourceEvidence: "DFS는 깊이 우선 탐색이다.",
        selectedByDefault: true,
        structureTags: ["절차"],
        importance: 3,
      }],
    },
    suggestedRole: "핵심 자료",
  };
  const plan = {
    summary: "DFS 학습",
    learningGoal: "DFS 설명",
    selectionRationale: "핵심",
    areas: [{ id: "a1", title: "DFS", description: "절차", learningValue: "구현", sourceScope: ["p1"] }],
    exclusions: [],
    maxLearningUnitCount: 1,
  };
  const recallOutput = recall();
  const prepare = {
    detectedGoal: "DFS 설명",
    sourceType: "concept" as const,
    keyTopics: ["DFS"],
    recommendedStrategy: "빈칸",
    extractedMaterial: "DFS는 깊이 우선 탐색이다.",
    primaryKnowledgeType: "concept" as const,
    learningUnits: [{
      id: "LU01",
      sourceId: "fixture.pdf",
      sourcePage: 1,
      sourceRange: "DFS",
      sourceText: "DFS는 깊이 우선 탐색이다.",
      knowledgeType: "concept" as const,
      fixedPart: "DFS는 탐색이다.",
      variableSlots: [],
      generalizedForm: "DFS는 ____ 탐색이다.",
      target: "깊이 우선",
      operation: "recall" as const,
      successCriterion: "깊이 우선을 쓴다.",
      rationale: "핵심 정의",
    }],
  };
  const cards = { cards: [{
    type: "cloze" as const,
    activityType: "flashcard" as const,
    front: "",
    back: "",
    clozeText: "DFS는 ____ 탐색이다.",
    answer: "깊이 우선",
    answers: ["깊이 우선"],
    options: [],
    correctOptionIndex: 0,
    correctBoolean: false,
    structureNodes: [],
    structureRecallMode: "free_input" as const,
    recommendationReason: "정의 인출",
    hint: "탐색 방향",
    tags: ["DFS"],
    basis: "DFS는 깊이 우선 탐색이다.",
    learningUnitId: "LU01",
    objectiveId: "LU01",
    blueprintId: "option-1-template",
    strategy: "concept" as const,
    sourceId: "fixture.pdf",
    sourcePage: 1,
    sourceRange: "DFS",
    rationale: "핵심 정의",
    difficulty: 1,
    qualityPassed: false,
    qualityNotes: [],
    qualityStatus: "not_run" as const,
    explanation: "깊이 방향으로 탐색한다.",
  }] };
  return { analyze, plan, recall: recallOutput, prepare, cards };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "study-forge-json-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = path.join(directory, "fixture.pdf");
  await writeFile(pdfPath, Buffer.from("fixture-pdf"));
  return { pdfPath, outputDirectory: path.join(directory, "run") };
}

test("다섯 단계는 자연어 블록 없이 구조화 JSON으로 실행되고 원본 시도를 보존한다", async (t) => {
  const { pdfPath, outputDirectory } = await fixture(t);
  const outputs = fullOutputs();
  const requests: StageRequest[] = [];
  const generator: StageGenerator = async (request) => {
    requests.push(request);
    return { output: outputs[request.stage], rawResponse: { id: request.stage }, durationMs: 1 };
  };
  const completed = await runJsonPipeline({
    pdfPath,
    outputDirectory,
    pageCount: 1,
    title: "fixture",
    learningGoal: "DFS를 설명한다.",
    maxAttemptsPerStage: 3,
    generateStage: generator,
  });
  assert.equal(completed.manifest.status, "completed");
  assert.equal(requests.length, 5);
  assert.ok(requests.slice(0, 4).every((request) => request.pdf));
  assert.equal(requests[4].pdf, undefined);
  for (const request of requests) {
    assert.equal(request.schema.type, "object");
    assert.doesNotMatch(JSON.stringify(request), /outlineText|treeText|LEARNING 1|DESIGN 1|CARD 1|ChatGptParityService/);
  }
  assert.deepEqual(completed.result.generatedCards, outputs.cards.cards);
  const stored = JSON.parse(await readFile(path.join(outputDirectory, "stages", "cards.json"), "utf8"));
  assert.deepEqual(stored, outputs.cards);
});

test("Responses API 전송은 terra medium과 단계별 strict JSON Schema를 사용한다", async () => {
  let body: Record<string, unknown> = {};
  const generator = createOpenAiJsonGenerator({
    apiKey: "secret-test-key",
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ id: "resp-1", output_text: JSON.stringify(fullOutputs().analyze), usage: { total_tokens: 1 } }), { status: 200 });
    }) as typeof fetch,
  });
  const response = await generator({
    stage: "analyze",
    schema: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string" } } },
    prompt: { purpose: "목적", evidence: "근거", completion: "완료" },
    context: {},
    pdf: { fileName: "fixture.pdf", bytes: Buffer.from("pdf"), sha256: "hash" },
  });
  assert.deepEqual(response.output, fullOutputs().analyze);
  assert.equal(body.model, JSON_ENGINE_MODEL);
  assert.deepEqual(body.reasoning, { effort: JSON_ENGINE_REASONING });
  assert.equal((body.text as { format: { strict: boolean } }).format.strict, true);
  assert.doesNotMatch(JSON.stringify(body), /secret-test-key/);
});
