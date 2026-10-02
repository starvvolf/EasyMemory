import assert from "node:assert/strict";
import test from "node:test";
import { correctEvent, isAssisted, recommend, scopeKey, type ArtifactScope, type ExperimentEvent } from "./rule.ts";

const base: ArtifactScope = {
  authoringRunId: "cycle-a", stage: "authoring-lab", artifactVersion: "iteration-0",
  artifactSha256: "a".repeat(64), originRunId: "mcp-run-a", questionId: "q-1",
  learningUnitId: "mcp-learning-1", sourceId: "source.pdf", sourceRange: "PDF 2쪽",
};
const now = "2026-09-28T12:00:00.000Z";
const at = "2026-09-28T11:00:00.000Z";
const event = (id: string, kind: "submit" | "reveal" | "rating", extra: object = {}): ExperimentEvent => ({ id, sessionId: "session-1", scope: base, kind, occurredAt: at, ...extra } as ExperimentEvent);

test("same question and learning IDs in another run or artifact stay separate", () => {
  const otherRun = { ...base, authoringRunId: "cycle-b" };
  const otherVersion = { ...base, artifactSha256: "b".repeat(64) };
  assert.notEqual(scopeKey(base), scopeKey(otherRun));
  assert.notEqual(scopeKey(base), scopeKey(otherVersion));
  const wrong = event("wrong", "submit", { responseId: "r-1", correct: false });
  const rows = recommend([base, otherRun, otherVersion], [wrong], now);
  assert.equal(rows.find((row) => scopeKey(row.scope) === scopeKey(base))?.status, "review");
  assert.equal(rows.filter((row) => row.status === "insufficient").length, 2);
});

test("reveal before correct submit cannot prove independent recall", () => {
  const rows = recommend([base], [event("reveal", "reveal"), event("submit", "submit", { responseId: "r-1", correct: true })], now);
  assert.equal(rows[0].status, "insufficient");
});

test("a new session can provide fresh independent evidence after a past reveal", () => {
  const rows = recommend([base], [event("reveal", "reveal"), event("submit", "submit", { sessionId: "session-2", responseId: "r-1", correct: true })], now);
  assert.equal(rows[0].status, "not-now");
});

test("post-reveal self-rating remains a user report, not an independent success", () => {
  const events = [event("reveal", "reveal"), event("rating", "rating", { rating: "remembered" })];
  assert.equal(isAssisted(events[1], events), true);
  const item = recommend([base], events, now)[0];
  assert.equal(item.status, "insufficient");
  assert.equal(item.evidence.length, 2);
});

test("excluding a reveal record cannot turn a later answer into independent success", () => {
  const events = [{ ...event("reveal", "reveal"), excluded: true }, event("submit", "submit", { responseId: "r-1", correct: true })];
  assert.equal(isAssisted(events[1], events), true);
  assert.equal(recommend([base], events, now)[0].status, "insufficient");
});

test("unseen question stays insufficient", () => {
  assert.equal(recommend([base], [], now)[0].status, "insufficient");
});

test("correction and exclusion change recommendation", () => {
  const unsure = event("rating", "rating", { rating: "unsure" });
  assert.equal(recommend([base], [unsure], now)[0].status, "review");
  const fixed = correctEvent(unsure, "remembered", now);
  assert.equal(recommend([base], [fixed], now)[0].status, "not-now");
  assert.equal(recommend([base], [{ ...fixed, excluded: true }], now)[0].status, "insufficient");
});

test("older one-time success returns as a review candidate", () => {
  const success = event("success", "submit", { responseId: "r-1", correct: true, occurredAt: "2026-09-26T10:00:00.000Z" });
  assert.equal(recommend([base], [success], now)[0].status, "review");
});
