import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { listExperimentRequests } from "./mcp-experiment-requests.ts";
import { resolveMcpSource } from "./mcp-source-registry.ts";

export const mcpStageNames = [
  "analyze",
  "concept-tree",
  "learning-design",
  "activity-design",
  "cards",
] as const;

export type McpStageName = (typeof mcpStageNames)[number];
export type McpRunSummary = {
  id: string;
  kind: "mcp-pipeline" | "authoring-lab";
  title: string;
  status: "active" | "stopped" | "completed" | "published" | "cancelled";
  createdAt: string | null;
  updatedAt: string | null;
  relatedRunId: string | null;
  executionRequestId?: string;
  executionRequestStatus?: "completed";
  requestRecordStatus?: "not-recorded";
};

type Recorded<T> = { status: "recorded"; value: T } | { status: "not-recorded" };

export type McpStageView = {
  name: McpStageName;
  status: "completed" | "active" | "not-started";
  actualInput: Recorded<unknown>;
  output: Recorded<unknown>;
  model: Recorded<string>;
  reasoningEffort: Recorded<string>;
  executionMetadataSource: "executor-reported" | "output-reuse-no-model" | "not-recorded";
  executorInputSha256: string | null;
  reusedFrom: { kind: "output"; sourceRunId: string; sourceRunSha256: string; sourceArtifactSha256: string; sourcePdfSha256: string; appliedAt: string } | null;
  startedAt: string | null;
  prefetchedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attemptCount: number | null;
  validationFailures: Array<{ at: string; error: string }>;
  computedOutputSha256: string | null;
};

export type McpRunDetail = McpRunSummary & {
  source: { root: "product-eval" | "mcp-exec" | "local-data" | "authoring-lab"; relativeFile: string; fileSha256: string };
  config: Recorded<unknown>;
  selectedOutlineLeafIds: Recorded<string[]>;
  outlineCoverage: Recorded<Array<{
    leafId: string;
    title: string;
    directQuestionIds: string[];
    possibleQuestionIds: string[];
    directQuestionCount: number;
    ambiguous: boolean;
  }>>;
  stages: McpStageView[];
  authoring: Recorded<{ sourcePacket: unknown; document: unknown; cycleNote: string }>;
  executionRequest: { id: string; status: "completed"; sourceId: string; stopAfterStage: string; requestedStages: unknown } | null;
  executionAudit: {
    finding: "copied-prior-output" | "new-source-grounded";
    assessmentSource: "review-correction" | "executor-evidence";
    note: string;
    approximateAuthoringMs: number | null;
    mcpRoundTripMs: { start: number; analyze: number } | null;
    modelSource: "executor-reported";
  } | null;
  provenanceNote: string;
};

type StoredRun = {
  id?: unknown;
  engine?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  config?: unknown;
  selectedOutlineLeafIds?: unknown;
  artifacts?: unknown;
  stageStartedAt?: unknown;
  stageCompletedAt?: unknown;
  stageDurationsMs?: unknown;
  stageAttemptCounts?: unknown;
  stageValidationFailures?: unknown;
  stageReuse?: unknown;
  cancelledAt?: unknown;
  publishedAt?: unknown;
};

type StageInputCall = { stage: McpStageName; value: unknown; completedAt: number };

