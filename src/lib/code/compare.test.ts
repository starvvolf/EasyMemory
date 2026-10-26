// 출력 비교: the one function the judge and the test maker share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareOutput } from "./compare.mjs";

test("exact: line ends and trailing blank lines don't matter, the rest does, and the first difference is named", () => {
  assert.equal(compareOutput("1 2 \r\n3\n\n", "1 2\n3").ok, true);
  const space = compareOutput("1  2\n3", "1 2\n3");
  assert.equal(space.ok, false); if (!space.ok) assert.match(space.why, /1번째 줄: 띄어쓰기/);
  const value = compareOutput("1 2\n3 5\n", "1 2\n3 4");
  assert.equal(value.ok, false); if (!value.ok) { assert.equal(value.line, 2); assert.equal(value.token, 2); assert.match(value.why, /2번째 줄 2번째 값/); }
  const short = compareOutput("1", "1\n2");
  assert.equal(short.ok, false); if (!short.ok) assert.match(short.why, /짧음/);
  const long = compareOutput("1\n2", "1");
  assert.equal(long.ok, false); if (!long.ok) assert.match(long.why, /김/);
});

test("approx: numbers within the error pass, words and counts still must match", () => {
  assert.equal(compareOutput("0.3333331\n", "0.333333", { mode: "approx" }).ok, true);
  assert.equal(compareOutput("1000000.5", "1000000", { mode: "approx" }).ok, true, "relative error");
  assert.equal(compareOutput("0.34", "0.333333", { mode: "approx" }).ok, false);
  assert.equal(compareOutput("YES 1.0", "NO 1.0", { mode: "approx" }).ok, false);
  assert.equal(compareOutput("1.0", "1.0 2.0", { mode: "approx" }).ok, false);
  assert.equal(compareOutput("1.0  2.0\n", "1.0 2.0", { mode: "approx" }).ok, true, "spacing ignored in approx");
});
