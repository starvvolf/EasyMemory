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
  for (const c of ["node app.js", "python main.py", "npm test", "npm run build", "git status", "git diff HEAD~1", "git log --oneline -5", "ls", "dir", "git branch", "node -e \"console.log(1)\" 2>&1", "cat a.txt | head -3", "pytest -q", "node -e \"const a = 1; console.log(a > 0 ? 'ok' : 'no')\"", "node -e \"[1,2].map((x) => x * 2)\""]) assert.equal(classify(c, ws).kind, "auto", c);
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
  const d = await decide("r2", ws, p.id, false); assert.match(d.say!, /거절/, "거절도 튜터에게 바로 알린다");
  assert.equal(await shellContext("r2"), "", "바로 알렸으니 다음 맥락에 또 붙이지 않는다");
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
test("학습자가 터미널에서 친 명령은 다음 맥락에 한 번", async () => {
  const { learnerRan, learnerRunsSince } = await import("../lib/shell.ts");
  const t0 = new Date(Date.now() - 1000).toISOString();
  await learnerRan("r4", { command: "python count.py", exitCode: 1, cwd: "", output: "KeyError: 'a'" });
  const c = await shellContext("r4"); assert.match(c, /직접 친 명령/); assert.match(c, /KeyError/);
  assert.equal(await shellContext("r4"), "");
  assert.equal((await learnerRunsSince("r4", t0)).length, 1);
});
test("npm 설치는 작업 폴더에 package.json을 먼저 만든다", async () => {
  const w = await mkdtemp(path.join(os.tmpdir(), "ws3-"));
  await runCommandTool("r5", w, { command: "npm install --offline --no-audit definitely-not-a-real-pkg-xyz", why: "" });
  const p = (await shellOf("r5")).pending!;
  const d = await decide("r5", w, p.id, true);
  assert.match(d.say!, /빈 package.json/);
  assert.ok((await import("node:fs")).existsSync(path.join(w, "package.json")));
});
test("뒤에서 켜 두는 명령은 처음 출력만 돌려주고 끌 수 있다", async () => {
  const { execBackground, stopBackground } = await import("../lib/shell.ts");
  await writeFile(path.join(ws, "srv.js"), "console.log('켜짐'); setInterval(() => {}, 1000);");
  const r = await execBackground("r6", "node srv.js", ws, 1500);
  assert.equal(r.running, true); assert.match(r.out, /켜짐/);
  assert.equal(stopBackground("r6"), 1);
});

test("Windows 경로 오탐(11/12): / 로 시작하는 주소 조각 · 따옴표 섞인 옵션은 폴더 밖이 아니다. 드라이브 · UNC · \\폴더는 그대로 묻는다", () => {
  const was = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const w = "C:\\work\\pay";
    for (const c of ['curl.exe -s -X POST "http://localhost:8080/orders/1/pay"', 'Invoke-WebRequest -Uri http://localhost:8080 /orders\\")', 'java -XshowSettings:properties -version /c:"java.home"']) assert.doesNotMatch(classify(c, w).reason ?? "", /작업 폴더 밖/, c);
    for (const c of ["type D:\\secret.txt", "type \\\\server\\share\\a.txt", "type \\Windows\\win.ini"]) assert.match(classify(c, w).reason ?? "", /작업 폴더 밖/, c);
  } finally { Object.defineProperty(process, "platform", was); }
});
