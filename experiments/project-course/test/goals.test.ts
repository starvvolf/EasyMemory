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

test("보충 로드맵(11/7~8): 설문 뒤 짜고 원래 로드맵은 보관, 보충도 이해 → 적용(판정 맞음), 끝나면 막혔던 단계로 돌아가고 거기서 나아가면 닫힌다", async () => {
  const r = "run2";
  const ok = { verdict: { verdict: "correct", right: "r", gap: "" } }, bad = { verdict: { verdict: "partial", right: "키로 꺼냄", gap: "없는 키" } };
  await G.runGoalTool(r, "propose_plan", { long: "캐시", spec: "", mode: "topdown", map: ["딕셔너리", "캐시 함수", "정리"], first: { title: "딕셔너리", done: "값 꺼내기" } }, []);
  await G.goalAction(r, "confirm", {});
  await G.goalAction(r, "understood", {}); // ② 적용 중에 막힘
  await assert.rejects(G.runGoalTool(r, "plan_support", { steps: [{ title: "괄호", done: "x" }], why_quote: "지어낸 말" }, ["cache(1)?"]), /글자 그대로/);
  const say = await G.goalAction(r, "hard", { reasons: [G.STUCK_REASONS[1]], text: "키가 뭐예요" });
  assert.match(say!, /plan_support로 보충 로드맵/); assert.match(say!, /개념 · 용어를 몰라요 · 덧붙임: 키가 뭐예요/);
  await G.runGoalTool(r, "plan_support", { steps: [{ title: "키와 값", done: "키로 값을 찾는다" }, { title: "[]로 꺼내기", done: "d[k]를 쓴다" }], why_quote: "" }, []);
  let g = await G.goalsOf(r);
  assert.deepEqual(g.support!.steps.map((x) => [x.title, x.status]), [["키와 값", "doing"], ["[]로 꺼내기", "todo"]]);
  assert.equal(g.support!.target.title, "딕셔너리"); assert.equal(g.map.length, 3);
  const ctx = await G.goalContext(r);
  assert.match(ctx, /원래 로드맵\(보충 중이라 잠시 보관\)/); assert.match(ctx, /지금 보충: 키와 값 — 완료 조건: 키로 값을 찾는다 · 단계: ① 이해 중/);
  assert.doesNotMatch(ctx, /\[답에 반응하기\]/); assert.match(G.goalRules(), /답에서 버튼을 누르라고 안내하지 않는다/); assert.match(G.goalRules(), /\[답에 반응하기\]/);
  await assert.rejects(G.runGoalTool(r, "set_current_goal", { title: "x", done: "y" }, []), /보충 로드맵을 진행 중/);
  // 보충도 ① 이해 → ② 적용
  assert.match((await G.goalAction(r, "understood", {}))!, /보충 "키와 값"을\(를\) 이해했어요.*적용 단계/s);
  assert.match((await G.goalAction(r, "applied", bad))!, /판정: 일부만 맞음.*아직 적용 단계/s); // 일부만 → 그대로
  assert.equal((await G.goalsOf(r)).support!.steps[0].status, "doing");
  assert.match((await G.goalAction(r, "applied", ok))!, /다음 보충 "\[\]로 꺼내기"/);
  // 보충 중 또 어려움 → 끝낸 보충은 두고 남은 것만 다시, 종착지 그대로
  assert.match((await G.goalAction(r, "hard", {}))!, /보충 "\[\]로 꺼내기"도 어려워요.*종착지 "딕셔너리"는 그대로/s);
  await G.runGoalTool(r, "plan_support", { steps: [{ title: "대괄호 모양", done: "a" }, { title: "[]로 꺼내기", done: "b" }], why_quote: "" }, []);
  g = await G.goalsOf(r);
  assert.deepEqual(g.support!.steps.map((x) => x.status), ["done", "doing", "todo"]); assert.equal(g.support!.round, 2);
  assert.match((await G.goalAction(r, "easy_next", {}))!, /이미 알아요.*다음 보충/s); // 쉬우면 그 보충만 넘김
  await G.goalAction(r, "understood", {});
  assert.match((await G.goalAction(r, "applied", ok))!, /보충을 다 했어요.*"딕셔너리".*② 적용 단계부터/s); // 막혔던 단계(적용)로
  g = await G.goalsOf(r);
  assert.equal(g.support!.back, true); assert.equal(g.current!.understood, true); // 단계 표시는 그대로
  // 막혔던 단계에서 나아가면(적용 맞음) 보충 닫힘
  assert.match((await G.goalAction(r, "applied", ok))!, /원래 로드맵으로 돌아왔어요/);
  g = await G.goalsOf(r);
  assert.equal(g.support, null); assert.equal(g.current!.applied, true);
  await G.runGoalTool(r, "plan_support", { steps: [{ title: "키", done: "x" }], why_quote: "키가 뭔지 모르겠어" }, ["음 키가 뭔지 모르겠어요"]);
  assert.ok((await G.goalsOf(r)).support);
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
  await G.runGoalTool(r, "plan_support", { steps: [{ title: "스택이 뭔지", done: "z" }], why_quote: "" }, []);
  assert.equal((await G.goalsOf(r)).support!.steps.length, 1);
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

test("해 봤어요(11/8): 판정이 맞음일 때만 적용 ✓, 틀리면 머물고 힌트, 근거 부족이면 보여 달라고", async () => {
  const r = "run10";
  await G.runGoalTool(r, "propose_plan", { long: "x", spec: "", mode: "bottomup", map: [], first: { title: "a", done: "b" } }, []);
  await G.goalAction(r, "confirm", {}); await G.goalAction(r, "understood", {});
  assert.match((await G.goalAction(r, "applied", { verdict: { verdict: "incorrect", right: "", gap: "반환을 안 함" } }))!, /판정: 틀림 · 빠지거나 틀린 부분: 반환을 안 함.*'맞아요'로 시작하지 말고/s);
  assert.equal((await G.goalsOf(r)).current!.applied, false);
  assert.match((await G.goalAction(r, "applied", { verdict: { verdict: "unclear", right: "", gap: "" } }))!, /근거가 부족/);
  assert.match((await G.goalAction(r, "applied", { verdict: { verdict: "correct", right: "반환함", gap: "" } }))!, /판정: 맞음 · 맞은 부분: 반환함/);
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

test("너무 쉬워요 → 다음으로(11/6~7): 본 단계는 끝남으로 넘어가고, 보충 중이면 그 보충만 넘어간다", async () => {
  const r = "run12";
  await G.runGoalTool(r, "propose_plan", { long: "비동기", spec: "", mode: "topdown", map: ["코루틴", "async 예제", "여러 작업"], first: { title: "코루틴 순서", done: "b" } }, []);
  await G.goalAction(r, "confirm", {});
  await G.goalAction(r, "hard", { reasons: [] });
  await G.runGoalTool(r, "plan_support", { steps: [{ title: "함수 호출과 반환", done: "d" }, { title: "이벤트 루프", done: "e" }], why_quote: "" }, []);
  assert.match((await G.goalAction(r, "easy_next", {}))!, /다음 보충 "이벤트 루프"/); // 보충 하나만 넘어감
  let g = await G.goalsOf(r);
  assert.equal(g.map[0].status, "doing"); assert.equal(g.support!.steps[0].status, "done");
  await G.goalAction(r, "next", {}); // 다음으로 → 보충은 닫힘
  g = await G.goalsOf(r);
  assert.equal(g.support, null);
  await G.runGoalTool(r, "set_current_goal", { title: "async 예제 실행", done: "c" }, []);
  const say = await G.goalAction(r, "easy_next", {});
  assert.match(say!, /이미 알아요.*다음 단계는 "여러 작업"/s);
  assert.equal((await G.goalsOf(r)).map[1].status, "done");
});
