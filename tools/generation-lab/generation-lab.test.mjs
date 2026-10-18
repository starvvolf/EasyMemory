import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { listRuns, loadRun } from "./artifact-reader.mjs";
import { renderRun, renderStage } from "./renderers.mjs";
import { createGenerationLabServer } from "./server.mjs";
import { GenerationLabRunExecutor } from "./run-executor.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const caseId = "operating-system-deadlock";
const runId = "20260810T152136Z__whole-document-core-soft-budget__baseline__r01";

async function existingRun() {
  return loadRun(repoRoot, caseId, runId);
}

test("기존 eval/runs 목록을 최신순으로 읽는다", async () => {
  const runs = await listRuns(repoRoot);
  assert.ok(runs.length >= 3);
  assert.ok(runs.some((run) => run.runId === runId));
});

test("run manifest와 provenance를 파싱한다", async () => {
  const run = await existingRun();
  assert.equal(run.manifest.runId, runId);
  assert.equal(run.manifest.provenance, "legacy-browser-export");
});

test("Analyze artifact를 사람이 읽는 view model로 만든다", async () => {
  const stage = renderStage("analyze", await existingRun());
  assert.equal(stage.status, "available");
  assert.ok(stage.sections.some((section) => section.type === "outline"));
  assert.match(stage.summary, /데드락|Deadlock/);
});

test("Plan artifact의 영역과 목표를 표시한다", async () => {
  const stage = renderStage("plan", await existingRun());
  const areas = stage.sections.find((section) => section.type === "areas");
  assert.ok(areas.items.length >= 5);
  assert.ok(stage.sections.some((section) => section.title === "전체 학습 목표"));
});

test("Recall artifact의 선택 옵션과 대표 예시를 표시한다", async () => {
  const stage = renderStage("recall", await existingRun());
  assert.match(stage.summary, /선택된 인출 방식/);
  assert.ok(stage.sections.some((section) => section.type === "example"));
  assert.ok(stage.sections.some((section) => section.type === "options"));
});

test("Prepare artifact의 LearningUnit을 표시한다", async () => {
  const stage = renderStage("prepare", await existingRun());
  const units = stage.sections.find((section) => section.type === "learningUnits");
  assert.equal(units.items.length, 26);
  assert.equal(units.linkageAvailable, false);
  assert.equal(units.items[0].id, "LU01");
});

test("Cards artifact와 LU coverage를 표시한다", async () => {
  const stage = renderStage("cards", await existingRun());
  const coverage = stage.sections.find((section) => section.type === "coverage");
  assert.equal(stage.metrics[0].value, "27");
  assert.deepEqual(coverage.zero, []);
  assert.deepEqual(coverage.multi, ["LU26"]);
});

test("Critic artifact의 품질 결과를 표시한다", async () => {
  const stage = renderStage("critic", await existingRun());
  assert.ok(stage.sections.some((section) => section.type === "issues"));
  assert.equal(stage.metrics[0].label, "통과");
});

test("각 stage view model이 원본 JSON을 보존한다", async () => {
  const stage = renderStage("finalCards", await existingRun());
  assert.equal(stage.raw.artifactType, "study-forge-stage-artifact");
  assert.equal(stage.raw.response.length, 27);
});

test("artifact가 일부 없는 run도 missing 상태로 렌더링한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "generation-lab-missing-"));
  const directory = path.join(root, "eval", "runs", "case-a", "20260810T000000Z__missing__baseline__r01");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "run.json"), JSON.stringify({ runId: path.basename(directory), caseId: "case-a", stageFiles: {} }));
  const rendered = renderRun(await loadRun(root, "case-a", path.basename(directory)));
  assert.equal(rendered.stages.prepare.status, "missing");
  assert.equal(rendered.stages.prepare.raw, null);
});

test("깨진 run manifest를 목록에서 invalid 상태로 표시한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "generation-lab-invalid-"));
  const directory = path.join(root, "eval", "runs", "case-a", "broken-run");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "run.json"), "{broken");
  const runs = await listRuns(root);
  assert.equal(runs[0].status, "invalid");
  assert.match(runs[0].error, /JSON/);
});

test("Generation Lab API가 run 목록과 렌더링 결과를 제공한다", async (t) => {
  const server = createGenerationLabServer({ repoRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const listResponse = await fetch(`${base}/api/runs`);
  assert.equal(listResponse.status, 200);
  const detailResponse = await fetch(`${base}/api/runs/${caseId}/${runId}`);
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.stages.prepare.status, "available");
});

async function waitForJob(executor, jobId) {
  for (let index = 0; index < 100; index += 1) {
    const job = executor.get(jobId);
    if (job?.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job timeout");
}

test("PDF 없이 새 실험 API를 실행할 수 없다", async (t) => {
  const server = createGenerationLabServer({ repoRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/experiments?fileName=test.pdf&learningGoal=goal`, { method: "POST", headers: { "Content-Type": "application/pdf" } });
  assert.equal(response.status, 400);
});

test("PDF와 학습 목표를 shared executor에 전달한다", async () => {
  let received = null;
  const executor = new GenerationLabRunExecutor({
    run: async (input) => {
      received = input;
      await input.onEvent({ stage: "analyze", status: "running" });
      await input.onEvent({ stage: "analyze", status: "completed" });
      return { runId: "run-1", caseId: "case-1" };
    },
  });
  const job = executor.start({ pdfBytes: Buffer.from("%PDF-test"), fileName: "test.pdf", learningGoal: "CS 면접 대비" });
  const completed = await waitForJob(executor, job.jobId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.stages.analyze.status, "completed");
  assert.equal(received.fileName, "test.pdf");
  assert.equal(received.learningGoal, "CS 면접 대비");
});

test("실행 중 중복 run을 거부한다", async () => {
  let release;
  const executor = new GenerationLabRunExecutor({ run: () => new Promise((resolve) => { release = resolve; }) });
  executor.start({ pdfBytes: Buffer.from("%PDF"), fileName: "a.pdf", learningGoal: "goal" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => executor.start({ pdfBytes: Buffer.from("%PDF"), fileName: "b.pdf", learningGoal: "goal" }), /실행 중/);
  release({ runId: "run-1", caseId: "case-1" });
});

test("실패 상태를 기록하고 다음 실행을 허용한다", async () => {
  let attempts = 0;
  const executor = new GenerationLabRunExecutor({
    run: async (input) => {
      attempts += 1;
      await input.onEvent({ stage: "prepare", status: "running" });
      if (attempts === 1) { const error = new Error("Structured output validation failed"); error.stage = "prepare"; error.runId = "failed-run"; error.caseId = "case-1"; throw error; }
      return { runId: "success-run", caseId: "case-1" };
    },
  });
  const first = executor.start({ pdfBytes: Buffer.from("%PDF"), fileName: "a.pdf", learningGoal: "goal" });
  const failed = await waitForJob(executor, first.jobId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.activeStage, "prepare");
  assert.equal(failed.runId, "failed-run");
  const second = executor.start({ pdfBytes: Buffer.from("%PDF"), fileName: "a.pdf", learningGoal: "goal" });
  assert.equal((await waitForJob(executor, second.jobId)).status, "completed");
});