const maxJsonBytes = 24 * 1024 * 1024;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const authoringId = "geometric-outline-cycle-20260928-02";
const allowedMcpRunId = "chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d";
const authoringRecords = [
  {
    id: authoringId,
    documentFile: `${authoringId}/iteration-0/document.json`,
    packetFile: "geometric-authoring-prototype/source-packet.json",
    originRunId: allowedMcpRunId,
    documentSha256: null,
    packetSha256: null,
  },
  {
    id: "integrated-geometry-sol-20260928-r02",
    documentFile: "integrated-geometry-sol-20260928-r02/iteration-1/document.json",
    packetFile: "integrated-geometry-sol-20260928-r02/source-packet.json",
    originRunId: "chatgpt-request-789ee8708698831ced8655c04f289698",
    documentSha256: "d788b7c9517d3171f3be4e593f3a883d4bbf93439dc967aa27e5c7f8abb22d98",
    packetSha256: "5889dda8985c422b98293677e723c02a2bb5095e7ba1048152df3314d8324aea",
  },
  {
    id: "integrated-geometry-sol-20260928-r01",
    documentFile: "integrated-geometry-sol-20260928-r01/iteration-1/document.json",
    packetFile: "integrated-geometry-sol-20260928-r01/source-packet.json",
    originRunId: "chatgpt-request-789ee8708698831ced8655c04f289698",
    documentSha256: "04c6b9cc8fa527d30f1271cdb54dbbd13ae4cc5ad25dd51a2891f2218153dd2d",
    packetSha256: "36c8c25c6b4c5f681a90316b5bd02a76167bfc1e9c45d87e2499d958799fa42b",
  },
  {
    id: "integrated-semiconductor-sol-20260928-r01",
    documentFile: "integrated-semiconductor-sol-20260928-r01/iteration-1/document.json",
    packetFile: "integrated-semiconductor-sol-20260928-r01/source-packet.json",
    originRunId: "chatgpt-request-6229f153e7dd736279e90e2f523926c4",
    documentSha256: "8811075330042100831d719c315d8298ed9f6340c632a9562a687a7b802fe6ca",
    packetSha256: "ec78698cd387f64623cb33e679c974883ce3d3e83960a025c26d7cb11b4471fd",
  },
] as const;
const newMcpRunIds = [
  "chatgpt-request-789ee8708698831ced8655c04f289698",
  "chatgpt-request-6229f153e7dd736279e90e2f523926c4",
] as const;
const copiedAnalyzeRequestId = "req_b553edb4887023c4d1b139f595f8a87b";
type PublicExperimentRequest = Awaited<ReturnType<typeof listExperimentRequests>>[number];

function roots() {
  const base = process.cwd();
  return [
    { label: "product-eval" as const, directory: path.join(base, "eval/local/product-flow-20260928-geometric/data/mcp/chatgpt-runs"), ids: [allowedMcpRunId] as readonly string[] },
    { label: "mcp-exec" as const, directory: path.join(base, "eval/local/mcp-exec-20260928-sol-medium-r01/data/mcp/chatgpt-runs"), ids: newMcpRunIds as readonly string[] },
    { label: "local-data" as const, directory: path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(base, ".study-forge-data"), "mcp/chatgpt-runs"), ids: [] as readonly string[] },
  ];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function callDirectories(): Promise<string[]> {
  const base = path.join(process.cwd(), "eval", "local");
  let names: string[];
  try { names = await readdir(base); } catch { return []; }
  const directories: string[] = [];
  for (const name of names.filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(item)).slice(0, 64)) {
    const candidate = path.join(base, name, "calls");
    try {
      const [realBase, realCalls] = await Promise.all([realpath(base), realpath(candidate)]);
      if (realCalls.startsWith(realBase + path.sep) && (await stat(realCalls)).isDirectory()) directories.push(candidate);
    } catch { /* This experiment has no call records. */ }
  }
  return directories;
}

async function verifyRequestRun(run: StoredRun, request: PublicExperimentRequest): Promise<boolean> {
  if (run.id !== request.runId || run.engine !== "chatgpt-mcp") return false;
  const source = await resolveMcpSource(request.input.sourceId);
  if (!source || (request.sourceSnapshot && (request.sourceSnapshot.sha256 !== source.sha256 ||
    request.sourceSnapshot.pageCount !== source.pageCount || request.sourceSnapshot.fileName !== source.fileName))) return false;
  const files = object(run.config).files;
  const requestedObjectives = request.input.selectedObjectiveIds ?? [];
  const runObjectives = object(run.config).selectedObjectiveIds;
  if (requestedObjectives.length > 0 && (!Array.isArray(runObjectives) ||
    JSON.stringify(runObjectives) !== JSON.stringify(requestedObjectives))) return false;
  if (requestedObjectives.length === 0 && Array.isArray(runObjectives) && runObjectives.length > 0) return false;
  if (!Array.isArray(files) || files.length !== 1 || object(files[0]).fileName !== source.fileName) return false;
  const runFile = object(files[0]);
  if (typeof runFile.pageCount === "number" && runFile.pageCount !== source.pageCount) return false;
  if (source.id.startsWith("src_") && (runFile.sourceId !== source.id || runFile.sha256 !== source.sha256)) return false;
  const artifacts = object(run.artifacts);
  const stopIndex = mcpStageNames.indexOf(request.input.stopAfterStage);
  if (stopIndex < 0 || request.stages.length !== stopIndex + 1 ||
    mcpStageNames.slice(stopIndex + 1).some((stage) => artifacts[stage] !== undefined)) return false;
  for (const stage of request.stages) {
    const output = artifacts[stage.stage];
    if (output === undefined || sha256(JSON.stringify(output)) !== stage.actual.outputSha256) return false;
  }
  const requestedReuse = request.input.reuse;
  const reuseRecords = object(run.stageReuse);
  for (const stage of mcpStageNames) {
    const recordedReuse = object(reuseRecords[stage]);
    const inPrefix = requestedReuse?.kind === "output" &&
      mcpStageNames.indexOf(stage) <= mcpStageNames.indexOf(requestedReuse.stage);
    if (inPrefix) {
      const rawSourceRunId = requestedReuse.runId.replace(/^mcp:/, "");
      const report = request.stages.find((entry) => entry.stage === stage);
      if (recordedReuse.kind !== "output" || recordedReuse.sourceRunId !== rawSourceRunId ||
        recordedReuse.sourceArtifactSha256 !== report?.actual.outputSha256 ||
        (stage === requestedReuse.stage && recordedReuse.sourceArtifactSha256 !== requestedReuse.sha256)) return false;
    } else if (recordedReuse.kind === "output") return false;
  }
  return request.stages.length > 0;
}

