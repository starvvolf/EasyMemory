import assert from "node:assert/strict";
import test from "node:test";
import { inspectAbilityCoverage } from "./ability-coverage.ts";
import type { AssessmentBlueprint } from "../../src/lib/types.ts";

const blueprint = (id: string, kind: AssessmentBlueprint["expectedResponse"]["kind"], task: string) => ({
  id, given: [{ type: "instruction", description: task }], expectedResponse: { kind, description: task },
}) as AssessmentBlueprint;
const procedure = [{ knowledgeType: "procedure", content: "세 단계 절차" }] as KnowledgeUnit[];

test("선택한 계산·절차 능력이 실제 문제 설계에 빠지면 경고한다", () => {
  const result = inspectAbilityCoverage(["계산·적용하기", "식·절차 쓰기"], [blueprint("b1", "short_text", "정의 설명")], [{ blueprintId: "b1", includeInGeneration: true }], procedure);
  assert.equal(result.length, 2);
});

test("생성에서 제외한 설계는 능력 충족으로 세지 않는다", () => {
  const result = inspectAbilityCoverage(["식·절차 쓰기"], [blueprint("b1", "ordered_structure", "단계")], [{ blueprintId: "b1", includeInGeneration: false }], procedure);
  assert.equal(result.length, 1);
});

test("계산과 순서 복원이 포함되면 경고하지 않는다", () => {
  const result = inspectAbilityCoverage(["계산·적용하기", "식·절차 쓰기"], [blueprint("b1", "numeric", "값을 구하라"), blueprint("b2", "ordered_structure", "단계를 배열")], [
    { blueprintId: "b1", includeInGeneration: true }, { blueprintId: "b2", includeInGeneration: true },
  ], procedure);
  assert.deepEqual(result, []);
});

test("식만 있는 자료에는 순서형을 억지로 요구하지 않는다", () => {
  const result = inspectAbilityCoverage(["식·절차 쓰기"], [blueprint("b1", "short_text", "공식을 쓰기")], [{ blueprintId: "b1", includeInGeneration: true }], [{ knowledgeType: "formula", content: "공식" } as KnowledgeUnit]);
  assert.deepEqual(result, []);
});
