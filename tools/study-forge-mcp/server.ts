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
        "The default PDF generation engine is the current Study Forge flow: Analyze -> Plan -> Learning Design (Objectives, Knowledge Units, Assessment Blueprints) -> Activity Design + Cards + verification. For a PDF attached to the current conversation, always use start_chatgpt_pdf_run and submit_chatgpt_pdf_stage. Read the attachment yourself; the local MCP server does not receive its binary. get_next_stage and submit_next_stage_result are legacy five-stage compatibility tools only and must not be used for new comparison runs. Always read instructions and outputContract before authoring. Publish only after explicit user confirmation.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Study Forge projects",
      description: "List canonical local Study Forge projects and their PDF counts.",
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
      title: "Get a Study Forge project",
      description: "Return canonical PDF source IDs, checksums, and cached-analysis availability for one project.",
      inputSchema: { projectId: z.string().min(1) },
      outputSchema: { project: z.record(z.string(), z.unknown()), sources: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ projectId }) => toolResult(await service.getProject(projectId), "프로젝트와 PDF 소스를 조회했습니다."),
  );

  server.registerTool(
    "get_active_coding_session",
    {
      title: "Get the active coding learning session",
      description:
        "Return the active Study Forge coding goal, current task, and latest VS Code submission. Omit projectId to get the most recently updated active session.",
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
      title: "Start a ChatGPT PDF comparison run",
      description:
        "Start the comparison path for PDFs attached to the current ChatGPT conversation. ChatGPT reads the attachments and authors every stage; MCP only validates, materializes, times, and stores results.",
      inputSchema: {
        title: z.string().min(1),
        files: z.array(z.object({
          fileName: z.string().min(1),
          pageCount: z.number().int().min(1).optional(),
        })).min(1).max(20),
        learningGoal: z.string().optional().default(""),
        instruction: z.string().optional().default(""),
        subject: z.string().optional().default(""),
        tags: z.array(z.string()).optional().default([]),
        sourceExpressionMode: z.enum(["preserve", "adapt"]).optional().default("adapt"),
      },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
        nextStage: z.enum(chatGptParityStages).nullable(),
        stageInput: z.unknown().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await chatGptParity.startRun(input),
      "ChatGPT 첨부 PDF 비교 run을 시작했습니다. 반환된 Analyze 계약에 맞춰 첨부 PDF를 직접 분석하세요.",
    ),
  );

  server.registerTool(
    "configure_chatgpt_pdf_run",
    {
      title: "Choose source outline items for a ChatGPT PDF run",
      description:
        "After Analyze, change the selected original-outline leaf nodes before Learning Design. This is the user intervention point equivalent to the Study Forge UI selection.",
      inputSchema: {
        runId: z.string().min(1),
        selectedOutlineLeafIds: z.array(z.string().min(1)).min(1),
      },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
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
    "get_chatgpt_pdf_next_stage",
    {
      title: "Continue a ChatGPT PDF comparison run",
      description: "Return the next exact stage contract and compact prior-stage context for a ChatGPT-authored run.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        completed: z.boolean(),
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
      title: "Submit a ChatGPT-authored PDF stage",
      description:
        "Validate and store one ChatGPT-authored Analyze, Plan, Learning Design, or Cards result, then return the next exact stage contract.",
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
      title: "Get a ChatGPT PDF comparison result",
      description: "Return the final cards, learning design, and per-stage elapsed time for comparison with Codex App Server.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: {
        runId: z.string(),
        engine: z.literal("chatgpt-mcp"),
        title: z.string(),
        files: z.array(z.record(z.string(), z.unknown())),
        selectedOutlineLeafIds: z.array(z.string()),
        stageDurationsMs: z.record(z.string(), z.number()),
        totalDurationMs: z.number(),
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
    "publish_chatgpt_pdf_run",
    {
      title: "Publish an approved ChatGPT PDF run",
      description: "After explicit confirmation, publish a completed ChatGPT MCP comparison run to the Study Forge deck inbox.",
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
      title: "List Study Forge materials",
      description: "List old immutable material fixtures for read-only compatibility. New runs should use projects.",
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
      title: "Legacy: start or continue the old five-stage pipeline",
      description:
        "Legacy compatibility only. Uses Analyze, Plan, Prepare, Activity Design, Cards. New PDF runs must use start_chatgpt_pdf_run so they match the current Study Forge engine.",
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
      title: "Apply Study Forge user selections",
      description:
        "Apply the same choices the web app asks between stages: generation scope, selected outline/focus, and excluded learning units. Call after showing the available choices to the user when a choice is needed.",
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
      title: "Legacy: submit an old five-stage result",
      description:
        "Legacy compatibility only. Submit one result for an old get_next_stage run. New PDF runs must use submit_chatgpt_pdf_stage.",
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
      title: "Get generation run status",
      description: "Show immutable artifacts, completed stages, and the next stage for a local generation run.",
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
      title: "Get final Study Forge cards",
      description: "Return the final card bodies and source summary for a completed run.",
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
      title: "Publish an approved run to Study Forge",
      description:
        "After explicit confirmation, publish a completed immutable run as a deck bundle that the local Study Forge learning screen imports. Repeating the same run is idempotent.",
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
      console.error("Study Forge MCP request failed", error instanceof Error ? error.message : error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
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
      error: { code: -32000, message: "Method not allowed" },
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
