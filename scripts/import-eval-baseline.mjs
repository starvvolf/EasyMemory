import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACT_VERSION = "v0";
const CASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENSITIVE_KEY_PATTERN = /^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)$/i;

const STAGES = [
  {
    key: "analyze",
    file: "stages/10-analyze.json",
    inputRefs: ["inputs.json"],
    model: (config) => config?.analyze ?? null,
    response: (stages) => stages?.analyze ?? null,
  },
  {
    key: "plan",
    file: "stages/20-plan.json",
    inputRefs: ["inputs.json", "stages/10-analyze.json"],
    model: (config) => ({
      plan: config?.plan ?? null,
      wholeDocumentCorePlan: config?.wholeDocumentCorePlan ?? null,
    }),
    response: (stages) => ({
      plan: stages?.plan ?? null,
      wholeDocumentCorePlan: stages?.wholeDocumentCorePlan ?? null,
      selectedLearningArea: stages?.selectedLearningArea ?? null,
      effectiveStudyGuideline: stages?.effectiveStudyGuideline ?? null,
    }),
  },
  {
    key: "recall",
    file: "stages/30-recall.json",
    inputRefs: ["inputs.json", "stages/20-plan.json"],
    model: (config) => config?.recallDesign ?? null,
    response: (stages) => ({
      recallDesign: stages?.recallDesign ?? null,
      selectedRecallDesign: stages?.selectedRecallDesign ?? null,
    }),
  },
  {
    key: "prepare",
    file: "stages/40-prepare.json",
    inputRefs: ["inputs.json", "stages/30-recall.json"],
    model: (config) => config?.prepare ?? null,
    response: (stages) => stages?.prepare ?? null,
  },
  {
    key: "cards",
    file: "stages/50-cards.json",
    inputRefs: ["inputs.json", "stages/30-recall.json", "stages/40-prepare.json"],
    model: (config) => config?.cards ?? null,
    response: (stages) => stages?.cards ?? null,
  },
  {
    key: "critic",
    file: "stages/60-critic.json",
    inputRefs: ["stages/40-prepare.json", "stages/50-cards.json"],
    model: (config) => config?.critic ?? null,
    response: (stages) => stages?.critic ?? null,
  },
  {
    key: "finalCards",
    stage: "final-cards",
    file: "stages/70-final-cards.json",
    inputRefs: ["stages/60-critic.json"],
    model: (config) => config?.critic ?? null,
    response: (stages) => stages?.finalCards ?? null,
  },
];

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function hasAvailableValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  if (typeof value !== "object") return true;
  return Object.values(value).some(hasAvailableValue);
}

function findSensitiveKeys(value, location = "$") {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const childLocation = `${location}.${key}`;
    const matches = SENSITIVE_KEY_PATTERN.test(key) ? [childLocation] : [];
    return matches.concat(findSensitiveKeys(child, childLocation));
  });
}

function getArray(value) {
  return Array.isArray(value) ? value : null;
}

function getLearningUnits(baseline) {
  return getArray(baseline?.stages?.prepare?.analysis?.learningUnits);
}

function countOrLegacy(items, legacyValue) {
  if (items) return items.length;
  return Number.isInteger(legacyValue) ? legacyValue : null;
}

export function deriveObservations(baseline, runId) {
  const legacy = baseline?.observations ?? null;
  const learningUnits = getLearningUnits(baseline);
  const generatedCards = getArray(baseline?.stages?.cards);
  const criticCards = getArray(baseline?.stages?.critic);
  const finalCards = getArray(baseline?.stages?.finalCards);

  let coverage = null;
  if (learningUnits && finalCards) {
    coverage = Object.fromEntries(
      learningUnits
        .filter((unit) => typeof unit?.id === "string" && unit.id.length > 0)
        .map((unit) => [
          unit.id,
          finalCards.filter((card) => card?.learningUnitId === unit.id).length,
        ]),
    );
  } else if (legacy?.learningUnitCardCoverage) {
    coverage = legacy.learningUnitCardCoverage;
  }

  const coverageEntries = coverage ? Object.entries(coverage) : [];

  return {
    artifactType: "study-forge-run-observations",
    artifactVersion: ARTIFACT_VERSION,
    runId,
    counts: {
      learningUnits: countOrLegacy(
        learningUnits,
        legacy?.generatedLearningUnitCount,
      ),
      generatedCards: countOrLegacy(
        generatedCards,
        legacy?.generatedCardCount,
      ),
      criticCards: countOrLegacy(criticCards, legacy?.criticCardCount),
      finalCards: countOrLegacy(finalCards, legacy?.finalCardCount),
    },
    learningUnitCardCoverageBasis: coverage ? "finalCards" : null,
    learningUnitCardCoverage: coverage,
    zeroCardLearningUnitIds: coverage
      ? coverageEntries.filter(([, count]) => count === 0).map(([id]) => id)
      : (legacy?.zeroCardLearningUnitIds ?? null),
    multipleCardLearningUnitIds: coverage
      ? coverageEntries.filter(([, count]) => count >= 2).map(([id]) => id)
      : (legacy?.multipleCardLearningUnitIds ?? null),
    derivation: {
      type: "mechanical-from-legacy-stage-artifacts",
      semanticEvaluationPerformed: false,
    },
    legacyObservations: legacy,
    notes: [],
  };
}

