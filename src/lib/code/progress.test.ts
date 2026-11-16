import test from "node:test";
import assert from "node:assert/strict";
import { note, readProgress, withProgress } from "./progress.ts";

test("진행 단계: 요청 흐름을 따라 job에 쌓이고, job 없는 요청에는 안 쌓인다", async () => {
  const deep = async () => { await new Promise((r) => setTimeout(r, 5)); note("둘째"); await Promise.all([1, 2].map(async () => note("동시")));};
  await withProgress("j-test-0001", async () => { note("첫째"); note("첫째"); await deep(); });
  const r = readProgress("j-test-0001");
  assert.deepEqual(r.steps.map((s) => s.text), ["첫째", "둘째", "동시"]);
  assert.equal(r.done, true);
  note("아무 데도 안 감");
  await withProgress(undefined, async () => note("job 없음"));
  assert.equal(readProgress("j-none-0001").steps.length, 0);
});
