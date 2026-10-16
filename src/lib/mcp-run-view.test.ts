import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getMcpRunView, listMcpRunViews, mcpStageNames, type McpStageView } from "./mcp-run-view.ts";

test("only explicitly allowed MCP runs and separate authoring cycles are listed", async () => {
  const runs = await listMcpRunViews();
  const fixedIds = new Set([
    "mcp:chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d",
    "mcp:chatgpt-request-789ee8708698831ced8655c04f289698",
    "mcp:chatgpt-request-6229f153e7dd736279e90e2f523926c4",
    "mcp:chatgpt-request-b4744eb39d74dae173c7c955ea3cd685",
    "mcp:chatgpt-request-f934a6b71ffb6d9a2a402870f0df2632",
    "authoring:geometric-outline-cycle-20260928-02",
    "authoring:integrated-geometry-sol-20260928-r02",
    "authoring:integrated-geometry-sol-20260928-r01",
    "authoring:integrated-semiconductor-sol-20260928-r01",
  ]);
  for (const id of fixedIds) assert.ok(runs.some((run) => run.id === id));
  for (const run of runs) if (!fixedIds.has(run.id)) {
    assert.equal(run.kind, "mcp-pipeline");
    assert.equal(run.executionRequestStatus, "completed");
    assert.ok(run.executionRequestId);
  }
  assert.equal(runs.filter((run) => run.kind === "authoring-lab").length, 4);
});

test("reused Analyze does not claim model input, but its MCP response records the next stage input", async () => {
  const run = await getMcpRunView("mcp:chatgpt-request-aa6fb606846e4a720aee91747068cc3f");
  assert.ok(run);
  assert.equal(run.stages[0].executionMetadataSource, "output-reuse-no-model");
  assert.equal(run.stages[0].actualInput.status, "not-recorded");
  const reuseCall = JSON.parse(await readFile(path.join(process.cwd(),
    "eval/local/mcp-exec-20260928-sol-medium-r01/calls/web-req_658afdb86690ce030d26dd3dd49c9380-reuse-analyze.json"), "utf8")) as {
    response: { structuredContent: { stageInput: unknown } };
  };
  assert.deepEqual(run.stages[1].actualInput, { status: "recorded", value: reuseCall.response.structuredContent.stageInput });
  assert.equal(run.stages[1].executionMetadataSource, "executor-reported");
});

test("completed Learning Design prefix run is returned by the list and detail loaders", async () => {
  const id = "mcp:chatgpt-request-205f3833a8b1bd6c2eb079850000212e";
  const listed = (await listMcpRunViews()).find((entry) => entry.id === id);
  assert.ok(listed);
  assert.equal(listed.executionRequestId, "req_af3e66d390aeca55d0f04e1c73bcb4c8");
  assert.equal(listed.status, "completed");
  const detail = await getMcpRunView(id);
  assert.ok(detail);
  assert.deepEqual(detail.stages.slice(0, 3).map((stage) => stage.executionMetadataSource),
    ["output-reuse-no-model", "output-reuse-no-model", "output-reuse-no-model"]);
  assert.deepEqual(detail.stages.slice(3).map((stage) => stage.executionMetadataSource),
    ["executor-reported", "executor-reported"]);
});

test("a completed web request is separate from a resumable MCP run", async () => {
  const run = await getMcpRunView("mcp:chatgpt-request-b4744eb39d74dae173c7c955ea3cd685");
  assert.ok(run);
  assert.equal(run.status, "stopped");
  assert.equal(run.executionRequest?.status, "completed");
  assert.equal(run.executionRequest?.stopAfterStage, "analyze");
  assert.equal(run.stages[0].status, "completed");
  assert.equal(run.stages[0].executionMetadataSource, "executor-reported");
  assert.equal(run.stages[0].actualInput.status, "recorded");
  const startCall = JSON.parse(await readFile(path.join(process.cwd(),
    "eval/local/mcp-exec-20260928-sol-medium-r01/calls/web-req_78e7e9cf47cb387eff67ca6c209ff353-start.json"), "utf8")) as {
    response: { structuredContent: { stageInput: unknown } };
  };
  assert.deepEqual(run.stages[0].actualInput, { status: "recorded", value: startCall.response.structuredContent.stageInput });
  assert.equal(run.stages[1].status, "not-started");
  assert.equal(run.stages[1].actualInput.status, "not-recorded");
  assert.equal(run.stages[1].startedAt, null);
  assert.ok(run.stages[1].prefetchedAt);
  assert.equal(run.executionAudit?.finding, "new-source-grounded");
  assert.equal(run.executionAudit?.approximateAuthoringMs, 26_000);
  assert.deepEqual(run.executionAudit?.mcpRoundTripMs, { start: 57, analyze: 92 });
});

