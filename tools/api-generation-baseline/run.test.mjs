import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  COMPARISON_COMMIT,
  DEFAULT_GOAL,
  RECOVERY_COMMIT,
  compareCandidates,
} from "./run.mjs";

test("복구 기준은 MCP 결합 전 API 스냅샷으로 고정된다", () => {
  assert.equal(RECOVERY_COMMIT, "150138f73301365b7d07fbfab4b8093c8f4409ca");
  assert.equal(COMPARISON_COMMIT, "115c895df9bc9d279103fc71902855c3a2be27e9");
  assert.equal(DEFAULT_GOAL, "이 자료의 핵심 내용을 반복학습 문제로 익힌다.");
});

test("두 후보의 계보와 변경 범위를 검사한다", () => {
  const comparison = compareCandidates(process.cwd());
  assert.equal(comparison.parent, "fda889ea29bc8783d290a5836d8f45db9919c07c");
  assert.equal(comparison.identicalSupportFiles, true);
  assert.ok(comparison.changedFiles.some((line) => line.includes("scripts/study-forge-mcp.test.ts")));
  assert.ok(comparison.coreDiff.every((line) => /src\/lib\/pipeline\/(analyze|plan|generate)\.ts$/.test(line.replaceAll("\\", "/"))));
});

test("복구 커밋은 Responses API와 엄격한 JSON Schema 계약을 포함한다", () => {
  const generate = execFileSync(
    "git",
    ["show", `${RECOVERY_COMMIT}:src/lib/pipeline/generate.ts`],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.match(generate, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(generate, /type:\s*"json_schema"/);
  assert.match(generate, /strict:\s*true/);
  assert.match(generate, /runAnalysis/);
  assert.match(generate, /runCardGeneration/);
});
