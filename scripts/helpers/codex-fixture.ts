import type { TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import type { CodexAppServer } from "../../src/lib/codex-app-server.ts";

export type CapturedCodexRequest = Parameters<CodexAppServer["chat"]>[0];

// Test-only boundary: exercise the real provider and pipeline, never start a model process.
export function installCodexFixture(
  context: TestContext,
  respond: (request: CapturedCodexRequest) => unknown | Promise<unknown>,
) {
  const target = globalThis as typeof globalThis & { __studyForgeCodexAppServer?: unknown };
  const previous = target.__studyForgeCodexAppServer;
  const requests: CapturedCodexRequest[] = [];
  target.__studyForgeCodexAppServer = {
    isRunning: () => true,
    getAccount: async () => ({ account: { type: "chatgpt" } }),
    chat: async (request: CapturedCodexRequest) => {
      requests.push(request);
      return { text: JSON.stringify(await respond(request)), threadId: "fixture-thread" };
    },
  };
  context.after(() => {
    if (previous === undefined) delete target.__studyForgeCodexAppServer;
    else target.__studyForgeCodexAppServer = previous;
  });
  return requests;
}

// Keep legacy fixture payloads/assertions while exercising today's Codex provider.
// This is a test representation, not a claim that production still sends HTTP Responses bodies.
export function installLegacyResponseFixture(context: TestContext) {
  const realFetch = globalThis.fetch;
  return installCodexFixture(context, async request => {
    if (globalThis.fetch === realFetch) throw new Error("Missing test response; refusing real network access");
    const files = await Promise.all((request.attachments ?? []).map(async file => ({
      type: "input_file", filename: file.name,
      file_data: "data:application/pdf;base64," + (await readFile(file.path)).toString("base64"),
    })));
    const body = {
      input: [{ role: "system", content: request.system }, { role: "user",
        content: files.length ? [{ type: "input_text", text: request.message }, ...files] : request.message }],
      text: { format: { type: "json_schema", schema: request.outputSchema } },
    };
    const response = await globalThis.fetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Fixture returned failure " + response.status);
    const payload = await response.json() as { output_text: string };
    return JSON.parse(payload.output_text);
  });
}
