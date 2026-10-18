import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lexicalCopyCheck, readVibeCache, vibeCacheKey, vibeCardSchema, vibePrompt, writeVibeCache } from "./pastexam.ts";

const card = { version: 1 as const, asking: { recall: .25, explain: .25, apply: .25, discriminate: .25 },
  answer: { choice: .5, short: .25, worked: .25 }, conditions: { plain: .5, scenario: .25, diagram: .25 },
  traps: { none: .25, boundary: .25, signOrOrder: .25, similarConcept: .25 }, size: { minSteps: 1, maxSteps: 3 },
  difficulty: { direct: .5, linked: .25, transfer: .25 }, highWeight: { explanation: .5, calculation: .25, construction: .25 } };
test("vibe excludes prose and validates ratios and ranges", () => {
  assert.equal(vibeCardSchema.safeParse(card).success, true);
  assert.equal(vibeCardSchema.safeParse({ ...card, example: "secret exam sentence" }).success, false);
  assert.equal(vibeCardSchema.safeParse({ ...card, asking: { ...card.asking, recall: .9 } }).success, false);
  assert.equal(vibeCardSchema.safeParse({ ...card, size: { minSteps: 4, maxSteps: 2 } }).success, false);
  assert.ok(vibePrompt(card).includes("선택한 강의 범위와 목표는 모두 유지"));
});
test("cache keys depend on PDF content, not selection order; roundtrip validated", async () => {
  const a = "a".repeat(64), b = "b".repeat(64);
  const key = vibeCacheKey([a, b]);
  assert.equal(key, vibeCacheKey([b, a, a]));
  assert.notEqual(key, vibeCacheKey([a]));
  assert.throws(() => vibeCacheKey(["../bad"]));
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe-test-"));
  try { assert.equal(await readVibeCache(root, key), null); await writeVibeCache(root, key, card); assert.deepEqual(await readVibeCache(root, key), card); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test("invented exam text and distinctive numeric sequence are flagged", () => {
  const source = "A fictional orchard robot carries purple baskets across the bridge. Route values: 17, 23, 41, 89.";
  assert.ok(lexicalCopyCheck(source, [source])[0].reasons.includes("shared-text"));
  assert.ok(lexicalCopyCheck("Different operation on 17, 23, 41, 89", [source])[0].reasons.includes("shared-values"));
  assert.deepEqual(lexicalCopyCheck("Explain a queue using 0 and 1.", [source]), []);
});
