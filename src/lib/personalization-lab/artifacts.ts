import "server-only";

import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { listExperimentRequests } from "../mcp-experiment-requests";
import { isLabRequest } from "../study/auto-executor";
import { getMcpRunView } from "../mcp-run-view";
import { resolveMcpSource } from "../mcp-source-registry";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { validateDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { renderInteractiveDocument } from "../../../tools/problem-authoring-lab/renderer.ts";

const runRoot = path.join(process.cwd(), "tools/problem-authoring-lab/runs");
const allowed = {
  "geometry-mcp-r02": {
    title: "기하변환 · 새 MCP 실행 9문항",
    authoringRunId: "integrated-geometry-sol-20260928-r02",
    stage: "authoring-lab" as const,
    artifactVersion: "iteration-1",
    file: "integrated-geometry-sol-20260928-r02/iteration-1/document.json",
    sourcePacket: "integrated-geometry-sol-20260928-r02/source-packet.json",
    sourceCatalogId: "geometric-transformations" as const,
    sourceTotalPages: 32,
    questionCount: 9,
    documentSha256: "d788b7c9517d3171f3be4e593f3a883d4bbf93439dc967aa27e5c7f8abb22d98",
    packetSha256: "5889dda8985c422b98293677e723c02a2bb5095e7ba1048152df3314d8324aea",
  },
  "semiconductor-mcp-r01": {
    title: "반도체 · 새 MCP 실행 5문항",
    authoringRunId: "integrated-semiconductor-sol-20260928-r01",
    stage: "authoring-lab" as const,
    artifactVersion: "iteration-1",
    file: "integrated-semiconductor-sol-20260928-r01/iteration-1/document.json",
    sourcePacket: "integrated-semiconductor-sol-20260928-r01/source-packet.json",
    sourceCatalogId: "semiconductor" as const,
    sourceTotalPages: 44,
    questionCount: 5,
    documentSha256: "8811075330042100831d719c315d8298ed9f6340c632a9562a687a7b802fe6ca",
    packetSha256: "ec78698cd387f64623cb33e679c974883ce3d3e83960a025c26d7cb11b4471fd",
  },
  "geometry-4-final": {
    title: "기하변환 · 확정 4문항",
    authoringRunId: "geometric-cycle-20260928-01",
    stage: "authoring-lab" as const,
    artifactVersion: "design-fix-1",
    file: "geometric-cycle-20260928-01/design-fix-1/document.json",
    sourcePacket: "geometric-authoring-prototype/source-packet.json",
    sourceCatalogId: "geometric-transformations" as const,
    sourceTotalPages: 32,
    questionCount: 4,
    documentSha256: "1a720ff34cd3ba70bac16448015e5486b26a6f95637762e76bdcbcad40c46459",
    packetSha256: null,
  },
  "geometry-8-outline": {
    title: "기하변환 · 원문 목차 8문항",
    authoringRunId: "geometric-outline-cycle-20260928-02",
    stage: "authoring-lab" as const,
    artifactVersion: "iteration-0",
    file: "geometric-outline-cycle-20260928-02/iteration-0/document.json",
    sourcePacket: "geometric-authoring-prototype/source-packet.json",
    sourceCatalogId: "geometric-transformations" as const,
    sourceTotalPages: 32,
    questionCount: 8,
    documentSha256: "da004f02e570f61b9c60f9102058e082a07ab667d9af0c83ef2ed55c14ea07b3",
    packetSha256: null,
  },
} as const;

type SourceCatalogId = string;
type ArtifactDescriptor = {
  title: string;
  authoringRunId: string;
  stage: "authoring-lab";
  artifactVersion: string;
  file: string;
  sourcePacket: string;
  sourceCatalogId: SourceCatalogId;
  sourceTotalPages: number;
  questionCount: number;
  documentSha256: string;
  packetSha256: string | null;
};
export type ArtifactMeta = {
  id: string;
  title: string;
  authoringRunId: string;
  stage: "authoring-lab";
  artifactVersion: string;
  artifactSha256: string;
  originRunId: string;
  originEvidenceSha256: string;
  sourcePacketSha256: string;
  sourceFile: string;
  sourceCatalogId: SourceCatalogId;
  sourceTotalPages: number;
  sourcePages: number[];
  questionCount: number;
};
export type ArtifactSourcePacket = {
  origin?: { runId?: string; sourceRunSha256?: string; cardsInputSha256?: string; sha256?: { output?: string } };
  sourceFileName?: string;
  selectedPdfPages?: number[];
  items?: Array<{
    learningUnitId: string; objectiveId: string; sourceId: string; sourcePage: number;
    sourceRange: string; sourceText: string; target: string; successCriteria: string[];
    outlineNodeIds?: string[];
  }>;
};

function sha256(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function readWithin(relativeFile: string): Promise<string | null> {
  const target = path.resolve(runRoot, relativeFile);
  if (!target.startsWith(path.resolve(runRoot) + path.sep)) return null;
  try {
    const [root, resolved] = await Promise.all([realpath(runRoot), realpath(target)]);
    if (!resolved.startsWith(root + path.sep) || (await stat(resolved)).size > 16 * 1024 * 1024) return null;
    return await readFile(resolved, "utf8");
  } catch { return null; }
}

async function sourceFor(fileName: string, sourceId: string, sourceSha256?: string): Promise<{ id: SourceCatalogId; pages: number } | null> {
  const source = await resolveMcpSource(sourceId);
  return source && source.fileName === fileName && (!sourceSha256 || source.sha256 === sourceSha256)
    ? { id: source.id, pages: source.pageCount } : null;
}

async function discoverArtifacts(): Promise<Array<{ id: string; item: ArtifactDescriptor }>> {
  const requests = (await listExperimentRequests()).filter((request) => request.status === "completed" && request.input.stopAfterStage === "cards" && request.runId && request.stages.at(-1)?.stage === "cards");
  const verified = new Map<string, { sourceId: string; sourceSha256?: string; runSha256: string; cardsInputSha256: string }>();
  await Promise.allSettled(requests.map(async (request) => {
    if (await isLabRequest(request.id)) return;
    const run = await getMcpRunView(`mcp:${request.runId}`);
    const cards = request.stages.find((stage) => stage.stage === "cards");
    if (run?.executionRequest?.id === request.id && run.executionRequestStatus === "completed" && cards?.actual.inputSha256 && run.stages.find((stage) => stage.name === "cards")?.output.status === "recorded") {
      verified.set(request.runId!, { sourceId: request.input.sourceId, sourceSha256: request.sourceSnapshot?.sha256, runSha256: run.source.fileSha256, cardsInputSha256: cards.actual.inputSha256 });
    }
  }));
  if (!verified.size) return [];
  let folders: Array<{ isDirectory(): boolean; name: string }>;
  try { folders = await readdir(runRoot, { withFileTypes: true }); }
  catch { return []; }
  const found = await Promise.allSettled(folders.filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(entry.name)).slice(0, 200).map(async (folder) => {
    const packetFile = `${folder.name}/source-packet.json`;
    const packetRaw = await readWithin(packetFile);
    if (!packetRaw) return null;
    let packet: { title?: string; sourceFileName?: string; selectedPdfPages?: number[]; origin?: { runId?: string; sourceRunSha256?: string; cardsInputSha256?: string; status?: string } };
    try { packet = JSON.parse(packetRaw); } catch { return null; }
    const origin = packet.origin;
    const matched = origin?.runId ? verified.get(origin.runId) : null;
    if (!matched || origin?.status !== "completed-unpublished" || origin.sourceRunSha256 !== matched.runSha256 || origin.cardsInputSha256 !== matched.cardsInputSha256 || !packet.sourceFileName) return null;
    const source = await sourceFor(packet.sourceFileName, matched.sourceId, matched.sourceSha256);
    if (!source || !Array.isArray(packet.selectedPdfPages) || !packet.selectedPdfPages.length || packet.selectedPdfPages.some((page) => !Number.isInteger(page) || page < 1 || page > source.pages)) return null;
    const entries = (await readdir(path.join(runRoot, folder.name), { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^iteration-\d+$/.test(entry.name)).sort((a, b) => Number(b.name.slice(10)) - Number(a.name.slice(10))).slice(0, 12);
    for (const entry of entries) {
      const prefix = `${folder.name}/${entry.name}`;
      const [documentRaw, executionRaw, inspectionRaw] = await Promise.all([readWithin(`${prefix}/document.json`), readWithin(`${prefix}/execution.json`), readWithin(`${prefix}/inspection.json`)]);
      if (!documentRaw || !executionRaw || !inspectionRaw) continue;
      try {
        const document = JSON.parse(documentRaw) as AuthoringDocument;
        const execution = JSON.parse(executionRaw) as { toolCalls?: string[] };
        const inspection = JSON.parse(inspectionRaw) as unknown;
        if (document.schemaVersion !== "problem-authoring-v1" || !document.questions?.length || validateDocument(document).some((issue) => issue.severity === "error") || !Array.isArray(execution.toolCalls) || !execution.toolCalls.includes("record_problem_iteration") || !Array.isArray(inspection) || inspection.some((issue) => typeof issue === "object" && issue !== null && "severity" in issue && issue.severity === "error")) continue;
        if (document.questions.some((question) => question.source.sourceId !== packet.sourceFileName || !packet.selectedPdfPages?.includes(question.source.sourcePage))) continue;
        return { id: `authoring:${folder.name}`, item: {
          title: packet.title || document.title, authoringRunId: folder.name,
          stage: "authoring-lab" as const, artifactVersion: entry.name, file: `${prefix}/document.json`, sourcePacket: packetFile,
          sourceCatalogId: source.id, sourceTotalPages: source.pages, questionCount: document.questions.length,
          documentSha256: sha256(documentRaw), packetSha256: sha256(packetRaw),
        } satisfies ArtifactDescriptor };
      } catch { /* An incomplete iteration is not a learning artifact. */ }
    }
    return null;
  }));
  return found.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

async function loadDescriptor(id: string, item: ArtifactDescriptor): Promise<{ meta: ArtifactMeta; document: AuthoringDocument; html: string; sourcePacket: ArtifactSourcePacket }> {
  const [documentRaw, packetRaw] = await Promise.all([readWithin(item.file), readWithin(item.sourcePacket)]);
  if (!documentRaw || !packetRaw) throw new Error("출제 산출물을 읽을 수 없습니다.");
  const documentHash = sha256(documentRaw);
  const packetHash = sha256(packetRaw);
  if (documentHash !== item.documentSha256 || (item.packetSha256 && packetHash !== item.packetSha256)) throw new Error("고정된 출제 산출물의 SHA-256이 달라졌습니다.");
  const document = JSON.parse(documentRaw) as AuthoringDocument;
  const packet = JSON.parse(packetRaw) as ArtifactSourcePacket;
  const source = packet.sourceFileName ? await sourceFor(packet.sourceFileName, item.sourceCatalogId) : null;
  if (!source || source.pages !== item.sourceTotalPages ||
    !Array.isArray(packet.selectedPdfPages) ||
    packet.selectedPdfPages.some((page) => !Number.isInteger(page) || page < 1 || page > source.pages)) {
    throw new Error("원본 PDF 등록 정보와 출제 범위가 일치하지 않습니다.");
  }
  if (document.questions?.length !== item.questionCount || document.schemaVersion !== "problem-authoring-v1") throw new Error("허용된 출제 산출물의 구조가 달라졌습니다.");
  if (validateDocument(document).some((issue) => issue.severity === "error")) throw new Error("출제 산출물 검사에 실패했습니다.");
  const originEvidenceSha256 = packet.origin?.sourceRunSha256 ?? packet.origin?.sha256?.output;
  if (!packet.origin?.runId || !originEvidenceSha256) throw new Error("MCP 원천 패킷 연결을 확인할 수 없습니다.");
  const meta: ArtifactMeta = {
    id,
    title: item.title,
    authoringRunId: item.authoringRunId,
    stage: item.stage,
    artifactVersion: item.artifactVersion,
    artifactSha256: documentHash,
    originRunId: packet.origin.runId,
    originEvidenceSha256,
    sourcePacketSha256: packetHash,
    sourceFile: packet.sourceFileName ?? "원본 자료",
    sourceCatalogId: item.sourceCatalogId,
    sourceTotalPages: item.sourceTotalPages,
    sourcePages: packet.selectedPdfPages ?? [],
    questionCount: document.questions.length,
  };
  const html = renderInteractiveDocument(document)
    .replaceAll("../../../assets/katex/", "/api/personalization-lab/assets/katex/")
    .replaceAll("../../../assets/fonts/", "/api/personalization-lab/assets/fonts/");
  return { meta, document, html, sourcePacket: packet };
}

async function findDescriptor(id: string): Promise<ArtifactDescriptor | null> {
  const fixed = Object.prototype.hasOwnProperty.call(allowed, id) ? allowed[id as keyof typeof allowed] : null;
  return fixed ?? (await discoverArtifacts()).find((item) => item.id === id)?.item ?? null;
}

export async function loadArtifact(id: string): Promise<{ meta: ArtifactMeta; document: AuthoringDocument; html: string; sourcePacket: ArtifactSourcePacket } | null> {
  const item = await findDescriptor(id);
  return item ? loadDescriptor(id, item) : null;
}

/** A generated SVG figure referenced by the document, served only if its hash still matches the recorded one. */
export async function readArtifactAsset(id: string, assetPath: string): Promise<string | null> {
  if (!/^assets\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(assetPath)) return null;
  const item = await findDescriptor(id);
  if (!item) return null;
  const { document } = await loadDescriptor(id, item);
  const block = [...document.questions, ...(document.sharedSets ?? [])].flatMap((entry) => entry.blocks)
    .find((candidate) => candidate.kind === "generated-image" && candidate.generatedAssetRef.path === assetPath);
  if (!block || block.kind !== "generated-image") return null;
  const svg = await readWithin(`${path.posix.dirname(item.file)}/${assetPath}`);
  return svg && sha256(svg) === block.generatedAssetRef.sha256 ? svg : null;
}

export async function listArtifacts(): Promise<ArtifactMeta[]> {
  const dynamic = await discoverArtifacts();
  const entries: Array<{ id: string; item: ArtifactDescriptor }> = [
    ...Object.entries(allowed).map(([id, item]) => ({ id, item })),
    ...dynamic.filter((entry) => !Object.prototype.hasOwnProperty.call(allowed, entry.id)),
  ];
  const results = await Promise.allSettled(entries.map(async ({ id, item }) => (await loadDescriptor(id, item)).meta));
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}
