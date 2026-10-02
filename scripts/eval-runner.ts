import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const SUPPORTED_FROM_STAGES = [
  "recall",
  "prepare",
  "cards",
  "critic",
] as const;

export type RunnerStage = (typeof SUPPORTED_FROM_STAGES)[number];

const PIPELINE_STAGES = ["analyze", "plan", ...SUPPORTED_FROM_STAGES] as const;
const RUN_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z__[a-z0-9-]+__[a-z0-9-]+__r[0-9]{2,3}$/;
const CASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const STAGE_FILES = {
  analyze: "stages/10-analyze.json",
  plan: "stages/20-plan.json",
  recall: "stages/30-recall.json",
  prepare: "stages/40-prepare.json",
  cards: "stages/50-cards.json",
  critic: "stages/60-critic.json",
  finalCards: "stages/70-final-cards.json",
} as const;

const modelOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  })
  .strict();

const learningSampleSchema = z
  .object({
    title: z.string(),
    cue: z.string(),
    target: z.string(),
    supportingInfo: z.string(),
  })
  .strict();

export const runnerOverrideSchema = z
  .object({
    artifactType: z.literal("study-forge-eval-run-override").optional(),
    artifactVersion: z.literal("v0").optional(),
    recall: z
      .object({
        optionId: z.string().min(1).optional(),
        variantId: z.string().min(1).optional(),
        representativeExample: learningSampleSchema.optional(),
      })
      .strict()
      .optional(),
    models: z
      .object({
        recall: modelOverrideSchema.optional(),
        prepare: modelOverrideSchema.optional(),
        cards: modelOverrideSchema.optional(),
        critic: modelOverrideSchema.optional(),
      })
      .strict()
      .optional(),
    stageInstructions: z
      .object({
        recall: z.string().min(1).optional(),
        prepare: z.string().min(1).optional(),
        cards: z.string().min(1).optional(),
        critic: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    sourceContext: z
      .object({
        text: z.string().min(1).optional(),
        files: z
          .array(
            z
              .object({
                path: z.string().min(1),
                mimeType: z.literal("application/pdf").default("application/pdf"),
              })
              .strict(),
          )
          .max(20)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RunnerOverride = z.infer<typeof runnerOverrideSchema>;

type JsonRecord = Record<string, unknown>;

export type RunnerOptions = {
  caseId: string;
  sourceRunId: string;
  fromStage: RunnerStage;
  label: string;
  overrideFile?: string;
  dryRun: boolean;
  repoRoot?: string;
};

type RunManifestInput = {
  runId: string;
  caseId: string;
  sourceRunId: string;
  fromStage: RunnerStage;
  frozenStages: readonly string[];
  executedStages: readonly string[];
  startedAt: string;
  completedAt: string;
  git: JsonRecord;
  promptChecksums: JsonRecord;
  modelConfiguration: JsonRecord;
  overridePath: string | null;
  overrideChecksum: string | null;
  stageLineage: JsonRecord;
};

type SourceRun = {
  directory: string;
  run: JsonRecord;
  inputs: JsonRecord;
  checksums: JsonRecord;
  stages: Record<string, JsonRecord>;
  stageBytes: Record<string, Buffer>;
};

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}이 객체가 아닙니다.`);
  }
  return value as JsonRecord;
}

function readPath(value: unknown, keys: string[]) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as JsonRecord)[key];
  }
  return current;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function mergeOverride<T>(source: T, override: Partial<T>): T {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return clone(override as T);
  }
  const result = clone(source) as JsonRecord;
  for (const [key, value] of Object.entries(override as JsonRecord)) {
    const current = result[key];
    result[key] =
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
        ? mergeOverride(current, value)
        : clone(value);
  }
  return result as T;
}

export function calculateStagePlan(fromStage: RunnerStage) {
  const start = PIPELINE_STAGES.indexOf(fromStage);
  if (start < 0) throw new Error(`지원하지 않는 from-stage입니다: ${fromStage}`);
  return {
    frozenStages: PIPELINE_STAGES.slice(0, start),
    executedStages: PIPELINE_STAGES.slice(start).filter(
      (stage): stage is RunnerStage =>
        SUPPORTED_FROM_STAGES.includes(stage as RunnerStage),
    ),
  };
}

export function parseOverride(value: unknown) {
  return runnerOverrideSchema.parse(value);
}

export function buildRunManifest(input: RunManifestInput) {
  return {
    artifactType: "study-forge-eval-run",
    artifactVersion: "v0",
    runId: input.runId,
    caseId: input.caseId,
    runKind: "exploratory",
    provenance: "eval-runner-v1",
    status: "completed",
    sourceRunId: input.sourceRunId,
    fromStage: input.fromStage,
    frozenStages: [...input.frozenStages],
    executedStages: [...input.executedStages],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    code: {
      ...input.git,
      runtimePromptChecksums: input.promptChecksums,
    },
    modelConfiguration: input.modelConfiguration,
    overrideFile: input.overridePath,
    overrideChecksum: input.overrideChecksum,
    stageLineage: input.stageLineage,
    stageFiles: STAGE_FILES,
  };
}

function sanitizeLabel(value: string) {
  const label = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!label) throw new Error("--label은 영문/숫자를 포함해야 합니다.");
  return label;
}

function timestampId(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function allocateRunId(outputRoot: string, label: string, now: Date) {
  const timestamp = timestampId(now);
  for (let index = 1; index <= 999; index += 1) {
    const runId = `${timestamp}__${label}__exploratory__r${String(index).padStart(2, "0")}`;
    if (!(await exists(path.join(outputRoot, runId)))) return runId;
  }
  throw new Error("새 run ID를 할당하지 못했습니다.");
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function locateSourceRun(
  repoRoot: string,
  caseId: string,
  sourceRunId: string,
) {
  if (!CASE_ID_PATTERN.test(caseId)) throw new Error(`유효하지 않은 case ID입니다: ${caseId}`);
  if (!RUN_ID_PATTERN.test(sourceRunId)) throw new Error(`유효하지 않은 source run ID입니다: ${sourceRunId}`);
  const directory = path.join(repoRoot, "eval", "runs", caseId, sourceRunId);
  if (!(await exists(path.join(directory, "run.json")))) {
    throw new Error(`source run을 찾을 수 없습니다: ${sourceRunId}`);
  }
  return directory;
}

export async function loadSourceRun(
  repoRoot: string,
  caseId: string,
  sourceRunId: string,
): Promise<SourceRun> {
  const directory = await locateSourceRun(repoRoot, caseId, sourceRunId);
  const run = asRecord(await readJson(path.join(directory, "run.json")), "run.json");
  const inputs = asRecord(await readJson(path.join(directory, "inputs.json")), "inputs.json");
  const checksums = asRecord(await readJson(path.join(directory, "checksums.json")), "checksums.json");
  const checksumFiles = asRecord(checksums.files, "checksums.files");
  const stages: Record<string, JsonRecord> = {};
  const stageBytes: Record<string, Buffer> = {};

  for (const [stage, relativePath] of Object.entries(STAGE_FILES)) {
    const fullPath = path.join(directory, relativePath);
    if (!(await exists(fullPath))) throw new Error(`필요한 source artifact가 없습니다: ${relativePath}`);
    const bytes = await readFile(fullPath);
    const expected = checksumFiles[relativePath];
    if (typeof expected !== "string" || sha256(bytes) !== expected) {
      throw new Error(`source artifact checksum이 일치하지 않습니다: ${relativePath}`);
    }
    stages[stage] = asRecord(JSON.parse(bytes.toString("utf8")), relativePath);
    stageBytes[stage] = bytes;
  }

  return { directory, run, inputs, checksums, stages, stageBytes };
}

function getStageResponse(source: SourceRun, stage: string) {
  const response = source.stages[stage]?.response;
  if (response === null || response === undefined) {
    throw new Error(`${stage} stage response가 없습니다.`);
  }
  return response;
}

function resolveRecallSelection(
  recallResponse: unknown,
  sourceInputs: JsonRecord,
  override: RunnerOverride,
) {
  const recall = asRecord(recallResponse, "recall response");
  const draft = asRecord(recall.recallDesign, "recallDesign");
  const options = Array.isArray(draft.options) ? draft.options : [];
  const sourceSelections = asRecord(sourceInputs.userSelections, "inputs.userSelections");
  const sourceOptionId = readPath(sourceSelections, ["recallOption", "id"]);
  const sourceVariantId = readPath(sourceSelections, ["recallVariant", "id"]);
  const optionId = override.recall?.optionId ?? sourceOptionId;
  const option = options.find(
    (item) => item && typeof item === "object" && (item as JsonRecord).id === optionId,
  ) as JsonRecord | undefined;
  if (!option) throw new Error(`선택할 recall option을 찾을 수 없습니다: ${String(optionId)}`);
  const variants = Array.isArray(option.variants) ? option.variants : [];
  const variantId = override.recall?.variantId ?? sourceVariantId;
  const variant = variants.find(
    (item) => item && typeof item === "object" && (item as JsonRecord).id === variantId,
  ) as JsonRecord | undefined;
  if (!variant) throw new Error(`선택할 recall variant를 찾을 수 없습니다: ${String(variantId)}`);
  const representativeExample =
    override.recall?.representativeExample ?? variant.sample;
  return {
    draft,
    selected: { selectedOption: clone(option), selectedVariant: clone(variant) },
    representativeExample: clone(representativeExample),
  };
}

export function validateDependencies(
  source: SourceRun,
  fromStage: RunnerStage,
  override: RunnerOverride,
) {
  const { frozenStages } = calculateStagePlan(fromStage);
  for (const stage of frozenStages) getStageResponse(source, stage);
  const plan = asRecord(getStageResponse(source, "plan"), "plan response");
  if (!plan.effectiveStudyGuideline) throw new Error("plan.effectiveStudyGuideline이 없습니다.");
  if (fromStage !== "recall") {
    resolveRecallSelection(getStageResponse(source, "recall"), source.inputs, override);
  }
  if (fromStage === "cards" || fromStage === "critic") {
    const prepared = asRecord(getStageResponse(source, "prepare"), "prepare response");
    if (!prepared.analysis || !prepared.organizedMaterial) {
      throw new Error("prepare stage에 analysis 또는 organizedMaterial이 없습니다.");
    }
  }
  if (fromStage === "critic" && !Array.isArray(getStageResponse(source, "cards"))) {
    throw new Error("critic 입력으로 사용할 generated cards가 배열이 아닙니다.");
  }
  if (
    (fromStage === "recall" || fromStage === "prepare") &&
    !override.sourceContext?.text &&
    !override.sourceContext?.files?.length
  ) {
    throw new Error(
      `${fromStage}부터 재실행하려면 override.sourceContext.text 또는 sourceContext.files가 필요합니다. legacy run에는 원문 bytes가 없습니다.`,
    );
  }
}

export function getGitInfo(repoRoot: string) {
  try {
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { gitCommit, gitDirty: status.trim().length > 0 };
  } catch {
    return { gitCommit: null, gitDirty: null };
  }
}

async function loadOverride(repoRoot: string, overrideFile?: string) {
  if (!overrideFile) return { value: {} as RunnerOverride, path: null, checksum: null };
  const resolved = path.resolve(repoRoot, overrideFile);
  const bytes = await readFile(resolved);
  const parsed = parseOverride(JSON.parse(bytes.toString("utf8")));
  return {
    value: parsed,
    path: path.relative(repoRoot, resolved).replaceAll(path.sep, "/"),
    checksum: sha256(bytes),
  };
}

async function loadPdfInputs(repoRoot: string, override: RunnerOverride) {
  const files = override.sourceContext?.files ?? [];
  return Promise.all(
    files.map(async (entry) => {
      const resolved = path.resolve(repoRoot, entry.path);
      const bytes = await readFile(resolved);
      const info = await stat(resolved);
      return {
        pipeline: {
          filename: path.basename(resolved),
          mimeType: entry.mimeType,
          base64: bytes.toString("base64"),
        },
        metadata: {
          name: path.basename(resolved),
          mimeType: entry.mimeType,
          size: info.size,
          sha256: sha256(bytes),
        },
      };
    }),
  );
}

export function currentModelConfiguration(modelConfig: JsonRecord, override: RunnerOverride) {
  const defaults = {
    recall: modelConfig.default,
    prepare: modelConfig.extraction,
    cards: modelConfig.default,
    critic: modelConfig.critic,
  };
  return mergeOverride(defaults, override.models ?? {});
}

function runtimeFor(stage: RunnerStage, override: RunnerOverride) {
  return {
    ...(override.models?.[stage] ?? {}),
    instruction: override.stageInstructions?.[stage],
  };
}

export function createStageArtifact({
  runId,
  stage,
  modelConfiguration,
  inputRefs,
  request,
  response,
  sourceRunId,
}: {
  runId: string;
  stage: string;
  modelConfiguration: unknown;
  inputRefs: string[];
  request: unknown;
  response: unknown;
  sourceRunId: string | null;
}) {
  return {
    artifactType: "study-forge-stage-artifact",
    artifactVersion: "v0",
    runId,
    stage,
    status: "executed",
    sourceRunId,
    sourceArtifact: null,
    capturedAt: new Date().toISOString(),
    modelConfiguration,
    inputRefs,
    request,
    response,
  };
}

export function deriveObservations(runId: string, prepare: unknown, cards: unknown, critic: unknown, finalCards: unknown) {
  const units = readPath(prepare, ["analysis", "learningUnits"]);
  const learningUnits = Array.isArray(units) ? units : [];
  const generatedCards = Array.isArray(cards) ? cards : [];
  const criticCards = Array.isArray(critic) ? critic : [];
  const final = Array.isArray(finalCards) ? finalCards : [];
  const coverage = Object.fromEntries(
    learningUnits
      .filter((unit) => unit && typeof unit === "object" && typeof (unit as JsonRecord).id === "string")
      .map((unit) => {
        const id = (unit as JsonRecord).id as string;
        return [id, final.filter((card) => readPath(card, ["learningUnitId"]) === id).length];
      }),
  );
  return {
    artifactType: "study-forge-run-observations",
    artifactVersion: "v0",
    runId,
    counts: {
      learningUnits: learningUnits.length,
      generatedCards: generatedCards.length,
      criticCards: criticCards.length,
      finalCards: final.length,
    },
    learningUnitCardCoverageBasis: "finalCards",
    learningUnitCardCoverage: coverage,
    zeroCardLearningUnitIds: Object.entries(coverage).filter(([, count]) => count === 0).map(([id]) => id),
    multipleCardLearningUnitIds: Object.entries(coverage).filter(([, count]) => count >= 2).map(([id]) => id),
    derivation: { type: "mechanical-from-run-stage-artifacts", semanticEvaluationPerformed: false },
    notes: [],
  };
}

export async function promptChecksums(repoRoot: string) {
  const files = [
    "src/lib/pipeline/analyze.ts",
    "src/lib/pipeline/plan.ts",
    "src/lib/pipeline/recall.ts",
    "src/lib/pipeline/generate.ts",
    "src/lib/model-config.ts",
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, sha256(await readFile(path.join(repoRoot, file)))]),
    ),
  );
}

export async function writeRunDirectory(
  repoRoot: string,
  outputDirectory: string,
  artifacts: Map<string, string | Buffer>,
) {
  const temporaryRoot = path.join(repoRoot, "eval", "local", "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "eval-run-"));
  for (const [relativePath, content] of artifacts) {
    const target = path.join(temporaryDirectory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const checksums = {
    artifactType: "study-forge-run-checksums",
    artifactVersion: "v0",
    runId: path.basename(outputDirectory),
    algorithm: "sha256",
    files: Object.fromEntries([...artifacts].map(([file, content]) => [file, sha256(content)])),
  };
  await writeFile(path.join(temporaryDirectory, "checksums.json"), json(checksums));
  await rename(temporaryDirectory, outputDirectory);
}

export function collectFrozenStageArtifacts(
  source: SourceRun,
  frozenStages: readonly string[],
) {
  return new Map(
    frozenStages.map((stage) => {
      const file = STAGE_FILES[stage as keyof typeof STAGE_FILES];
      const bytes = source.stageBytes[stage];
      if (!file || !bytes) throw new Error(`freeze할 source stage가 없습니다: ${stage}`);
      return [file, Buffer.from(bytes)] as const;
    }),
  );
}

function redactOverride(override: RunnerOverride) {
  const redacted = clone(override);
  if (redacted.sourceContext?.files) {
    redacted.sourceContext.files = redacted.sourceContext.files.map((file) => ({
      ...file,
      path: path.basename(file.path),
    }));
  }
  return redacted;
}

function parseCli(argv: string[]): RunnerOptions {
  const values: Record<string, string | boolean> = { "dry-run": false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--dry-run") {
      values["dry-run"] = true;
      continue;
    }
    if (!key.startsWith("--")) throw new Error(`알 수 없는 인수입니다: ${key}`);
    const value = argv[++index];
    if (!value) throw new Error(`${key} 값이 필요합니다.`);
    values[key.slice(2)] = value;
  }
  const fromStage = values["from-stage"];
  if (!SUPPORTED_FROM_STAGES.includes(fromStage as RunnerStage)) {
    throw new Error(`지원하지 않는 from-stage입니다: ${String(fromStage)}`);
  }
  if (typeof values.case !== "string" || typeof values["source-run"] !== "string" || typeof values.label !== "string") {
    throw new Error("--case, --source-run, --from-stage, --label이 필요합니다.");
  }
  return {
    caseId: values.case,
    sourceRunId: values["source-run"],
    fromStage: fromStage as RunnerStage,
    label: values.label,
    overrideFile: typeof values["override-file"] === "string" ? values["override-file"] : undefined,
    dryRun: values["dry-run"] === true,
  };
}

export async function runEval(options: RunnerOptions) {
  const startedAt = new Date().toISOString();
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  try {
    process.loadEnvFile(path.join(repoRoot, ".env.local"));
  } catch {
    // A dry-run can use defaults; an actual run checks the API key below.
  }
  const source = await loadSourceRun(repoRoot, options.caseId, options.sourceRunId);
  const overrideInfo = await loadOverride(repoRoot, options.overrideFile);
  const override = overrideInfo.value;
  validateDependencies(source, options.fromStage, override);
  const plan = calculateStagePlan(options.fromStage);
  const label = sanitizeLabel(options.label);
  const outputRoot = path.join(repoRoot, "eval", "runs", options.caseId);
  const runId = await allocateRunId(outputRoot, label, new Date());
  const outputDirectory = path.join(outputRoot, runId);
  const modelModule = await import("../src/lib/model-config.ts");
  const publicModels = modelModule.getPublicModelConfig() as JsonRecord;
  const models = currentModelConfiguration(publicModels, override);
  const prompts = await promptChecksums(repoRoot);
  const git = getGitInfo(repoRoot);
  const pdfInputs = await loadPdfInputs(repoRoot, override);

  const preview = {
    caseId: options.caseId,
    sourceRunId: options.sourceRunId,
    fromStage: options.fromStage,
    frozenStages: plan.frozenStages,
    executedStages: plan.executedStages,
    override: overrideInfo.path
      ? {
          path: overrideInfo.path,
          checksum: overrideInfo.checksum,
          value: redactOverride(override),
        }
      : null,
    modelConfiguration: models,
    plannedRunId: runId,
    outputPath: path.relative(repoRoot, outputDirectory).replaceAll(path.sep, "/"),
    provenance: {
      git,
      promptChecksums: prompts,
      sourceChecksumsVerified: true,
    },
  };
  if (options.dryRun) return { dryRun: true, preview };

  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");

  const generate = await import("../src/lib/pipeline/generate.ts");
  const recallPipeline = await import("../src/lib/pipeline/recall.ts");
  const artifacts = new Map<string, string | Buffer>();
  const stageLineage: JsonRecord = {};
  for (const [file, bytes] of collectFrozenStageArtifacts(
    source,
    plan.frozenStages,
  )) {
    const stage = Object.entries(STAGE_FILES).find(([, value]) => value === file)?.[0];
    if (!stage) throw new Error(`stage file mapping을 찾을 수 없습니다: ${file}`);
    artifacts.set(file, bytes);
    stageLineage[stage] = {
      status: "frozen",
      sourceRunId: options.sourceRunId,
      sourceArtifact: file,
      checksum: sha256(bytes),
    };
  }

  const sourceSelections = asRecord(source.inputs.userSelections, "inputs.userSelections");
  const planResponse = asRecord(getStageResponse(source, "plan"), "plan response");
  const guideline = planResponse.effectiveStudyGuideline;
  const analyzeResponse = getStageResponse(source, "analyze");
  let recallResponse = getStageResponse(source, "recall");
  if (plan.executedStages.includes("recall")) {
    const draft = await recallPipeline.createRecallDesign(
      analyzeResponse as never,
      guideline as never,
      pdfInputs.map((item) => item.pipeline),
      runtimeFor("recall", override),
    );
    recallResponse = { recallDesign: draft, selectedRecallDesign: null };
  }
  const recallSelection = resolveRecallSelection(recallResponse, source.inputs, override);
  recallResponse = {
    recallDesign: recallSelection.draft,
    selectedRecallDesign: recallSelection.selected,
  };
  if (plan.executedStages.includes("recall")) {
    const file = STAGE_FILES.recall;
    const artifact = createStageArtifact({
      runId,
      stage: "recall",
      modelConfiguration: models.recall,
      inputRefs: [STAGE_FILES.analyze, STAGE_FILES.plan],
      request: { analysis: analyzeResponse, guideline, sourceFiles: pdfInputs.map((item) => item.metadata) },
      response: recallResponse,
      sourceRunId: options.sourceRunId,
    });
    artifacts.set(file, json(artifact));
    stageLineage.recall = { status: "executed", sourceRunId: options.sourceRunId, sourceArtifact: null };
  }

  const effectiveSelections = mergeOverride(sourceSelections, {
    recallOption: recallSelection.selected.selectedOption,
    recallVariant: recallSelection.selected.selectedVariant,
    representativeExample: recallSelection.representativeExample,
  });
  const mode = String(effectiveSelections.cardMode ?? recallSelection.selected.selectedOption.mode ?? "flashcard");
  const generateInput = {
    title: String(readPath(getStageResponse(source, "prepare"), ["organizedMaterial", "title"]) ?? "Eval rerun"),
    subject: "",
    tags: [],
    sourceText: override.sourceContext?.text ?? "",
    instruction: String(effectiveSelections.instruction ?? ""),
    analysisContext: JSON.stringify(analyzeResponse),
    studyGuideline: JSON.stringify(guideline),
    recallDesign: JSON.stringify(recallSelection.selected),
    approvedSample: JSON.stringify(recallSelection.representativeExample),
    sampleFeedback: String(effectiveSelections.sampleFeedback ?? ""),
    activityDesign: "",
    activitySelectionMode: "automatic" as const,
    stage: "prepare" as const,
    preparedAnalysis: "",
    preparedMaterial: "",
    mode: mode as "flashcard" | "cloze" | "translation",
  };

  let prepareResponse = getStageResponse(source, "prepare");
  if (plan.executedStages.includes("prepare")) {
    const analysis = await generate.runAnalysis(
      generateInput,
      pdfInputs.map((item) => item.pipeline),
      runtimeFor("prepare", override),
    );
    prepareResponse = {
      analysis,
      organizedMaterial: generate.buildReviewMaterial(generateInput, analysis),
      cards: [],
    };
    const file = STAGE_FILES.prepare;
    artifacts.set(
      file,
      json(
        createStageArtifact({
          runId,
          stage: "prepare",
          modelConfiguration: models.prepare,
          inputRefs: [STAGE_FILES.analyze, STAGE_FILES.plan, STAGE_FILES.recall],
          request: { ...generateInput, sourceFiles: pdfInputs.map((item) => item.metadata) },
          response: prepareResponse,
          sourceRunId: options.sourceRunId,
        }),
      ),
    );
    stageLineage.prepare = { status: "executed", sourceRunId: options.sourceRunId, sourceArtifact: null };
  }
  const prepared = asRecord(prepareResponse, "prepare response");

  let generatedCards = getStageResponse(source, "cards");
  let criticCards = getStageResponse(source, "critic");
  let finalCards: unknown;
  if (plan.executedStages.includes("cards")) {
    const result = await generate.runCardGeneration(
      generateInput.mode,
      prepared.organizedMaterial as never,
      prepared.analysis as never,
      generateInput.instruction,
      generateInput.studyGuideline,
      generateInput.recallDesign,
      generateInput.approvedSample,
      generateInput.sampleFeedback,
      "",
      { cards: runtimeFor("cards", override), critic: runtimeFor("critic", override) },
    );
    generatedCards = result.baselineTrace.generatedCards;
    criticCards = result.baselineTrace.criticCards;
    finalCards = result.cards;
    for (const [stage, response, refs] of [
      ["cards", generatedCards, [STAGE_FILES.prepare, STAGE_FILES.recall]],
      ["critic", criticCards, [STAGE_FILES.cards, STAGE_FILES.prepare]],
    ] as const) {
      const file = STAGE_FILES[stage];
      artifacts.set(file, json(createStageArtifact({ runId, stage, modelConfiguration: models[stage], inputRefs: [...refs], request: stage === "cards" ? { prepare: prepareResponse, selectedRecallDesign: recallSelection.selected } : { cards: generatedCards, prepare: prepareResponse }, response, sourceRunId: options.sourceRunId })));
      stageLineage[stage] = { status: "executed", sourceRunId: options.sourceRunId, sourceArtifact: null };
    }
  } else {
    const analysis = prepared.analysis as never;
    const organized = prepared.organizedMaterial as never;
    const learningUnits = generate.selectLearningUnitsForCards(analysis, organized);
    const soft = generate.hasSoftCountPolicy(generateInput.studyGuideline);
    const target = soft ? undefined : learningUnits.length || generate.getSelectedUnitCount(generateInput.studyGuideline);
    const contract = generate.buildCardContract(generateInput.mode, generateInput.approvedSample, generateInput.recallDesign, generateInput.sampleFeedback);
    criticCards = await generate.runCardCritic(generatedCards as never, learningUnits, target, contract, soft, runtimeFor("critic", override));
    finalCards = generate.materializeCards(criticCards as never, generateInput.mode);
    const file = STAGE_FILES.critic;
    artifacts.set(file, json(createStageArtifact({ runId, stage: "critic", modelConfiguration: models.critic, inputRefs: [STAGE_FILES.cards, STAGE_FILES.prepare], request: { cards: generatedCards, prepare: prepareResponse, selectedRecallDesign: recallSelection.selected }, response: criticCards, sourceRunId: options.sourceRunId })));
    stageLineage.critic = { status: "executed", sourceRunId: options.sourceRunId, sourceArtifact: null };
  }

  artifacts.set(STAGE_FILES.finalCards, json(createStageArtifact({ runId, stage: "final-cards", modelConfiguration: models.critic, inputRefs: [STAGE_FILES.critic], request: null, response: finalCards, sourceRunId: options.sourceRunId })));
  stageLineage.finalCards = { status: "executed", sourceRunId: options.sourceRunId, sourceArtifact: null };

  const inputs = {
    artifactType: "study-forge-eval-run-inputs",
    artifactVersion: "v0",
    runId,
    sourceRunId: options.sourceRunId,
    runMode: source.run.runMode ?? null,
    userSelections: effectiveSelections,
    override: overrideInfo.path
      ? {
          path: overrideInfo.path,
          checksum: overrideInfo.checksum,
          value: redactOverride(override),
        }
      : null,
    sourceFiles: pdfInputs.map((item) => item.metadata),
  };
  const observations = deriveObservations(runId, prepareResponse, generatedCards, criticCards, finalCards);
  const run = buildRunManifest({
    runId,
    caseId: options.caseId,
    sourceRunId: options.sourceRunId,
    fromStage: options.fromStage,
    frozenStages: plan.frozenStages,
    executedStages: plan.executedStages,
    startedAt,
    completedAt: new Date().toISOString(),
    git,
    promptChecksums: prompts,
    modelConfiguration: models as JsonRecord,
    overridePath: overrideInfo.path,
    overrideChecksum: overrideInfo.checksum,
    stageLineage,
  });
  artifacts.set("run.json", json(run));
  artifacts.set("inputs.json", json(inputs));
  artifacts.set("observations.json", json(observations));
  await writeRunDirectory(repoRoot, outputDirectory, artifacts);
  return { dryRun: false, runId, outputDirectory, observations };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = await runEval(parseCli(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
