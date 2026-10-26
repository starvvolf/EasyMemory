// 채점 보정: how a calibration turns raw job-object numbers into the solution's own use, and the hard limits back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveUsage, limitsFor, type Calibration } from "./run.ts";

const slowPc: Calibration = { speed: 1.5, base: { python: { cpuMs: 60, peakKb: 60 * 1024 }, cpp: { cpuMs: 0, peakKb: 600 } } };

test("a slower PC and a heavy Python install don't count against the solution", () => {
  assert.deepEqual(effectiveUsage({ cpuMs: 1560, peakKb: 160 * 1024 }, "python", slowPc), { cpuMs: 1000, peakKb: 100 * 1024 });
  assert.deepEqual(effectiveUsage({ cpuMs: 30, peakKb: 100 }, "python", slowPc), { cpuMs: 0, peakKb: 0 }, "never below zero");
  assert.deepEqual(effectiveUsage({ cpuMs: 900, peakKb: 5000 }, "javascript"), { cpuMs: 900, peakKb: 5000 }, "no calibration: raw");
});

test("hard limits are the limit plus the band, in this PC's raw terms", () => {
  assert.deepEqual(limitsFor(2000, 256), { cpuMs: 2600, memMb: 282, wallMs: 7800 });
  const py = limitsFor(2000, 256, "python", slowPc);
  assert.equal(py.cpuMs, Math.round(2600 * 1.5 + 60));
  assert.equal(py.memMb, 282 + 60);
  assert.equal(limitsFor(500, 64).cpuMs, 800, "band at least 0.3 s");
  assert.equal(limitsFor(500, 64).memMb, 80, "band at least 16 MB");
});
