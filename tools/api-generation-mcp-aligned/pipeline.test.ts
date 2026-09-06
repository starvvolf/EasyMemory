import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import {
  API_PROMPT_VERSION,
  API_STAGE_PROMPTS,
  API_SYSTEM_PROMPT,
  createOpenAiStageGenerator,
  runAlignedPipeline,
  type ApiStageRequest,
  type StageGenerator,
} from "./pipeline.ts";

test("고정 프롬프트는 특정 평가 자료나 정답을 주입하지 않는다", () => {
  const fixedPrompt = JSON.stringify({ system: API_SYSTEM_PROMPT, stages: API_STAGE_PROMPTS });
  assert.doesNotMatch(fixedPrompt, /오픽|DFS|BFS|데드락|deadlock/i);
  assert.match(fixedPrompt, /문구 보존/);
  assert.match(fixedPrompt, /개념 이해·적용/);
});

const outputs = {
  analyze: {
    outlineText: "@file deadlock.pdf\n# 데드락의 필요조건 [1]",
  },
  "concept-tree": {
    treeText: [
      "데드락",
      "- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (p.1)",
      "- [필요조건] 점유와 대기 — 자원을 가진 채 다른 자원을 기다림 (p.1)",
      "- [필요조건] 비선점 — 자원을 강제로 회수할 수 없음 (p.1)",
      "- [필요조건] 순환 대기 — 프로세스들이 원형으로 자원을 기다림 (p.1)",
    ].join("\n"),
  },
  "learning-design": {
    learningDesignText: [
      "--- LEARNING 1 ---",
      "개념: 2, 3, 4, 5",
      "학습내용: 데드락의 네 필요조건과 동시 성립 관계",
      "학습목표: 네 필요조건과 동시 성립 관계를 설명할 수 있다.",
      "성공기준: 네 조건과 동시 성립 관계를 빠짐없이 말한다.",
      "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
      "종류: 관계",
      "이유: 네 조건은 개별 사실보다 동시 성립 관계가 핵심이다.",
      "중요도: 3",
    ].join("\n"),
  },
  "activity-design": {
    activityDesignText: [
      "--- DESIGN 1 ---",
      "학습대상: 1",
      "관련개념: 전체",
      "관계: 직접",
      "보여줄 것: 데드락은 네 가지 필요조건이 어떻게 성립할 때 발생하는가",
      "감출 것: 동시에",
      "응답: 짧은답",
      "채점: 정확",
      "단서: 보통",
      "문제방식: 빈칸",
      "풀이방식: 해당없음",
      "이유: 핵심 관계어를 문맥에서 직접 회상한다.",
      "제한:",
      "--- DESIGN 2 ---",
      "학습대상: 1",
      "관련개념: 3",
      "관계: 직접",
      "보여줄 것: 네 조건 중 일부만 성립한 상황에 대한 진술",
      "감출 것: 데드락 발생 여부의 참과 거짓",
      "응답: 단일선택",
      "채점: 정확",
      "단서: 보통",
      "문제방식: OX",
      "풀이방식: 해당없음",
      "이유: 동시 성립 관계를 진술 판별로 보조 연습한다.",
      "제한: 최종 설명 행동을 직접 평가하지는 않는다.",
    ].join("\n"),
  },
  cardsInvalid: {
    cardsText: [
      "--- CARD 1 ---",
      "유형: 빈칸",
      "질문: 데드락은 네 가지 필요조건이 ____ 성립할 때 발생할 수 있다.",
      "정답: 동시에",
      "해설: 네 조건은 개별 존재가 아니라 동시 성립해야 한다.",
      "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
      "--- CARD 2 ---",
      "유형: OX",
      "질문: 필요조건 중 하나만 성립해도 데드락이 발생한다.",
      "정답: 예",
      "해설: 네 조건이 동시에 성립해야 한다.",
      "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
    ].join("\n"),
  },
  cardsPatch: {
    cardsText: [
      "--- CARD 2 ---",
      "유형: OX",
      "질문: 필요조건 중 하나만 성립해도 데드락이 발생한다.",
      "정답: X",
      "해설: 네 조건이 동시에 성립해야 한다.",
      "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
    ].join("\n"),
  },
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "api-mcp-aligned-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "deadlock.pdf");
  await writeFile(pdfPath, Buffer.from("offline fake PDF bytes"));
  return { root, pdfPath, outputDirectory: path.join(root, "round-002", "api-aligned") };
}