export function formatRunTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function kebabCase(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function allocateRunId(outputRoot, timestamp, runLabel) {
  for (let replicate = 1; replicate <= 999; replicate += 1) {
    const runId = `${timestamp}__${runLabel}__baseline__r${String(replicate).padStart(2, "0")}`;
    if (!(await pathExists(path.join(outputRoot, runId)))) return runId;
  }
  throw new Error("같은 timestamp와 label에 사용할 replicate 번호가 없습니다.");
}

function buildInputs(baseline, runId) {
  const sourceFiles = Array.isArray(baseline.sourceFiles)
    ? baseline.sourceFiles.map((source) => ({
        ...source,
        sha256: null,
        contentHashAvailability: "unavailable-in-legacy-browser-export",
      }))
    : [];

  return {
    artifactType: "study-forge-eval-run-inputs",
    artifactVersion: ARTIFACT_VERSION,
    runId,
    runMode: baseline.runMode ?? null,
    sourceFiles,
    sourceIds: [],
    sourceIdentityAvailability:
      "metadata-only; source content hash unavailable in legacy export",
    userSelections: baseline.userSelections ?? null,
    requestPayloadAvailability:
      "unavailable; legacy export did not capture complete API requests",
  };
}

function buildStageArtifact(definition, baseline, runId) {
  const response = definition.response(baseline.stages);
  const modelConfiguration = definition.model(baseline.modelConfiguration);

  return {
    artifactType: "study-forge-stage-artifact",
    artifactVersion: ARTIFACT_VERSION,
    runId,
    stage: definition.stage ?? definition.key,
    capturedAt: null,
    capturedAtAvailability:
      "unavailable; legacy export only records artifact capturedAt",
    modelConfiguration,
    modelConfigurationAvailability: hasAvailableValue(modelConfiguration)
      ? "copied-from-legacy-export"
      : "unavailable",
    inputRefs: definition.inputRefs,
    request: null,
    requestAvailability: "unavailable-in-legacy-browser-export",
    response,
    responseAvailability: hasAvailableValue(response) ? "available" : "unavailable",
  };
}

function buildRun(baseline, options) {
  const hasFinalCards = Array.isArray(baseline?.stages?.finalCards);

  return {
    artifactType: "study-forge-eval-run",
    artifactVersion: ARTIFACT_VERSION,
    runId: options.runId,
    caseId: options.caseId,
    runKind: "baseline",
    provenance: "legacy-browser-export",
    status: hasFinalCards ? "completed" : "incomplete",
    runMode: baseline.runMode ?? null,
    capturedAt: baseline.capturedAt ?? null,
    importedAt: options.importedAt,
    startedAt: null,
    completedAt: null,
    timingAvailability:
      "unavailable; capturedAt is export time, not stage start or completion time",
    experimentId: null,
    armId: null,
    role: null,
    code: {
      gitCommit: null,
      gitDirty: null,
      runtimePromptFiles: null,
      availability:
        "unavailable; legacy export did not capture the executing code revision",
    },
    modelConfiguration: baseline.modelConfiguration ?? null,
    sourceIds: [],
    sourceIdentityAvailability:
      "unavailable; source content hash was not captured by the legacy export",
    legacyExport: {
      file: "legacy-export.json",
      artifactType: baseline.artifactType ?? null,
      artifactVersion: baseline.artifactVersion ?? null,
    },
    stageFiles: Object.fromEntries(STAGES.map((stage) => [stage.key, stage.file])),
    reproducibility: {
      level: "partial",
      unavailable: [
        "complete request payloads",
        "exact stage execution timestamps",
        "source content hash captured at execution",
        "executing git commit and dirty state",
        "runtime prompt file checksums",
      ],
    },
  };
}

export async function importLegacyBaseline({
  baselinePath,
  caseId,
  repoRoot = process.cwd(),
  outputRoot,
}) {
  if (!CASE_ID_PATTERN.test(caseId)) {
    throw new Error(`유효하지 않은 case ID입니다: ${caseId}`);
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const casePath = path.join(resolvedRepoRoot, "eval", "cases", caseId, "case.json");
  if (!(await pathExists(casePath))) {
    throw new Error(`case.json을 찾을 수 없습니다: ${casePath}`);
  }

  const rawLegacyExport = await readFile(path.resolve(baselinePath), "utf8");
  const baseline = JSON.parse(rawLegacyExport);
  if (baseline?.artifactType !== "study-forge-production-baseline") {
    throw new Error("Study Forge browser baseline export가 아닙니다.");
  }

  const sensitiveKeys = findSensitiveKeys(baseline);
  if (sensitiveKeys.length > 0) {
    throw new Error(`비밀정보로 의심되는 필드가 있어 import를 중단했습니다: ${sensitiveKeys.join(", ")}`);
  }

  const importedAt = new Date().toISOString();
  const capturedTimestamp = formatRunTimestamp(baseline.capturedAt);
  const timestamp = capturedTimestamp ?? formatRunTimestamp(importedAt);
  const runLabel = kebabCase(baseline.runMode, "legacy-browser-export");
  const resolvedOutputRoot = path.resolve(
    outputRoot ?? path.join(resolvedRepoRoot, "eval", "runs", caseId),
  );
  await mkdir(resolvedOutputRoot, { recursive: true });

  const runId = await allocateRunId(resolvedOutputRoot, timestamp, runLabel);
  const runDirectory = path.join(resolvedOutputRoot, runId);
  const temporaryRoot = path.join(resolvedRepoRoot, "eval", "local", "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, `${caseId}-`));
  await mkdir(path.join(temporaryDirectory, "stages"), { recursive: true });

  const run = buildRun(baseline, { runId, caseId, importedAt });
  const inputs = buildInputs(baseline, runId);
  const observations = deriveObservations(baseline, runId);
  const artifacts = new Map([
    ["run.json", json(run)],
    ["inputs.json", json(inputs)],
    ["observations.json", json(observations)],
    ["legacy-export.json", rawLegacyExport],
  ]);

  for (const definition of STAGES) {
    artifacts.set(
      definition.file,
      json(buildStageArtifact(definition, baseline, runId)),
    );
  }

  for (const [relativePath, content] of artifacts) {
    const target = path.join(temporaryDirectory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  const checksums = {
    artifactType: "study-forge-run-checksums",
    artifactVersion: ARTIFACT_VERSION,
    runId,
    algorithm: "sha256",
    files: Object.fromEntries(
      [...artifacts.entries()].map(([relativePath, content]) => [
        relativePath.replaceAll(path.sep, "/"),
        sha256(content),
      ]),
    ),
    unavailable: {
      sourceFiles:
        "legacy export did not include source bytes or execution-time content hashes",
      runtimePromptFiles:
        "legacy export did not identify the executing code revision",
    },
  };
  await writeFile(
    path.join(temporaryDirectory, "checksums.json"),
    json(checksums),
    "utf8",
  );

  await rename(temporaryDirectory, runDirectory);

  return {
    runId,
    runDirectory,
    observations,
  };
}

function parseArguments(argv) {
  let baselinePath = null;
  let caseId = null;
  let outputRoot = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--case") {
      caseId = argv[++index] ?? null;
    } else if (value === "--output-root") {
      outputRoot = argv[++index] ?? null;
    } else if (!value.startsWith("--") && !baselinePath) {
      baselinePath = value;
    } else {
      throw new Error(`알 수 없는 인수입니다: ${value}`);
    }
  }

  if (!baselinePath || !caseId) {
    throw new Error(
      "사용법: npm run eval:import -- <baseline-json-path> --case <case-id> [--output-root <path>]",
    );
  }

  return { baselinePath, caseId, outputRoot };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = await importLegacyBaseline(parseArguments(process.argv.slice(2)));
    console.log(`Imported ${result.runId}`);
    console.log(result.runDirectory);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
