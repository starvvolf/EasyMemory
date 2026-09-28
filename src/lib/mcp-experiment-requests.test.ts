import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerMcpSource } from "./mcp-source-registry.ts";
import {
  claimExperimentRequest, createExperimentRequest, createExperimentRequestSchema,
  failExperimentRequest, getExperimentRequest, listExperimentRequests, recordExperimentProgress,
} from "./mcp-experiment-requests.ts";

const hash = createHash("sha256").update("recorded-output").digest("hex");
const settings = { model: "gpt-6-sol", effort: "medium" } as const;
const base = {
  sourceId: "geometric-transformations", scope: { pageNumbers: [2, 3], outlineLeafIds: [] },
  purpose: "기하 변환 원리 연습", requestedStages: { analyze: settings, "concept-tree": settings },
  stopAfterStage: "concept-tree",
} as const;
const actual = { model: "gpt-6-sol", effort: "medium", startedAt: "2026-09-28T00:00:00.000Z", finishedAt: "2026-09-28T00:01:00.000Z", inputSha256: hash, outputSha256: hash };

test("requested GPT-6 model and effort boundary", () => {
  const withAnalyze = (model: string, effort: string) => ({
    ...base, requestedStages: { ...base.requestedStages, analyze: { model, effort } },
  });
  assert.equal(createExperimentRequestSchema.safeParse(withAnalyze("gpt-6-luna", "max")).success, true);
  const unsupported = createExperimentRequestSchema.safeParse(withAnalyze("gpt-6-luna", "ultra"));
  assert.equal(unsupported.success, false);
  if (!unsupported.success) {
    assert.deepEqual(unsupported.error.issues[0].path, ["requestedStages", "analyze", "effort"]);
    assert.match(unsupported.error.issues[0].message, /gpt-6-luna.*ultra.*max/);
  }
  assert.equal(createExperimentRequestSchema.safeParse(withAnalyze("gpt-6-sol", "ultra")).success, true);
  assert.equal(createExperimentRequestSchema.safeParse(withAnalyze("gpt-6-astra", "ultra")).success, true);
});

test("selected objectives require a completed Learning Design prefix and reject duplicates", () => {
  const request = {
    ...base,
    stopAfterStage: "cards",
    requestedStages: { ...base.requestedStages, "learning-design": settings, "activity-design": settings, cards: settings },
    reuse: { kind: "output", runId: "mcp:origin", stage: "learning-design", sha256: hash },
    selectedObjectiveIds: ["objective-2"],
  };
  assert.equal(createExperimentRequestSchema.safeParse(request).success, true);
  assert.equal(createExperimentRequestSchema.safeParse({ ...request, reuse: undefined }).success, false);
  assert.equal(createExperimentRequestSchema.safeParse({ ...request, selectedObjectiveIds: ["objective-2", "objective-2"] }).success, false);
});

test("registered source requests pin the real PDF and reject pages outside its bounds", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-registered-request-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const pdf = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf"));
    const source = await registerMcpSource("sample.pdf", pdf);
    const input = { ...base, sourceId: source.id, scope: { pageNumbers: [1, 2], outlineLeafIds: [] } };
    const request = await createExperimentRequest(input);
    assert.deepEqual(request.sourceSnapshot, source);
    await assert.rejects(createExperimentRequest({ ...input, scope: { pageNumbers: [3], outlineLeafIds: [] } }), { status: 400 });
    await assert.rejects(createExperimentRequest({ ...input, sourceId: `src_${"0".repeat(64)}` }), { status: 404 });
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});

