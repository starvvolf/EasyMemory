import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "flow-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9";
const GO = await import("../lib/goals.ts");

test("선행 뺌(11/12 사용자 \"선행 시스템 자체를 빼\"): 계획 · 목표에 선행 없이 정하고, 맥락 · 도구에 선행이 안 나온다", async () => {
  assert.ok(!GO.GOAL_NAMES.has("set_prereqs") && !GO.GOAL_NAMES.has("check_prereq"));
  for (const t of GO.GOAL_TOOLS) assert.doesNotMatch(JSON.stringify(t), /prereq|선행/, t.name);
  const run = "rf";
  await GO.runGoalTool(run, "propose_plan", { long: "REST API", spec: "", mode: "topdown", map: ["요청 · 응답", "HTTP 메서드"], first: { title: "요청 · 응답", done: "말한다" } }, []);
  await GO.goalAction(run, "confirm", {});
  const ctx = await GO.goalContext(run);
  assert.doesNotMatch(ctx, /선행/);
  assert.match(ctx, /현재 목표: 요청 · 응답 — 완료 조건: 말한다 · 단계: ① 이해 중/);
  await GO.goalAction(run, "next", {});
  await GO.runGoalTool(run, "set_current_goal", { title: "GET과 주소", done: "GET /weather/seoul의 뜻을 말한다" }, []);
  assert.equal((await GO.goalsOf(run)).current!.title, "GET과 주소");
});

test("도움 다이얼(11/11): AI 없이 바뀌어 맥락에 붙는다 · [깊이]는 보충을 세 번 짰을 때만", async () => {
  const run = "rh";
  await GO.runGoalTool(run, "propose_plan", { long: "React 할 일 앱", spec: "", mode: "topdown", map: ["화면 띄우기", "목록"], first: { title: "화면 띄우기", done: "브라우저에 제목이 보인다" } }, []);
  await GO.goalAction(run, "confirm", {});
  assert.match(await GO.goalContext(run), /\[도움 정도: 같이\]/);
  assert.equal(await GO.goalAction(run, "help", { help: "fast" }), null);
  assert.match(await GO.goalContext(run), /\[도움 정도: 빨리 만들기/);
  for (let i = 0; i < 3; i++) await GO.runGoalTool(run, "plan_support", { steps: [{ title: `보충 ${i}`, done: "말한다" }], why_quote: "모르겠어요" }, ["모르겠어요"]);
  assert.match(await GO.goalContext(run), /\[깊이\] 이 목표에서 보충을 여러 번 짰다/);
});

test("적용 과제(11/12): [이해했어요] 때 같은 걸 다시 돌리지 말고 변형을, 정답 · 기대 출력은 적지 말라고 넘긴다", async () => {
  const run = "ra";
  await GO.runGoalTool(run, "propose_plan", { long: "할 일 CLI", spec: "", mode: "bottomup", map: ["추가 · 보기"], first: { title: "추가 · 보기", done: "추가한 할 일이 목록에 보인다" } }, []);
  await GO.goalAction(run, "confirm", {});
  const say = String(await GO.goalAction(run, "understood", {}));
  assert.match(say, /조건을 하나 바꾼 변형/);
  assert.match(say, /정답 코드나 기대 출력을 그대로 적지 않는다/);
});

test("판정에서도 선행 뺌(11/13 사용자 \"그런 거는 당연히 다 빼는 거지\"): 판정 형식 · 지시 · 원장에 선행이 없다", async () => {
  const J = await import("../lib/judge.ts");
  assert.doesNotMatch(J.JUDGE_SYSTEM, /prereq|선행/);
  assert.doesNotMatch(JSON.stringify(J.JUDGE_SCHEMA), /prereq/);
  const GP = await import("../lib/gaps.ts");
  assert.equal((GP as Record<string, unknown>).prereqUnit, undefined);
  assert.equal((GP as Record<string, unknown>).fillPrereqs, undefined);
});

test("매번 같은 규칙은 고정 지시로(11/13): 차례 맥락에는 없고 goalRules에만, 도움 정도는 맥락에 남는다", async () => {
  const run = "rr";
  await GO.runGoalTool(run, "propose_plan", { long: "x", spec: "", mode: "bottomup", map: ["a"], first: { title: "a", done: "d" } }, []);
  await GO.goalAction(run, "confirm", {});
  const ctx = await GO.goalContext(run);
  for (const r of ["[답에 반응하기]", "[학습자가 물을 때]", "① 이해 → ② 적용 순서로 간다"]) { assert.ok(!ctx.includes(r), r); assert.ok(GO.goalRules().includes(r), r); }
  assert.match(ctx, /\[도움 정도: /);
});
