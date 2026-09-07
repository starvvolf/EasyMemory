import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyRevision, validateDocument, type AuthoringDocument, type RevisionPatch } from "./contract.ts";
import { renderDocument } from "./renderer.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const unknownRecord = z.record(z.string(), z.unknown());
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function createProblemAuthoringMcpServer() {
  const server = new McpServer(
    { name: "study-forge-problem-authoring-lab", version: "0.1.0" },
    { instructions: "Use the supplied source packet and problem-authoring skill to compose a block document. Validate it, render unanswered and revealed states, inspect the real HTML, and apply targeted patches. Never change source learning content or create unreferenced image facts." },
  );
  server.registerTool("load_source_packet", {
    title: "Load the fixed school-content packet",
    description: "Load four saved science learning items without existing card types or layouts.",
    inputSchema: {}, outputSchema: { packet: unknownRecord, inputHash: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const packetText = await readFile(path.join(root, "fixtures", "science-source-packet.json"), "utf8");
    return result({ packet: JSON.parse(packetText), inputHash: sha256(packetText) }, "고정 원문 패킷을 읽었습니다.");
  });

  server.registerTool("get_authoring_instructions", {
    title: "Read problem-authoring instructions",
    description: "Return the common skill and the initial multiple-choice and fill-blank methods.",
    inputSchema: {}, outputSchema: {
      skillVersion: z.string(), skillHash: z.string(), skill: z.string(),
      multipleChoice: z.string(), fillBlank: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const skill = await readFile(path.join(root, "skill", "problem-authoring", "SKILL.md"), "utf8");
    return result({
      skillVersion: "problem-authoring-hypothesis-v1",
      skillHash: sha256(skill),
      skill,
      multipleChoice: await readFile(path.join(root, "skill", "problem-authoring", "references", "multiple-choice.md"), "utf8"),
      fillBlank: await readFile(path.join(root, "skill", "problem-authoring", "references", "fill-blank.md"), "utf8"),
    }, "문제 제작 지침을 읽었습니다.");
  });

  server.registerTool("validate_problem_document", {
    title: "Validate a problem document",
    description: "Check stable IDs, source assets, page bounds, response links, and answer contracts without rewriting content.",
    inputSchema: { document: unknownRecord }, outputSchema: { valid: z.boolean(), issues: z.array(unknownRecord) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ document }) => {
    const issues = validateDocument(document as AuthoringDocument);
    return result({ valid: !issues.some((issue) => issue.severity === "error"), issues }, "문서 계약을 검사했습니다.");
  });

  server.registerTool("render_problem_preview", {
    title: "Render unanswered and answer-revealed previews",
    description: "Render the authored block layout to real HTML in both study states for visual inspection.",
    inputSchema: { document: unknownRecord }, outputSchema: { beforeAnswerHtml: z.string(), afterAnswerHtml: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ document }) => result({
    beforeAnswerHtml: renderDocument(document as AuthoringDocument, { revealAnswers: false }),
    afterAnswerHtml: renderDocument(document as AuthoringDocument, { revealAnswers: true }),
  }, "정답 전·후 HTML 미리보기를 렌더했습니다."));

  server.registerTool("apply_problem_patch", {
    title: "Apply a targeted problem patch",
    description: "Replace only named blocks or response contracts while preserving stable IDs, then validate the result.",
    inputSchema: { document: unknownRecord, patch: unknownRecord }, outputSchema: { document: unknownRecord, issues: z.array(unknownRecord) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ document, patch }) => {
    const next = applyRevision(document as AuthoringDocument, patch as RevisionPatch);
    return result({ document: next, issues: validateDocument(next) }, "지정한 부분만 수정하고 다시 검사했습니다.");
  });

  server.registerTool("record_problem_iteration", {
    title: "Record one authoring iteration",
    description: "Persist the exact document, both rendered states, inspection, optional patch, and actual execution metadata under this isolated lab.",
    inputSchema: {
      runId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      iteration: z.number().int().min(0).max(3),
      document: unknownRecord,
      issues: z.array(unknownRecord),
      patch: unknownRecord.optional(),
      execution: z.object({
        model: z.string(), sessionId: z.string(), usage: unknownRecord,
        toolCalls: z.array(z.string()),
      }),
    },
    outputSchema: { directory: z.string(), files: z.array(z.string()) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ runId, iteration, document, issues, patch, execution }) => {
    const authored = document as AuthoringDocument;
    const errors = validateDocument(authored).filter((issue) => issue.severity === "error");
    if (errors.length) throw new Error("유효하지 않은 문서는 기록할 수 없습니다.");
    const directory = path.join(root, "runs", runId, `iteration-${iteration}`);
    await mkdir(directory, { recursive: true });
    const files = ["document.json", "before-answer.html", "after-answer.html", "inspection.json", "execution.json"];
    await Promise.all([
      writeFile(path.join(directory, files[0]), JSON.stringify(authored, null, 2)),
      writeFile(path.join(directory, files[1]), renderDocument(authored, { revealAnswers: false })),
      writeFile(path.join(directory, files[2]), renderDocument(authored, { revealAnswers: true })),
      writeFile(path.join(directory, files[3]), JSON.stringify(issues, null, 2)),
      writeFile(path.join(directory, files[4]), JSON.stringify(execution, null, 2)),
      ...(patch ? [writeFile(path.join(directory, "patch.json"), JSON.stringify(patch, null, 2))] : []),
    ]);
    if (patch) files.push("patch.json");
    return result({ directory, files }, "이번 제작 iteration을 실험 디렉터리에 기록했습니다.");
  });
  return server;
}

function result(data: Record<string, unknown>, message: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text: message }] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createProblemAuthoringMcpServer();
  await server.connect(new StdioServerTransport());
}
