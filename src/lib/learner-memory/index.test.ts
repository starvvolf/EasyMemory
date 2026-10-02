import assert from "node:assert/strict";
import test from "node:test";
import { applyMemorySummary, createMemoryState, editMemoryEntry, MEMORY_LIMITS, selectMemoryContext, validateMemoryCandidates } from "./index.ts";
import type { MemoryCandidate, MemorySource, MemoryState } from "./index.ts";

const now = "2026-09-07T00:00:00.000Z";
const candidate: MemoryCandidate = { domain: "algorithm", topic: "binary search", confirmed: ["경계 조건을 설명함"], uncertain: ["중복값 처리 미확인"], evidenceIds: ["m1"], basis: "observation" };
const source: MemorySource = { ownerUid: "alice", recordId: "problem-1", throughSequence: 1, events: [{ id: "m1", sequence: 1 }] };
function initial() { return applyMemorySummary(createMemoryState("alice"), "alice", 0, source, [candidate], now); }

test("summary updates state; another problem gets only relevant domain/topic data", () => {
  const state = initial();
  assert.equal(state.revision, 1);
  assert.equal(state.entries[0].evidence.recordId, "problem-1");
  const context = selectMemoryContext(state, "alice", "algorithm", ["BINARY SEARCH"]);
  assert.equal(context.entries.length, 1);
  assert.equal(context.kind, "learner-memory-user-data");
  assert.deepEqual(selectMemoryContext(state, "alice", "algorithm", ["graph"]).entries, []);
  assert.deepEqual(selectMemoryContext(state, "alice", "cs", ["binary search"]).entries, []);
  context.entries[0].confirmed.push("caller mutation");
  assert.equal(state.entries[0].confirmed.length, 1);
});

test("same original record replay, older position, and new summary with only old evidence do not add evidence", () => {
  const state = initial();
  assert.equal(applyMemorySummary(state, "alice", 1, source, [candidate], now), state);
  const next = applyMemorySummary(state, "alice", 1, { ...source, throughSequence: 2, events: [...source.events, { id: "m2", sequence: 2 }] }, [{ ...candidate, confirmed: ["old evidence promoted"] }], now);
  assert.deepEqual(next.entries, state.entries);
  assert.equal(next.appliedSources[0].throughSequence, 2);
  assert.equal(applyMemorySummary(next, "alice", 2, source, [candidate], now), next);
});

test("fresh original evidence replaces current observation without accumulating a score", () => {
  const state = initial();
  const next = applyMemorySummary(state, "alice", 1, { ...source, throughSequence: 2, events: [{ id: "m2", sequence: 2 }] }, [{ ...candidate, evidenceIds: ["m2"], uncertain: [] }], now);
  assert.deepEqual(next.entries[0].evidence.evidenceIds, ["m2"]);
  assert.deepEqual(next.entries[0].uncertain, []);
  assert.equal(next.entries.length, 1);
});

test("confirm, correction, and deletion survive reconnect and fresh automated summaries", () => {
  for (const change of ["confirm", "delete", { confirmed: ["사용자 정정"], uncertain: [] }] as const) {
    const state = initial();
    const edited = editMemoryEntry(state, "alice", 1, candidate, change === "confirm" || change === "delete" ? change : { confirmed: [...change.confirmed], uncertain: [] }, now);
    const reloaded = JSON.parse(JSON.stringify(edited)) as MemoryState;
    const next = applyMemorySummary(reloaded, "alice", 2, { ...source, recordId: "problem-2" }, [candidate], now);
    assert.deepEqual(next.entries, edited.entries);
    if (change === "delete") {
      assert.deepEqual(selectMemoryContext(next, "alice", "algorithm", [candidate.topic]).entries, []);
      assert.deepEqual(next.entries[0].confirmed, []);
      assert.deepEqual(next.entries[0].evidence.evidenceIds, []);
    } else assert.equal(next.entries[0].userEdited, true);
  }
});

test("owner and source ownership mismatches fail for reads and mutations", () => {
  const state = initial();
  assert.throws(() => selectMemoryContext(state, "bob", "algorithm", [candidate.topic]), /owner/);
  assert.throws(() => editMemoryEntry(state, "bob", 1, candidate, "delete", now), /owner/);
  assert.throws(() => applyMemorySummary(state, "bob", 1, source, [candidate], now), /owner/);
  assert.throws(() => applyMemorySummary(state, "alice", 1, { ...source, ownerUid: "bob" }, [candidate], now), /owner/);
});

test("invalid candidates, forged references and revision conflicts preserve the old value", () => {
  const state = initial();
  const before = JSON.stringify(state);
  assert.throws(() => applyMemorySummary(state, "alice", 0, source, [candidate], now), /conflict/);
  assert.throws(() => applyMemorySummary(state, "alice", 1, source, [{ ...candidate, evidenceIds: ["unknown"] }], now), /evidence/);
  assert.throws(() => applyMemorySummary(state, "alice", 1, { ...source, events: [{ id: "m1", sequence: 99 }] }, [candidate], now), /position/);
  assert.throws(() => applyMemorySummary(state, "alice", 1, source, [{ ...candidate, confirmed: ["x".repeat(241)] }], now));
  assert.throws(() => validateMemoryCandidates([{ ...candidate, domain: "other" }]));
  assert.throws(() => validateMemoryCandidates([candidate, { ...candidate, topic: "BINARY SEARCH" }]));
  assert.equal(JSON.stringify(state), before);
});

test("pure transition leaves input intact and replay after JSON reload is a no-op", () => {
  const original = createMemoryState("alice");
  const derived = applyMemorySummary(original, "alice", 0, source, [candidate], now);
  assert.equal(original.revision, 0);
  assert.deepEqual(original.entries, []);
  const stored = JSON.parse(JSON.stringify(derived)) as MemoryState;
  assert.equal(applyMemorySummary(stored, "alice", stored.revision, source, [candidate], now), stored);
});

test("context has hard count and serialized length limits including metadata", () => {
  let state = createMemoryState("alice");
  for (let index = 0; index < 10; index++) {
    state = applyMemorySummary(state, "alice", state.revision, { ...source, recordId: `problem-${index}` }, [{ ...candidate, topic: `topic-${index}` }], now);
  }
  const context = selectMemoryContext(state, "alice", "algorithm", state.entries.map((entry) => entry.topic));
  assert.ok(context.entries.length > 0 && context.entries.length <= MEMORY_LIMITS.contextEntries);
  assert.ok(JSON.stringify(context).length <= MEMORY_LIMITS.contextChars);
});

test("capacity fails closed instead of evicting replay protection", () => {
  const state = createMemoryState("alice");
  state.appliedSources = Array.from({ length: MEMORY_LIMITS.sources }, (_, i) => ({ recordId: `old-${i}`, throughSequence: 1 }));
  const before = JSON.stringify(state);
  assert.throws(() => applyMemorySummary(state, "alice", 0, source, [candidate], now), /capacity/);
  assert.equal(JSON.stringify(state), before);
});

test("inference cannot be promoted to confirmed and user corrections retain self-report provenance", () => {
  assert.throws(() => validateMemoryCandidates([{ ...candidate, basis: "inference" }]), /uncertain/);
  assert.equal(validateMemoryCandidates([{ ...candidate, basis: "inference", confirmed: [] }])[0].basis, "inference");
  const state = editMemoryEntry(initial(), "alice", 1, candidate, "confirm", now);
  assert.equal(state.entries[0].basis, "self-report");
});