test("local requests persist, are claimed once, and require ordered executor outputs", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-requests-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const created = await createExperimentRequest(base);
    assert.equal(created.status, "waiting-for-executor");
    assert.equal(created.runId, null);
    assert.equal((await listExperimentRequests()).length, 1);
    const reloaded = await getExperimentRequest(created.id);
    assert.deepEqual(reloaded.input.scope.pageNumbers, [2, 3]);
    const disk = JSON.parse(await readFile(path.join(folder, "mcp-experiment-requests", `${created.id}.json`), "utf8"));
    assert.equal(disk.status, "waiting-for-executor");

    const claimed = await claimExperimentRequest(created.id);
    assert.equal(claimed.request.status, "claimed");
    assert.equal("claimToken" in claimed.request, false);
    await assert.rejects(claimExperimentRequest(created.id), { status: 409 });
    const record = { claimToken: claimed.claimToken, runId: "mcp:run-01", actual, output: { outline: ["translation"] } };
    await assert.rejects(recordExperimentProgress(created.id, { ...record, stage: "concept-tree" }, true), { status: 409 });
    await assert.rejects(recordExperimentProgress(created.id, { ...record, stage: "analyze" }, true), { status: 409 });
    await assert.rejects(recordExperimentProgress(created.id, { ...record, stage: "analyze", claimToken: "a".repeat(64) }), { status: 409 });
    const first = await recordExperimentProgress(created.id, { ...record, stage: "analyze" });
    assert.equal(first.status, "running");
    assert.equal(first.stages[0].provenance, "executor-reported");
    await assert.rejects(recordExperimentProgress(created.id, { ...record, stage: "concept-tree", runId: "mcp:another" }, true), { status: 409 });
    const last = await recordExperimentProgress(created.id, { ...record, stage: "concept-tree" }, true);
    assert.equal(last.status, "completed");
    assert.equal(last.stages.length, 2);
    assert.equal((await getExperimentRequest(created.id)).status, "completed");
    await assert.rejects(failExperimentRequest(created.id, { claimToken: claimed.claimToken, message: "late" }), { status: 409 });
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});

test("invalid scope and model are rejected; requested reuse needs matching actual provenance", async () => {
  assert.equal(createExperimentRequestSchema.safeParse({ ...base, scope: { pageNumbers: [], outlineLeafIds: [] } }).success, false);
  await assert.rejects(createExperimentRequest({ ...base, scope: { pageNumbers: [33], outlineLeafIds: [] } }), { status: 400 });
  assert.equal(createExperimentRequestSchema.safeParse({ ...base, requestedStages: { analyze: { model: "fake", effort: "medium" } } }).success, false);
  assert.equal(createExperimentRequestSchema.safeParse({ ...base, requestedStages: { ...base.requestedStages, invented: settings } }).success, false);
  assert.equal(createExperimentRequestSchema.safeParse({ ...base, path: "C:/private/file.pdf" }).success, false);

  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-reuse-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const reuse = { kind: "output" as const, runId: "mcp:origin", stage: "analyze" as const, sha256: hash };
    const created = await createExperimentRequest({ ...base, reuse });
    const { claimToken } = await claimExperimentRequest(created.id);
    const record = { claimToken, stage: "analyze", runId: "mcp:new", actual, output: { reused: true } };
    await assert.rejects(recordExperimentProgress(created.id, record), { status: 409 });
    const accepted = await recordExperimentProgress(created.id, { ...record, actual: { ...actual, reusedFrom: reuse } });
    assert.deepEqual(accepted.stages[0].actual.reusedFrom, reuse);
    const failed = await failExperimentRequest(created.id, { claimToken, message: "다음 단계는 실행할 수 없습니다." });
    assert.equal(failed.status, "failed");
    assert.equal((await getExperimentRequest(created.id)).failure, "다음 단계는 실행할 수 없습니다.");

    const ordinary = await createExperimentRequest(base);
    const ordinaryClaim = await claimExperimentRequest(ordinary.id);
    await assert.rejects(recordExperimentProgress(ordinary.id, {
      ...record, claimToken: ordinaryClaim.claimToken, actual: { ...actual, reusedFrom: reuse },
    }), { status: 409 });
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});

