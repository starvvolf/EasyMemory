import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";
import { listExperimentRequests } from "../mcp-experiment-requests";
import { getMcpRunView, type McpRunDetail } from "../mcp-run-view";
import { legacyMcpSources, listRegisteredMcpSources, resolveMcpSource } from "../mcp-source-registry";
import type { KnowledgeUnit, LearningDesignObjective } from "../types";
import { listArtifacts, loadArtifact } from "./artifacts";
import type { LearningKnowledgeUnit, LearningObjective, ObjectiveQuestionLink } from "./objective-checklist";
import type { ArtifactScope } from "./rule";

export type ObjectiveCycleSummary = {
  id: string;
  sourceId: string;
  sourceFileName: string;
  sourcePageCount: number;
  sourceSha256: string;
  sourceVerified: boolean;
  learningDesignSha256: string;
  title: string;
  updatedAt: string | null;
  selectedPages: number[];
  objectiveCount: number;
  questionCount: number;
};

export type ObjectiveCycle = ObjectiveCycleSummary & {
  objectives: LearningObjective[];
  knowledgeUnits: LearningKnowledgeUnit[];
  outlineTitles: Record<string, string>;
  outlineLeaves: Array<{ id: string; title: string; pages: number[]; selected: boolean; objectiveIds: string[]; excludedReason: string | null }>;
  questionLinks: ObjectiveQuestionLink[];
  verificationNote: string;
};

type RecordValue = Record<string, unknown>;
type CycleContext = {
  requests: Awaited<ReturnType<typeof listExperimentRequests>>;
  artifacts: Awaited<ReturnType<typeof listArtifacts>>;
  registeredSources: Awaited<ReturnType<typeof listRegisteredMcpSources>>;
};
async function cycleContext(): Promise<CycleContext> {
  const [requests, artifacts, registeredSources] = await Promise.all([
    listExperimentRequests(), listArtifacts(), listRegisteredMcpSources(),
  ]);
  return { requests, artifacts, registeredSources };
}
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function parsedDesign(run: McpRunDetail) {
  const stage = run.stages.find((item) => item.name === "learning-design");
  if (stage?.output.status !== "recorded" || !stage.computedOutputSha256) return null;
  const design = record(record(stage.output.value).learningDesign);
  const objectives = list(design.objectives) as LearningDesignObjective[];
  const knowledgeUnits = list(design.knowledgeUnits) as KnowledgeUnit[];
  if (!objectives.length || !knowledgeUnits.length ||
    objectives.some((objective) => !text(objective?.id) || !text(objective?.target) || !Array.isArray(objective?.outlineNodeIds) ||
      !Array.isArray(objective?.successCriteria) || objective.successCriteria.some((criterion) => !text(criterion?.id) || !text(criterion?.description))) ||
    knowledgeUnits.some((unit) => !text(unit?.id) || !text(unit?.objectiveId) || !text(unit?.sourceId) ||
      !Number.isInteger(unit?.sourcePage) || unit.sourcePage < 1) ||
    new Set(objectives.map((objective) => objective.id)).size !== objectives.length ||
    new Set(knowledgeUnits.map((unit) => unit.id)).size !== knowledgeUnits.length ||
    knowledgeUnits.some((unit) => !objectives.some((objective) => objective.id === unit.objectiveId))) return null;
  return { stage, sha256: stage.computedOutputSha256, objectives, knowledgeUnits, blueprints: list(design.assessmentBlueprints) };
}

function scopeFor(meta: Awaited<ReturnType<typeof listArtifacts>>[number], question: NonNullable<Awaited<ReturnType<typeof loadArtifact>>>["document"]["questions"][number]): ArtifactScope {
  return {
    authoringRunId: meta.authoringRunId, stage: "authoring-lab", artifactVersion: meta.artifactVersion,
    artifactSha256: meta.artifactSha256, originRunId: meta.originRunId, questionId: question.id,
    learningUnitId: question.source.learningUnitId, sourceId: question.source.sourceId,
    sourceRange: question.source.sourceRange,
  };
}

