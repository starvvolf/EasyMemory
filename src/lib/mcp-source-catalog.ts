import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMcpRunView, listMcpRunViews, type McpRunDetail, type McpStageName } from "@/lib/mcp-run-view";
import { listRegisteredMcpSources, readRegisteredMcpSourcePdf } from "@/lib/mcp-source-registry";
import { listExperimentRequests } from "@/lib/mcp-experiment-requests";

const geometricRunId = "mcp:chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d";
const newGeometricRunId = "mcp:chatgpt-request-789ee8708698831ced8655c04f289698";
const semiconductorRunId = "mcp:chatgpt-request-6229f153e7dd736279e90e2f523926c4";

const fixedSources = [
  {
    id: "geometric-transformations",
    fileName: "02_Geometric Transformations.pdf",
    title: "Geometric Transformations",
    pageCount: 32,
    sha256: "73beb50cced41ee5da481f375fc21dff3b40d12054743767d6ad334d88fb7dca",
    runIds: [newGeometricRunId, geometricRunId],
  },
  {
    id: "semiconductor",
    fileName: "ilovepdf_merged.pdf",
    title: "반도체 공학의 이해",
    pageCount: 44,
    sha256: "bfa671735178c61957ce5d78edd1746a4c585bdde2907d9b4c35f16483705254",
    runIds: [semiconductorRunId],
  },
] as const;

export type McpSourceCatalogEntry = {
  id: string;
  fileName: string;
  title: string;
  pageCount: number;
  available: boolean;
  sha256: string | null;
  expectedSha256: string;
  matchesExpectedFile: boolean;
  pages: Array<{ number: number; recordedRunId: string | null }>;
  runIds: string[];
  /** Reuse eligibility only; these runs do not imply generated coverage for this source. */
  reuseCandidates: Array<{ runId: string; stage: Exclude<McpStageName, "cards">; sha256: string; sourcePdfSha256: string; origin: "same-source" | "verified-legacy" }>;
  outlineVersions: Array<{ runId: string; assessment: "copied-prior-input" | "not-independently-verified"; preferred: boolean }>;
  outline: { status: "recorded"; runId: string; value: unknown } | { status: "not-generated" };
  note: string;
};

const reusableStages = new Set<McpStageName>(["analyze", "concept-tree", "learning-design", "activity-design"]);

function candidatesFromRun(run: McpRunDetail, sourcePdfSha256: string, origin: "same-source" | "verified-legacy"):
  McpSourceCatalogEntry["reuseCandidates"] {
  return run.stages.filter((stage) => reusableStages.has(stage.name) && stage.output.status === "recorded" && stage.computedOutputSha256 &&
    (origin === "same-source" || stage.name === "analyze"))
    .map((stage) => ({ runId: run.id, stage: stage.name as Exclude<McpStageName, "cards">,
      sha256: stage.computedOutputSha256!, sourcePdfSha256, origin }));
}

function sourcePath(fileName: string): string {
  // This catalog is intentionally limited to the two named local PDFs.
  return path.join(os.homedir(), "OneDrive", "바탕 화면", "예외폴", fileName);
}

function pageRunMap(runs: McpRunDetail[], fileName: string, pageCount: number): Map<number, string> {
  const pages = new Map<number, string>();
  for (const run of runs) {
    const output = run.stages.find((stage) => stage.name === "cards")?.output;
    if (output?.status !== "recorded" || !output.value || typeof output.value !== "object" ||
      !("cards" in output.value) || !Array.isArray(output.value.cards)) continue;
    for (const rawCard of output.value.cards) {
      if (!rawCard || typeof rawCard !== "object" || !("sourceId" in rawCard) || rawCard.sourceId !== fileName) continue;
      const sourcePages = "sourcePages" in rawCard && Array.isArray(rawCard.sourcePages)
        ? rawCard.sourcePages : "sourcePage" in rawCard ? [rawCard.sourcePage] : [];
      for (const page of sourcePages) if (Number.isInteger(page) && page >= 1 && page <= pageCount && !pages.has(page)) pages.set(page, run.id);
    }
  }
  return pages;
}

