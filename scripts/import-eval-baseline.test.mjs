import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveObservations,
  formatRunTimestamp,
} from "./import-eval-baseline.mjs";

test("capturedAt을 run ID용 UTC timestamp로 변환한다", () => {
  assert.equal(
    formatRunTimestamp("2026-08-10T15:21:36.696Z"),
    "20260810T152136Z",
  );
  assert.equal(formatRunTimestamp("invalid"), null);
});

test("final cards에서 LearningUnit별 coverage를 기계적으로 계산한다", () => {
  const observations = deriveObservations(
    {
      stages: {
        prepare: {
          analysis: {
            learningUnits: [{ id: "LU-01" }, { id: "LU-02" }, { id: "LU-03" }],
          },
        },
        cards: [{ learningUnitId: "LU-01" }, { learningUnitId: "LU-02" }],
        critic: [{ learningUnitId: "LU-01" }, { learningUnitId: "LU-02" }],
        finalCards: [
          { learningUnitId: "LU-01" },
          { learningUnitId: "LU-02" },
          { learningUnitId: "LU-02" },
        ],
      },
      observations: {
        generatedCardCount: 2,
      },
    },
    "test-run",
  );

  assert.deepEqual(observations.counts, {
    learningUnits: 3,
    generatedCards: 2,
    criticCards: 2,
    finalCards: 3,
  });
  assert.deepEqual(observations.learningUnitCardCoverage, {
    "LU-01": 1,
    "LU-02": 2,
    "LU-03": 0,
  });
  assert.deepEqual(observations.zeroCardLearningUnitIds, ["LU-03"]);
  assert.deepEqual(observations.multipleCardLearningUnitIds, ["LU-02"]);
});
