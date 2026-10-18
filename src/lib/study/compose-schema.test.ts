import { test } from "node:test";
import assert from "node:assert/strict";
import { responseRequest } from "../ai/chatgpt-provider.ts";
import { COMPOSE_SCHEMAS } from "./notes.ts";

// Strict structured output: every object lists all its fields as required and allows nothing else.
function assertStrict(node: unknown, at = "$"): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
  if (n.type === "object") {
    assert.equal(n.additionalProperties, false, `${at}: additionalProperties`);
    assert.deepEqual([...(n.required ?? [])].sort(), Object.keys(n.properties ?? {}).sort(), `${at}: required`);
    for (const [k, v] of Object.entries(n.properties ?? {})) assertStrict(v, `${at}.${k}`);
  }
  if (n.type === "array") assertStrict(n.items, `${at}[]`);
}

test("용어 지도·번역은 고정 양식(strict JSON Schema)으로 요청하고 입력 글은 바꾸지 않는다", () => {
  for (const [kind, schema] of Object.entries(COMPOSE_SCHEMAS)) {
    assertStrict(schema);
    const body = responseRequest({ purpose: `note:${kind}`, system: "rule", user: "[자료] g01", caller: { uid: "u" }, json: true, schema: schema as Record<string, unknown>, schemaName: `recaller_${kind}` });
    assert.deepEqual(body.text, { format: { type: "json_schema", name: `recaller_${kind}`, schema, strict: true } });
    assert.deepEqual(body.input, [{ role: "user", content: "[자료] g01" }]);
  }
  // When the plan route refuses schemas, the fallback asks for JSON mode with the schema in the instructions.
  const fallback = responseRequest({ purpose: "note:translate", system: "rule", user: "1. Hello", caller: { uid: "u" }, json: true, schema: COMPOSE_SCHEMAS.translate as Record<string, unknown> }, "fallback");
  assert.deepEqual(fallback.text, { format: { type: "json_object" } });
  assert.match(fallback.instructions, /JSON Schema/);
  assert.match(String(fallback.input[0].content), /JSON/);
});
