// 테스트 만들기 실행기: real generator / reference / brute / faulty solutions for "가장 큰 두 수의 합", run in the harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestgen, type TestgenJob } from "./index.ts";

const READ = `const t = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number); const n = t[0]; const a = t.slice(1, n + 1);`;
const REFERENCE = `${READ} let x = -Infinity, y = -Infinity; for (const v of a) { if (v > x) { y = x; x = v; } else if (v > y) y = v; } console.log(String(x + y));`;
const BRUTE = `${READ} let best = -Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) best = Math.max(best, a[i] + a[j]); console.log(String(best));`;
const GENERATOR = `
const LO = -1.5e9, HI = 1.5e9; // the sum of two can pass 2^31
const line = (a) => a.length + "\\n" + a.join(" ") + "\\n";
module.exports = {
  tests: [
    { kind: "min", size: "min", count: 2 }, { kind: "allNeg", size: "mid", count: 2 }, { kind: "sameMax", size: "mid", count: 2 },
    { kind: "extreme", size: "max", count: 1 }, { kind: "random", size: "mid", count: 3 }, { kind: "random", size: "max", count: 1 },
  ],
  smallKinds: ["random", "allNeg", "sameMax", "tiny"],
  gen(kind, size, rnd) {
    const n = size === "min" ? 2 : size === "small" ? rnd.int(2, 6) : size === "mid" ? rnd.int(100, 1000) : 100000;
    const vals = (lo, hi) => Array.from({ length: n }, () => rnd.int(lo, hi));
    if (kind === "min" || kind === "tiny") return line(vals(-5, 5).slice(0, Math.max(2, Math.min(n, 3))));
    if (kind === "allNeg") return line(vals(LO, -1));
    if (kind === "sameMax") { const a = vals(-100, 100); a[0] = 100; a[a.length - 1] = 100; return line(a); }
    if (kind === "extreme") return line(Array.from({ length: n }, () => HI));
    return line(vals(LO, HI));
  },
  check(input) {
    const t = input.trim().split(/\\s+/).map(Number); const n = t[0];
    if (!(n >= 2 && n <= 100000)) return "N 범위 밖";
    if (t.length !== n + 1) return "수의 개수가 N과 다름";
    return t.slice(1).every((v) => Number.isInteger(v) && v >= -1.5e9 && v <= 1.5e9) || "값 범위 밖";
  },
};`;
const base: TestgenJob = { generator: GENERATOR, reference: REFERENCE, brute: BRUTE, needCompared: 50, smallCount: 200, seed: 7,
  exampleInputs: ["3\n1 2 3\n"] };

test("a sound generator and reference give hidden tests of every size, agreed by the simple solution, in one process", { timeout: 120_000 }, async () => {
  const started = Date.now();
  const r = await runTestgen(base);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.ok(r.compared >= 150, `compared ${r.compared}`);
  assert.ok(r.maxTests >= 2, "max-size tests are in");
  assert.ok(r.tests.some((t) => t.input.length > 500_000), "a 100,000-number input");
  assert.equal(r.tests.find((t) => t.kind === "extreme")!.output, "3000000000", "an answer past 32 bits");
  assert.deepEqual(r.examples, [{ input: "3\n1 2 3\n", output: "5" }]);
  assert.ok(Date.now() - started < 60_000, "hundreds of runs in seconds, not minutes");
});

test("faulty solutions: each kind is caught by the tests that aim at it, and the score says so", { timeout: 120_000 }, async () => {
  const r = await runTestgen({ ...base, mutants: [
    { flaw: "초기화", code: `${READ} let x = 0, y = 0; for (const v of a) { if (v > x) { y = x; x = v; } else if (v > y) y = v; } console.log(String(x + y));` },
    { flaw: "정수 범위", code: `${READ} let x = -Infinity, y = -Infinity; for (const v of a) { if (v > x) { y = x; x = v; } else if (v > y) y = v; } console.log(String((x + y) | 0));` },
    { flaw: "시간 초과", code: BRUTE },
    { flaw: "중복 처리", code: `${READ} const s = [...new Set(a)].sort((p, q) => q - p); console.log(String(s[0] + (s[1] ?? s[0])));` },
    { flaw: "사실은 맞는 풀이", code: `${READ} const s = [...a].sort((p, q) => q - p); console.log(String(s[0] + s[1]));` },
  ] });
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.equal(r.mutation.total, 4, "the right one is not counted");
  assert.equal(r.mutation.killed, 4);
  assert.deepEqual(r.mutation.maybeRight, ["사실은 맞는 풀이"]);
});

test("a draft fails with a reason: a checker that refuses the source example, a reference that disagrees with the simple one", { timeout: 60_000 }, async () => {
  const strict = await runTestgen({ ...base, exampleInputs: [], sourceExamples: [{ input: "1\n5\n", output: "5" }] });
  assert.equal(strict.ok, false);
  assert.match(!strict.ok ? strict.reason : "", /원문 예제 1번.*거부/);
  const wrong = await runTestgen({ ...base, reference: `${READ} console.log(String(Math.max(...a) * 2));` });
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.reason : "", /단순 풀이 .*모범 풀이/);
  const hang = await runTestgen({ ...base, generator: GENERATOR.replace("gen(kind, size, rnd) {", "gen(kind, size, rnd) { while (true) {}") });
  assert.equal(hang.ok, false);
  assert.match(!hang.ok ? hang.reason : "", /생성기가/);
});

test("the harness sees no environment: the app's keys stay out", { timeout: 30_000 }, async () => {
  process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = "secret-for-test";
  const peek = `${READ} console.log(String(typeof process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY === "undefined" ? x() : 0)); function x() { return 1; }`;
  const r = await runTestgen({ ...base, brute: "", needCompared: 0, reference: peek, exampleInputs: [] });
  delete process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY;
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (r.ok) assert.ok(r.tests.every((t) => t.output === "1"));
});