async function verifyRequestlessLocalRun(run: StoredRun): Promise<boolean> {
  const files = object(run.config).files;
  if (!Array.isArray(files) || files.length !== 1 || run.engine !== "chatgpt-mcp") return false;
  const file = object(files[0]);
  const sourceId = string(file.sourceId);
  if (!sourceId?.startsWith("src_")) return false;
  const source = await resolveMcpSource(sourceId);
  return !!source && file.fileName === source.fileName && file.pageCount === source.pageCount &&
    file.sha256 === source.sha256 && Object.keys(object(run.artifacts)).some((stage) =>
      mcpStageNames.some((name) => name === stage));
}

async function executionAudit(request: PublicExperimentRequest): Promise<McpRunDetail["executionAudit"]> {
  if (request.id === copiedAnalyzeRequestId) return {
    finding: "copied-prior-output",
    assessmentSource: "review-correction",
    note: "기존 기하 Analyze 제출 문자열을 새 run에 복사했습니다. MCP 요청·제출 연결만 검증했고 신규 AI 분석이나 정식 출력 재사용 도구 사용을 입증하지 않습니다.",
    approximateAuthoringMs: null,
    mcpRoundTripMs: null,
    modelSource: "executor-reported",
  };
  if (request.id !== "req_78e7e9cf47cb387eff67ca6c209ff353") return null;
  const root = path.join(process.cwd(), "eval/local/mcp-exec-20260928-sol-medium-r01");
  const evidence = await readWithin<Record<string, unknown>>(root, `web-${request.id}-evidence.json`);
  if (!evidence || evidence.value.requestId !== request.id || evidence.value.runId !== request.runId) return null;
  const timings = object(evidence.value.mcpRoundTripMs);
  const start = number(timings.start);
  const analyze = number(timings.analyze);
  const authoredAt = string(evidence.value.authoringStartedAtApprox);
  const draftAt = string(evidence.value.authoringDraftCompletedAtApprox);
  const authoringMs = authoredAt && draftAt ? Date.parse(draftAt) - Date.parse(authoredAt) : null;
  return {
    finding: "new-source-grounded",
    assessmentSource: "executor-evidence",
    note: "실행 담당 기록상 고정 PDF를 다시 읽어 새 Analyze 초안을 작성했습니다. 모델·추론 강도는 담당 보고이며 독립 호스트 계측이 아닙니다. 작성 시간은 근사치이고 MCP 왕복 시간과 구분합니다.",
    approximateAuthoringMs: authoringMs !== null && Number.isFinite(authoringMs) && authoringMs >= 0 ? authoringMs : null,
    mcpRoundTripMs: start !== null && analyze !== null ? { start, analyze } : null,
    modelSource: "executor-reported",
  };
}

async function readWithin<T>(root: string, relativeFile: string): Promise<{ value: T; raw: string } | null> {
  const target = path.resolve(root, relativeFile);
  if (!target.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!realTarget.startsWith(realRoot + path.sep)) return null;
    if ((await stat(realTarget)).size > maxJsonBytes) return null;
    const raw = await readFile(realTarget, "utf8");
    return { value: JSON.parse(raw) as T, raw };
  } catch {
    return null;
  }
}

