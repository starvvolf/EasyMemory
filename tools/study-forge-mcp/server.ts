import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { StudyForgeMcpService } from "./service.ts";
import { generationStages } from "./types.ts";
import {
  ChatGptParityService,
  chatGptParityStages,
} from "./chatgpt-parity.ts";

const port = Number(process.env.STUDY_FORGE_MCP_PORT ?? 3210);
const host = process.env.STUDY_FORGE_MCP_HOST ?? "127.0.0.1";
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const artifactMetadataOutputSchema = z.object({
  id: z.string(),
  stage: z.enum(generationStages),
  checksum: checksumSchema,
  inputChecksum: checksumSchema,
  sourceChecksum: checksumSchema,
  parentArtifactIds: z.array(z.string()),
  createdAt: z.string(),
  fileName: z.string(),
});
const attemptOutputSchema = z.object({
  id: z.string(),
  stage: z.enum(generationStages),
  inputChecksum: checksumSchema,
  createdAt: z.string(),
  outcome: z.enum(["accepted", "rejected"]),
  artifactId: z.string().optional(),
  error: z.string().optional(),
});

export function createStudyForgeMcpServer(
  service = new StudyForgeMcpService(),
  chatGptParity = new ChatGptParityService(),
) {
  const server = new McpServer(
    { name: "study-forge-generation", version: "0.2.0" },
    {
      instructions:
        "기본 PDF 생성 흐름은 간결한 원문 목차 추출 → 개념트리 → 학습설계(트리 묶기·나누기와 목표) → 평가·활동 설계(현재 앱이 지원하는 기능에 맞춘 설계) → 카드 → 검증입니다. ChatGPT는 짧은 자연어 블록을 쓰고, MCP 서버는 이를 파싱해 ID, 연결, JSON 필드, 지원 수준, 전략, 난이도, 구조 방식, 원문 검사를 구체화합니다. 현재 대화에 첨부된 PDF에는 항상 start_chatgpt_pdf_run과 submit_chatgpt_pdf_stage를 사용합니다. 로컬 MCP 서버는 PDF 바이너리를 받지 않으므로 첨부 파일을 직접 읽습니다. get_next_stage와 submit_next_stage_result는 이전 방식과의 호환용 도구일 뿐입니다. 작성 전에 항상 instructions와 outputContract를 읽습니다. 사용자의 명시적 확인을 받은 뒤에만 발행합니다.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "Study Forge 프로젝트 목록 조회",
      description: "로컬 Study Forge 프로젝트의 기준 목록과 각 PDF 수를 조회합니다.",
      inputSchema: {},
      outputSchema: {
        projects: z.array(z.object({
          id: z.string(), name: z.string(), createdAt: z.string(), updatedAt: z.string(), sourceCount: z.number().int(),
        })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => toolResult(
      { projects: await service.listProjects() },
      "학습 프로젝트 목록을 조회했습니다.",
    ),
  );

  server.registerTool(
    "get_project",
    {
      title: "Study Forge 프로젝트 조회",
      description: "프로젝트 하나의 기준 PDF 원본 ID, 체크섬, 저장된 분석의 사용 가능 여부를 반환합니다.",
      inputSchema: { projectId: z.string().min(1) },
      outputSchema: { project: z.record(z.string(), z.unknown()), sources: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ projectId }) => toolResult(await service.getProject(projectId), "프로젝트와 PDF 소스를 조회했습니다."),
  );

  server.registerTool(
    "get_active_coding_session",
    {
      title: "진행 중인 코딩 학습 세션 조회",
      description:
        "진행 중인 Study Forge 코딩 목표, 현재 과제, 최근 VS Code 제출을 반환합니다. projectId를 생략하면 가장 최근에 갱신된 진행 중 세션을 반환합니다.",
      inputSchema: { projectId: z.string().min(1).optional() },
      outputSchema: {
        session: z.record(z.string(), z.unknown()).nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ projectId }) => toolResult(
      await service.getActiveCodingSession(projectId),
      "현재 코딩 학습 세션과 최신 제출을 조회했습니다.",
    ),
  );

  server.registerTool(
    "start_chatgpt_pdf_run",
    {
      title: "ChatGPT PDF 비교 실행 시작",
      description:
        "현재 ChatGPT 대화에 첨부된 PDF의 비교 경로를 시작합니다. ChatGPT는 먼저 간결한 원문 목차만 반환하고, MCP가 앱 구조를 만든 뒤 이후 단계를 검증·구체화·시간 기록·저장합니다.",
      inputSchema: {
        clientRequestId: z.string().trim().min(1).max(200).optional(),
        projectId: z.string().trim().min(1).max(200).optional().describe(
          "Study Forge 프로젝트에서 시작한 run이면 list_study_projects가 반환한 projectId를 그대로 전달합니다.",
        ),
        title: z.string().min(1),
        files: z.array(z.object({
          fileName: z.string().min(1),
          pageCount: z.number().int().min(1).optional(),
          sourceId: z.string().regex(/^src_[a-f0-9]{64}$/).optional(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        })).min(1).max(20),
        learningGoal: z.string().optional().default(""),
        instruction: z.string().optional().default(""),
        subject: z.string().optional().default(""),
        tags: z.array(z.string()).optional().default([]),
        sourceExpressionMode: z.enum(["preserve", "adapt"]).optional().default("adapt"),
        stopAfterStage: z.enum(chatGptParityStages).optional().default("cards"),
      },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.startRun(input),
      "ChatGPT 첨부 PDF 비교 run을 시작했습니다. 반환된 계약에 맞춰 첨부 PDF의 원문 목차만 제출하세요.",
    ),
  );

  server.registerTool(
    "configure_chatgpt_pdf_run",
    {
      title: "ChatGPT PDF 실행의 원문 목차 항목 선택",
      description:
        "원문 분석 후 개념트리를 만들기 전에 선택한 원문 목차의 말단 항목을 바꿉니다. Study Forge 화면에서 사용자가 범위를 선택하는 지점에 해당합니다.",
      inputSchema: {
        runId: z.string().min(1),
        selectedOutlineLeafIds: z.array(z.string().min(1)).min(1),
      },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.configureRun(input),
      "선택한 원문 목차 범위를 ChatGPT 비교 run에 반영했습니다.",
    ),
  );

  server.registerTool(
    "reuse_chatgpt_pdf_analyze_output",
    {
      title: "완료된 원문 분석 출력의 정확한 재사용",
      description:
        "검증된 원문 분석 산출물 하나를 비어 있는 새 ChatGPT PDF 실행에 복사합니다. 등록된 로컬 PDF 바이트, 원본 실행 파일 해시, 산출물 해시를 확인하고 원본은 변경하지 않으며 출력 재사용 출처를 기록합니다. 새 AI 원문 분석은 아닙니다.",
      inputSchema: {
        runId: z.string().min(1),
        sourceRunId: z.string().min(1),
        sourceRunSha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourceArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourcePdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
      },
      outputSchema: {
        reused: z.object({
          kind: z.literal("output"),
          stage: z.literal("analyze"),
          sourceRunId: z.string(),
          sourceRunSha256: z.string(),
          sourceArtifactSha256: z.string(),
          sourcePdfSha256: z.string(),
        }),
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.reuseAnalyzeOutput(input),
      "기존 Analyze artifact를 SHA-256 검증 후 새 run에 그대로 채택했습니다. 새 AI 분석은 실행하지 않았습니다.",
    ),
  );

  server.registerTool(
    "reuse_chatgpt_pdf_stage_prefix",
    {
      title: "검증된 완료 단계 묶음을 새 PDF 실행에 재사용",
      description:
        "원문 분석부터 선택 단계까지의 완료 출력을 비어 있는 새 실행에 정확히 복사합니다. 개념트리 이후를 재사용하려면 학습 목표, 지시, 명시적으로 선택한 목차·쪽 범위가 같아야 합니다. 원본은 변경하지 않고 복사한 각 단계의 출력 재사용 출처를 기록하며 새 모델 추론은 없습니다.",
      inputSchema: {
        runId: z.string().min(1),
        sourceRunId: z.string().min(1),
        stage: z.enum(["analyze", "concept-tree", "learning-design", "activity-design"]),
        sourceRunSha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourceArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourcePdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
        selectedOutlineLeafIds: z.array(z.string().min(1)).min(1).optional(),
        selectedPageNumbers: z.array(z.number().int().positive()).min(1).optional(),
      },
      outputSchema: {
        reused: z.object({
          kind: z.literal("output"),
          stage: z.enum(["analyze", "concept-tree", "learning-design", "activity-design"]),
          sourceRunId: z.string(),
          sourceRunSha256: z.string(),
          sourceArtifactSha256: z.string(),
          sourcePdfSha256: z.string(),
        }),
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.reuseStagePrefix(input),
      "검증된 완료 단계까지의 산출물을 새 run에 그대로 채택했습니다. 복사한 단계에 새 AI 생성은 없었습니다.",
    ),
  );

  server.registerTool(
    "get_chatgpt_pdf_next_stage",
    {
      title: "ChatGPT PDF 비교 실행 이어가기",
      description: "ChatGPT가 작성하는 실행의 다음 단계 계약과 간결한 이전 단계 맥락을 반환합니다.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ runId }) => toolResult(
      await chatGptParity.getNextStage(runId),
      "ChatGPT 비교 run의 다음 단계 계약을 조회했습니다.",
    ),
  );

  server.registerTool(
    "submit_chatgpt_pdf_stage",
    {
      title: "ChatGPT가 작성한 PDF 단계 제출",
      description:
        "ChatGPT가 작성한 원문 분석, 개념트리, 학습설계, 평가·활동 설계 또는 카드 결과 하나를 검증·저장하고 다음 단계의 정확한 계약을 반환합니다.",
      inputSchema: {
        runId: z.string().min(1),
        stage: z.enum(chatGptParityStages),
        result: z.record(z.string(), z.unknown()),
      },
      outputSchema: {
        submitted: z.record(z.string(), z.unknown()),
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        stoppedAfterStage: z.enum(chatGptParityStages).nullable(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.submitStage(input),
      "ChatGPT 단계 결과를 검증·저장하고 다음 단계를 준비했습니다.",
    ),
  );

  server.registerTool(
    "get_chatgpt_pdf_result",
    {
      title: "ChatGPT PDF 비교 결과 조회",
      description: "Codex App Server 결과와 비교할 수 있도록 최종 카드, 학습설계, 단계별 소요 시간을 반환합니다.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        title: z.string(),
        files: z.array(z.record(z.string(), z.unknown())),
        selectedOutlineLeafIds: z.array(z.string()),
        stageDurationsMs: z.record(z.string(), z.number()),
        stageAttemptCounts: z.record(z.string(), z.number()),
        stageValidationFailures: z.record(z.string(), z.array(z.object({
          at: z.string(),
          error: z.string(),
        }))),
        totalDurationMs: z.number(),
        conceptTree: z.record(z.string(), z.unknown()),
        learningDesign: z.record(z.string(), z.unknown()),
        activityDesign: z.record(z.string(), z.unknown()),
        cardCount: z.number().int().nonnegative(),
        cards: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ runId }) => toolResult(
      await chatGptParity.getResult(runId),
      "ChatGPT MCP 생성 결과와 단계별 시간을 조회했습니다.",
    ),
  );

  server.registerTool(
    "list_chatgpt_pdf_runs",
    {
      title: "ChatGPT PDF 실행 목록 조회",
      description: "정리와 진단을 위해 진행 중·완료·발행·취소된 ChatGPT MCP PDF 실행을 나열합니다.",
      inputSchema: {},
      outputSchema: {
        runs: z.array(z.object({
          runId: z.string(),
          title: z.string(),
          status: z.enum(["active", "stopped", "completed", "published", "cancelled"]),
          nextStage: z.enum(chatGptParityStages).nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
          clientRequestId: z.string().nullable(),
        })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => toolResult(
      { runs: await chatGptParity.listRuns() },
      "ChatGPT MCP PDF run 목록을 조회했습니다.",
    ),
  );

  server.registerTool(
    "cancel_chatgpt_pdf_run",
    {
      title: "미완료 ChatGPT PDF 실행 취소",
      description: "진단 기록을 삭제하지 않고 미완료 ChatGPT MCP PDF 실행을 취소 상태로 표시합니다.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        cancelled: z.literal(true),
        cancelledAt: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ runId }) => toolResult(
      await chatGptParity.cancelRun(runId),
      "미완료 ChatGPT MCP PDF run을 취소했습니다. 진단 기록은 보존됩니다.",
    ),
  );

  server.registerTool(
    "publish_chatgpt_pdf_run",
    {
      title: "승인된 ChatGPT PDF 실행 발행",
      description: "명시적 확인을 받은 뒤 완료된 ChatGPT MCP 비교 실행을 Study Forge 덱 수신함에 발행합니다.",
      inputSchema: { runId: z.string().min(1), confirmPublish: z.literal(true) },
      outputSchema: {
        runId: z.string(),
        deckId: z.string(),
        title: z.string(),
        cardCount: z.number().int().nonnegative(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.publishRun(input),
      "승인된 ChatGPT MCP 결과를 Study Forge 덱으로 발행했습니다.",
    ),
  );

  server.registerTool(
    "list_materials",
    {
      title: "Study Forge 자료 목록 조회",
      description: "읽기 전용 호환을 위해 변경하지 않는 이전 자료 예시를 나열합니다. 새 실행에는 프로젝트를 사용합니다.",
      inputSchema: {},
      outputSchema: {
        materials: z.array(z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          learningGoal: z.string(),
          instruction: z.string(),
          mode: z.enum(["flashcard", "cloze", "translation"]),
          sourceFileName: z.string(),
          sourceBytes: z.number().int().nonnegative(),
          sourceChecksum: checksumSchema,
        })),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => toolResult(
      { materials: await service.listMaterials() },
      "사용 가능한 자료를 조회했습니다.",
    ),
  );

  server.registerTool(
    "get_next_stage",
    {
      title: "이전 방식: 5단계 파이프라인 시작 또는 이어가기",
      description:
        "이전 방식과의 호환 전용입니다. 원문 분석, 계획, 준비, 활동 설계, 카드 단계를 사용합니다. 새 PDF 실행에는 현재 Study Forge 엔진과 맞는 start_chatgpt_pdf_run을 사용해야 합니다.",
      inputSchema: {
        materialId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        sourceIds: z.array(z.string().min(1)).min(1).max(20).optional(),
        config: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          learningGoal: z.string().min(1),
          instruction: z.string(),
          mode: z.enum(["flashcard", "cloze", "translation"]),
          subject: z.string().optional(),
          tags: z.array(z.string()).optional(),
          sourceExpressionMode: z.enum(["preserve", "adapt"]).optional(),
          activitySelectionMode: z.enum(["automatic", "manual"]).optional(),
        }).optional(),
        runId: z.string().min(1).optional(),
        runMode: z.enum([
          "focused_area",
          "whole_document_core",
          "whole_document_core_soft_budget",
        ]).optional(),
      },
      outputSchema: {
        runId: z.string(),
        completed: z.boolean(),
        nextStage: z.enum(generationStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await service.getNextStage(input),
      "run의 다음 단계 입력을 준비했습니다.",
    ),
  );

  server.registerTool(
    "configure_run",
    {
      title: "Study Forge 사용자 선택 반영",
      description:
        "웹앱이 단계 사이에 묻는 생성 범위, 선택 목차·초점, 제외할 학습 단위를 반영합니다. 사용자 선택이 필요하면 가능한 선택지를 보여준 뒤 호출합니다.",
      inputSchema: {
        runId: z.string().min(1),
        runMode: z.enum([
          "focused_area",
          "whole_document_core",
          "whole_document_core_soft_budget",
        ]).optional(),
        selectedSourceOutlineLeafIds: z.array(z.string().min(1)).optional(),
        selectedFocusGroupId: z.string().min(1).optional(),
        selectedOutlineLeafIds: z.array(z.string().min(1)).optional(),
        excludedLearningUnitIds: z.array(z.string().min(1)).optional(),
      },
      outputSchema: {
        runId: z.string(),
        settings: z.record(z.string(), z.unknown()),
        nextStage: z.enum(generationStages).nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await service.configureRun(input),
      "웹앱과 같은 단계 사이 사용자 선택을 run에 반영했습니다.",
    ),
  );

  server.registerTool(
    "submit_next_stage_result",
    {
      title: "이전 방식: 5단계 결과 제출",
      description:
        "이전 방식과의 호환 전용입니다. get_next_stage로 만든 이전 실행의 결과 하나를 제출합니다. 새 PDF 실행에는 submit_chatgpt_pdf_stage를 사용해야 합니다.",
      inputSchema: {
        runId: z.string().min(1),
        result: z.record(z.string(), z.unknown()),
      },
      outputSchema: {
        submitted: z.record(z.string(), z.unknown()),
        runId: z.string(),
        completed: z.boolean(),
        nextStage: z.enum(generationStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await service.submitNextStageResult(input),
      "현재 단계 결과를 저장하고 다음 단계 입력을 준비했습니다.",
    ),
  );

  server.registerTool(
    "get_run_status",
    {
      title: "생성 실행 상태 조회",
      description: "로컬 생성 실행의 변경하지 않는 산출물, 완료 단계, 다음 단계를 보여줍니다.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        id: z.string(),
        materialId: z.string(),
        projectId: z.string().optional(),
        sourceIds: z.array(z.string()).optional(),
        sourceChecksum: checksumSchema,
        createdAt: z.string(),
        updatedAt: z.string(),
        artifacts: z.array(artifactMetadataOutputSchema),
        attempts: z.array(attemptOutputSchema),
        settings: z.record(z.string(), z.unknown()).optional(),
        completedStages: z.array(z.enum(generationStages)),
        nextStage: z.enum(generationStages).nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ runId }) => toolResult(
      await service.getRunStatus(runId),
      "생성 run 상태를 조회했습니다.",
    ),
  );

  server.registerTool(
    "get_run_result",
    {
      title: "최종 Study Forge 카드 조회",
      description: "완료된 실행의 최종 카드 내용과 원문 요약을 반환합니다.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        materialId: z.string(),
        projectId: z.string().optional(),
        sourceIds: z.array(z.string()).optional(),
        title: z.string(),
        sourceFileName: z.string(),
        artifactId: z.string(),
        cardCount: z.number().int().nonnegative(),
        cards: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ runId }) => toolResult(
      await service.getRunResult(runId),
      "최종 카드 내용을 조회했습니다.",
    ),
  );

  server.registerTool(
    "publish_run_to_deck",
    {
      title: "승인된 실행을 Study Forge에 발행",
      description:
        "명시적 확인을 받은 뒤 완료된 불변 실행을 로컬 Study Forge 학습 화면이 가져올 수 있는 덱 묶음으로 발행합니다. 같은 실행을 다시 발행해도 결과는 같습니다.",
      inputSchema: {
        runId: z.string().min(1),
        confirmPublish: z.literal(true),
      },
      outputSchema: {
        runId: z.string(),
        deckId: z.string(),
        title: z.string(),
        cardCount: z.number().int().nonnegative(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await service.publishRunToDeck(input),
      "승인된 run을 Study Forge 학습 덱으로 발행했습니다.",
    ),
  );

  return server;
}

function toolResult(data: Record<string, unknown>, message: string) {
  return {
    structuredContent: data,
    content: [{ type: "text" as const, text: message }],
  };
}

export function startServer() {
  const app = createMcpExpressApp({ host });
  app.post("/mcp", async (request, response) => {
    const server = createStudyForgeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("Study Forge MCP 요청 실패", error instanceof Error ? error.message : error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "서버 내부 오류" },
          id: null,
        });
      }
    }
  });
  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "study-forge-generation" });
  });
  app.all("/mcp", (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "허용되지 않은 요청 방식" },
      id: null,
    });
  });
  return app.listen(port, host, () => {
    console.log(`Study Forge MCP: http://${host}:${port}/mcp`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer();
}
