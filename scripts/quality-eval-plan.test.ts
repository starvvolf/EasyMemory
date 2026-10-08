import assert from "node:assert/strict";
import test from "node:test";

import {
  assertQualityEvalBudget,
  createQualityEvalExecutionPlan,
} from "./quality-eval-plan.ts";

test("Prepare부터 실행하면 Analyze와 Plan을 고정하고 호출하지 않는다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["opic", "calculus-problems"],
    fromStage: "prepare",
    phase: "selection",
    attempts: 1,
  });

  assert.equal(plan.solCalls, 2);
  assert.equal(plan.terraCalls, 0);
  assert.equal(plan.calls.some((call) => call.stage === "analyze"), false);
  assert.equal(plan.calls.some((call) => call.stage === "plan"), false);
  assert.deepEqual(plan.calls[0].frozenStages, ["analyze", "plan"]);
});

test("문제 생성부터 실행하면 앞의 모든 단계를 고정한다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["deadlocks"],
    fromStage: "cards",
    phase: "activity",
    attempts: 2,
  });

  assert.equal(plan.solCalls, 0);
  assert.equal(plan.terraCalls, 2);
  assert.deepEqual(plan.calls[0].frozenStages, [
    "analyze",
    "plan",
    "prepare",
    "activity-design",
  ]);
});

test("추천까지만 실행하면 카드 호출을 예산에 넣지 않는다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["calculus-problems"],
    fromStage: "activity-design",
    toStage: "activity-design",
    phase: "activity",
    attempts: 1,
  });

  assert.equal(plan.terraCalls, 1);
  assert.deepEqual(plan.calls.map((call) => call.stage), ["activity-design"]);
});

test("호출 수와 예상 비용 한도를 첫 호출 전에 검사한다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["opic", "calculus-problems"],
    fromStage: "prepare",
    attempts: 2,
    estimatedCostPerCallUsd: { sol: 0.1, terra: 0.02 },
  });

  assert.throws(
    () => assertQualityEvalBudget(plan, { maxSolCalls: 3 }),
    /Sol 호출 4회/,
  );
  assert.throws(
    () => assertQualityEvalBudget(plan, { maxEstimatedCostUsd: 0.5 }),
    /예상 비용/,
  );
});

test("단가가 없으면 비용 한도를 추측으로 통과시키지 않는다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["opic"],
    fromStage: "cards",
    attempts: 1,
  });
  assert.throws(
    () => assertQualityEvalBudget(plan, { maxEstimatedCostUsd: 1 }),
    /예상 단가가 없어/,
  );
});

test("구형 artifact에 없는 고정 단계 입력을 실행계획에 명시한다", () => {
  const plan = createQualityEvalExecutionPlan({
    caseIds: ["opic"],
    fromStage: "prepare",
    attempts: 1,
    missingFrozenInputs: [{ caseId: "opic", stages: ["analyze"] }],
  });
  assert.deepEqual(plan.missingFrozenInputs, [
    { caseId: "opic", stages: ["analyze"] },
  ]);
});