/** MCP's returned contract snapshot, never the submitted `arguments.result` or a full model prompt. */
export async function recordedStageInputs(run: StoredRun): Promise<Map<McpStageName, unknown>> {
  const runId = string(run.id);
  if (!runId || !runIdPattern.test(runId)) return new Map();
  const roots = await callDirectories();
  const artifacts = object(run.artifacts);
  const completed = object(run.stageCompletedAt);
  const selectedLeaves = run.selectedOutlineLeafIds;
  const candidates: StageInputCall[] = [];
  for (const root of roots) {
    let names: string[];
    try { names = await readdir(root); } catch { continue; }
    for (const name of names.slice(0, 1000)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name)) continue;
    const file = await readWithin<Record<string, unknown>>(root, name);
    if (!file) continue;
    const call = file.value;
    const inputFile = string(call.inputFile)?.replaceAll("\\", "/");
    if (!inputFile || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(inputFile)) continue;
    const recordedInput = await readWithin<unknown>(path.dirname(root), inputFile);
    if (!recordedInput || sha256(stableStringify(recordedInput.value)) !== sha256(stableStringify(call.arguments))) continue;
    const response = object(object(call.response).structuredContent);
    const input = object(response.stageInput);
    const stage = string(input.stage);
    if (response.runId !== runId || response.nextStage !== stage ||
      !mcpStageNames.some((item) => item === stage)) continue;
    const actualStage = stage as McpStageName;
    if (artifacts[actualStage] === undefined || object(object(run.stageReuse)[actualStage]).kind === "output" ||
      !input.instructions || !input.outputContract || !input.input) continue;
    const completedAt = Date.parse(string(call.completedAt) ?? "");
    const stageCompletedAt = Date.parse(string(completed[actualStage]) ?? "");
    if (!Number.isFinite(completedAt) || !Number.isFinite(stageCompletedAt) || completedAt > stageCompletedAt) continue;
    const argumentsObject = object(call.arguments);
    const previous = mcpStageNames[mcpStageNames.indexOf(actualStage) - 1];
    const tool = string(call.tool);
    const reused = object(response.reused);
    const reusedStage = string(reused.stage);
    const reuseRecord = object(object(run.stageReuse)[reusedStage ?? ""]);
    const reuseOrigin = (tool === "reuse_chatgpt_pdf_analyze_output" || tool === "reuse_chatgpt_pdf_stage_prefix") &&
      argumentsObject.runId === runId && reused.kind === "output" &&
      mcpStageNames.indexOf(actualStage) === mcpStageNames.indexOf(reusedStage as McpStageName) + 1 &&
      (tool !== "reuse_chatgpt_pdf_analyze_output" || reusedStage === "analyze") &&
      argumentsObject.sourceRunId === reused.sourceRunId &&
      argumentsObject.sourceRunSha256 === reused.sourceRunSha256 &&
      argumentsObject.sourceArtifactSha256 === reused.sourceArtifactSha256 &&
      argumentsObject.sourcePdfSha256 === reused.sourcePdfSha256 &&
      reuseRecord.kind === "output" && reuseRecord.sourceRunId === reused.sourceRunId &&
      reuseRecord.sourceRunSha256 === reused.sourceRunSha256 &&
      reuseRecord.sourceArtifactSha256 === reused.sourceArtifactSha256 &&
      reuseRecord.sourcePdfSha256 === reused.sourcePdfSha256 &&
      sha256(JSON.stringify(artifacts[reusedStage ?? ""])) === reused.sourceArtifactSha256;
    const submitted = object(response.submitted);
    const submittedOrigin = tool === "submit_chatgpt_pdf_stage" && submitted.stage === previous &&
      submitted.checksum === `sha256:${sha256(stableStringify(artifacts[previous]))}`;
    const config = object(run.config);
    const stageInputData = object(input.input);
    const startOrigin = tool === "start_chatgpt_pdf_run" &&
      JSON.stringify(argumentsObject.files) === JSON.stringify(config.files) &&
      JSON.stringify(stageInputData.files) === JSON.stringify(config.files) &&
      argumentsObject.title === config.title && stageInputData.title === config.title;
    const validOrigin = reuseOrigin || (actualStage === "analyze"
      ? startOrigin
      : actualStage === "concept-tree"
        ? tool === "configure_chatgpt_pdf_run" && argumentsObject.runId === runId &&
          Array.isArray(argumentsObject.selectedOutlineLeafIds) &&
          JSON.stringify(argumentsObject.selectedOutlineLeafIds) === JSON.stringify(selectedLeaves) &&
          JSON.stringify(object(input.userSelection).selectedOutlineLeafIds) === JSON.stringify(selectedLeaves) &&
          stageInputData.learningGoal === config.learningGoal && stageInputData.instruction === config.instruction
        : submittedOrigin && argumentsObject.runId === runId && argumentsObject.stage === previous);
    if (!validOrigin) continue;
    candidates.push({ stage: actualStage, value: response.stageInput, completedAt });
    }
  }
  const chosen = new Map<McpStageName, StageInputCall>();
  for (const candidate of candidates) {
    if (!chosen.has(candidate.stage) || chosen.get(candidate.stage)!.completedAt < candidate.completedAt) chosen.set(candidate.stage, candidate);
  }
  return new Map([...chosen].map(([stage, call]) => [stage, call.value]));
}

