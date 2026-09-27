import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyRevision, validateDocument, validateDocumentAgainstPacket, validateFormatOverride, type AuthoringDocument, type RevisionPatch, type SourceContent } from "./contract.ts";
import { renderDocument, renderInteractiveDocument } from "./renderer.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const unknownRecord = z.record(z.string(), z.unknown());
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const methodNames = ["selection", "recall-blank", "relationship-structure", "graph-geometry"] as const;
const methodFiles: Record<(typeof methodNames)[number], string> = {
  "selection": "multiple-choice.md",
  "recall-blank": "fill-blank.md",
  "relationship-structure": "relationship-structure.md",
  "graph-geometry": "graph-geometry.md",
};

export function createProblemAuthoringMcpServer() {
  const server = new McpServer(
    { name: "study-forge-problem-authoring-lab", version: "0.1.0" },
    { instructions: "Use the supplied source packet and problem-authoring skill to compose a block document. Validate it, render unanswered and revealed states, inspect the real HTML, and apply targeted patches. Keep source images and reproducible generated assets explicitly distinct." },
  );
  server.registerTool("load_source_packet", {
    title: "Load a school-content packet",
    description: "Load a fixed lab packet, or a validated Learning Design bridge packet under this lab's runs directory.",
    inputSchema: {
      packetId: z.enum(["science-default", "graph-one"]).default("science-default"),
      packetPath: z.string().optional(),
    },
    outputSchema: { packet: unknownRecord, inputHash: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ packetId, packetPath }) => {
    const fixedFilename = packetId === "graph-one" ? "graph-one-source-packet.json" : "science-source-packet.json";
    const packetFile = packetPath
      ? resolveRunPacketPath(packetPath)
      : path.join(root, "fixtures", fixedFilename);
    const packetText = await readFile(packetFile, "utf8");
    return result({ packet: JSON.parse(packetText), inputHash: sha256(packetText) }, "고정 원문 패킷을 읽었습니다.");
  });

  server.registerTool("get_authoring_instructions", {
    title: "Read problem-authoring instructions",
    description: "Return the common evidence-first skill and only the requested optional method references. No arguments preserves the legacy selection and recall response.",
    inputSchema: { methods: z.array(z.enum(methodNames)).max(4).optional() }, outputSchema: {
      skillVersion: z.string(), skillHash: z.string(), skill: z.string(),
      references: z.record(z.string(), z.string()), referenceHashes: z.record(z.string(), z.string()),
      multipleChoice: z.string().optional(), fillBlank: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ methods }) => {
    const skill = await readFile(path.join(root, "skill", "problem-authoring", "SKILL.md"), "utf8");
    const requested = methods ?? ["selection", "recall-blank"];
    const entries = await Promise.all(requested.map(async (method) => {
      const content = await readFile(path.join(root, "skill", "problem-authoring", "references", methodFiles[method]), "utf8");
      return [method, content] as const;
    }));
    const references = Object.fromEntries(entries);
    const referenceHashes = Object.fromEntries(entries.map(([method, content]) => [method, sha256(content)]));
    return result({
      skillVersion: "problem-authoring-method-v2",
      skillHash: sha256(skill),
      skill,
      references,
      referenceHashes,
      ...(references.selection ? { multipleChoice: references.selection } : {}),
      ...(references["recall-blank"] ? { fillBlank: references["recall-blank"] } : {}),
    }, "문제 제작 지침을 읽었습니다.");
  });

  server.registerTool("validate_problem_document", {
    title: "Validate a problem document",
    description: "Check stable IDs, source assets, page bounds, response links, and answer contracts without rewriting content.",
    inputSchema: { document: unknownRecord, packetPath: z.string().optional(), formatOverride: z.record(z.string(), z.enum(["single-choice", "short-text"])).optional() }, outputSchema: { valid: z.boolean(), issues: z.array(unknownRecord) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ document, packetPath, formatOverride }) => {
    const issues = validateDocument(document as AuthoringDocument);
    if (packetPath) {
      const packet = JSON.parse(await readFile(resolveRunPacketPath(packetPath), "utf8")) as { items: SourceContent[] };
      issues.push(...validateDocumentAgainstPacket(document as AuthoringDocument, packet));
    }
    if (formatOverride) issues.push(...validateFormatOverride(document as AuthoringDocument, formatOverride));
    return result({ valid: !issues.some((issue) => issue.severity === "error"), issues }, "문서 계약을 검사했습니다.");
  });

  server.registerTool("render_problem_preview", {
    title: "Render unanswered and answer-revealed previews",
    description: "Render unanswered, answer-revealed, and locally interactive HTML for visual and grading checks.",
    inputSchema: { document: unknownRecord }, outputSchema: { beforeAnswerHtml: z.string(), afterAnswerHtml: z.string(), interactiveHtml: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ document }) => result({
    beforeAnswerHtml: renderDocument(document as AuthoringDocument, { revealAnswers: false }),
    afterAnswerHtml: renderDocument(document as AuthoringDocument, { revealAnswers: true }),
    interactiveHtml: renderInteractiveDocument(document as AuthoringDocument),
  }, "정답 전·후 HTML 미리보기를 렌더했습니다."));

  server.registerTool("apply_problem_patch", {
    title: "Apply a targeted problem patch",
    description: "Replace only named blocks or response contracts while preserving stable IDs, then validate the result.",
    inputSchema: { document: unknownRecord, patch: unknownRecord, packetPath: z.string().optional(), formatOverride: z.record(z.string(), z.enum(["single-choice", "short-text"])).optional() }, outputSchema: { document: unknownRecord, issues: z.array(unknownRecord) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ document, patch, packetPath, formatOverride }) => {
    const next = applyRevision(document as AuthoringDocument, patch as RevisionPatch);
    const issues = validateDocument(next);
    if (packetPath) {
      const packet = JSON.parse(await readFile(resolveRunPacketPath(packetPath), "utf8")) as { items: SourceContent[] };
      issues.push(...validateDocumentAgainstPacket(next, packet));
    }
    if (formatOverride) issues.push(...validateFormatOverride(next, formatOverride));
    return result({ document: next, issues }, "지정한 부분만 수정하고 다시 검사했습니다.");
  });

  server.registerTool("record_problem_iteration", {
    title: "Record one authoring iteration",
    description: "Preserve an iteration, its validation issues and execution data; render previews when the contract is valid.",
    inputSchema: {
      runId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      iteration: z.number().int().min(0).max(1),
      packetPath: z.string().optional(),
      formatOverride: z.record(z.string(), z.enum(["single-choice", "short-text"])).optional(),
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
  }, async ({ runId, iteration, packetPath, formatOverride, document, issues, patch, execution }) => {
    const authored = document as AuthoringDocument;
    const errors = validateDocument(authored).filter((issue) => issue.severity === "error");
    if (packetPath) {
      const packet = JSON.parse(await readFile(resolveRunPacketPath(packetPath), "utf8")) as { items: SourceContent[] };
      errors.push(...validateDocumentAgainstPacket(authored, packet));
    }
    if (formatOverride) errors.push(...validateFormatOverride(authored, formatOverride));
    const directory = path.join(root, "runs", runId, `iteration-${iteration}`);
    await mkdir(directory, { recursive: false });
    const files = ["document.json", "inspection.json", "execution.json"];
    await Promise.all([
      writeFile(path.join(directory, files[0]), JSON.stringify(authored, null, 2)),
      writeFile(path.join(directory, files[1]), JSON.stringify([...issues, ...errors], null, 2)),
      writeFile(path.join(directory, files[2]), JSON.stringify(execution, null, 2)),
      ...(patch ? [writeFile(path.join(directory, "patch.json"), JSON.stringify(patch, null, 2))] : []),
    ]);
    if (patch) files.push("patch.json");
    if (!errors.length) {
      await verifyGeneratedAssets(authored, directory);
      await Promise.all([
        writeFile(path.join(directory, "before-answer.html"), renderDocument(authored, { revealAnswers: false })),
        writeFile(path.join(directory, "after-answer.html"), renderDocument(authored, { revealAnswers: true })),
        writeFile(path.join(directory, "interactive.html"), renderInteractiveDocument(authored)),
      ]);
      files.push("before-answer.html", "after-answer.html", "interactive.html");
    }
    return result({ directory, files }, "이번 제작 iteration을 실험 디렉터리에 기록했습니다.");
  });
  return server;
}

function resolveRunPacketPath(packetPath: string) {
  const normalized = packetPath.replaceAll("\\", "/");
  if (!/^runs\/[a-z0-9][a-z0-9-]{0,63}\/source-packet\.json$/.test(normalized)) {
    throw new Error("브리지 패킷은 runs/<run-id>/source-packet.json 형식만 허용합니다.");
  }
  const resolved = path.resolve(root, normalized);
  const runsRoot = `${path.resolve(root, "runs")}${path.sep}`;
  if (!resolved.startsWith(runsRoot)) throw new Error("실험 runs 디렉터리 밖의 패킷은 읽을 수 없습니다.");
  return resolved;
}

async function verifyGeneratedAssets(document: AuthoringDocument, iterationDirectory: string) {
  const workspaceRoot = path.resolve(root, "../..");
  for (const entry of [...document.questions, ...(document.sharedSets ?? [])]) {
    for (const block of entry.blocks) {
      if (block.kind !== "generated-image") continue;
      const asset = block.generatedAssetRef;
      const assetBytes = await readFile(path.resolve(iterationDirectory, asset.path));
      const specBytes = await readFile(path.resolve(workspaceRoot, asset.specPath));
      await readFile(path.resolve(workspaceRoot, asset.scriptPath));
      if (sha256(assetBytes) !== asset.sha256 || sha256(specBytes) !== asset.specSha256) {
        throw new Error(`생성 그림의 해시가 재현 정보와 다릅니다: ${asset.assetId}`);
      }
    }
  }
}

function result(data: Record<string, unknown>, message: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text: message }] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createProblemAuthoringMcpServer();
  await server.connect(new StdioServerTransport());
}
