import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "base-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9";
const GO = await import("../lib/goals.ts");
const L = await import("../lib/learner-note.ts");

test("현재 목표의 선행(11/11): 비면 맥락이 set_prereqs를 시키고, 학습자가 알아요 · 몰라요로 표시 · 지움, 표시는 다음 목표의 같은 덩어리로 이어진다", async () => {
  const run = "rp";
  await GO.runGoalTool(run, "propose_plan", { long: "REST API 요청 · 응답 이해", spec: "", mode: "topdown", map: ["요청 · 응답", "HTTP 메서드", "작은 API"],
    first: { title: "요청 · 응답 이해하기", done: "주소를 치면 무슨 일이 일어나는지 말한다", prereqs: [] } }, []);
  await GO.goalAction(run, "confirm", {});
  assert.match(await GO.goalContext(run), /\[선행 비어 있음\]/);
  await GO.runGoalTool(run, "set_prereqs", { prereqs: [{ name: "클라이언트와 서버", check: "?" }, { name: "Python 기본", check: "?" }] }, []);
  assert.doesNotMatch(await GO.goalContext(run), /\[선행 비어 있음\]/);
  await GO.setPrereqSelf(run, "Python 기본", "됨");
  const r = await GO.setPrereqSelf(run, "클라이언트와 서버", "비어 있음");
  assert.equal(r.prereqs[0].result, "비어 있음"); assert.equal(r.prereqs[0].by, "학습자");
  assert.match(await GO.goalContext(run), /클라이언트와 서버\(몰라요·스스로 표시\)/);
  await GO.setPrereqSelf(run, "클라이언트와 서버", null);
  let g = await GO.goalsOf(run);
  assert.equal(g.current!.prereqs![0].result, undefined);
  await assert.rejects(GO.setPrereqSelf(run, "없는 것", "됨"), /찾지 못했어요/);
  // 다음 목표: 같은 덩어리(띄어쓰기 · 대소문자 무시)는 표시가 이어진다
  await GO.goalAction(run, "next", {});
  await GO.runGoalTool(run, "set_current_goal", { title: "GET 보내기", done: "응답을 출력", prereqs: [{ name: "python  기본", check: "?" }, { name: "JSON", check: "?" }] }, []);
  g = await GO.goalsOf(run);
  assert.deepEqual(g.current!.prereqs!.map((p) => [p.name, p.result ?? null, p.by ?? null]), [["python  기본", "됨", "학습자"], ["JSON", null, null]]);
});

test("[다음으로] 뒤(11/11 실제로 꼬인 것): 선행 적기가 끼어도 새 목표를 정할 수 있고, 기다리는 중엔 set_prereqs를 막고 [선행 비어 있음]도 안 띄운다", async () => {
  const run = "rn";
  await GO.runGoalTool(run, "propose_plan", { long: "REST API", spec: "", mode: "topdown", map: ["요청 · 응답", "HTTP 메서드"], first: { title: "요청 · 응답", done: "말한다", prereqs: [] } }, []);
  await GO.goalAction(run, "confirm", {});
  await GO.goalAction(run, "next", {});
  assert.doesNotMatch(await GO.goalContext(run), /\[선행 비어 있음\]/);
  await assert.rejects(GO.runGoalTool(run, "set_prereqs", { prereqs: [{ name: "a", check: "?" }, { name: "b", check: "?" }] }, []), /set_current_goal/);
  // 예전 기록처럼 선행 적기가 끼어 있어도
  const g0 = await GO.goalsOf(run); g0.log.push({ at: new Date().toISOString(), kind: "prereqs", text: "a, b" } as never);
  await (await import("../lib/store.ts")).writeAtomic(path.join(process.env.PC_DATA_DIR!, "goals", `${run}.json`), JSON.stringify(g0));
  await GO.runGoalTool(run, "set_current_goal", { title: "GET과 주소", done: "GET /weather/seoul의 뜻을 말한다", prereqs: [{ name: "URL", check: "?" }, { name: "요청과 응답", check: "?" }] }, []);
  const g = await GO.goalsOf(run);
  assert.equal(g.current!.title, "GET과 주소");
  assert.equal(g.current!.prereqs!.length, 2);
});