function summary(run: StoredRun): McpRunSummary | null {
  const rawId = string(run.id);
  if (!rawId || !runIdPattern.test(rawId) || run.engine !== "chatgpt-mcp") return null;
  const artifacts = object(run.artifacts);
  const complete = mcpStageNames.every((stage) => artifacts[stage] !== undefined);
  const stopAfter = string(object(run.config).stopAfterStage);
  const stopped = stopAfter && stopAfter !== "cards" && artifacts[stopAfter] !== undefined;
  return {
    id: `mcp:${rawId}`,
    kind: "mcp-pipeline",
    title: string(object(run.config).title) ?? rawId,
    status: run.cancelledAt ? "cancelled" : run.publishedAt ? "published" : complete ? "completed" : stopped ? "stopped" : "active",
    createdAt: string(run.createdAt),
    updatedAt: string(run.updatedAt),
    relatedRunId: null,
  };
}

function stageViews(run: StoredRun, inputs: Map<McpStageName, unknown>, request?: PublicExperimentRequest): McpStageView[] {
  const artifacts = object(run.artifacts);
  const started = object(run.stageStartedAt);
  const completed = object(run.stageCompletedAt);
  const durations = object(run.stageDurationsMs);
  const attempts = object(run.stageAttemptCounts);
  const failures = object(run.stageValidationFailures);
  const reuse = object(run.stageReuse);
  return mcpStageNames.map((name) => {
    const output = artifacts[name];
    const report = request?.stages.find((stage) => stage.stage === name);
    const reused = object(reuse[name]);
    const afterRequestedStop = request && mcpStageNames.indexOf(name) > mcpStageNames.indexOf(request.input.stopAfterStage);
    const validationFailures = Array.isArray(failures[name])
      ? failures[name].filter((entry): entry is { at: string; error: string } =>
        typeof object(entry).at === "string" && typeof object(entry).error === "string")
      : [];
    return {
      name,
      status: output !== undefined ? "completed" : afterRequestedStop ? "not-started" : started[name] ? "active" : "not-started",
      actualInput: inputs.has(name) ? { status: "recorded", value: inputs.get(name) } : { status: "not-recorded" },
      output: output === undefined ? { status: "not-recorded" } : { status: "recorded", value: output },
      model: reused.kind === "output"
        ? { status: "recorded", value: "모델 호출 없음 (저장 출력 재사용)" }
        : report ? { status: "recorded", value: report.actual.model } : { status: "not-recorded" },
      reasoningEffort: reused.kind === "output"
        ? { status: "recorded", value: "해당 없음" }
        : report ? { status: "recorded", value: report.actual.effort } : { status: "not-recorded" },
      executionMetadataSource: reused.kind === "output" ? "output-reuse-no-model" : report ? "executor-reported" : "not-recorded",
      executorInputSha256: reused.kind === "output" ? null : report?.actual.inputSha256 ?? null,
      reusedFrom: reused.kind === "output" &&
        typeof reused.sourceRunId === "string" &&
        typeof reused.sourceRunSha256 === "string" &&
        typeof reused.sourceArtifactSha256 === "string" &&
        typeof reused.sourcePdfSha256 === "string" &&
        typeof reused.appliedAt === "string"
        ? {
          kind: "output",
          sourceRunId: reused.sourceRunId,
          sourceRunSha256: reused.sourceRunSha256,
          sourceArtifactSha256: reused.sourceArtifactSha256,
          sourcePdfSha256: reused.sourcePdfSha256,
          appliedAt: reused.appliedAt,
        } : null,
      startedAt: afterRequestedStop ? null : string(started[name]),
      prefetchedAt: afterRequestedStop ? string(started[name]) : null,
      completedAt: string(completed[name]),
      durationMs: number(durations[name]),
      attemptCount: number(attempts[name]),
      validationFailures,
      computedOutputSha256: output === undefined ? null : sha256(JSON.stringify(output)),
    };
  });
}

