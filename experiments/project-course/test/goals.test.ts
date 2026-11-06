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

test("목표 단계(11/5): ① 이해 → [이해했어요] 적용 과제 → [해 봤어요] 확인 → 다음으로는 마침", async () => {
  const r = "run4";
  await G.runGoalTool(r, "propose_plan", { long: "스택", spec: "", mode: "bottomup", map: [], first: { title: "push · pop", done: "append와 pop으로 넣고 꺼낸다" } }, []);
  await G.goalAction(r, "confirm", {});
  assert.match(await G.goalContext(r), /단계: ① 이해 중/);
  assert.match((await G.goalAction(r, "understood", {}))!, /적용 단계.*작은 과제/);
  assert.match(await G.goalContext(r), /단계: ② 적용 중/);
  assert.equal(await G.goalAction(r, "understood", {}), null); // 두 번 눌러도 다시 부르지 않음
  assert.match((await G.goalAction(r, "applied", {}))!, /확인/);
  assert.match(await G.goalContext(r), /적용까지 끝/);
  await G.goalAction(r, "next", {});
  assert.match((await G.goalsOf(r)).log.at(-1)!.text, /마침/);
});

test("지도는 늘 있다(11/6): 바텀업으로 해 온 목표가 지도에 남고, 탑다운으로 바꿔도 1단계부터 다시 돌지 않는다", async () => {
  const r = "run9";
  await G.runGoalTool(r, "propose_plan", { long: "캐시", spec: "", mode: "bottomup", map: [], first: { title: "반복 계산 보기", done: "x" } }, []);
  await G.goalAction(r, "confirm", {});
  assert.deepEqual((await G.goalsOf(r)).map.map((m) => [m.title, m.status]), [["반복 계산 보기", "doing"]]);
  await G.goalAction(r, "understood", {}); await G.goalAction(r, "applied", {});
  await G.goalAction(r, "next", {});
  await G.runGoalTool(r, "set_current_goal", { title: "딕셔너리에 저장", done: "y" }, []);
  assert.deepEqual((await G.goalsOf(r)).map.map((m) => [m.title, m.status]), [["반복 계산 보기", "done"], ["딕셔너리에 저장", "doing"]]);
  // 탑다운으로 바꾸면: 지나온 단계는 두고 남은 단계만 정하라고 한다
  assert.match((await G.goalAction(r, "mode", { mode: "topdown" }))!, /지나온 단계는 그대로/);
  // 모델이 처음부터 다 보내도 이미 지난 단계와 같은 제목은 빠진다
  await G.runGoalTool(r, "update_map", { titles: ["반복 계산 보기", "딕셔너리에 저장", "오래된 캐시", "정리"] }, []);
  assert.deepEqual((await G.goalsOf(r)).map.map((m) => m.status), ["done", "doing", "todo", "todo"]);
  assert.match((await G.goalAction(r, "next", {}))!, /다음 단계는 "오래된 캐시"/);
  const g = await G.goalsOf(r);
  assert.equal(g.map[1].status, "skipped");
  assert.match(await G.goalContext(r), /3\.· 오래된 캐시/);
  // 학습 종료: 하던 목표를 닫고 튜터는 안 부른다
  await G.runGoalTool(r, "set_current_goal", { title: "오래된 캐시 보기", done: "z" }, []);
  assert.equal(await G.goalAction(r, "end", {}), null);
  const e = await G.goalsOf(r);
  assert.equal(e.current, null); assert.equal(e.map[2].status, "skipped");
});

test("해 봤어요(11/6): 저장한 코드가 없으면 튜터를 안 부르고 적용 ✓만", async () => {
  const r = "run10";
  await G.runGoalTool(r, "propose_plan", { long: "x", spec: "", mode: "bottomup", map: [], first: { title: "a", done: "b" } }, []);
  await G.goalAction(r, "confirm", {}); await G.goalAction(r, "understood", {});
  assert.equal(await G.goalAction(r, "applied", { codeSaved: false }), null);
  assert.equal((await G.goalsOf(r)).current!.applied, true);
});

test("너무 쉬워요(11/6): 다시 정한 목표가 지도에 반영되고, 남은 단계도 고치라고 한다", async () => {
  const r = "run11";
  await G.runGoalTool(r, "propose_plan", { long: "비동기", spec: "", mode: "bottomup", map: ["동기와 비동기 순서", "async 예제", "여러 작업 기다리기"], first: { title: "동기와 비동기 순서", done: "b" } }, []);
  await G.goalAction(r, "confirm", {});
  assert.match((await G.goalAction(r, "easy", {}))!, /남은 단계도 .* update_map/);
  await G.runGoalTool(r, "set_current_goal", { title: "코루틴의 실행과 대기 순서", done: "c" }, []);
  const g = await G.goalsOf(r);
  assert.deepEqual(g.map.map((m) => [m.title, m.status]), [["코루틴의 실행과 대기 순서", "doing"], ["async 예제", "todo"], ["여러 작업 기다리기", "todo"]]);
  assert.equal(g.current!.mapId, g.map[0].id);
});

test("보충 단계는 지도에 끼워지고(11/6), 너무 쉬워요 → 다음으로는 끝남으로 넘어간다", async () => {
  const r = "run12";
  await G.runGoalTool(r, "propose_plan", { long: "비동기", spec: "", mode: "topdown", map: ["코루틴", "async 예제", "여러 작업"], first: { title: "코루틴 순서", done: "b" } }, []);
  await G.goalAction(r, "confirm", {});
  await G.goalAction(r, "hard", { reasons: [] });
  await G.runGoalTool(r, "open_support", { title: "함수 호출과 반환", done: "d", why_quote: "" }, []);
  let g = await G.goalsOf(r);
  assert.deepEqual(g.map.map((m) => [m.title, m.status, !!m.support]), [["함수 호출과 반환", "doing", true], ["코루틴", "doing", false], ["async 예제", "todo", false], ["여러 작업", "todo", false]]);
  assert.match(await G.goalContext(r), /1\.▶ \(보충\) 함수 호출과 반환/);
  await G.goalAction(r, "understood", {}); // 보충 이해 → 돌아감
  g = await G.goalsOf(r);
  assert.equal(g.map[0].status, "done"); assert.equal(g.stack.length, 0);
  const say = await G.goalAction(r, "easy_next", {});
  assert.match(say!, /이미 알아요.*다음 단계는 "async 예제"/);
  assert.equal((await G.goalsOf(r)).map[1].status, "done");
});
