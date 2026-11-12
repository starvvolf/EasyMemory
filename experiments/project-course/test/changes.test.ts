import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "chg-"));
process.env.PC_FAKE_AI = "1";
const C = await import("../lib/changes.ts");
const GR = await import("../lib/goal-record.ts");

test("바뀐 코드(11/12): 처음 · 바뀐 때만 붙고, 저장 안 한 열린 파일은 그렇게 표시하고, 저장 확인 차례의 파일은 본 것으로만 친다", async () => {
  const r = "run1";
  assert.equal(await C.changesForTurn(r), "", "저장본이 없으면 아무것도 안 붙음");
  await GR.logSave(r, "Server/Program.cs", "int health = 100;\nhealth -= 10;");
  const a = await C.changesForTurn(r);
  assert.match(a, /\[지난번 뒤 바뀐 코드 — Server\/Program\.cs, 저장됨\]/);
  assert.match(a, /  2\| health -= 10;/);
  assert.equal(await C.changesForTurn(r), "", "이미 본 것은 다시 안 붙음");
  // 저장 안 한 열린 파일
  const open = { file: "Server/Program.cs", dirty: true, text: "int health = 100;\nlock (healthLock) { health -= 10; }" };
  const b = await C.changesForTurn(r, open);
  assert.match(b, /저장 안 함\(실행하면 아직 예전 코드로 돌아요\)/);
  assert.match(b, /lock \(healthLock\)/);
  // 저장 확인 차례: 그 파일은 안 붙이고 본 것으로
  await GR.logSave(r, "Client/Program.cs", "connect();");
  assert.equal(await C.changesForTurn(r, open, "Client/Program.cs"), "");
  assert.equal((await C.seenOf(r))["Client/Program.cs"], "connect();");
});

test("큰 파일은 바뀐 줄만", () => {
  const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const changed = big.replace("line 120", "line 120 // 고침");
  const r = C.changeNote([{ file: "A.cs", text: changed, saved: true }], { "A.cs": big }, GR.lineDiff);
  assert.match(r.text, /바뀐 줄\(\+ 더함, - 뺌\)\n\+ line 120 \/\/ 고침\n- line 120/);
  assert.equal(r.seen["A.cs"], changed);
});