function outlineCoverage(run: StoredRun): McpRunDetail["outlineCoverage"] {
  const selected = run.selectedOutlineLeafIds;
  const artifacts = object(run.artifacts);
  const analyze = object(artifacts.analyze);
  const outline = object(analyze.sourceOutline);
  const learning = object(object(artifacts["learning-design"]).learningDesign);
  const cards = object(artifacts.cards);
  if (!Array.isArray(selected) || !selected.every((id) => typeof id === "string") ||
    !Array.isArray(outline.nodes) || !Array.isArray(learning.objectives) || !Array.isArray(cards.cards)) {
    return { status: "not-recorded" };
  }
  const titleById = new Map(outline.nodes.map((node) => [string(object(node).id), string(object(node).title)]));
  const leafIdsByObjective = new Map(learning.objectives.map((objective) => {
    const value = object(objective);
    return [string(value.id), Array.isArray(value.outlineNodeIds) ? value.outlineNodeIds : []] as const;
  }));
  const directByLeaf = new Map<string, string[]>((selected as string[]).map((id) => [id, []]));
  const possibleByLeaf = new Map<string, string[]>((selected as string[]).map((id) => [id, []]));
  for (const rawCard of cards.cards) {
    const card = object(rawCard);
    const questionId = string(card.id);
    if (!questionId) continue;
    const linkedLeaves = leafIdsByObjective.get(string(card.objectiveId)) ?? [];
    for (const leafId of linkedLeaves) {
      if (typeof leafId !== "string") continue;
      if (linkedLeaves.length === 1) directByLeaf.get(leafId)?.push(questionId);
      else possibleByLeaf.get(leafId)?.push(questionId);
    }
  }
  return { status: "recorded", value: (selected as string[]).map((leafId) => {
    const directQuestionIds = [...new Set(directByLeaf.get(leafId) ?? [])];
    const possibleQuestionIds = [...new Set(possibleByLeaf.get(leafId) ?? [])];
    return {
      leafId,
      title: titleById.get(leafId) ?? leafId,
      directQuestionIds,
      possibleQuestionIds,
      directQuestionCount: directQuestionIds.length,
      ambiguous: possibleQuestionIds.length > 0,
    };
  }) };
}

async function authoringSummary(id: string): Promise<McpRunSummary | null> {
  const entry = authoringRecords.find((record) => record.id === id);
  if (!entry) return null;
  const base = path.join(process.cwd(), "tools/problem-authoring-lab/runs");
  const [record, packet] = await Promise.all([
    readWithin<Record<string, unknown>>(base, entry.documentFile),
    readWithin<Record<string, unknown>>(base, entry.packetFile),
  ]);
  if (!record || !packet || object(packet.value.origin).runId !== entry.originRunId ||
    (entry.documentSha256 && sha256(record.raw) !== entry.documentSha256) ||
    (entry.packetSha256 && sha256(packet.raw) !== entry.packetSha256)) return null;
  if (entry.packetSha256) {
    const sourceRun = await getMcpRunView(`mcp:${entry.originRunId}`);
    if (!sourceRun || object(packet.value.origin).sourceRunSha256 !== sourceRun.source.fileSha256) return null;
  }
  return {
    id: `authoring:${entry.id}`,
    kind: "authoring-lab",
    title: string(record.value.title) ?? entry.id,
    status: "completed",
    createdAt: null,
    updatedAt: null,
    relatedRunId: `mcp:${entry.originRunId}`,
  };
}

