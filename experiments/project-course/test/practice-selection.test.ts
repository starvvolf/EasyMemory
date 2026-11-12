import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "sel-"));
process.env.PC_FAKE_AI = "1";
const { freshSelection } = await import("../lib/practice.ts");

test("고른 코드(11/12): 같은 선택은 한 번만 질문 앞에 붙고, 바꾸거나 풀었다 다시 고르면 다시 붙는다", () => {
  const st = (text: string, from = 1, to = 2) => ({ file: "A.java", selection: { text, from, to } }) as never;
  assert.match(freshSelection("r", st("int a;")), /A\.java 1~2줄\]\nint a;/);
  assert.equal(freshSelection("r", st("int a;")), "", "같은 선택은 다음 질문에 다시 안 붙는다");
  assert.match(freshSelection("r", st("int b;", 3, 3)), /int b;/);
  assert.equal(freshSelection("r", { file: "A.java" } as never), "");
  assert.match(freshSelection("r", st("int b;", 3, 3)), /int b;/, "선택을 풀었다 다시 고르면 붙는다");
});
