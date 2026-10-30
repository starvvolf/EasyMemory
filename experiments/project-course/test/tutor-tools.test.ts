// 튜터 도구: 코드 조각 실행 · 공식 문서 · 생각 한 줄
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PC_DATA_DIR = await mkdtemp(path.join(tmpdir(), "pc-tools-"));
const { printLast, runSnippet, lookDocs, htmlText, looksNode } = await import("../lib/tutor-tools.ts");
const { thinkLine } = await import("../lib/oc-engine.ts");

test("마지막 줄이 값이면 찍는다", () => {
  assert.equal(printLast("String(5) + 1"), "console.log(String(5) + 1);");
  assert.equal(printLast("const a = 1;\na + 1"), "const a = 1;\nconsole.log(a + 1);");
  assert.equal(printLast("const a = 1; a + 1"), "const a = 1;\nconsole.log(a + 1);");
  assert.equal(printLast("console.log(1)\n2"), "console.log(1)\n2");
  assert.equal(printLast("const x = 3"), "const x = 3");
});

test("코드 조각: 결과·파일 막힘·시간 초과", async () => {
  assert.equal((await runSnippet("[1,2].map((x: number) => x * 2)")).output, "[ 2, 4 ]");
  const fs = await runSnippet('import { readFileSync } from "node:fs"; readFileSync("/etc/passwd", "utf8")');
  assert.equal(fs.ok, false); assert.match(fs.output, /restricted|ERR_ACCESS_DENIED/);
  const loop = await runSnippet("while (true) {}", 1500);
  assert.equal(loop.timedOut, true);
});

test("공식 문서만", async () => {
  await assert.rejects(lookDocs({ url: "https://example.com/a" }), /공식 문서/);
  assert.equal(htmlText("<p>a &lt;b&gt;</p><dl><dt>X</dt><dd>y</dd></dl>"), "a <b>\nX\ny");
  assert.ok(looksNode("fs.readFile")); assert.ok(looksNode("scryptSync")); assert.ok(!looksNode("JSON.parse"));
});

test("생각 한 줄: 마지막 굵은 제목, 없으면 마지막 문장", () => {
  assert.equal(thinkLine("**Reading the file** I will look. **Checking the router** next."), "Checking the router");
  assert.equal(thinkLine("I need to see the server. Then the router."), "Then the router.");
});
