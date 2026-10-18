import assert from "node:assert/strict";
import test from "node:test";
import { packetFromCompletedRequest } from "./request-packet.ts";
import type { ExperimentRequest } from "../../src/lib/mcp-experiment-requests.ts";

const request = {
  status: "completed", runId: "chatgpt-request-test", sourceSnapshot: { id: "src_a", fileName: "lesson.pdf", pageCount: 4, sha256: "a" },
  input: { stopAfterStage: "cards", purpose: "시험", scope: { pageNumbers: [2, 3], outlineLeafIds: [] }, selectedObjectiveIds: ["o2"] },
  stages: [
    { stage: "learning-design", output: { learningDesign: {
      objectives: [
        { id: "o1", target: "정의", successCriteria: [{ description: "설명" }] },
        { id: "o2", target: "절차", successCriteria: [{ description: "순서 복원" }] },
      ],
      knowledgeUnits: [
        { id: "u1", objectiveId: "o1", sourceId: "lesson.pdf", sourcePage: 2, sourceRange: "정의", sourceText: "A", content: "A", outlineNodeIds: [], conceptNodeIds: [] },
        { id: "u2", objectiveId: "o2", sourceId: "lesson.pdf", sourcePage: 3, sourceRange: "절차", sourceText: "B", content: "B", outlineNodeIds: [], conceptNodeIds: [] },
      ],
    } } },
    { stage: "cards", actual: { inputSha256: "b".repeat(64) } },
  ],
} as ExperimentRequest;

test("다시 만들기 패킷에는 고른 학습목표만 담는다", () => {
  const packet = packetFromCompletedRequest(request, "c".repeat(64));
  assert.deepEqual(packet.items.map((item) => item.objectiveId), ["o2"]);
  assert.equal(packet.items[0]?.sourceRange, "PDF 3쪽 / 절차");
  assert.equal(packet.origin.runId, request.runId);
});

test("선택하지 않은 목표 또는 완료되지 않은 요청은 출제 패킷으로 만들지 않는다", () => {
  assert.throws(() => packetFromCompletedRequest({ ...request, input: { ...request.input, selectedObjectiveIds: ["missing"] } }, "c".repeat(64)), /선택한 목표/);
  assert.throws(() => packetFromCompletedRequest({ ...request, status: "running" }, "c".repeat(64)), /5단계/);
});
