// [막혔어요] 칸(11/3): 열고 · 이름 붙이고 · 내려가고 · 반복·깊이 막고 · 풀리면 위로, 기초 기록은 언어와 함께
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = await mkdtemp(path.join(tmpdir(), "pc-stuck-"));
process.env.PC_STUCK_MAX = "4";
const { openRoot, nameGap, goDeeper, countReply, resolveTop, leaveAll, stuckView, stuckOf, openStack } = await import("../lib/stuck.ts");
const { basicsStore, basicsLine, langOf, basicsFor, findBasic, promotable } = await import("../lib/basics.ts");

test("언어: stack 글에서 고르고, 언어별 칸만 보인다", () => {
  assert.equal(langOf({ stack: "Node.js · TypeScript · VS Code" }), "ts");
  assert.equal(langOf({ stack: "Java 21 · Spring Boot" }), "java");
  assert.equal(langOf({ stack: "C++20 · CMake" }), "cpp");
  assert.equal(langOf({ language: "python" }), "python");
  assert.equal(langOf({ stack: "JavaScript" }), "js");
  const ids = (l: Parameters<typeof basicsFor>[0]) => basicsFor(l).map((b) => b.id);
  assert.ok(ids("ts").includes("js:arrow") && !ids("ts").includes("cpp:pointer"));
  assert.ok(ids("cpp").includes("cpp:pointer") && !ids("cpp").includes("js:arrow"));
  assert.ok(ids("java").includes("fn-as-value") && ids("cpp").includes("fn-as-value"), "공통 칸은 모든 언어에");
  assert.equal(findBasic("java", "js:arrow"), null, "다른 언어 칸은 못 고른다");
});

test("REST 예제처럼: 처음 줄 → 짚은 칸이 아래로 열림 → 더 아래 → 풀리며 올라옴 → 처음 줄은 돌아온 뒤에만 닫힘", async () => {
  const run = "r1";
  const root = await openRoot(run, { choice: "lost", quote: { file: "server.js", from: 7, to: 7, code: 'app.get("/todos", (req, res) => { res.json(todos); });' } });
  assert.equal(root.depth, 0);
  // 처음 줄은 이름이 바뀌지 않고 아래 칸이 열린다
  assert.equal((await nameGap(run, "js", { concept: "fn-as-value" })).ok, true);
  const down = await goDeeper(run, "js", { concept: "js:arrow", why: "(req, res) => { } 모양을 모름" });
  assert.equal(down.ok, true);
  assert.deepEqual((await stuckView(run))!.path.map((p) => p.label), ["server.js 7줄", "함수를 값처럼 넘기기(콜백 — 나중에 남이 부름)", "화살표 함수 (=>)"]);
  assert.equal((await goDeeper(run, "js", { concept: "fn-as-value", why: "x" })).ok, false, "돌고 돌지 않게");
  assert.equal((await resolveTop(run, "js", "tutor", "곱하기 함수를 직접 씀")).ok, false, "답하기 전에는 못 닫음");
  await countReply(run);
  assert.equal((await resolveTop(run, "js", "tutor", "const 곱하기 = (a, b) => { return a * b; } 를 직접 씀")).ok, true);
  await countReply(run);
  assert.equal((await resolveTop(run, "js", "tutor", "함수는 맡겨 두면 요청이 올 때 Express가 부른다고 답함")).ok, true);
  // 처음 줄: 아래 칸이 풀려 돌아왔으니 학습자가 읽으면 닫힌다
  await countReply(run);
  const r = await resolveTop(run, "js", "tutor", "'/todos를 달라고 하면 목록을 답장으로 보내는 함수를 맡겨 둔다'로 읽음");
  assert.equal(r.ok, true); assert.equal(r.parent, undefined);
  assert.equal(await stuckView(run), null);
  const b = await basicsStore();
  assert.equal(b.concepts["js:arrow"].resolved, 1);
  assert.equal(b.concepts["fn-as-value"].resolved, 1);
  assert.match(await basicsLine("ts"), /화살표 함수/);
});

test("처음 줄은 아래 칸 없이 튜터가 닫지 못한다(이름 짐작 하나로 닫히던 것, 11/3 재현)", async () => {
  const run = "r1b";
  await openRoot(run, { choice: "lost", quote: { file: "src/server.ts", from: 8, to: 8, code: "const server = createServer(async (req, res) => {" } });
  await countReply(run);
  assert.equal((await resolveTop(run, "ts", "tutor", "createUser는 유저를 만든다고 답함")).ok, false);
  await leaveAll(run);
});

test("다른 언어로 가면: 공통 칸은 '다른 언어에서 풀림'으로, 그 언어 칸은 따로", async () => {
  const line = await basicsLine("java");
  assert.match(line, /함수를 값처럼 넘기기.*풀림\(js에서/);
  assert.doesNotMatch(line, /화살표 함수/, "JS 칸은 Java 맥락에 안 나온다");
});

test("깊이는 말도 안 되는 수준만 막는다 · 그만두면 닫힘(풀림 아님) · 기타는 쌓여서 목록 후보", async () => {
  const run = "r2";
  await openRoot(run, { choice: "word", word: "@GetMapping" });
  await nameGap(run, "java", { other: "Spring 어노테이션" });
  for (const c of ["class", "object", "member"]) assert.equal((await goDeeper(run, "java", { concept: c, why: "아래가 빔" })).ok, true);
  assert.equal(openStack(await stuckOf(run)).length, 4);
  assert.equal((await goDeeper(run, "java", { concept: "variable", why: "더" })).ok, false, "PC_STUCK_MAX=4");
  assert.equal(await leaveAll(run), 4);
  assert.equal(await stuckView(run), null);
  for (const r of ["r3", "r4"]) { await openRoot(r, { choice: "shape" }); await nameGap(r, "java", { other: "spring  어노테이션" }); }
  assert.equal((await promotable())[0]?.count, 3);
});

test("학습자 [이제 알겠어요]는 답 없이도 닫힌다(자기 보고로 남음)", async () => {
  const run = "r5";
  await openRoot(run, { choice: "when" });
  const r = await resolveTop(run, "cpp", "learner", "학습자가 [이제 알겠어요]를 누름");
  assert.equal(r.ok, true); assert.equal(r.frame?.by, "learner");
});
