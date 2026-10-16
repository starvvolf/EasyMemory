import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const STAGE_DEFINITIONS = [
  { id: "analyze", label: "자료 이해", technicalLabel: "Analyze", fallbackPath: "stages/10-analyze.json" },
  { id: "plan", label: "학습 계획", technicalLabel: "Plan", fallbackPath: "stages/20-plan.json" },
  { id: "recall", label: "인출 방식 설계", technicalLabel: "Recall Design", fallbackPath: "stages/30-recall.json" },
  { id: "prepare", label: "학습 단위", technicalLabel: "Prepare / Learning Units", fallbackPath: "stages/40-prepare.json" },
  { id: "cards", label: "카드 생성", technicalLabel: "Cards", fallbackPath: "stages/50-cards.json" },
  { id: "critic", label: "결과 검사", technicalLabel: "Critic", fallbackPath: "stages/60-critic.json" },
  { id: "finalCards", label: "최종 결과", technicalLabel: "Final Cards", fallbackPath: "stages/70-final-cards.json" },
];

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return { status: "available", value: await readJson(filePath), error: null };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", value: null, error: "artifact가 없습니다." };
    return { status: "invalid", value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function assertSafeId(value, label) {
  if (!SAFE_ID.test(value)) throw new Error(`유효하지 않은 ${label}입니다.`);
}

function timestampOf(manifest) {
  return manifest.completedAt ?? manifest.capturedAt ?? manifest.startedAt ?? manifest.importedAt ?? null;
}

function parseRunName(runId) {
  const [, label = runId, kind = "unknown"] = runId.split("__");
  return { label, kind };
}

async function readCaseTitle(repoRoot, caseId) {
  const result = await readOptionalJson(path.join(repoRoot, "eval", "cases", caseId, "case.json"));
  return result.status === "available" ? result.value.title ?? caseId : caseId;
}

export async function listRuns(repoRoot) {
  const runsRoot = path.join(repoRoot, "eval", "runs");
  let cases = [];
  try {
    cases = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const rows = [];
  for (const caseEntry of cases.filter((entry) => entry.isDirectory())) {
    const caseId = caseEntry.name;
    const caseTitle = await readCaseTitle(repoRoot, caseId);
    const casePath = path.join(runsRoot, caseId);
    const runEntries = await readdir(casePath, { withFileTypes: true });
    for (const runEntry of runEntries.filter((entry) => entry.isDirectory())) {
      const runId = runEntry.name;
      const manifestResult = await readOptionalJson(path.join(casePath, runId, "run.json"));
      if (manifestResult.status !== "available") {
        rows.push({
          caseId,
          caseTitle,
          runId,
          label: parseRunName(runId).label,
          kind: parseRunName(runId).kind,
          status: "invalid",
          timestamp: null,
          sourceRunId: null,
          error: manifestResult.error,
        });
        continue;
      }
      const manifest = manifestResult.value;
      const parsed = parseRunName(runId);
      rows.push({
        caseId,
        caseTitle,
        runId,
        label: parsed.label,
        kind: manifest.runKind ?? parsed.kind,
        variant: manifest.runMode ?? manifest.armId ?? null,
        status: manifest.status ?? "unknown",
        timestamp: timestampOf(manifest),
        sourceRunId: manifest.sourceRunId ?? null,
        provenance: manifest.provenance ?? null,
        error: null,
      });
    }
  }

  return rows.sort((a, b) => String(b.timestamp ?? b.runId).localeCompare(String(a.timestamp ?? a.runId)));
}

export async function loadRun(repoRoot, caseId, runId) {
  assertSafeId(caseId, "case ID");
  assertSafeId(runId, "run ID");
  const runDirectory = path.join(repoRoot, "eval", "runs", caseId, runId);
  const manifest = await readJson(path.join(runDirectory, "run.json"));
  const inputs = await readOptionalJson(path.join(runDirectory, "inputs.json"));
  const observations = await readOptionalJson(path.join(runDirectory, "observations.json"));
  const checksums = await readOptionalJson(path.join(runDirectory, "checksums.json"));
  const stageFiles = manifest.stageFiles ?? {};
  const stages = {};

  for (const definition of STAGE_DEFINITIONS) {
    const relativePath = stageFiles[definition.id] ?? definition.fallbackPath;
    const result = await readOptionalJson(path.join(runDirectory, relativePath));
    stages[definition.id] = {
      ...result,
      relativePath,
      checksum: checksums.value?.files?.[relativePath] ?? manifest.stageLineage?.[definition.id]?.checksum ?? null,
      lineage: manifest.stageLineage?.[definition.id] ?? null,
    };
  }

  return {
    caseId,
    runId,
    runDirectory: path.relative(repoRoot, runDirectory).replaceAll(path.sep, "/"),
    manifest,
    inputs,
    observations,
    checksums,
    stages,
  };
}