function fakeGenerator(requests: ApiStageRequest[]): StageGenerator {
  let cardsAttempt = 0;
  return async (request) => {
    requests.push(request);
    const submitted = request.stage === "cards"
      ? (++cardsAttempt === 1 ? outputs.cardsInvalid : outputs.cardsPatch)
      : outputs[request.stage];
    return {
      submitted,
      rawResponse: { id: `fake-${request.stage}-${requests.length}`, output: submitted },
      responseId: `fake-${request.stage}-${requests.length}`,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      durationMs: 5,
    };
  };
}

test("동일 MCP 계약으로 전체 흐름을 중단·재개하고 오류 CARD만 부분 재제출한다", async (t) => {
  const { pdfPath, outputDirectory } = await fixture(t);
  const requests: ApiStageRequest[] = [];
  const generateStage = fakeGenerator(requests);
  const common = {
    outputDirectory,
    pdfPath,
    title: "데드락 비교 학습",
    learningGoal: "데드락 조건을 설명한다.",
    instruction: "원문 근거만 사용한다.",
    model: "fake-model",
    reasoningEffort: "medium" as const,
    maxAttemptsPerStage: 3,
    pageCount: 1,
    generateStage,
  };

  const paused = await runAlignedPipeline({ ...common, stopAfter: "learning-design" });
  assert.equal(paused.manifest.status, "paused");
  assert.equal(paused.manifest.nextStage, "activity-design");
  assert.deepEqual(requests.map((request) => request.stage), [
    "analyze", "concept-tree", "learning-design",
  ]);

  const completed = await runAlignedPipeline({ ...common, resume: true });
  assert.equal(completed.manifest.status, "completed");
  assert.equal((completed.result?.result as { cardCount: number }).cardCount, 2);
  assert.equal(completed.manifest.attemptsByStage.cards, 2);
  assert.deepEqual(requests.map((request) => request.stage), [
    "analyze", "concept-tree", "learning-design", "activity-design", "cards", "cards",
  ]);
  assert.equal(requests[0].pdf?.bytes.toString(), "offline fake PDF bytes");
  assert.ok(requests.slice(0, 3).every((request) => request.pdf));
  assert.ok(requests.slice(3).every((request) => !request.pdf));
  assert.match(JSON.stringify(requests[0].stageInput), /input_file PDF/);
  assert.match(JSON.stringify(requests[1].stageInput), /바로 아래 자식.*공백 없이/);
  assert.match(JSON.stringify(requests[3].stageInput), /대상마다 1~3개 과제/);
  assert.match(JSON.stringify(requests[4].stageInput), /하나의 연속 구절/);
  assert.equal((requests[0].stageInput.runContext as { learningGoal: string }).learningGoal, "데드락 조건을 설명한다.");
  assert.ok((requests[1].stageInput.context as { input: { selectedSourceOutline: unknown } }).input.selectedSourceOutline);
  assert.ok((requests[2].stageInput.context as { input: { conceptTree: unknown } }).input.conceptTree);
  assert.ok((requests[3].stageInput.context as { input: { learningTargets: unknown } }).input.learningTargets);
  assert.ok((requests[4].stageInput.context as { input: { problemDesigns: unknown } }).input.problemDesigns);
  for (const request of requests) {
    const serialized = JSON.stringify(request.stageInput);
    assert.doesNotMatch(serialized, /"instructions":|"outputContract":|"attachmentRule":|"format":|"cardOrderRule":|"retryRule":/);
    assert.equal(request.stageInput.promptVersion, API_PROMPT_VERSION);
  }
  assert.equal(requests[5].priorAttempt?.error.includes("O 또는 X"), true);
  assert.equal(requests[5].schema.additionalProperties, false);

  const firstCardAttempt = JSON.parse(await readFile(
    path.join(outputDirectory, "attempts", "cards", "attempt-001.json"),
    "utf8",
  )) as { outcome: string; request: { systemPrompt: string; userPayload: Record<string, unknown> } };
  assert.equal(firstCardAttempt.outcome, "server_validation_error");
  assert.match(firstCardAttempt.request.systemPrompt, /현재 요청의 한 단계만/);
  assert.equal(firstCardAttempt.request.userPayload.stage, "cards");
  const secondCardAttempt = JSON.parse(await readFile(
    path.join(outputDirectory, "attempts", "cards", "attempt-002.json"),
    "utf8",
  )) as { promptVersion: string; request: { userPayload: { retryContext: { validationError: string } } } };
  assert.equal(secondCardAttempt.promptVersion, API_PROMPT_VERSION);
  assert.match(secondCardAttempt.request.userPayload.retryContext.validationError, /O 또는 X/);
  const state = JSON.parse(await readFile(
    path.join(outputDirectory, "server-state", "runs", completed.manifest.serviceRunId!, "run.json"),
    "utf8",
  )) as { stageAttemptCounts: { cards: number }; stageValidationFailures: { cards: unknown[] } };
  assert.equal(state.stageAttemptCounts.cards, 2);
  assert.equal(state.stageValidationFailures.cards.length, 1);

  await assert.rejects(runAlignedPipeline(common), /EEXIST|exist/i);
});

