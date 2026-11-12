// 판정에 작업 폴더의 지금 파일(11/13 사용자 승인 안 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(os.tmpdir(), "jfiles-"));
process.env.PC_DATA_DIR = dir; process.env.PC_FAKE_AI = "1";
const ws = path.join(dir, "ws");
await mkdir(ws, { recursive: true });
await writeFile(path.join(ws, "a.py"), "print('a')\nprint('b')");
await writeFile(path.join(ws, "b.py"), "x = 1");
await writeFile(path.join(dir, "..", "outside.py"), "secret").catch(() => {});
const S = await import("../lib/store.ts");
await writeFile(path.join(S.DATA, "runs.json"), JSON.stringify({ runs: [{ id: "r1", courseId: "free", createdAt: "", current: 1, workspaces: { 1: ws }, stages: {} }] }));
const P = await import("../lib/practice.ts");

test("판정 자료: 저장했거나 열린 파일의 지금 내용을 줄 번호로, 이미 들어간 파일 · 폴더 밖 · 없는 파일은 뺀다", async () => {
  const out = await P.filesNow("r1", ["a.py", "b.py", "a.py", "../outside.py", "none.py"], (f) => f === "b.py");
  assert.equal(out.length, 1);
  assert.match(out[0], /^\[작업 폴더의 지금 파일 a\.py — 이번 과제에서 고쳤는지는 모름\]\n {2}1\| print\('a'\)\n {2}2\| print\('b'\)$/);
});
