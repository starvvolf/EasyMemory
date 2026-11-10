import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 가짜 VSCodium 웹 서버판: bin/codium-server가 받은 인자를 적고, --port에 /version으로 답하는 작은 서버를 켠다(--install-extension이면 바로 끝)
const tmp = mkdtempSync(path.join(os.tmpdir(), "edweb-"));
const pkg = path.join(tmp, "pkg"); mkdirSync(path.join(pkg, "bin"), { recursive: true });
writeFileSync(path.join(pkg, "fake.mjs"), `import { createServer } from "node:http"; import { appendFileSync } from "node:fs";
const a = process.argv.slice(2); appendFileSync(${JSON.stringify(path.join(tmp, "args.log"))}, JSON.stringify({ a, emb: process.env.RECALLER_EMBEDDED }) + "\\n");
if (a.includes("--install-extension")) process.exit(0);
const port = Number(a[a.indexOf("--port") + 1]); createServer((q, r) => r.end(q.url)).listen(port, "127.0.0.1");`);
writeFileSync(path.join(pkg, "bin", "codium-server"), `#!/bin/sh\nexec node "$(dirname "$0")/../fake.mjs" "$@"\n`); chmodSync(path.join(pkg, "bin", "codium-server"), 0o755);
const tgz = path.join(tmp, "a.tar.gz"); execFileSync("tar", ["-czf", tgz, "-C", pkg, "."]);
const body = readFileSync(tgz); let sum = createHash("sha256").update(body).digest("hex");
const srv = createServer((q, r) => { if (q.url!.endsWith(".sha256")) return r.end(`${sum}  a.tar.gz\n`); r.setHeader("content-length", body.length); r.end(q.method === "HEAD" ? undefined : body); });
await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
const port = (srv.address() as { port: number }).port;
process.env.PC_DATA_DIR = path.join(tmp, "data");
process.env.PC_EDITOR_WEB_HOME = path.join(tmp, "home");
process.env.PC_EDITOR_WEB_URL = `http://127.0.0.1:${port}/a.tar.gz`;
process.env.PC_EDITOR_WEB_PORT = String(40000 + Math.floor(Math.random() * 20000));
const E = await import("../lib/editor-web.ts");
const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await f()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error("시간 초과"); };

test("앱 안 편집기(11/11): 주소 · 명령 줄 · 인자", () => {
  assert.equal(E.folderParam("C:\\Users\\a\\RecallerPractice\\chat-1"), "/C:/Users/a/RecallerPractice/chat-1");
  assert.equal(E.folderParam("/home/a/x"), "/home/a/x");
  assert.equal(E.cmdLine("C:\\R\\bin\\codium-server.cmd", ["--port", "4103", "--server-data-dir", "C:\\a b\\d"]), '""C:\\R\\bin\\codium-server.cmd" --port 4103 --server-data-dir "C:\\a b\\d""');
  const a = E.serverArgs("/t/token");
  assert.deepEqual(a.slice(0, 6), ["--host", "127.0.0.1", "--port", String(E.PORT), "--connection-token-file", "/t/token"]);
  assert.ok(!a.includes("--without-connection-token"));
  assert.match(E.assetName(), /^vscodium-reh-web-(linux|win32|darwin)-(x64|arm64)-[\d.]+\.tar\.gz$/);
});

test("앱 안 편집기(11/11): 받기 전 크기 → 받기 · 해시 확인 · 풀기 · 확장 → 켜기(토큰 · 전용 설정 · 앱 안 표시)", async () => {
  let st = await E.status();
  assert.equal(st.installed, false); assert.equal(st.size, body.length);
  E.install();
  await until(async () => (await E.status()).job?.phase === "끝");
  st = await E.status(); assert.equal(st.installed, true);
  const url = await E.urlFor("/home/a/practice");
  const u = new URL(url);
  assert.equal(u.hostname, "127.0.0.1"); assert.match(u.searchParams.get("tkn")!, /^[0-9a-f]{48}$/); assert.equal(u.searchParams.get("folder"), "/home/a/practice");
  const log = readFileSync(path.join(tmp, "args.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(log.some((x) => x.a.includes("ms-python.python")));
  const serve = log.find((x) => x.a.includes("--connection-token-file"))!;
  assert.equal(serve.emb, "1");
  const tok = readFileSync(serve.a[serve.a.indexOf("--connection-token-file") + 1], "utf8");
  assert.equal(tok, u.searchParams.get("tkn"));
  const settings = JSON.parse(readFileSync(path.join(process.env.PC_DATA_DIR!, "editor-web", "data", "Machine", "settings.json"), "utf8"));
  assert.equal(settings["recaller.openTutorBeside"], false);
  assert.equal((await E.status()).running, true);
  E.stop();
});

test("앱 안 편집기(11/11): 해시가 다르면 받은 파일을 버리고 실패", async () => {
  process.env.PC_EDITOR_WEB_HOME = path.join(tmp, "home2");
  sum = "0".repeat(64);
  const E2 = await import("../lib/editor-web.ts?again");
  E2.install();
  await until(async () => ["끝", "실패"].includes((await E2.status()).job?.phase ?? ""));
  const st = await E2.status();
  assert.equal(st.job!.phase, "실패"); assert.match(st.job!.error!, /해시/);
  assert.equal(existsSync(path.join(tmp, "home2", `${E2.assetName()}.part`)), false);
  srv.close();
});
