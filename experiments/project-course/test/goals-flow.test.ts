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
