import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR ??= await mkdtemp(path.join(os.tmpdir(), "pc-nav-"));
const { codeNavTool, debugPeekTool } = await import("../lib/codenav.ts");
const { GOAL_NAMES, goalToolsMcp } = await import("../lib/goals.ts");

test("VS Code가 안 붙어 있으면 다른 길을 알려 준다", async () => {
  assert.match(await codeNavTool("nope", { op: "definition", file: "a.js", line: 1, symbol: "x" }), /연결돼 있지 않/);
  assert.match(await debugPeekTool("nope", { file: "a.js", line: 1, expr: [] }), /연결돼 있지 않/);
});
test("두 엔진 공통 도구 목록에 들어 있다", () => {
  for (const n of ["run_command", "code_nav", "debug_peek"]) { assert.ok(GOAL_NAMES.has(n)); assert.ok(goalToolsMcp().some((t) => t.name === n)); }
});
