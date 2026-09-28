import assert from "node:assert/strict";
import test from "node:test";
import { loadExperimentProgress, loadExperimentProgressFor, saveExperimentProgress } from "./storage.ts";

test("switching documents preserves each version's attempt and reveal boundary", () => {
  const values = new Map<string, string>();
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  try {
    const geometry = { artifactId: "geometry", artifactSha256: "a".repeat(64), sessionId: "session-geometry", lastQuestionId: "q-6" };
    const semiconductor = { artifactId: "semiconductor", artifactSha256: "b".repeat(64), sessionId: "session-semiconductor", lastQuestionId: "q-2" };
    saveExperimentProgress("user", geometry);
    saveExperimentProgress("user", semiconductor);
    assert.deepEqual(loadExperimentProgress("user"), semiconductor);
    assert.deepEqual(loadExperimentProgressFor("user", geometry.artifactId, geometry.artifactSha256), geometry);
    assert.equal(loadExperimentProgressFor("user", geometry.artifactId, "c".repeat(64)), null);
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
});
