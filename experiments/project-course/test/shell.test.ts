import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.PC_DATA_DIR ??= await mkdtemp(path.join(os.tmpdir(), "pc-shell-"));
const { classify, runCommandTool, decide, shellOf, shellContext } = await import("../lib/shell.ts");
const ws = await mkdtemp(path.join(os.tmpdir(), "ws-"));
await (await import("node:fs/promises")).mkdir(path.join(ws, ".git"));

test("작업 폴더 안에서 돌리거나 보기만 하는 명령은 바로", () => {
  for (const c of ["node app.js", "python main.py", "npm test", "npm run build", "git status", "git diff HEAD~1", "git log --oneline -5", "ls", "dir", "git branch", "node -e \"console.log(1)\" 2>&1", "cat a.txt | head -3", "pytest -q"]) assert.equal(classify(c, ws).kind, "auto", c);
});
test("설치 · git 기록 바꾸기 · 지우기 · 밖 · 처음 보는 명령은 묻기", () => {
  for (const c of ["npm install express", "npm i", "pip install requests", "python -m pip install x", "git commit -m x", "git push", "git reset --hard", "git checkout main", "rm -rf build", "del a.txt", "cat ../secret.txt", "type C:\\Users\\x\\a.txt", "node ~/x.js", "echo hi > a.txt", "curl https://x.y", "echo `whoami`", "frobnicate", "node a.js && git push", "git branch -D x"]) assert.equal(classify(c, ws).kind, "ask", c);
});
test("바로 돌리는 명령은 결과를 돌려준다", async () => {
  await writeFile(path.join(ws, "a.js"), "console.log('안녕')");
  const out = await runCommandTool("r1", ws, { command: "node a.js", why: "출력 보기" });
  assert.match(out, /종료 코드 0/); assert.match(out, /안녕/);
});
test("묻는 명령은 대기 → [안 함]이면 돌리지 않고 다음 맥락에 한 번 알림", async () => {
  const out = await runCommandTool("r2", ws, { command: "npm install left-pad", why: "설치" });
  assert.match(out, /먼저 묻는/);
  const p = (await shellOf("r2")).pending!; assert.equal(p.command, "npm install left-pad");
  assert.match(await runCommandTool("r2", ws, { command: "node a.js", why: "" }), /고르지 않았/);
  const d = await decide("r2", ws, p.id, false); assert.equal(d.say, null);
  assert.match(await shellContext("r2"), /거절/); assert.equal(await shellContext("r2"), "");
});
test("[실행]이면 돌리고 튜터에게 결과", async () => {
  await runCommandTool("r3", ws, { command: "node a.js > out.txt", why: "파일로" });
  const p = (await shellOf("r3")).pending!;
  const d = await decide("r3", ws, p.id, true); assert.match(d.say!, /학습자가 허락/); assert.match(d.say!, /종료 코드 0/);
  assert.equal((await decide("r3", ws, p.id, true)).say, null);
});
test("작업 폴더가 자기 저장소가 아니면 git 읽기도 묻기", async () => {
  const bare = await mkdtemp(path.join(os.tmpdir(), "ws2-"));
  assert.equal(classify("git status", bare).kind, "ask");
  assert.equal(classify("node a.js", bare).kind, "auto");
});
