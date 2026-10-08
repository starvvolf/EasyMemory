import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ChatGptParityService } from "../tools/study-forge-mcp/chatgpt-parity.ts";
const original = "협업/검증_11/real/stage5-2026-10-01T19-29-58-092Z/bfs-2pages-gpt-6-sol-calls.json";
const calls = JSON.parse(await readFile(original, "utf8"));
const call = calls.find((entry) => entry.purpose === "stage:concept-tree" && entry.ok);
assert.ok(call, "Actual saved concept-tree response must exist.");
const result = JSON.parse(call.reply);
assert.equal(result.treeText.trim().split(/\r?\n/).length, 1);
const root = await mkdtemp(path.join(tmpdir(), "verification11-actual-replay-"));
try {
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({ title: "실제 응답 재생", files: [{ fileName: "fixture.pdf", pageCount: 2 }] });
  await service.submitStage({ runId: started.runId, stage: "analyze", result: { outlineText: "@file fixture.pdf\n# 자료 [1-2]" } });
  await assert.rejects(service.submitStage({ runId: started.runId, stage: "concept-tree", result }), /하위 개념을 하나 이상/);
  const proof = { actualSavedResponse: true, responseSha256: createHash("sha256").update(call.reply).digest("hex"), childConcepts: 0, rejectedAt: "concept-tree", repairedErrorProvided: true, actualModelCalls: 0 };
  await writeFile(`협업/검증_11/real/root-only-replay-${Date.now()}_public.json`, JSON.stringify(proof, null, 2), { flag: "wx" });
  console.log(JSON.stringify(proof));
} finally { await rm(root, { recursive: true, force: true }); }