async function sourceForRun(run: McpRunDetail, context: CycleContext) {
  const file = list(record(run.config.status === "recorded" ? run.config.value : null).files);
  if (file.length !== 1) return null;
  const fileName = text(record(file[0]).fileName);
  const pageCount = record(file[0]).pageCount;
  const request = context.requests.find((item) => item.status === "completed" && `mcp:${item.runId}` === run.id);
  const known = request ? await resolveMcpSource(request.input.sourceId) : null;
  const fallback = known ? [] : await Promise.all([
    ...Object.keys(legacyMcpSources).map((id) => resolveMcpSource(id)),
    ...(context.registeredSources.map((item) => Promise.resolve(item))),
  ]);
  const source = known ?? fallback.find((item) => item?.fileName === fileName && item.pageCount === pageCount);
  if (!source || source.fileName !== fileName || source.pageCount !== pageCount) return null;
  const snapshot = request?.sourceSnapshot;
  const sourceVerified = !!snapshot && snapshot.id === source.id && snapshot.fileName === source.fileName &&
    snapshot.pageCount === source.pageCount && snapshot.sha256 === source.sha256 &&
    run.executionRequest?.id === request?.id && run.executionRequest?.sourceId === source.id;
  return { source, request, sourceVerified };
}

async function buildCycle(run: McpRunDetail, context: CycleContext): Promise<ObjectiveCycle | null> {
  if (run.kind !== "mcp-pipeline") return null;
  const design = parsedDesign(run);
  const origin = await sourceForRun(run, context);
  if (!design || !origin) return null;
  const { source, request, sourceVerified } = origin;
  if (design.knowledgeUnits.some((unit) => unit.sourceId !== source.fileName || unit.sourcePage > source.pageCount)) return null;
  const reportedLd = request?.stages.find((stage) => stage.stage === "learning-design")?.actual.outputSha256;
  if (request && reportedLd !== design.sha256) return null;
  const analyze = run.stages.find((stage) => stage.name === "analyze")?.output;
  const outlineNodes = analyze?.status === "recorded" ? list(record(record(analyze.value).sourceOutline).nodes) : [];
  const outlineTitles = Object.fromEntries(outlineNodes.map((node) => [text(record(node).id), text(record(node).title)]).filter(([id]) => id));
  const parentIds = new Set(outlineNodes.map((node) => text(record(node).parentId)).filter(Boolean));
  const selectedLeaves = new Set(run.selectedOutlineLeafIds.status === "recorded" ? run.selectedOutlineLeafIds.value : []);
  const outlineLeaves = outlineNodes.filter((node) => !parentIds.has(text(record(node).id))).map((raw) => {
    const node = record(raw);
    const id = text(node.id);
    const pages = [...new Set(list(node.sourceRefs).flatMap((ref) => list(record(ref).pageNumbers))
      .filter((page): page is number => Number.isInteger(page) && typeof page === "number" && page > 0 && page <= source.pageCount))].sort((a, b) => a - b);
    return {
      id, title: text(node.title), pages, selected: selectedLeaves.has(id),
      objectiveIds: design.objectives.filter((objective) => objective.outlineNodeIds.includes(id)).map((objective) => objective.id),
      excludedReason: text(node.exclusionReason) || null,
    };
  }).filter((leaf) => leaf.id);
  const selectedPages = request?.input.scope.pageNumbers.length
    ? [...request.input.scope.pageNumbers].sort((a, b) => a - b)
    : [...new Set(design.knowledgeUnits.map((unit) => unit.sourcePage))].sort((a, b) => a - b);
  const questionLinks: ObjectiveQuestionLink[] = [];
  const cardsInputSha256 = run.stages.find((stage) => stage.name === "cards")?.executorInputSha256;
  const metas = context.artifacts.filter((meta) => meta.originRunId === run.id.slice(4) && meta.sourceCatalogId === source.id);
  for (const meta of metas) {
    const artifact = await loadArtifact(meta.id);
    if (!artifact) continue;
    const packet = artifact.sourcePacket;
    const packetTrusted = sourceVerified && packet.origin?.runId === run.id.slice(4) &&
      packet.origin.sourceRunSha256 === run.source.fileSha256 && packet.sourceFileName === source.fileName &&
      artifact.meta.sourcePacketSha256 === meta.sourcePacketSha256 &&
      (!cardsInputSha256 || packet.origin.cardsInputSha256 === cardsInputSha256);
    for (const question of artifact.document.questions) {
      const sourceQuestion = question.source;
      const item = packet.items?.find((candidate) => candidate.learningUnitId === sourceQuestion.learningUnitId &&
        candidate.objectiveId === sourceQuestion.objectiveId && candidate.sourceId === sourceQuestion.sourceId &&
        candidate.sourcePage === sourceQuestion.sourcePage);
      const unit = design.knowledgeUnits.find((candidate) => candidate.id === sourceQuestion.learningUnitId);
      const objective = design.objectives.find((candidate) => candidate.id === sourceQuestion.objectiveId);
      const exactSource = !!item && !!unit && !!objective && unit.objectiveId === objective.id &&
        equal([item.sourceId, item.sourcePage, item.sourceRange, item.sourceText, item.target, item.successCriteria],
          [sourceQuestion.sourceId, sourceQuestion.sourcePage, sourceQuestion.sourceRange, sourceQuestion.sourceText, sourceQuestion.target, sourceQuestion.successCriteria]) &&
        equal([unit.sourceId, unit.sourcePage, unit.sourceRange, unit.sourceText, objective.target, unit.outlineNodeIds],
          [item.sourceId, item.sourcePage, item.sourceRange, item.sourceText, item.target, item.outlineNodeIds]);
      const criteria = exactSource ? sourceQuestion.successCriteria.map((description) =>
        objective!.successCriteria.filter((criterion) => criterion.description === description)) : [];
      const criterionIds = criteria.every((matches) => matches.length === 1) ? criteria.map((matches) => matches[0].id) : [];
      const blueprints = design.blueprints.filter((raw) => {
        const value = record(raw);
        return value.objectiveId === objective?.id && value.knowledgeUnitId === unit?.id;
      });
      const blueprintMatches = !design.blueprints.length || blueprints.some((raw) =>
        criterionIds.every((id) => list(record(raw).coverageCriterionIds).includes(id)));
      const verified = packetTrusted && exactSource && criteria.length > 0 && criterionIds.length === criteria.length && blueprintMatches;
      questionLinks.push({
        verification: verified ? "verified" : "unverified",
        verificationBasis: verified ? design.blueprints.length ? "blueprint-coverage" : "exact-criterion-text" : undefined,
        sourceSha256: source.sha256, learningDesignSha256: design.sha256,
        documentSha256: meta.artifactSha256, objectiveId: sourceQuestion.objectiveId,
        learningUnitId: sourceQuestion.learningUnitId, criterionIds, scope: scopeFor(meta, question),
        artifactId: meta.id,
      });
    }
  }
  return {
    id: run.id, sourceId: source.id, sourceFileName: source.fileName, sourcePageCount: source.pageCount,
    sourceSha256: source.sha256, sourceVerified, learningDesignSha256: design.sha256,
    title: run.title, updatedAt: run.updatedAt, selectedPages, objectiveCount: design.objectives.length,
    questionCount: questionLinks.filter((link) => link.verification === "verified").length,
    objectives: design.objectives, knowledgeUnits: design.knowledgeUnits, outlineTitles, outlineLeaves, questionLinks,
    verificationNote: sourceVerified ? "등록 원본 PDF, 실행 요청, 학습설계 출력 해시가 일치합니다." :
      "이전 실행에는 원본 PDF SHA 스냅샷이 없어 문항 연결을 미확인으로 표시합니다.",
  };
}

