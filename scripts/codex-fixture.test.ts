import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { installCodexFixture, installLegacyResponseFixture } from "./helpers/codex-fixture.ts";
import { callCodexJson } from "../src/lib/ai/codex-provider.ts";

test("legacy fixture refuses to fall through to real fetch when its response is missing", async (t) => {
  installLegacyResponseFixture(t);
  await assert.rejects(callCodexJson({ schemaName: "fixture", schema: { type: "object" },
    system: "fixture", user: "fixture" }), /refusing real network access/);
});

test("pipeline fixture captures actual schema, prompt and temporary attachment without a model", async (t) => {
  const requests = installCodexFixture(t, async request => {
    assert.equal(request.system, "fixture policy");
    assert.match(request.message, /fixture question/);
    assert.deepEqual(request.outputSchema, { type: "object" });
    assert.equal(request.attachments?.length, 1);
    assert.equal(await readFile(request.attachments![0].path, "utf8"), "fake PDF bytes");
    return { answer: "fixture only" };
  });
  const result = await callCodexJson({
    schemaName: "fixture", schema: { type: "object" }, system: "fixture policy", user: "fixture question",
    files: [{ filename: "fake.pdf", mimeType: "application/pdf", base64: Buffer.from("fake PDF bytes").toString("base64") }],
  });
  assert.deepEqual(result, { answer: "fixture only" });
  assert.equal(requests.length, 1);
  await assert.rejects(readFile(requests[0].attachments![0].path), { code: "ENOENT" });
});
