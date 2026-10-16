import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ChatGptParityService } from "../tools/study-forge-mcp/chatgpt-parity.ts";
import { createStudyForgeMcpServer } from "../tools/study-forge-mcp/server.ts";
import { StudyForgeMcpService } from "../tools/study-forge-mcp/service.ts";

test("the existing geometric run is readable through the actual MCP tools", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "study-forge-view-mcp-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const runRoot = path.join(
    process.cwd(),
    "eval/local/product-flow-20260928-geometric/data/mcp/chatgpt-runs",
  );
  const server = createStudyForgeMcpServer(
    new StudyForgeMcpService(path.join(temporaryRoot, "legacy")),
    new ChatGptParityService(runRoot, path.join(temporaryRoot, "published")),
  );
  const client = new Client({ name: "mcp-run-view-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.callTool({ name: "list_chatgpt_pdf_runs", arguments: {} });
  assert.equal(listed.isError, undefined);
  const runs = (listed.structuredContent as { runs: Array<{ runId: string }> }).runs;
  assert.ok(runs.some((run) => run.runId === "chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d"));

  const result = await client.callTool({
    name: "get_chatgpt_pdf_result",
    arguments: { runId: "chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d" },
  });
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { cardCount: number }).cardCount, 6);
});

test("MCP stageInput carries source-grounded Learning Design guidance", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "study-forge-learning-guidance-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const server = createStudyForgeMcpServer(
    new StudyForgeMcpService(path.join(temporaryRoot, "legacy")),
    new ChatGptParityService(path.join(temporaryRoot, "runs"), path.join(temporaryRoot, "published")),
  );
  const client = new Client({ name: "learning-guidance-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const started = await client.callTool({ name: "start_chatgpt_pdf_run", arguments: {
    title: "Study", files: [{ fileName: "study.pdf", pageCount: 1 }], stopAfterStage: "learning-design",
  } });
  const runId = (started.structuredContent as { runId: string }).runId;
  const analyzed = await client.callTool({ name: "submit_chatgpt_pdf_stage", arguments: {
    runId, stage: "analyze", result: { outlineText: "@file study.pdf\n# Study [1]" },
  } });
  assert.match((analyzed.structuredContent as { stageInput: { instructions: string } }).stageInput.instructions,
    /독립적으로 학습·판단할 내용의 출처/);
  const tree = await client.callTool({ name: "submit_chatgpt_pdf_stage", arguments: {
    runId, stage: "concept-tree", result: { treeText: "Study\n- [개념] Example — 학습할 개념 (p.1)" },
  } });
  assert.equal(tree.isError, undefined);
  const input = (tree.structuredContent as { stageInput: { instructions: string; input: { attachmentRule: string } } }).stageInput;
  assert.match(input.instructions, /학습내용·목표·성공기준은 같은 능력과 범위/);
  assert.match(input.instructions, /제공된 원문으로 학습하고 확인할 수 있는 내용/);
  assert.match(input.input.attachmentRule, /상위 개념의 출처를 그 아래 모든 독립 능력의 평가범위로 간주하지/);
});
