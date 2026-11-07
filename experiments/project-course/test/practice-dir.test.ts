import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const { archivePractice } = await import("../tools/reset-data.mjs");
test("자료 비우기는 Recaller 밖 작업 폴더도 같은 보관 칸으로 옮긴다", () => {
  const data = mkdtempSync(path.join(os.tmpdir(), "d-")), practice = mkdtempSync(path.join(os.tmpdir(), "p-"));
  writeFileSync(path.join(data, "package.json"), "{}"); writeFileSync(path.join(data, "runs.json"), "{}");
  mkdirSync(path.join(practice, "chat-1")); writeFileSync(path.join(practice, "chat-1", "a.py"), "print(1)");
  const r = archivePractice(data, "t", practice);
  assert.equal(r.count, 2);
  assert.ok(existsSync(path.join(data, "package.json")), "막는 package.json은 남김");
  assert.ok(existsSync(path.join(data, "보관", r.label, "practice", "chat-1", "a.py")));
  assert.ok(!existsSync(path.join(practice, "chat-1")));
});
