import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { budgetFetch, proveBudget, stopRepeatedRecordedFailures } from "./verification-11-real-budget.mjs";
const endpoint = "https://api.openai.com/v1/responses";
test("actual budget preserves 60 reservations and blocks request 61", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "verification-real-proof-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(await proveBudget(path.join(dir, "ledger.json")), { outgoingFakeCalls: 60, sixtyFirstBlocked: true, realCalls: 0 });
});
test("the same correction A-B-A stops before another outgoing request", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "verification-real-correction-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ledger.json");
  let outgoing = 0;
  const guarded = budgetFetch(file, async () => { outgoing += 1; return new Response("{}", { status: 200 }); });
  const options = (message) => ({ body: JSON.stringify({ model: "mock", input: [{ content: `[검사 오류]\n${message}\n\n이전 답 수정` }] }) });
  await guarded(endpoint, options("A"));
  await guarded(endpoint, options("B"));
  await assert.rejects(guarded(endpoint, options("A")), /two identical/);
  assert.equal(outgoing, 2);
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(ledger.calls.length, 2);
  assert.equal(ledger.stopped, "same-validation-failure-twice");
});
test("completed-case failure records A-B-A stop the next case without changing reservations", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "verification-real-records-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ledger.json");
  writeFileSync(file, JSON.stringify({ limit: 60, calls: [{ n: 1 }] }));
  stopRepeatedRecordedFailures(file, ["A", "B", "A"].map((error) => ({ ok: false, error })));
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(ledger.stopped, "same-recorded-failure-twice");
  assert.equal(ledger.calls.length, 1);
  assert.ok(Object.values(ledger.recordedFailureCounts).includes(2));
});
