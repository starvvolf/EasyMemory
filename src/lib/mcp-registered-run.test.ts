import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatGptParityService } from "../../tools/study-forge-mcp/chatgpt-parity.ts";
import { claimExperimentRequest, createExperimentRequest, recordExperimentProgress } from "./mcp-experiment-requests.ts";
import { getMcpRunView, listMcpRunViews } from "./mcp-run-view.ts";
import { registerMcpSource } from "./mcp-source-registry.ts";

test("completed request links a registered PDF to its verified MCP run", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "study-forge-registered-run-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const source = await registerMcpSource("study.pdf", await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf")));
    const settings = { model: "gpt-6-sol", effort: "medium" } as const;
    const request = await createExperimentRequest({ sourceId: source.id,
      scope: { pageNumbers: [1, 2], outlineLeafIds: [] }, purpose: "목차 확인",
      requestedStages: { analyze: settings }, stopAfterStage: "analyze" });
    const claimed = await claimExperimentRequest(request.id);
    const service = new ChatGptParityService(path.join(folder, "mcp/chatgpt-runs"), path.join(folder, "mcp/published"));
    const started = await service.startRun({ clientRequestId: request.id, title: "study",
      files: [{ fileName: source.fileName, pageCount: source.pageCount, sourceId: source.id, sha256: source.sha256 }],
      stopAfterStage: "analyze" });
    await service.submitStage({ runId: started.runId, stage: "analyze", result: { outlineText: "@file study.pdf\n# 첫 장 [1-2]" } });
    const run = JSON.parse(await readFile(path.join(folder, "mcp/chatgpt-runs", started.runId, "run.json"), "utf8")) as { artifacts: { analyze: unknown } };
    const digest = createHash("sha256").update(JSON.stringify(run.artifacts.analyze)).digest("hex");
    await recordExperimentProgress(request.id, { claimToken: claimed.claimToken, runId: started.runId, stage: "analyze",
      actual: { model: settings.model, effort: settings.effort, startedAt: "2026-09-28T00:00:00.000Z",
        finishedAt: "2026-09-28T00:01:00.000Z", inputSha256: digest, outputSha256: digest },
      output: run.artifacts.analyze }, true);
    const view = await getMcpRunView(`mcp:${started.runId}`);
    assert.equal(view?.executionRequestId, request.id);
    assert.equal(view?.stages[0].output.status, "recorded");
    assert.ok((await listMcpRunViews()).some((item) => item.id === `mcp:${started.runId}`));
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
