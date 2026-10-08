import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunManifest,
  calculateStagePlan,
  collectFrozenStageArtifacts,
  loadSourceRun,
  locateSourceRun,
  mergeOverride,
  parseOverride,
  runEval,
  sha256,
  validateDependencies,
} from "./eval-runner.ts";

const repoRoot = process.cwd();
const caseId = "operating-system-deadlock";
const sourceRunId =
  "20260810T152136Z__whole-document-core-soft-budget__baseline__r01";

test("source run을 case와 run ID로 찾는다", async () => {
  const directory = await locateSourceRun(repoRoot, caseId, sourceRunId);
  assert.match(directory, /operating-system-deadlock/);
});

test("from-stage별 frozen/executed stage를 계산한다", () => {
  assert.deepEqual(calculateStagePlan("recall"), {
    frozenStages: ["analyze", "plan"],
    executedStages: ["recall", "prepare", "cards", "critic"],
  });
  assert.deepEqual(calculateStagePlan("prepare").frozenStages, [
    "analyze",
    "plan",
    "recall",
  ]);
  assert.deepEqual(calculateStagePlan("cards").executedStages, [
    "cards",
    "critic",
  ]);
  assert.deepEqual(calculateStagePlan("critic").executedStages, ["critic"]);
});

test("각 from-stage의 dependency를 해결한다", async () => {
  const source = await loadSourceRun(repoRoot, caseId, sourceRunId);
  validateDependencies(source, "recall", {
    sourceContext: { text: "explicit source context" },
  });
  validateDependencies(source, "prepare", {
    sourceContext: { text: "explicit source context" },
  });
  validateDependencies(source, "cards", {});
  validateDependencies(source, "critic", {});
});

test("frozen artifact bytes와 checksum을 변경하지 않는다", async () => {
  const source = await loadSourceRun(repoRoot, caseId, sourceRunId);
  const frozen = collectFrozenStageArtifacts(source, [
    "analyze",
    "plan",
    "recall",
    "prepare",
  ]);
  for (const [file, bytes] of frozen) {
    const stage = Object.entries({
      analyze: "stages/10-analyze.json",
      plan: "stages/20-plan.json",
      recall: "stages/30-recall.json",
      prepare: "stages/40-prepare.json",
    }).find(([, value]) => value === file)?.[0];
    assert.ok(stage);
    assert.deepEqual(bytes, source.stageBytes[stage]);
    assert.equal(sha256(bytes), sha256(source.stageBytes[stage]));
  }
});

test("override merge가 source 객체를 mutate하지 않는다", () => {
  const source = { models: { cards: { model: "source", reasoningEffort: "low" } } };
  const before = structuredClone(source);
  const merged = mergeOverride(source, {
    models: { cards: { model: "override" } },
  });
  assert.deepEqual(source, before);
  assert.equal(merged.models.cards.model, "override");
  assert.equal(merged.models.cards.reasoningEffort, "low");
});

test("정의되지 않은 override 필드를 거부한다", () => {
  assert.throws(
    () => parseOverride({ models: { cards: { temperature: 1 } } }),
    /unrecognized|Unrecognized|invalid/i,
  );
});

test("dry-run은 fetch를 호출하지 않는다", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("dry-run called fetch");
  };
  try {
    const result = await runEval({
      caseId,
      sourceRunId,
      fromStage: "cards",
      label: "runner-test-no-fetch",
      dryRun: true,
      repoRoot,
    });
    assert.equal(result.dryRun, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid source run ID를 거부한다", async () => {
  await assert.rejects(
    locateSourceRun(repoRoot, caseId, "../invalid"),
    /유효하지 않은 source run ID/,
  );
});

test("SHA-256 checksum을 안정적으로 생성한다", () => {
  assert.equal(
    sha256("study-forge"),
    "5659f7cfeca18fe589c6babfa25f599a7490195c4dd0ba8679b3c12d2e0669a8",
  );
});

test("dry-run preview가 새 run artifact 기본 provenance를 제공한다", async () => {
  const result = await runEval({
    caseId,
    sourceRunId,
    fromStage: "critic",
    label: "runner-structure-test",
    dryRun: true,
    repoRoot,
  });
  assert.equal(result.dryRun, true);
  if (!result.dryRun) assert.fail("dry-run result expected");
  assert.equal(result.preview.sourceRunId, sourceRunId);
  assert.deepEqual(result.preview.frozenStages, [
    "analyze",
    "plan",
    "recall",
    "prepare",
    "cards",
  ]);
  assert.deepEqual(result.preview.executedStages, ["critic"]);
  assert.match(result.preview.plannedRunId, /__runner-structure-test__exploratory__r01$/);
  assert.equal(result.preview.provenance.sourceChecksumsVerified, true);
});

test("run artifact 기본 구조와 stage lineage를 보존한다", () => {
  const run = buildRunManifest({
    runId: "20260812T000000Z__runner-structure-test__exploratory__r01",
    caseId,
    sourceRunId,
    fromStage: "cards",
    frozenStages: ["analyze", "plan", "recall", "prepare"],
    executedStages: ["cards", "critic"],
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:01:00.000Z",
    git: { commit: "abc123", dirty: true },
    promptChecksums: { cards: "checksum" },
    modelConfiguration: { cards: { model: "test-model" } },
    overridePath: null,
    overrideChecksum: null,
    stageLineage: {
      analyze: {
        status: "frozen",
        sourceRunId,
        sourceArtifact: "stages/10-analyze.json",
        checksum: "checksum",
      },
      cards: {
        status: "executed",
        sourceRunId,
        sourceArtifact: null,
      },
    },
  });

  assert.equal(run.artifactType, "study-forge-eval-run");
  assert.equal(run.provenance, "eval-runner-v1");
  assert.equal(run.sourceRunId, sourceRunId);
  assert.deepEqual(run.frozenStages, ["analyze", "plan", "recall", "prepare"]);
  assert.deepEqual(run.executedStages, ["cards", "critic"]);
  assert.deepEqual(run.stageLineage.analyze, {
    status: "frozen",
    sourceRunId,
    sourceArtifact: "stages/10-analyze.json",
    checksum: "checksum",
  });
});
