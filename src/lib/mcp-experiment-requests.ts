import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveMcpSource } from "./mcp-source-registry.ts";

export const experimentStages = ["analyze", "concept-tree", "learning-design", "activity-design", "cards"] as const;
const stageSchema = z.enum(experimentStages);
const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]);
const modelSchema = z.enum(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"]);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const runIdSchema = z.string().trim().min(1).max(200).regex(/^[\w:.-]+$/);
const requestIdSchema = z.string().regex(/^req_[a-f0-9]{32}$/);
const settingsSchema = z.strictObject({ model: modelSchema, effort: effortSchema }).superRefine((settings, context) => {
  if (settings.model === "gpt-6-luna" && settings.effort === "ultra") {
    context.addIssue({ code: "custom", path: ["effort"], message: "gpt-6-luna 모델은 ultra 추론 강도를 지원하지 않습니다. max 이하를 선택하세요." });
  }
});

export const createExperimentRequestSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(100).regex(/^(?:geometric-transformations|semiconductor|src_[a-f0-9]{64})$/),
  scope: z.strictObject({
    pageNumbers: z.array(z.number().int().positive()).max(500),
    outlineLeafIds: z.array(z.string().trim().min(1).max(200).regex(/^[\w:.-]+$/)).max(100),
  }),
  purpose: z.string().trim().min(1).max(2000),
  requestedStages: z.partialRecord(stageSchema, settingsSchema),
  stopAfterStage: stageSchema,
  reuse: z.strictObject({ kind: z.enum(["input", "output"]), runId: runIdSchema, stage: stageSchema, sha256: hashSchema }).optional(),
  selectedObjectiveIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
}).superRefine((input, context) => {
  if (!input.scope.pageNumbers.length && !input.scope.outlineLeafIds.length) {
    context.addIssue({ code: "custom", path: ["scope"], message: "페이지나 목차 범위를 하나 이상 선택해야 합니다." });
  }
  if (new Set(input.scope.pageNumbers).size !== input.scope.pageNumbers.length ||
    input.scope.pageNumbers.some((page) => page > 500)) {
    context.addIssue({ code: "custom", path: ["scope", "pageNumbers"], message: "중복되거나 자료 범위를 벗어난 페이지입니다." });
  }
  if (new Set(input.scope.outlineLeafIds).size !== input.scope.outlineLeafIds.length) {
    context.addIssue({ code: "custom", path: ["scope", "outlineLeafIds"], message: "목차 항목이 중복되었습니다." });
  }
  const last = experimentStages.indexOf(input.stopAfterStage);
  for (const stage of experimentStages.slice(0, last + 1)) {
    if (!input.requestedStages[stage]) context.addIssue({ code: "custom", path: ["requestedStages", stage], message: "이 단계의 요청 모델이 필요합니다." });
  }
  for (const stage of experimentStages.slice(last + 1)) {
    if (input.requestedStages[stage]) context.addIssue({ code: "custom", path: ["requestedStages", stage], message: "중단 단계 이후 모델을 요청할 수 없습니다." });
  }
  if (input.reuse && experimentStages.indexOf(input.reuse.stage) > last) {
    context.addIssue({ code: "custom", path: ["reuse", "stage"], message: "재사용 단계는 중단 단계 이하여야 합니다." });
  }
  if (input.selectedObjectiveIds) {
    if (new Set(input.selectedObjectiveIds).size !== input.selectedObjectiveIds.length) {
      context.addIssue({ code: "custom", path: ["selectedObjectiveIds"], message: "선택한 학습목표 ID가 중복되었습니다." });
    }
    if (last < experimentStages.indexOf("activity-design") || input.reuse?.kind !== "output" || input.reuse.stage !== "learning-design") {
      context.addIssue({ code: "custom", path: ["selectedObjectiveIds"], message: "선택한 목표만 출제하려면 완료된 학습 설계 결과를 재사용해야 합니다." });
    }
  }
});

const actualSchema = z.strictObject({
  model: z.string().trim().min(1).max(100),
  effort: effortSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  inputSha256: hashSchema,
  outputSha256: hashSchema,
  reusedFrom: z.strictObject({ kind: z.enum(["input", "output"]), runId: runIdSchema, stage: stageSchema, sha256: hashSchema }).optional(),
}).refine((value) => Date.parse(value.finishedAt) >= Date.parse(value.startedAt), "종료 시각이 시작 시각보다 빨라서는 안 됩니다.");