test("계약 불일치는 유한 횟수 뒤 실패하고 원본 시도 파일을 보존한다", async (t) => {
  const { pdfPath, outputDirectory } = await fixture(t);
  const generateStage: StageGenerator = async (request) => ({
    submitted: { outlineText: "형식 없는 설명 문장" },
    rawResponse: { id: `bad-${request.stage}` },
    durationMs: 1,
  });
  await assert.rejects(
    runAlignedPipeline({
      outputDirectory,
      pdfPath,
      title: "계약 실패",
      learningGoal: "목차를 만든다.",
      model: "fake-model",
      reasoningEffort: "medium",
      maxAttemptsPerStage: 2,
      pageCount: 1,
      generateStage,
    }),
    /2회 실패/,
  );
  const manifest = JSON.parse(await readFile(path.join(outputDirectory, "manifest.json"), "utf8")) as {
    status: string;
    attemptsByStage: { analyze: number };
  };
  assert.equal(manifest.status, "failed");
  assert.equal(manifest.attemptsByStage.analyze, 2);
  const first = await readFile(path.join(outputDirectory, "attempts", "analyze", "attempt-001.json"), "utf8");
  const second = await readFile(path.join(outputDirectory, "attempts", "analyze", "attempt-002.json"), "utf8");
  assert.match(first, /형식 없는 설명 문장/);
  assert.match(second, /형식 없는 설명 문장/);
});

test("재개 시 다른 프롬프트 버전을 한 run에 섞지 않는다", async (t) => {
  const { pdfPath, outputDirectory } = await fixture(t);
  const requests: ApiStageRequest[] = [];
  const common = {
    outputDirectory,
    pdfPath,
    title: "버전 보호",
    learningGoal: "자료 구조를 익힌다.",
    model: "fake-model",
    reasoningEffort: "medium" as const,
    pageCount: 1,
    generateStage: fakeGenerator(requests),
  };
  await runAlignedPipeline({ ...common, stopAfter: "analyze" });
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { promptVersion: string };
  manifest.promptVersion = "older-prompt";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(
    runAlignedPipeline({ ...common, resume: true }),
    /프롬프트 버전.*다릅니다/,
  );
  assert.equal(requests.length, 1);
});

test("Responses API 전송기는 strict 외곽 계약과 PDF를 보내되 인증값을 결과에 남기지 않는다", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const generator = createOpenAiStageGenerator({
    apiKey: "test-only-secret",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        id: "resp-offline",
        output_text: JSON.stringify({ outlineText: "@file deadlock.pdf\n# 데드락 [1]" }),
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const response = await generator({
    stage: "analyze",
    stageInput: {
      stage: "analyze",
      instructions: "목차만 작성",
      outputContract: {},
      input: { attachmentRule: "input_file PDF" },
    },
    schema: {
      type: "object",
      properties: { outlineText: { type: "string" } },
      required: ["outlineText"],
      additionalProperties: false,
    },
    schemaName: "study_forge_analyze",
    model: "fake-model",
    reasoningEffort: "medium",
    pdf: {
      fileName: "deadlock.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("fake-pdf"),
      sha256: "fake-hash",
    },
  });
  const body = JSON.parse(String(capturedInit?.body)) as {
    text: { format: { strict: boolean; schema: { additionalProperties: boolean } } };
    input: Array<{ content: Array<{ type: string; file_data?: string }> }>;
  };
  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.match(body.input[1].content[0].file_data ?? "", /^data:application\/pdf;base64,/);
  assert.deepEqual(response.submitted, { outlineText: "@file deadlock.pdf\n# 데드락 [1]" });
  assert.doesNotMatch(JSON.stringify(response), /test-only-secret/);
});
