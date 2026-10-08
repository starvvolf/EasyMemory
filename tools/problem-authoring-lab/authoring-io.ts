import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDocument, validateDocumentAgainstPacket, validateFormatOverride, type AuthoringDocument, type InspectionIssue, type SourceContent } from "./contract.ts";
import { inspectQuality } from "./quality.ts";
import { renderDocument, renderInteractiveDocument } from "./renderer.ts";

// File-side steps of the authoring lab, shared by its MCP tools and the app's auto-executor.
// `labDir` is the tools/problem-authoring-lab directory (the MCP server passes its own location).

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const authoringMethods = ["selection", "recall-blank", "relationship-structure", "graph-geometry"] as const;
export type AuthoringMethod = (typeof authoringMethods)[number];
const methodFiles: Record<AuthoringMethod, string> = {
  "selection": "multiple-choice.md",
  "recall-blank": "fill-blank.md",
  "relationship-structure": "relationship-structure.md",
  "graph-geometry": "graph-geometry.md",
};

export async function readAuthoringInstructions(labDir: string, methods?: readonly AuthoringMethod[]) {
  const skill = await readFile(path.join(labDir, "skill", "problem-authoring", "SKILL.md"), "utf8");
  const requested = methods ?? ["selection", "recall-blank"];
  const entries = await Promise.all(requested.map(async (method) => {
    const content = await readFile(path.join(labDir, "skill", "problem-authoring", "references", methodFiles[method]), "utf8");
    return [method, content] as const;
  }));
  return {
    skillVersion: "problem-authoring-method-v2",
    skillHash: sha256(skill),
    skill,
    references: Object.fromEntries(entries) as Partial<Record<AuthoringMethod, string>>,
    referenceHashes: Object.fromEntries(entries.map(([method, content]) => [method, sha256(content)])),
  };
}

export function resolveRunPacketPath(labDir: string, packetPath: string) {
  const normalized = packetPath.replaceAll("\\", "/");
  if (!/^runs\/[a-z0-9][a-z0-9-]{0,63}\/source-packet\.json$/.test(normalized)) {
    throw new Error("브리지 패킷은 runs/<run-id>/source-packet.json 형식만 허용합니다.");
  }
  const resolved = path.resolve(labDir, normalized);
  const runsRoot = `${path.resolve(labDir, "runs")}${path.sep}`;
  if (!resolved.startsWith(runsRoot)) throw new Error("실험 runs 디렉터리 밖의 패킷은 읽을 수 없습니다.");
  return resolved;
}

export async function verifyGeneratedAssets(labDir: string, document: AuthoringDocument, iterationDirectory: string) {
  const workspaceRoot = path.resolve(labDir, "../..");
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

/** Every blocking issue for a document: contract, item quality, fixed packet, optional format override. */
export async function blockingIssues(labDir: string, document: AuthoringDocument, packetPath?: string, formatOverride?: Record<string, "single-choice" | "short-text">) {
  const issues: InspectionIssue[] = [...validateDocument(document), ...inspectQuality(document)];
  if (packetPath) {
    const packet = JSON.parse(await readFile(resolveRunPacketPath(labDir, packetPath), "utf8")) as { items: SourceContent[] };
    issues.push(...validateDocumentAgainstPacket(document, packet));
  }
  if (formatOverride) issues.push(...validateFormatOverride(document, formatOverride));
  return issues;
}

export type IterationRecord = {
  runId: string;
  iteration: 0 | 1;
  packetPath?: string;
  formatOverride?: Record<string, "single-choice" | "short-text">;
  document: AuthoringDocument;
  issues: unknown[];
  patch?: unknown;
  execution: { model: string; sessionId: string; usage: Record<string, unknown>; toolCalls: string[] };
};

/** Preserves one authoring iteration; renders previews only when no blocking error remains. */
export async function recordProblemIteration(labDir: string, input: IterationRecord) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.runId)) throw new Error("출제 실행 ID 형식이 올바르지 않습니다.");
  const errors = (await blockingIssues(labDir, input.document, input.packetPath, input.formatOverride)).filter((issue) => issue.severity === "error");
  const directory = path.join(labDir, "runs", input.runId, `iteration-${input.iteration}`);
  await mkdir(directory, { recursive: false });
  const files = ["document.json", "inspection.json", "execution.json"];
  await Promise.all([
    writeFile(path.join(directory, files[0]), JSON.stringify(input.document, null, 2)),
    writeFile(path.join(directory, files[1]), JSON.stringify([...input.issues, ...errors], null, 2)),
    writeFile(path.join(directory, files[2]), JSON.stringify(input.execution, null, 2)),
    ...(input.patch ? [writeFile(path.join(directory, "patch.json"), JSON.stringify(input.patch, null, 2))] : []),
  ]);
  if (input.patch) files.push("patch.json");
  if (!errors.length) {
    await verifyGeneratedAssets(labDir, input.document, directory);
    await Promise.all([
      writeFile(path.join(directory, "before-answer.html"), renderDocument(input.document, { revealAnswers: false })),
      writeFile(path.join(directory, "after-answer.html"), renderDocument(input.document, { revealAnswers: true })),
      writeFile(path.join(directory, "interactive.html"), renderInteractiveDocument(input.document)),
    ]);
    files.push("before-answer.html", "after-answer.html", "interactive.html");
  }
  return { directory, files, errors };
}
