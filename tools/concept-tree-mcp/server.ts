import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConceptTreeMcpService } from "./service.ts";

const port = Number(process.env.CONCEPT_TREE_MCP_PORT ?? 3220);
const host = process.env.CONCEPT_TREE_MCP_HOST ?? "127.0.0.1";

export function createConceptTreeMcpServer(
  service = new ConceptTreeMcpService(),
) {
  const server = new McpServer(
    { name: "study-forge-concept-tree-experiment", version: "0.1.0" },
    {
      instructions:
        "Create concept-only knowledge trees. For an attached PDF, start with start_pdf_concept_tree, read the attachment yourself, author the compact natural-language outline specified by outlineContract, and submit it with submit_concept_tree_outline. For a topic discussed in chat, start with start_topic_concept_tree and submit the same outline format. Never invent PDF concepts or submit JSON nodes; the server assigns IDs, parent links, order, provenance, and validation.",
    },
  );

  server.registerTool(
    "start_pdf_concept_tree",
    {
      title: "Start a concept tree from attached PDFs",
      description: "Register PDFs attached to the current conversation and return the natural-language concept-tree contract. The model reads the attachments; MCP receives metadata only.",
      inputSchema: {
        title: z.string().min(1).max(120),
        files: z.array(z.object({
          fileName: z.string().min(1).max(240),
          pageCount: z.number().int().min(1).max(500).optional(),
        })).min(1).max(20),
        instruction: z.string().max(1000).optional().default(""),
      },
      outputSchema: {
        runId: z.string(),
        sourceMode: z.literal("pdf"),
        title: z.string(),
        sourceLabel: z.string(),
        instruction: z.string(),
        outlineContract: z.record(z.string(), z.unknown()),
        nextAction: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      await service.startPdfRun(input),
      "PDF 개념트리 작성을 시작했습니다. 첨부 PDF를 읽고 자연어 트리를 제출하세요.",
    ),
  );

  server.registerTool(
    "start_topic_concept_tree",
    {
      title: "Start a concept tree from a chat topic",
      description: "Return the same natural-language concept-tree contract for a topic discussed with the user.",
      inputSchema: {
        topic: z.string().min(1).max(300),
        title: z.string().max(120).optional(),
        instruction: z.string().max(1000).optional().default(""),
      },
      outputSchema: {
        runId: z.string(),
        sourceMode: z.literal("topic"),
        title: z.string(),
        sourceLabel: z.string(),
        instruction: z.string(),
        outlineContract: z.record(z.string(), z.unknown()),
        nextAction: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => toolResult(
      await service.startTopicRun(input),
      "대화 주제 기반 개념트리 작성을 시작했습니다. 자연어 트리를 제출하세요.",
    ),
  );

  server.registerTool(
    "submit_concept_tree_outline",
    {
      title: "Validate and save a natural-language concept tree",
      description: "Parse an indented natural-language outline, assign structural fields, validate it, and store the concept tree.",
      inputSchema: {
        runId: z.string().min(1),
        outlineText: z.string().min(1).max(30_000),
      },
      outputSchema: { tree: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => toolResult(
      { tree: await service.submitOutline(input) },
      "자연어 개념트리를 구조화하고 저장했습니다.",
    ),
  );

  server.registerTool(
    "get_concept_tree",
    {
      title: "Get a stored concept tree",
      description: "Return the structured tree, original natural-language outline, source mode, and validation warnings.",
      inputSchema: { runId: z.string().min(1) },
      outputSchema: { tree: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ runId }) => toolResult(
      { tree: await service.getTree(runId) },
      "저장된 개념트리를 조회했습니다.",
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
    const server = createConceptTreeMcpServer();
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
      console.error("Concept Tree MCP request failed", error instanceof Error ? error.message : error);
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
    response.json({ ok: true, service: "study-forge-concept-tree-experiment" });
  });
  app.get("/mcp", (request, response) => {
    if (request.headers.accept?.includes("text/html")) {
      response.json({
        ok: true,
        service: "study-forge-concept-tree-experiment",
        message: "개념트리 MCP 서버가 실행 중입니다.",
        usage: "이 주소는 MCP 클라이언트가 POST 방식으로 호출합니다. 브라우저에서는 서버 상태만 확인할 수 있습니다.",
        health: `http://${host}:${port}/health`,
      });
      return;
    }
    response.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });
  app.all("/mcp", (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });
  return app.listen(port, host, (error?: Error) => {
    if (error) {
      console.error(`Concept Tree MCP 시작 실패: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Concept Tree MCP: http://${host}:${port}/mcp`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer();
}