export const progressSchema = z.strictObject({
  claimToken: z.string().regex(/^[a-f0-9]{64}$/),
  stage: stageSchema,
  runId: runIdSchema,
  actual: actualSchema,
  output: z.unknown().refine((value) => value !== undefined && value !== null, "단계 결과가 필요합니다."),
});
export const failSchema = z.strictObject({ claimToken: z.string().regex(/^[a-f0-9]{64}$/), message: z.string().trim().min(1).max(2000) });
export type CreateExperimentRequest = z.infer<typeof createExperimentRequestSchema>;
export type StageProgress = z.infer<typeof progressSchema>;
type StageResult = Omit<StageProgress, "claimToken"> & {
  provenance: "executor-reported";
  executionMode?: "reused-output" | "model-generated";
};
type ExperimentStatus = "waiting-for-executor" | "claimed" | "running" | "completed" | "failed";
export type ExperimentRequest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ExperimentStatus;
  input: CreateExperimentRequest;
  sourceSnapshot?: { id: string; fileName: string; pageCount: number; sha256: string };
  runId: string | null;
  stages: StageResult[];
  failure: string | null;
  claimedAt: string | null;
  claimTokenHash: string | null;
};

export class ExperimentRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function directory() {
  return path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "mcp-experiment-requests");
}
function requestPath(id: string) {
  if (!requestIdSchema.safeParse(id).success) throw new ExperimentRequestError(400, "잘못된 요청 ID입니다.");
  return path.join(directory(), `${id}.json`);
}
function publicRequest(record: ExperimentRequest): Omit<ExperimentRequest, "claimTokenHash"> {
  const { claimTokenHash: _claimTokenHash, ...publicRecord } = record;
  void _claimTokenHash;
  return publicRecord;
}
async function readRecord(id: string): Promise<ExperimentRequest | null> {
  try { return JSON.parse(await readFile(requestPath(id), "utf8")) as ExperimentRequest; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function persist(record: ExperimentRequest) {
  await mkdir(directory(), { recursive: true });
  const temporary = path.join(directory(), `${record.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    await rename(temporary, requestPath(record.id));
  } finally { await rm(temporary, { force: true }); }
}

// Directory creation is atomic across Node processes. No stale-lock stealing: a crashed writer
// produces a visible 503 instead of allowing two hosts to claim the same request.
async function locked<T>(operation: () => Promise<T>): Promise<T> {
  await mkdir(directory(), { recursive: true });
  const lock = path.join(directory(), ".write-lock");
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock);
      try {
        await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
        return await operation();
      }
      finally { await rm(lock, { recursive: true, force: true }); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Only reclaim a lock from a dead process. A fresh lock without owner.json may
      // belong to a process still creating it, so it must age before reclamation.
      try {
        const info = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as { pid?: number; createdAt?: number };
        if (typeof info.pid === "number" && typeof info.createdAt === "number" && Date.now() - info.createdAt > 10_000) {
          let alive = true;
          try { process.kill(info.pid, 0); } catch (probe) { alive = (probe as NodeJS.ErrnoException).code !== "ESRCH"; }
          if (!alive) await rm(lock, { recursive: true, force: true });
        }
      } catch {
        try { if (Date.now() - (await stat(lock)).mtimeMs > 10_000) await rm(lock, { recursive: true, force: true }); }
        catch { /* Another process released the lock. */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new ExperimentRequestError(503, "요청 저장소 잠금이 남아 있습니다. 로컬 실행자 상태를 확인하세요.");
}
function requireClaim(record: ExperimentRequest, token: string) {
  const actualHash = createHash("sha256").update(token).digest("hex");
  if (!record.claimTokenHash || record.claimTokenHash !== actualHash || !["claimed", "running"].includes(record.status)) {
    throw new ExperimentRequestError(409, "이 요청의 실행 권한이 없거나 이미 종료되었습니다.");
  }
}

export async function createExperimentRequest(input: unknown) {
  const parsed = createExperimentRequestSchema.parse(input);
  const source = await resolveMcpSource(parsed.sourceId);
  if (!source) throw new ExperimentRequestError(404, "등록된 원본 PDF를 찾지 못했습니다.");
  if (parsed.scope.pageNumbers.some((page) => page > source.pageCount)) {
    throw new ExperimentRequestError(400, "자료 범위를 벗어난 페이지입니다.");
  }
  return locked(async () => {
    const now = new Date().toISOString();
    const record: ExperimentRequest = {
      id: `req_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now,
      status: "waiting-for-executor", input: parsed, sourceSnapshot: source, runId: null, stages: [], failure: null,
      claimedAt: null, claimTokenHash: null,
    };
    await persist(record);
    return publicRequest(record);
  });
}
export async function listExperimentRequests() {
  await mkdir(directory(), { recursive: true });
  const names = (await readdir(directory())).filter((name) => /^req_[a-f0-9]{32}\.json$/.test(name));
  const records = await Promise.all(names.map((name) => readRecord(name.slice(0, -5))));
  return records.filter((record): record is ExperimentRequest => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicRequest);
}
export async function getExperimentRequest(id: string) {
  const record = await readRecord(id);
  if (!record) throw new ExperimentRequestError(404, "요청을 찾지 못했습니다.");
  return publicRequest(record);
}
export async function claimExperimentRequest(id: string) {
  return locked(async () => {
    const record = await readRecord(id);
    if (!record) throw new ExperimentRequestError(404, "요청을 찾지 못했습니다.");
    if (record.status !== "waiting-for-executor") throw new ExperimentRequestError(409, "이미 다른 실행자가 가져간 요청입니다.");
    if (record.sourceSnapshot) {
      const current = await resolveMcpSource(record.input.sourceId);
      if (!current || current.sha256 !== record.sourceSnapshot.sha256 || current.pageCount !== record.sourceSnapshot.pageCount) {
        throw new ExperimentRequestError(409, "등록 당시 원본 PDF를 확인할 수 없거나 변경되었습니다.");
      }
    }
    const claimToken = randomBytes(32).toString("hex");
    record.claimTokenHash = createHash("sha256").update(claimToken).digest("hex");
    record.status = "claimed";
    record.claimedAt = new Date().toISOString();
    record.updatedAt = record.claimedAt;
    await persist(record);
    return { request: publicRequest(record), claimToken };
  });
}
export async function recordExperimentProgress(id: string, input: unknown, finish = false) {
  const update = progressSchema.parse(input);
  return locked(async () => {
    const record = await readRecord(id);
    if (!record) throw new ExperimentRequestError(404, "요청을 찾지 못했습니다.");
    requireClaim(record, update.claimToken);
    const next = experimentStages[record.stages.length];
    if (update.stage !== next || experimentStages.indexOf(update.stage) > experimentStages.indexOf(record.input.stopAfterStage)) {
      throw new ExperimentRequestError(409, "다음 단계와 일치하지 않습니다.");
    }
    if (finish !== (update.stage === record.input.stopAfterStage)) {
      throw new ExperimentRequestError(409, "마지막 단계는 완료 경로로만 기록해야 합니다.");
    }
    if (record.runId && record.runId !== update.runId) throw new ExperimentRequestError(409, "실행 ID가 앞 단계와 다릅니다.");
    if (record.input.reuse) {
      const reuse = record.input.reuse;
      const prefixReuse = reuse.kind === "output" && experimentStages.indexOf(update.stage) <= experimentStages.indexOf(reuse.stage);
      const expectedReuse = prefixReuse || update.stage === reuse.stage;
      const reported = update.actual.reusedFrom;
      if (expectedReuse !== Boolean(reported) || (reported && (reported.kind !== reuse.kind ||
        reported.runId !== reuse.runId || reported.stage !== update.stage ||
        (update.stage === reuse.stage && reported.sha256 !== reuse.sha256) ||
        (reuse.kind === "output" && reported.sha256 !== update.actual.outputSha256)))) {
        throw new ExperimentRequestError(409, "요청한 재사용 prefix와 실제 단계별 출처 기록이 다릅니다. 지원하지 않으면 실패로 보고하세요.");
      }
    } else if (update.actual.reusedFrom) {
      throw new ExperimentRequestError(409, "요청하지 않은 결과 재사용은 기록할 수 없습니다.");
    }
    if (record.input.selectedObjectiveIds && update.stage === "activity-design") {
      const design = (update.output as { learningDesign?: { objectives?: Array<{ id?: unknown }> } } | null)?.learningDesign;
      const actualIds = design?.objectives?.map((item) => item.id);
      if (!actualIds || actualIds.length !== record.input.selectedObjectiveIds.length ||
        actualIds.some((id) => typeof id !== "string" || !record.input.selectedObjectiveIds!.includes(id))) {
        throw new ExperimentRequestError(409, "문제 설계 결과가 선택한 학습목표 범위와 다릅니다.");
      }
    }
    if (record.input.selectedObjectiveIds && update.stage === "cards") {
      const cards = (update.output as { cards?: Array<{ objectiveId?: unknown }> } | null)?.cards;
      if (!Array.isArray(cards) || cards.some((card) => typeof card.objectiveId !== "string" ||
        !record.input.selectedObjectiveIds!.includes(card.objectiveId))) {
        throw new ExperimentRequestError(409, "생성된 문제에 선택하지 않은 학습목표가 포함되었습니다.");
      }
    }
    record.runId = update.runId;
    record.stages.push({ stage: update.stage, runId: update.runId, actual: update.actual, output: update.output,
      provenance: "executor-reported", executionMode: update.actual.reusedFrom?.kind === "output" ? "reused-output" : "model-generated" });
    record.status = finish ? "completed" : "running";
    record.updatedAt = new Date().toISOString();
    await persist(record);
    return publicRequest(record);
  });
}
export async function failExperimentRequest(id: string, input: unknown) {
  const update = failSchema.parse(input);
  return locked(async () => {
    const record = await readRecord(id);
    if (!record) throw new ExperimentRequestError(404, "요청을 찾지 못했습니다.");
    requireClaim(record, update.claimToken);
    record.status = "failed";
    record.failure = update.message;
    record.updatedAt = new Date().toISOString();
    await persist(record);
    return publicRequest(record);
  });
}
