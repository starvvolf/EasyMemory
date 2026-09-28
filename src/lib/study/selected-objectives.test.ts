import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectLearningDesignObjectives } from "../../../tools/study-forge-mcp/chatgpt-parity.ts";
import type { LearningDesignPlan } from "../types.ts";

test("문제 설계에는 선택한 목표와 연결된 내용만 전달하고 원본 설계는 그대로 둔다", async () => {
  const raw = await readFile(new URL("./fixtures/learning-design-request.json", import.meta.url), "utf8");
  const record = JSON.parse(raw) as { request: { stages: Array<{ stage: string; output: { learningDesign?: LearningDesignPlan } }> } };
  const base = record.request.stages.find((stage) => stage.stage === "learning-design")?.output.learningDesign;
  if (!base) throw new Error("학습 설계 기록이 없습니다.");
  assert.ok(base.objectives.length > 1);
  const selectedId = base.objectives[1].id;
  const selected = selectLearningDesignObjectives({ ...base, assessmentBlueprints: [] }, [selectedId]);
  assert.deepEqual(selected.objectives.map((item) => item.id), [selectedId]);
  assert.ok(selected.knowledgeUnits.length > 0);
  assert.ok(selected.knowledgeUnits.every((unit) => unit.objectiveId === selectedId));
  assert.equal(base.objectives.length, record.request.stages.find((stage) => stage.stage === "learning-design")?.output.learningDesign?.objectives.length);
  assert.throws(() => selectLearningDesignObjectives({ ...base, assessmentBlueprints: [] }, ["missing-objective"]), /학습목표 ID/);
});