test("five-stage input snapshots come from the matching MCP response, including final configured scope", async () => {
  const fixtures = [
    { id: "chatgpt-request-789ee8708698831ced8655c04f289698", prefix: "geo" },
    { id: "chatgpt-request-6229f153e7dd736279e90e2f523926c4", prefix: "semi" },
  ];
  const suffixes = ["01-start", "03-configure", "04-concept", "05-learning", "06-activity"];
  for (const fixture of fixtures) {
    const run = await getMcpRunView(`mcp:${fixture.id}`);
    assert.ok(run);
    for (const [index, suffix] of suffixes.entries()) {
      const callPath = path.join(process.cwd(), "eval/local/mcp-exec-20260928-sol-medium-r01/calls", `${fixture.prefix}-${suffix}.json`);
      const call = JSON.parse(await readFile(callPath, "utf8")) as {
        response: { structuredContent: { runId: string; nextStage: string; stageInput: unknown } };
      };
      const stage: McpStageView = run.stages[index];
      assert.equal(call.response.structuredContent.runId, fixture.id);
      assert.equal(call.response.structuredContent.nextStage, stage.name);
      assert.deepEqual(stage.actualInput, { status: "recorded", value: call.response.structuredContent.stageInput });
      assert.equal(stage.output.status, "recorded");
      assert.notDeepEqual(stage.actualInput.status === "recorded" ? stage.actualInput.value : null,
        stage.output.status === "recorded" ? stage.output.value : null);
    }
    const concept = run.stages[1].actualInput;
    assert.equal(concept.status, "recorded");
    if (concept.status === "recorded" && run.selectedOutlineLeafIds.status === "recorded") {
      const selection = (concept.value as { userSelection: { selectedOutlineLeafIds: string[] } }).userSelection.selectedOutlineLeafIds;
      assert.deepEqual(selection, run.selectedOutlineLeafIds.value);
    }
  }
});

test("the copied Analyze submission keeps its correction visible", async () => {
  const run = await getMcpRunView("mcp:chatgpt-request-f934a6b71ffb6d9a2a402870f0df2632");
  assert.ok(run);
  assert.match(run.provenanceNote, /이전 기하 run 제출값을 그대로 복사/);
  assert.equal(run.executionRequest?.status, "completed");
  assert.equal(run.executionAudit?.finding, "copied-prior-output");
});

test("actual five-stage outputs are not confused with unrecorded model inputs", async () => {
  const run = await getMcpRunView("mcp:chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d");
  assert.ok(run);
  assert.deepEqual(run.stages.map((stage) => stage.name), [...mcpStageNames]);
  assert.ok(run.stages.every((stage) => stage.status === "completed"));
  assert.ok(run.stages.every((stage) => stage.output.status === "recorded"));
  assert.ok(run.stages.every((stage) => stage.actualInput.status === "not-recorded"));
  assert.ok(run.stages.every((stage) => stage.model.status === "not-recorded"));
  assert.equal(run.selectedOutlineLeafIds.status, "recorded");
  if (run.selectedOutlineLeafIds.status === "recorded") assert.equal(run.selectedOutlineLeafIds.value.length, 8);
});

test("authoring eight questions stay separate from the MCP pipeline", async () => {
  const run = await getMcpRunView("authoring:geometric-outline-cycle-20260928-02");
  assert.ok(run);
  assert.equal(run.stages.length, 0);
  assert.equal(run.relatedRunId, "mcp:chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d");
  assert.equal(run.authoring.status, "recorded");
  if (run.authoring.status === "recorded") {
    const document = run.authoring.value.document as { questions: unknown[] };
    assert.equal(document.questions.length, 8);
  }
});

test("final revised authoring artifact is pinned to its verified SHA", async () => {
  const run = await getMcpRunView("authoring:integrated-geometry-sol-20260928-r02");
  assert.ok(run);
  assert.equal(run.source.fileSha256, "d788b7c9517d3171f3be4e593f3a883d4bbf93439dc967aa27e5c7f8abb22d98");
  assert.equal(run.relatedRunId, "mcp:chatgpt-request-789ee8708698831ced8655c04f289698");
  assert.equal(run.authoring.status, "recorded");
  if (run.authoring.status === "recorded") {
    const document = run.authoring.value.document as { questions: unknown[] };
    assert.equal(document.questions.length, 9);
  }
});

test("unknown and path-like IDs cannot access files", async () => {
  assert.equal(await getMcpRunView("mcp:another-run"), null);
  assert.equal(await getMcpRunView("mcp:../run"), null);
  assert.equal(await getMcpRunView("authoring:../run"), null);
});
