import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordedStageInputs } from "./mcp-run-view.ts";

test("discovers a new experiment's call records only when the recorded input matches", async () => {
  const originalCwd = process.cwd();
  const folder = await mkdtemp(path.join(os.tmpdir(), "mcp-input-discovery-"));
  try {
    process.chdir(folder);
    const experiment = path.join(folder, "eval", "local", "another-experiment");
    await mkdir(path.join(experiment, "calls"), { recursive: true });
    await mkdir(path.join(experiment, "inputs"), { recursive: true });
    const args = { title: "Study", files: [{ fileName: "study.pdf", pageCount: 2 }] };
    const call = { tool: "start_chatgpt_pdf_run", inputFile: "inputs/start.json", arguments: args,
      completedAt: "2026-09-28T00:00:01.000Z", response: { structuredContent: {
        runId: "run-1", nextStage: "analyze", stageInput: { stage: "analyze", instructions: "Read source",
          outputContract: { type: "object" }, input: args },
      } } };
    await writeFile(path.join(experiment, "inputs", "start.json"), JSON.stringify(args));
    await writeFile(path.join(experiment, "calls", "first.json"), JSON.stringify(call));
    const run = { id: "run-1", config: args, artifacts: { analyze: { sourceOutline: {} } },
      stageCompletedAt: { analyze: "2026-09-28T00:00:02.000Z" } };
    assert.equal((await recordedStageInputs(run)).has("analyze"), true);
    await writeFile(path.join(experiment, "inputs", "start.json"), JSON.stringify({ ...args, title: "Different" }));
    assert.equal((await recordedStageInputs(run)).has("analyze"), false);
    const concept = { treeText: "one concept" };
    const submitArgs = { runId: "run-1", stage: "concept-tree", result: concept };
    const submitCall = { tool: "submit_chatgpt_pdf_stage", inputFile: "inputs/concept.json", arguments: submitArgs,
      completedAt: "2026-09-28T00:00:03.000Z", response: { structuredContent: {
        runId: "run-1", nextStage: "learning-design",
        submitted: { stage: "concept-tree", checksum: `sha256:${createHash("sha256").update(JSON.stringify(concept)).digest("hex")}` },
        stageInput: { stage: "learning-design", instructions: "Design learning", outputContract: { type: "object" }, input: { conceptTree: concept } },
      } } };
    await writeFile(path.join(experiment, "inputs", "concept.json"), JSON.stringify(submitArgs));
    await writeFile(path.join(experiment, "calls", "concept.json"), JSON.stringify(submitCall));
    const completedRun = { ...run, artifacts: { ...run.artifacts, "concept-tree": concept, "learning-design": {} },
      stageCompletedAt: { ...run.stageCompletedAt, "learning-design": "2026-09-28T00:00:04.000Z" } };
    assert.equal((await recordedStageInputs(completedRun)).has("learning-design"), true);
    await writeFile(path.join(experiment, "calls", "concept.json"), JSON.stringify({ ...submitCall,
      response: { structuredContent: { ...submitCall.response.structuredContent, submitted: { stage: "concept-tree", checksum: "sha256:bad" } } } }));
    assert.equal((await recordedStageInputs(completedRun)).has("learning-design"), false);
  } finally {
    process.chdir(originalCwd);
    await rm(folder, { recursive: true, force: true });
  }
});