function scopeNote(runCount: number, pageCount: number, sourceMatches: boolean): string {
  if (!sourceMatches) return "원본 PDF의 SHA-256이 등록 기록과 달라 실행 범위를 연결하지 않았습니다.";
  return runCount ? `연결된 실행 ${runCount}건 · 문제 생성으로 연결된 쪽 ${pageCount}쪽입니다.`
    : "연결된 실행이 없습니다. 문제 생성으로 연결된 쪽은 0쪽입니다.";
}

async function fileSha256(fileName: string): Promise<string | null> {
  const target = sourcePath(fileName);
  try {
    if (!(await stat(target)).isFile()) return null;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

export async function listMcpSourceCatalog(): Promise<McpSourceCatalogEntry[]> {
  const requests = await listExperimentRequests();
  const allRunIds = (await listMcpRunViews())
    .filter((run) => run.kind === "mcp-pipeline")
    .map((run) => run.id);
  const runs = new Map(await Promise.all(
    [...new Set([geometricRunId, newGeometricRunId, semiconductorRunId, ...allRunIds])]
      .map(async (id) => [id, await getMcpRunView(id)] as const),
  ));

  const fixed = await Promise.all(fixedSources.map(async (source) => {
    const actualSha256 = await fileSha256(source.fileName);
    const matchesExpectedFile = actualSha256 === source.sha256;
    const eligibleRequestRunIds = requests.filter((request) => request.status === "completed" && request.runId &&
      request.input.sourceId === source.id && (!request.sourceSnapshot || request.sourceSnapshot.sha256 === source.sha256))
      .map((request) => `mcp:${request.runId}`);
    const sourceRuns = [...new Set([...source.runIds, ...eligibleRequestRunIds])].map((id) => runs.get(id)).filter((run) => run && run.config.status === "recorded" &&
      typeof run.config.value === "object" && run.config.value !== null && "files" in run.config.value &&
      Array.isArray(run.config.value.files) && run.config.value.files.some((file) =>
        typeof file === "object" && file !== null && "fileName" in file && file.fileName === source.fileName));
    const outlineRun = sourceRuns.find((run) => run?.stages.find((stage) => stage.name === "analyze")?.output.status === "recorded");
    const analyze = outlineRun?.stages.find((stage) => stage.name === "analyze")?.output;
    const sourceOutline = analyze?.status === "recorded" && analyze.value &&
      typeof analyze.value === "object" && "sourceOutline" in analyze.value
      ? analyze.value.sourceOutline
      : null;
    const recordedPages = matchesExpectedFile ? pageRunMap(sourceRuns as McpRunDetail[], source.fileName, source.pageCount) : new Map<number, string>();
    return {
      id: source.id,
      fileName: source.fileName,
      title: source.title,
      pageCount: source.pageCount,
      available: actualSha256 !== null,
      sha256: actualSha256,
      expectedSha256: source.sha256,
      matchesExpectedFile,
      runIds: sourceRuns.map((run) => run!.id),
      reuseCandidates: matchesExpectedFile ? sourceRuns.flatMap((run) => candidatesFromRun(run!, source.sha256, "same-source")) : [],
      outlineVersions: sourceRuns.filter((run) =>
        run?.stages.find((stage) => stage.name === "analyze")?.output.status === "recorded")
        .map((run) => ({
          runId: run!.id,
          assessment: run!.executionRequestId === "req_b553edb4887023c4d1b139f595f8a87b"
            ? "copied-prior-input" as const : "not-independently-verified" as const,
          preferred: run!.id === outlineRun?.id,
        })),
      pages: Array.from({ length: source.pageCount }, (_, index) => {
        const number = index + 1;
        return { number, recordedRunId: recordedPages.get(number) ?? null };
      }),
      outline: sourceOutline && outlineRun && matchesExpectedFile
        ? { status: "recorded" as const, runId: outlineRun.id, value: sourceOutline }
        : { status: "not-generated" as const },
      note: scopeNote(sourceRuns.length, recordedPages.size, matchesExpectedFile),
    } satisfies McpSourceCatalogEntry;
  }));
  const registered = await listRegisteredMcpSources();
  const registeredEntries = await Promise.all(registered.map(async (source): Promise<McpSourceCatalogEntry> => {
    const sourceRuns = allRunIds.map((id) => runs.get(id)).filter((run): run is McpRunDetail => {
      if (!run || run.config.status !== "recorded") return false;
      const files = (run.config.value as { files?: unknown }).files;
      if (!Array.isArray(files) || files.length !== 1) return false;
      const file = files[0] as Record<string, unknown>;
      return file.sourceId === source.id && file.sha256 === source.sha256 &&
        file.fileName === source.fileName && file.pageCount === source.pageCount;
    });
    const outlineRun = sourceRuns.find((run) => run?.stages.find((stage) => stage.name === "analyze")?.output.status === "recorded");
    const analyze = outlineRun?.stages.find((stage) => stage.name === "analyze")?.output;
    const sourceOutline = analyze?.status === "recorded" && analyze.value && typeof analyze.value === "object" &&
      "sourceOutline" in analyze.value ? analyze.value.sourceOutline : null;
    const recordedPages = pageRunMap(sourceRuns, source.fileName, source.pageCount);
    const ownCandidates = sourceRuns.flatMap((run) => candidatesFromRun(run!, source.sha256, "same-source"));
    const eligibleLegacyRunIds = fixedSources.flatMap((legacy, index) =>
      legacy.sha256 === source.sha256 && legacy.fileName === source.fileName && legacy.pageCount === source.pageCount &&
      fixed[index].matchesExpectedFile ? fixed[index].runIds : []);
    const legacyCandidates = (await Promise.all(eligibleLegacyRunIds.map(async (id) => {
        const run = await getMcpRunView(id);
        if (!run || run.config.status !== "recorded" || !Array.isArray((run.config.value as { files?: unknown }).files)) return null;
        const files = (run.config.value as { files: Array<{ fileName?: string; pageCount?: number; sourceId?: string }> }).files;
        if (files.length !== 1 || files[0].fileName !== source.fileName || files[0].pageCount !== source.pageCount || files[0].sourceId) return null;
        return run;
      }))).filter((run): run is McpRunDetail => run !== null)
      .flatMap((run) => candidatesFromRun(run, source.sha256, "verified-legacy"));
    return {
    id: source.id,
    fileName: source.fileName,
    title: source.fileName.replace(/\.pdf$/i, ""),
    pageCount: source.pageCount,
    available: true,
    sha256: source.sha256,
    expectedSha256: source.sha256,
    matchesExpectedFile: true,
    pages: Array.from({ length: source.pageCount }, (_, index) => ({ number: index + 1,
      recordedRunId: recordedPages.get(index + 1) ?? null })),
    runIds: sourceRuns.map((run) => run!.id),
    reuseCandidates: [...ownCandidates, ...legacyCandidates],
    outlineVersions: sourceRuns.filter((run) => run?.stages.find((stage) => stage.name === "analyze")?.output.status === "recorded")
      .map((run) => ({ runId: run!.id, assessment: "not-independently-verified" as const, preferred: run!.id === outlineRun?.id })),
    outline: sourceOutline && outlineRun
      ? { status: "recorded", runId: outlineRun.id, value: sourceOutline }
      : { status: "not-generated" },
    note: scopeNote(sourceRuns.length, recordedPages.size, true),
  };
  }));
  return [...fixed, ...registeredEntries];
}

/** Returns only a verified, fixed source PDF; client-supplied paths are never accepted. */
export async function readMcpSourcePdf(id: string): Promise<Uint8Array | null> {
  if (id.startsWith("src_")) return readRegisteredMcpSourcePdf(id);
  const source = fixedSources.find((entry) => entry.id === id);
  if (!source) return null;
  try {
    const bytes = await readFile(sourcePath(source.fileName));
    if (bytes.length > 10 * 1024 * 1024) return null;
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) return null;
    return bytes;
  } catch {
    return null;
  }
}
