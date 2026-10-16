import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "eval/model-tests/prepare-terra-redesign");

const pairs = [
  {
    id: "opic",
    baseline: "eval/local/plan-prepare-v1/opic-evidence-only-attempt-1.json",
    candidate: "eval/local/plan-prepare-v1/model-test-prepare-terra-opic-r1.json",
  },
  {
    id: "dfs-bfs",
    baseline: "eval/local/plan-prepare-v1/dfs-bfs-evidence-only-attempt-1.json",
    candidate: "eval/local/plan-prepare-v1/model-test-prepare-terra-dfs-bfs-r1.json",
  },
  {
    id: "deadlock",
    baseline: "eval/local/plan-prepare-v1/model-test-prepare-sol-deadlock-r1.json",
    candidate: "eval/local/plan-prepare-v1/model-test-prepare-terra-deadlock-r1.json",
  },
];

const diverseArtifacts = [
  "eval/local/current-app-prepared-smoke/quality-v1-bill-of-rights-selection-a1-2026-08-16T180942991Z.json",
  "eval/local/current-app-prepared-smoke/quality-v1-calculus-problems-selection-a2-2026-08-16T181300380Z.json",
  "eval/local/current-app-prepared-smoke/quality-v1-moon-phases-selection-a1-2026-08-16T180940026Z.json",
  "eval/local/current-app-prepared-smoke/quality-v1-disaster-checklist-selection-a1-2026-08-16T181458576Z.json",
  "eval/local/current-app-prepared-smoke/social-game-economy-student-2026-08-16T162440292Z-2026-08-16T180810307Z.json",
  "eval/local/current-app-prepared-smoke/science-stars-spectrum-student-2026-08-16T162440292Z-2026-08-16T180813201Z.json",
];

const operations = new Set(["recall", "reconstruct", "discriminate", "apply"]);
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function load(relativePath) {
  const value = JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  const analysis = value.prepare?.analysis ?? value.analysis;
  if (!analysis?.learningUnits) throw new Error(`Prepare analysis not found: ${relativePath}`);
  return { relativePath, value, analysis };
}

function marginalBytes(objects, field) {
  return objects.reduce((sum, object) => {
    if (!(field in object)) return sum;
    const copy = { ...object };
    delete copy[field];
    return sum + byteLength(object) - byteLength(copy);
  }, 0);
}

function auditArtifact(relativePath) {
  const { analysis } = load(relativePath);
  const units = analysis.learningUnits;
  const unitFields = [...new Set(units.flatMap((unit) => Object.keys(unit)))].sort();
  const fieldBytes = Object.fromEntries(
    unitFields.map((field) => [field, marginalBytes(units, field)]),
  );
  const compactActivityInput = {
    learningGoal: analysis.detectedGoal,
    units: units.map((unit) => ({
      learningUnitId: unit.id,
      target: unit.target ?? unit.intent ?? "",
      operation: unit.operation ?? null,
      successCriterion: unit.successCriterion ?? unit.target ?? unit.intent ?? "",
      finalContent: unit.reviewedText ?? unit.generalizedForm ?? unit.sourceText,
      sourceId: unit.sourceId,
      sourcePage: unit.sourcePage,
      sourceRange: unit.sourceRange,
    })),
  };
  const fullBytes = byteLength(analysis);
  const unitsBytes = byteLength(units);
  const compactBytes = byteLength(compactActivityInput);
  return {
    path: relativePath,
    unitCount: units.length,
    fullAnalysisBytes: fullBytes,
    learningUnitsBytes: unitsBytes,
    compactDownstreamBytes: compactBytes,
    compactVsFullReductionPercent: Number(((1 - compactBytes / fullBytes) * 100).toFixed(1)),
    unitFieldMarginalBytes: fieldBytes,
    checks: {
      duplicateIds: units.length - new Set(units.map((unit) => unit.id)).size,
      missingEvidence: units.filter((unit) => !unit.sourceText?.trim()).map((unit) => unit.id),
      missingTarget: units.filter((unit) => !(unit.target ?? unit.intent)?.trim()).map((unit) => unit.id),
      missingSuccessCriterion: units.filter((unit) => !unit.successCriterion?.trim()).map((unit) => unit.id),
      invalidOperation: units.filter((unit) => !operations.has(unit.operation)).map((unit) => unit.id),
    },
  };
}

