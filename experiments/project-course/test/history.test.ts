import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "hist-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9";
const H = await import("../lib/history.ts");
const GO = await import("../lib/goals.ts");

test("학습 기록(11/11): 덧붙이기 · 찾기(이름 부분 일치 · 종류 · 글) · 최신 순", async () => {
  await H.add({ run: "r1", goal: "Node 실행", kind: "확인", name: "터미널에서 폴더 이동", result: "됨", quote: "cd practice" });
  await H.add({ run: "r1", goal: "Node 실행", kind: "봤음", name: "console.log" });
  await H.add({ run: "r1", goal: "Node 실행", kind: "틀림", name: "Node 실행", result: "print를 씀", quote: "print('안녕')" });
  await H.add({ run: "r1", goal: "Node 실행", kind: "씀", name: "console.log", result: "본 뒤에" });
  assert.deepEqual((await H.search({ name: "Console.Log" })).map((e) => e.kind), ["씀", "봤음"]);
  assert.deepEqual((await H.search({ kind: "틀림" })).map((e) => e.result), ["print를 씀"]);
  assert.equal((await H.search({ text: "print" })).length, 1);
  assert.match(await H.historyTool({ name: "console" }), /씀 · console\.log → 본 뒤에/);
  assert.match(await H.historyTool({ name: "없는것" }), /찾은 기록이 없어요/);
});

test("새 이름 펼침(11/11): 혼자 씀 · 다시 확인 맞음 · 이번에 친 명령이면 접고, 본 적만 있으면 펼치고, 없으면 설문", async () => {
  const E = await H.localEntries();
  assert.equal(H.shouldOpen("console.log", E, "", false), true);           // 본 뒤에 씀 · 봤음 → 펼침
  assert.equal(H.shouldOpen("cd", E, "cd hello\nnode -v", true), false);    // 이번 실습에서 직접 친 명령 → 접힘
  assert.equal(H.shouldOpen("터미널에서 폴더 이동", E, "", true), false);   // 확인 됨 → 접힘
  assert.equal(H.shouldOpen("npm init", E, "", true), true);               // 기록 없음 · 처음 → 펼침
  assert.equal(H.shouldOpen("npm init", E, "", false), false);             // 기록 없음 · 써 봄 → 접힘
  await H.add({ run: "r2", goal: "x", kind: "씀", name: "npm init", result: "혼자" });
  assert.equal(H.shouldOpen("npm init", await H.localEntries(), "", true), false);
});

test("새 이름 칸(11/11): new_names → 화면에 이름마다 펼침 여부, 펼쳐 보면 봤음(AI 없음)", async () => {
  const run = "rn";
  await GO.runGoalTool(run, "propose_plan", { long: "풀스택 세팅", spec: "", mode: "bottomup", map: ["Node 실행"], first: { title: "Node로 파일 실행", done: "node hello.js로 글이 찍힘", prereqs: [] }, base: [] }, []);
  await GO.goalAction(run, "answer", { answers: [] }).catch(() => null);
  await GO.goalAction(run, "confirm", {});
  await GO.runGoalTool(run, "new_names", { names: [{ name: "console.log", what: "화면에 글 찍기", example: "console.log(\"…\")" }, { name: "node 파일이름", what: "파일 실행", example: "node a.js" }] }, []);
  let v = await GO.goalsView(run);
  const open = Object.fromEntries(v.current!.names!.map((n) => [n.name, (n as { open?: boolean }).open]));
  assert.equal(open["console.log"], true); // 기록: 봤음만(앞 시험) → 펼침
  await GO.goalAction(run, "names_seen", { names: ["console.log"] });
  v = await GO.goalsView(run);
  assert.equal(v.current!.names!.find((n) => n.name === "console.log")!.seen, true);
  assert.ok((await H.search({ name: "console.log", kind: "봤음" })).some((e) => e.run === run));
  assert.match(await GO.goalContext(run), /search_history로 찾아본다/);
});