export async function listMcpRunViews(): Promise<McpRunSummary[]> {
  const found = new Map<string, McpRunSummary>();
  for (const root of roots()) {
    for (const rawId of root.ids) {
      const run = await getMcpRunView(`mcp:${rawId}`);
      if (run) found.set(run.id, {
        id: run.id,
        kind: run.kind,
        title: run.title,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        relatedRunId: run.relatedRunId,
        executionRequestId: run.executionRequestId,
        executionRequestStatus: run.executionRequestStatus,
      });
    }
  }
  const localRoot = roots().find((root) => root.label === "local-data")!;
  let localIds: string[] = [];
  try {
    localIds = (await readdir(localRoot.directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && runIdPattern.test(entry.name))
      .slice(0, 500).map((entry) => entry.name);
  } catch { /* No locally preserved MCP runs. */ }
  for (const rawId of localIds) {
    const run = await getMcpRunView(`mcp:${rawId}`);
    if (run) found.set(run.id, {
      id: run.id, kind: run.kind, title: run.title, status: run.status,
      createdAt: run.createdAt, updatedAt: run.updatedAt, relatedRunId: run.relatedRunId,
      executionRequestId: run.executionRequestId,
      executionRequestStatus: run.executionRequestStatus,
      requestRecordStatus: run.requestRecordStatus,
    });
  }
  for (const request of await listExperimentRequests()) {
    if (request.status !== "completed" || !request.runId) continue;
    const run = await getMcpRunView(`mcp:${request.runId}`);
    if (run) found.set(run.id, {
      id: run.id,
      kind: run.kind,
      title: run.title,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      relatedRunId: run.relatedRunId,
      executionRequestId: run.executionRequestId,
      executionRequestStatus: run.executionRequestStatus,
      requestRecordStatus: run.requestRecordStatus,
    });
  }
  for (const entry of authoringRecords) {
    const authoring = await authoringSummary(entry.id);
    if (authoring) found.set(authoring.id, authoring);
  }
  return [...found.values()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getMcpRunView(id: string): Promise<McpRunDetail | null> {
  const [kind, rawId, ...rest] = id.split(":");
  if (rest.length > 0 || !rawId || !runIdPattern.test(rawId)) return null;
  if (kind === "mcp") {
    const request = (await listExperimentRequests()).find((item) =>
      item.status === "completed" && item.runId === rawId);
    for (const root of roots()) {
      if (root.label === "product-eval" && !root.ids.includes(rawId)) continue;
      if (root.label === "mcp-exec" && !root.ids.includes(rawId) && !request) continue;
      const relativeFile = `${rawId}/run.json`;
      const record = await readWithin<StoredRun>(root.directory, relativeFile);
      if (!record) continue;
      const base = summary(record.value);
      if (!base || base.id !== id) continue;
      if (request && !(await verifyRequestRun(record.value, request))) continue;
      if (root.label === "local-data" && !request && !(await verifyRequestlessLocalRun(record.value))) continue;
      const selected = record.value.selectedOutlineLeafIds;
      return {
        ...base,
        ...(request && request.input.stopAfterStage !== "cards" ? { status: "stopped" as const } : {}),
        ...(request ? { executionRequestId: request.id, executionRequestStatus: "completed" as const } : {}),
        ...(root.label === "local-data" && !request ? { requestRecordStatus: "not-recorded" as const } : {}),
        source: { root: root.label, relativeFile, fileSha256: sha256(record.raw) },
        config: record.value.config === undefined ? { status: "not-recorded" } : { status: "recorded", value: record.value.config },
        selectedOutlineLeafIds: Array.isArray(selected) && selected.every((item) => typeof item === "string")
          ? { status: "recorded", value: selected as string[] }
          : { status: "not-recorded" },
        outlineCoverage: outlineCoverage(record.value),
        stages: stageViews(record.value, await recordedStageInputs(record.value), request),
        authoring: { status: "not-recorded" },
        executionRequest: request ? {
          id: request.id,
          status: "completed",
          sourceId: request.input.sourceId,
          stopAfterStage: request.input.stopAfterStage,
          requestedStages: request.input.requestedStages,
        } : null,
        executionAudit: request ? await executionAudit(request) : null,
        provenanceNote: request
          ? `${request.id === copiedAnalyzeRequestId ? "검수 정정: 이 Analyze 결과의 문자열은 이전 기하 run 제출값을 그대로 복사했습니다. 새 AI 분석이나 '재사용하지 않음' 실험의 성공 증거가 아닙니다. 브라우저 요청부터 MCP 제출·저장까지의 연결만 검증했습니다. " : ""}단계 출력은 보존 run.json 원본 artifact입니다. 기록된 단계 입력은 MCP 응답의 stageInput 스냅샷이며 호스트 모델에 전달된 전체 대화나 PDF 읽기 문맥은 아닙니다. 모델·추론 강도·입력 해시·시간은 실행 담당의 보고값이며 MCP 자체의 독립 계측이 아닙니다. 시간은 도구 호출 구간으로 AI 추론 시간이 아닙니다. 종료 후 다음 단계의 MCP 입력 준비 시각이 남아도 모델 실행으로 보지 않습니다. 요청은 지정 단계에서 끝났지만 MCP run 자체는 계속 가능한 상태일 수 있습니다. 목차별 문항 연결은 비독점으로 계산합니다.`
          : `${root.label === "local-data" ? "요청 기록 없음. 등록된 원본 PDF의 실제 SHA-256과 보존 실행의 자료 정보가 일치합니다. " : ""}단계 출력은 보존 run.json의 원본 artifact입니다. 기록된 단계 입력은 MCP 응답의 stageInput 스냅샷이며 호스트 모델에 전달된 전체 대화나 PDF 읽기 문맥은 아닙니다. 모델·추론 강도는 이 파일에 기록되지 않았습니다. 출력 해시는 열람 시 계산한 값입니다. 목차별 문항 연결은 objective ID를 따라 계산한 비독점 연결이며, 여러 목차에 묶인 목표의 문항은 가능 연결로만 표시합니다.`,
      };
    }
  }
  const authoringEntry = authoringRecords.find((entry) => entry.id === rawId);
  if (kind === "authoring" && authoringEntry) {
    const runRoot = path.join(process.cwd(), "tools/problem-authoring-lab/runs");
    const [document, packet, cycle] = await Promise.all([
      readWithin<unknown>(runRoot, authoringEntry.documentFile),
      readWithin<unknown>(runRoot, authoringEntry.packetFile),
      authoringEntry.id === authoringId
        ? readFile(path.join(runRoot, authoringId, "CYCLE.md"), "utf8").catch(() => null)
        : Promise.resolve(authoringEntry.id === "integrated-geometry-sol-20260928-r02"
          ? "이 문서는 이전 authoring r01 iteration-1을 부모 SHA로 참조하는 새 r02 iteration-1 개정본입니다. 기하 p6은 좌표 복원 단답과 h≠0 이유·h=1 표현을 구별하는 객관식으로 나뉩니다. 후자는 보기 인식 평가이며 무힌트 설명 평가는 아닙니다. 원본 MCP 산출물은 변경하지 않았습니다."
          : "MCP Cards를 별도 출제 편집틀에 배치·수정한 iteration-1입니다. 원본 MCP 산출물은 변경하지 않았습니다."),
    ]);
    if (!document || !packet || !cycle) return null;
    const base = await authoringSummary(authoringEntry.id);
    if (!base) return null;
    return {
      ...base,
      source: { root: "authoring-lab", relativeFile: authoringEntry.documentFile, fileSha256: sha256(document.raw) },
      config: { status: "not-recorded" },
      selectedOutlineLeafIds: { status: "not-recorded" },
      outlineCoverage: { status: "not-recorded" },
      stages: [],
      authoring: { status: "recorded", value: { sourcePacket: packet.value, document: document.value, cycleNote: cycle } },
      executionRequest: null,
      executionAudit: null,
      provenanceNote: "별도 문제 출제 실험입니다. MCP 5단계 결과로 위장하지 않으며 연결 ID는 출처 패킷의 원 실행을 가리킵니다. 원천 run의 목차 연결이 과포괄적인 경우 문항별 실제 평가 대상과 동일하다고 가정하지 않습니다.",
    };
  }
  return null;
}

/** Read an already allowlisted and verified run for MCP prefix reuse without accepting a path from the caller. */
export async function readVerifiedMcpRunRaw(id: string): Promise<string | null> {
  const view = await getMcpRunView(id);
  if (!view || view.kind !== "mcp-pipeline") return null;
  const root = roots().find((entry) => entry.label === view.source.root);
  if (!root) return null;
  const record = await readWithin<StoredRun>(root.directory, view.source.relativeFile);
  return record && sha256(record.raw) === view.source.fileSha256 ? record.raw : null;
}
