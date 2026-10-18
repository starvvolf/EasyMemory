import assert from "node:assert/strict";
import test from "node:test";
import type { LearningOutline, LearningUnit } from "../src/lib/types.ts";
import {
  createPdfMaskActivities,
  selectPdfMaskActivities,
} from "../src/lib/pdf-mask-activity.ts";

function unit(id: string): LearningUnit {
  return {
    id,
    sourceId: "source.pdf",
    sourcePage: 3,
    sourceRange: "3쪽",
    sourceText: "원문 근거",
    knowledgeType: "concept",
    fixedPart: "",
    variableSlots: [],
    generalizedForm: "",
    rationale: "",
  };
}

test("AI 중요도가 가림 활동에 보존되고 제외 덩어리는 만들지 않는다", () => {
  const outline: LearningOutline = {
    title: "목차",
    summary: "",
    nodes: [
      { id: "core", parentId: null, order: 1, title: "핵심", summary: "", sourceRefs: [], sourceEvidence: "근거", selectedByDefault: true, importance: 3 },
      { id: "skip", parentId: null, order: 2, title: "제외", summary: "", sourceRefs: [], sourceEvidence: "근거", selectedByDefault: false, importance: 0 },
    ],
  };
  const activities = createPdfMaskActivities([unit("core"), unit("skip")], outline);
  assert.deepEqual(activities.map(({ learningUnitId, importance }) => ({ learningUnitId, importance })), [
    { learningUnitId: "core", importance: 3 },
  ]);
});

test("오늘 복습은 예정 시간이 지난 가림만 고른다", () => {
  const [activity] = createPdfMaskActivities([unit("core")]);
  const future = { ...activity, reviewSchedule: {
    algorithm: "fsrs" as const,
    dueAt: "2030-01-02T00:00:00.000Z",
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    learningSteps: 0,
    repetitions: 1,
    lapses: 0,
    state: "review" as const,
  } };
  assert.equal(selectPdfMaskActivities([future], true, new Date("2030-01-01T00:00:00.000Z")).length, 0);
  assert.equal(selectPdfMaskActivities([future], true, new Date("2030-01-03T00:00:00.000Z")).length, 1);
});