test("도움 다이얼 · 받아 쓴 것(11/11): 다이얼은 AI 없이 바뀌어 맥락에 붙고, 선행 덩어리에서 받아 쓴 이름이 3개 쌓이면 정리를 한 번만 제안", async () => {
  const run = "rh";
  await GO.runGoalTool(run, "propose_plan", { long: "React 할 일 앱", spec: "", mode: "topdown", map: ["화면 띄우기", "목록"],
    first: { title: "화면 띄우기", done: "브라우저에 제목이 보인다", prereqs: [{ name: "JavaScript 기본", check: "함수와 배열을 써 봤나요?" }, { name: "Node와 npm", check: "npm install을 해 봤나요?" }] } }, []);
  await GO.goalAction(run, "confirm", {});
  assert.match(await GO.goalContext(run), /\[도움 정도: 같이\]/);
  assert.match(await GO.goalContext(run), /\[선행 — 미리 묻지 않는다\]/);
  const r = await GO.goalAction(run, "help", { help: "fast" });
  assert.equal(r, null); // 튜터를 부르지 않는다
  assert.match(await GO.goalContext(run), /\[도움 정도: 빨리 만들기/);
  await GO.runGoalTool(run, "new_names", { names: [{ name: "const", what: "값에 이름 붙이기", example: "const a = 1", from: "JavaScript 기본" }, { name: "=>", what: "짧은 함수", example: "(x) => x + 1", from: "javascript  기본" }] }, []);
  assert.doesNotMatch(await GO.goalContext(run), /\[자꾸 걸림\]/);
  await GO.runGoalTool(run, "new_names", { names: [{ name: "map", what: "배열을 바꿔 새 배열로", example: "xs.map(f)", from: "JavaScript 기본" }, { name: "useState", what: "화면이 기억할 값", example: "useState(0)" }] }, []);
  const g = await GO.goalsOf(run);
  assert.deepEqual(g.current!.prereqs![0].debts, ["const", "=>", "map"]);
  assert.match(await GO.goalContext(run), /\[자꾸 걸림\] "JavaScript 기본"에서 받아 쓴 것이 3개/);
  assert.doesNotMatch(await GO.goalContext(run), /\[자꾸 걸림\]/); // 한 번만
  assert.deepEqual(GO.prereqBrief(await GO.goalsOf(run))[0].debts, ["const", "=>", "map"]);
});

test("[깊이](11/11 점검): 스스로 몰라요로 표시한 덩어리는 '목표를 낮추자'를 부르지 않고, 막혀서 드러난 것만 센다", async () => {
  const run = "rd";
  await GO.runGoalTool(run, "propose_plan", { long: "React 앱", spec: "", mode: "topdown", map: ["화면", "목록"],
    first: { title: "화면 띄우기", done: "제목이 보인다", prereqs: [{ name: "JavaScript 기본", check: "?" }, { name: "HTML/CSS", check: "?" }, { name: "Node와 npm", check: "?" }] } }, []);
  await GO.goalAction(run, "confirm", {});
  await GO.setPrereqSelf(run, "JavaScript 기본", "비어 있음"); await GO.setPrereqSelf(run, "HTML/CSS", "비어 있음");
  assert.doesNotMatch(await GO.goalContext(run), /\[깊이\]/);
  await GO.runGoalTool(run, "check_prereq", { name: "Node와 npm", result: "비어 있음", quote: "npm이 뭔지 몰라요" }, ["npm이 뭔지 몰라요"]);
  await GO.runGoalTool(run, "check_prereq", { name: "JavaScript 기본", result: "비어 있음", quote: "map이 뭐예요" }, ["map이 뭐예요"]);
  assert.match(await GO.goalContext(run), /\[깊이\]/);
});