test("Learning Design prefix reports three reused outputs before newly generated work", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-prefix-ledger-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const stageHashes = ["analyze", "concept-tree", "learning-design", "activity-design"]
      .map((stage) => createHash("sha256").update(stage).digest("hex"));
    const reuse = { kind: "output" as const, runId: "mcp:origin", stage: "learning-design" as const, sha256: stageHashes[2] };
    const created = await createExperimentRequest({ ...base, stopAfterStage: "activity-design",
      requestedStages: { analyze: settings, "concept-tree": settings, "learning-design": settings, "activity-design": settings }, reuse });
    const { claimToken } = await claimExperimentRequest(created.id);
    const progress = (stage: "analyze" | "concept-tree" | "learning-design" | "activity-design", index: number,
      reused: boolean) => ({ claimToken, runId: "mcp:new-prefix", stage,
        actual: { ...actual, outputSha256: stageHashes[index], ...(reused ? {
          reusedFrom: { ...reuse, stage, sha256: stageHashes[index] },
        } : {}) }, output: { stage },
      });
    await assert.rejects(recordExperimentProgress(created.id, progress("analyze", 0, false)), { status: 409 });
    const analyzed = await recordExperimentProgress(created.id, progress("analyze", 0, true));
    assert.equal(analyzed.stages[0].executionMode, "reused-output");
    await assert.rejects(recordExperimentProgress(created.id, progress("concept-tree", 1, false)), { status: 409 });
    await recordExperimentProgress(created.id, progress("concept-tree", 1, true));
    await assert.rejects(recordExperimentProgress(created.id, {
      ...progress("learning-design", 2, true), actual: { ...actual, outputSha256: stageHashes[2],
        reusedFrom: { ...reuse, sha256: stageHashes[0] } },
    }), { status: 409 });
    await recordExperimentProgress(created.id, progress("learning-design", 2, true));
    const finished = await recordExperimentProgress(created.id, progress("activity-design", 3, false), true);
    assert.deepEqual(finished.stages.map((stage) => stage.executionMode), [
      "reused-output", "reused-output", "reused-output", "model-generated",
    ]);
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});

test("selected-objective requests reject an unselected objective in design or cards", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-selected-objectives-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const stages = ["analyze", "concept-tree", "learning-design", "activity-design", "cards"] as const;
    const hashes = stages.map((stage) => createHash("sha256").update(stage).digest("hex"));
    const reuse = { kind: "output" as const, runId: "mcp:origin", stage: "learning-design" as const, sha256: hashes[2] };
    const created = await createExperimentRequest({ ...base, stopAfterStage: "cards",
      requestedStages: Object.fromEntries(stages.map((stage) => [stage, settings])),
      reuse, selectedObjectiveIds: ["objective-1"] });
    const { claimToken } = await claimExperimentRequest(created.id);
    const progress = (stage: typeof stages[number], index: number, output: unknown) => ({
      claimToken, runId: "mcp:selected", stage, output,
      actual: { ...actual, outputSha256: hashes[index], ...(index < 3 ? {
        reusedFrom: { ...reuse, stage, sha256: hashes[index] },
      } : {}) },
    });
    for (let index = 0; index < 3; index += 1) {
      await recordExperimentProgress(created.id, progress(stages[index], index, { stage: stages[index] }));
    }
    await assert.rejects(recordExperimentProgress(created.id, progress("activity-design", 3,
      { learningDesign: { objectives: [{ id: "objective-1" }, { id: "objective-2" }] } })), { status: 409 });
    await recordExperimentProgress(created.id, progress("activity-design", 3,
      { learningDesign: { objectives: [{ id: "objective-1" }] } }));
    await assert.rejects(recordExperimentProgress(created.id, progress("cards", 4,
      { cards: [{ objectiveId: "objective-2" }] }), true), { status: 409 });
    const completed = await recordExperimentProgress(created.id, progress("cards", 4,
      { cards: [{ objectiveId: "objective-1" }] }), true);
    assert.equal(completed.status, "completed");
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});

test("a dead process lock is reclaimed without opening a second claim", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "recaller-stale-lock-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const created = await createExperimentRequest(base);
    const lock = path.join(folder, "mcp-experiment-requests", ".write-lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2147483647, createdAt: Date.now() - 20_000 }));
    const claimed = await claimExperimentRequest(created.id);
    assert.equal(claimed.request.status, "claimed");
    await assert.rejects(claimExperimentRequest(created.id), { status: 409 });
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
