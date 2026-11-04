import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "goals-"));
const G = await import("../lib/goals.ts");

test("목표: 설문 → 계획 → 확정 → 이해·적용 → 다음으로 → 다음 목표", async () => {
  const r = "run1";
  assert.match(await G.goalContext(r), /아직 장기 목표 없음/);
  await G.runGoalTool(r, "ask_questions", { intro: "좁혀 볼게요", questions: [{ q: "어디서 돌려요?", options: ["브라우저", "터미널"], multi: false }, { q: "한 개뿐", options: ["x"] }] }, []);
  assert.equal((await G.goalsOf(r)).survey!.questions.length, 1); // 고를 것이 1개인 질문은 버림
  const say = await G.goalAction(r, "answer", { answers: [{ picks: ["브라우저"], text: "캔버스로" }] });
  assert.match(say!, /브라우저 \(덧붙임: 캔버스로\)/);
  await assert.rejects(G.runGoalTool(r, "propose_plan", { long: "점프 게임", spec: "", mode: "topdown", map: ["화면"], first: { title: "a", done: "b" } }, []), /2개 이상/);
  await G.runGoalTool(r, "propose_plan", { long: "점프 게임", spec: "브라우저 캔버스", mode: "topdown", map: ["화면", "점프", "장애물"], first: { title: "캔버스 띄우기", done: "하늘색 화면이 보인다" } }, []);
  await G.goalAction(r, "confirm", {});
  let g = await G.goalsOf(r);
  assert.equal(g.long!.text, "점프 게임"); assert.equal(g.map[0].status, "doing"); assert.equal(g.current!.title, "캔버스 띄우기");
  // 확정 직후에는 첫 목표를 다듬을 수 있고, 그 뒤에는 학습자 [다음으로] 전까지 못 바꾼다
  await G.runGoalTool(r, "set_current_goal", { title: "캔버스 띄우기(800x400)", done: "하늘색 화면" }, []);
  await G.goalAction(r, "understood", {});
  await assert.rejects(G.runGoalTool(r, "set_current_goal", { title: "딴 거", done: "x" }, []), /진행 중/);
  const next = await G.goalAction(r, "next", {});
  g = await G.goalsOf(r);
  assert.equal(g.map[0].status, "skipped"); // 적용 안 함 → 건너뜀으로 정직하게
  assert.match(next!, /다음 단계는 "점프"/);
  await G.runGoalTool(r, "set_current_goal", { title: "스페이스바로 점프", done: "누르면 뜨고 착지" }, []);
  g = await G.goalsOf(r);
  assert.equal(g.map[1].status, "doing");
  assert.match(await G.goalContext(r), /지도: 1\.↷ 화면 · 2\.▶ 점프 · 3\.· 장애물/);
});

test("보충: [막혔어요] 이유 뒤에만(또는 학습자 말 그대로) 열리고, 이해하면 돌아온다", async () => {
  const r = "run2";
  await G.runGoalTool(r, "propose_plan", { long: "캐시", spec: "", mode: "bottomup", map: [], first: { title: "딕셔너리", done: "값 꺼내기" } }, []);
  await G.goalAction(r, "confirm", {});
  await assert.rejects(G.runGoalTool(r, "open_support", { title: "괄호", done: "x", why_quote: "지어낸 말" }, ["cache(1)?"]), /글자 그대로/);
  const say = await G.goalAction(r, "stuck", { reasons: ["처음 보는 모양이 있어요"], text: "" });
  assert.match(say!, /open_support/);
  await G.runGoalTool(r, "open_support", { title: "[]와 ()의 차이", done: "둘을 구분한다", why_quote: "" }, []);
  let g = await G.goalsOf(r);
  assert.equal(g.stack.length, 1); assert.equal(g.stack[0].from, "딕셔너리"); assert.equal(g.stuck, null);
  assert.match(await G.goalContext(r), /보충 중\(1겹\): \[\]와 \(\)의 차이/);
  assert.equal(await G.goalAction(r, "understood", {}), null); // 보충 이해 → AI 안 부르고 돌아옴
  g = await G.goalsOf(r);
  assert.equal(g.stack.length, 0); assert.equal(g.current!.understood, false);
  // 학습자 말 그대로면 [막혔어요] 없이도
  await G.runGoalTool(r, "open_support", { title: "키", done: "x", why_quote: "키가 뭔지 모르겠어" }, ["음 키가 뭔지 모르겠어요"]);
  assert.equal((await G.goalsOf(r)).stack.length, 1);
});

test("너무 쉬워요 · 너무 어려워요(11/5): 쉬우면 수준 올리기(현재 목표 다듬기 허용), 어려우면 이유 없이도 보충", async () => {
  const r = "run3";
  await G.runGoalTool(r, "propose_plan", { long: "스택", spec: "", mode: "bottomup", map: [], first: { title: "리스트 인덱스", done: "x" } }, []);
  await G.goalAction(r, "confirm", {});
  await G.runGoalTool(r, "set_current_goal", { title: "리스트 인덱스", done: "x" }, []); // 확정 직후 다듬기
  await G.goalAction(r, "understood", {});
  await assert.rejects(G.runGoalTool(r, "set_current_goal", { title: "괄호 검사", done: "y" }, []), /진행 중/);
  assert.match((await G.goalAction(r, "easy", {}))!, /너무 쉬워요/);
  await G.runGoalTool(r, "set_current_goal", { title: "괄호 검사", done: "y" }, []); // 쉬움 뒤에는 올려도 됨
  assert.equal((await G.goalsOf(r)).current!.title, "괄호 검사");
  const say = await G.goalAction(r, "hard", {});
  assert.match(say!, /너무 어려워요\(어디가 어려운지는 모르겠어요\)/);
  await G.runGoalTool(r, "open_support", { title: "스택이 뭔지", done: "z", why_quote: "" }, []);
  assert.equal((await G.goalsOf(r)).stack.length, 1);
  assert.match(await G.goalContext(r), /너무 쉬움 1번 · 너무 어려움 1번/);
});