function comparePair(pair) {
  const baseline = load(pair.baseline).analysis;
  const candidate = load(pair.candidate).analysis;
  const baselineById = new Map(baseline.learningUnits.map((unit) => [unit.id, unit]));
  const candidateById = new Map(candidate.learningUnits.map((unit) => [unit.id, unit]));
  const baselineIds = [...baselineById.keys()].sort();
  const candidateIds = [...candidateById.keys()].sort();
  const commonIds = baselineIds.filter((id) => candidateById.has(id));
  const operationDisagreements = commonIds.flatMap((id) => {
    const before = baselineById.get(id).operation;
    const after = candidateById.get(id).operation;
    return before === after ? [] : [{ id, baseline: before, candidate: after }];
  });
  const evidenceLengthFlags = commonIds.flatMap((id) => {
    const before = Buffer.byteLength(baselineById.get(id).sourceText ?? "", "utf8");
    const after = Buffer.byteLength(candidateById.get(id).sourceText ?? "", "utf8");
    const ratio = before === 0 ? null : after / before;
    return ratio !== null && (ratio < 0.5 || ratio > 2)
      ? [{ id, baselineBytes: before, candidateBytes: after, ratio: Number(ratio.toFixed(2)) }]
      : [];
  });
  return {
    id: pair.id,
    baseline: pair.baseline,
    candidate: pair.candidate,
    hardChecks: {
      exactIdSet: JSON.stringify(baselineIds) === JSON.stringify(candidateIds),
      candidateDuplicateIds: candidate.learningUnits.length - new Set(candidate.learningUnits.map((unit) => unit.id)).size,
      candidateMissingRequired: candidate.learningUnits.flatMap((unit) => {
        const missing = ["id", "sourceId", "sourceRange", "sourceText", "target", "operation", "successCriterion"]
          .filter((field) => field === "operation" ? !operations.has(unit[field]) : !String(unit[field] ?? "").trim());
        return missing.length ? [{ id: unit.id, fields: missing }] : [];
      }),
    },
    reviewFlags: {
      operationDisagreements,
      evidenceLengthFlags,
    },
  };
}

const artifactPaths = [...new Set([
  ...pairs.flatMap((pair) => [pair.baseline, pair.candidate]),
  ...diverseArtifacts,
])];
const artifactAudits = artifactPaths.map(auditArtifact);
const totalFieldBytes = {};
for (const artifact of artifactAudits) {
  for (const [field, bytes] of Object.entries(artifact.unitFieldMarginalBytes)) {
    totalFieldBytes[field] = (totalFieldBytes[field] ?? 0) + bytes;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  apiCalls: 0,
  scope: {
    comparisonPairs: pairs.length,
    diverseArtifacts: diverseArtifacts.length,
    totalArtifacts: artifactAudits.length,
  },
  pairComparisons: pairs.map(comparePair),
  artifactAudits,
  aggregateUnitFieldMarginalBytes: Object.fromEntries(
    Object.entries(totalFieldBytes).sort((a, b) => b[1] - a[1]),
  ),
  notes: [
    "operation disagreement is a teacher-review flag, not an automatic failure; the Sol baseline can also be wrong.",
    "compactDownstreamBytes models the data needed by Activity Design, not a proposed production schema.",
    "sourceText semantic faithfulness cannot be proven by byte length and remains a teacher check.",
  ],
};

fs.mkdirSync(outDir, { recursive: true });
const outputPath = path.join(outDir, "offline-audit.json");
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...report.scope, pairComparisons: report.pairComparisons }, null, 2));