export async function listObjectiveCycles(): Promise<ObjectiveCycleSummary[]> {
  const context = await cycleContext();
  const base = process.cwd();
  const directories = [
    path.join(base, "eval/local/product-flow-20260928-geometric/data/mcp/chatgpt-runs"),
    path.join(base, "eval/local/mcp-exec-20260928-sol-medium-r01/data/mcp/chatgpt-runs"),
    path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(base, ".study-forge-data"), "mcp/chatgpt-runs"),
  ];
  const names = await Promise.all(directories.map(async (directory) => {
    try {
      return (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(entry.name))
        .slice(0, 500).map((entry) => entry.name);
    } catch { return []; }
  }));
  const runIds = [...new Set([
    ...names.flat(),
    ...context.requests.filter((request) => request.status === "completed" && request.runId).map((request) => request.runId!),
  ])];
  const cycles = await Promise.all(runIds.map(async (rawId) => {
    const run = await getMcpRunView(`mcp:${rawId}`);
    return run ? buildCycle(run, context) : null;
  }));
  return cycles.filter((cycle): cycle is ObjectiveCycle => cycle !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .map(({ objectives: _objectives, knowledgeUnits: _units,
    outlineTitles: _titles, outlineLeaves: _leaves, questionLinks: _links, verificationNote: _note, ...summary }) => {
    void _objectives; void _units; void _titles; void _leaves; void _links; void _note;
    return summary;
  });
}

export async function loadObjectiveCycle(id: string): Promise<ObjectiveCycle | null> {
  const [run, context] = await Promise.all([getMcpRunView(id), cycleContext()]);
  return run ? buildCycle(run, context) : null;
}
