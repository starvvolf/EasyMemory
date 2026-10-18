import fs from "node:fs/promises";
import path from "node:path";

import {
  createCompactActivityDesignInput,
  createCompactCardGenerationInput,
  finalLearningContent,
  learningUnitSuccessCriterion,
  learningUnitTarget,
  serializedByteLength,
} from "../src/lib/pipeline/compact-input.ts";
import { selectLearningUnitsForCards } from "../src/lib/pipeline/generate.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  OrganizedMaterial,
} from "../src/lib/types.ts";

const cases = [
  ["opic", 2],
  ["deadlocks", 1],
  ["bill-of-rights", 1],
  ["moon-phases", 1],
  ["disaster-checklist", 1],
  ["calculus-problems", 2],
] as const;

const rows = [];
for (const [caseId, selectionAttempt] of cases) {
  const preparedPath = path.resolve(
    "eval/local/plan-prepare-v1",
    `quality-v1-${caseId}-selection-a${selectionAttempt}.json`,
  );
  const activityPath = path.resolve(
    "eval/local/generation-quality-v1",
    `quality-v1-${caseId}-activity-a1.json`,
  );
  const prepared = JSON.parse(await fs.readFile(preparedPath, "utf8")) as {
    prepare: { analysis: AnalysisResult; organizedMaterial: OrganizedMaterial };
  };
  const activity = JSON.parse(await fs.readFile(activityPath, "utf8")) as {
    activityDesign: ActivityDesign;
  };
  const units = selectLearningUnitsForCards(
    prepared.prepare.analysis,
    prepared.prepare.organizedMaterial,
  );
  const currentActivityInput = units;
  const compactActivityInput = createCompactActivityDesignInput(
    prepared.prepare.analysis,
    units,
  );
  const currentCardInput = {
    analysis: prepared.prepare.analysis,
    learningUnits: units,
    organizedMaterial: prepared.prepare.organizedMaterial,
    activityDesign: activity.activityDesign,
  };
  const compactCardInput = createCompactCardGenerationInput(
    prepared.prepare.analysis,
    units,
    activity.activityDesign,
  );
  const activityBefore = serializedByteLength(currentActivityInput);
  const activityAfter = serializedByteLength(compactActivityInput);
  const cardsBefore = serializedByteLength(currentCardInput);
  const cardsAfter = serializedByteLength(compactCardInput);
  rows.push({
    caseId,
    learningUnitCount: units.length,
    activity: {
      beforeBytes: activityBefore,
      afterBytes: activityAfter,
      reductionPercent: Math.round((1 - activityAfter / activityBefore) * 1000) / 10,
    },
    cards: {
      beforeBytes: cardsBefore,
      afterBytes: cardsAfter,
      reductionPercent: Math.round((1 - cardsAfter / cardsBefore) * 1000) / 10,
    },
  });
}

async function latestOutlineOcrComparison() {
  const directory = path.resolve("eval/local/outline-one-question-v1");
  let filename: string | undefined;
  try {
    filename = (await fs.readdir(directory))
      .filter((item) => item.endsWith("-opic.json"))
      .sort()
      .at(-1);
  } catch {
    return null;
  }
  if (!filename) return null;

  const artifact = JSON.parse(
    await fs.readFile(path.join(directory, filename), "utf8"),
  ) as {
    analysis: AnalysisResult;
    generationDesign: ActivityDesign;
  };
  const units = artifact.analysis.learningUnits ?? [];
  const legacyActivityInput = {
    learningGoal: artifact.analysis.detectedGoal,
    units: units.map((unit) => ({
      learningUnitId: unit.id,
      target: learningUnitTarget(unit),
      operation: unit.operation ?? null,
      successCriterion: learningUnitSuccessCriterion(unit),
      finalContent: finalLearningContent(unit),
    })),
  };
  const legacyCardInput = {
    learningGoal: artifact.analysis.detectedGoal,
    sourceType: artifact.analysis.sourceType,
    units: units.flatMap((unit) => {
      const recommendation = artifact.generationDesign.recommendations.find(
        (item) => item.learningUnitId === unit.id,
      );
      if (!recommendation?.includeInGeneration || !recommendation.recommendedType) {
        return [];
      }
      return [{
        learningUnitId: unit.id,
        finalContent: finalLearningContent(unit),
        activityType: recommendation.recommendedType,
        recommendationReason: recommendation.reason,
        sourceId: unit.sourceId,
        sourcePage: unit.sourcePage,
        sourceRange: unit.sourceRange,
      }];
    }),
  };
  const compactActivityInput = createCompactActivityDesignInput(
    artifact.analysis,
    units,
  );
  const compactCardInput = createCompactCardGenerationInput(
    artifact.analysis,
    units,
    artifact.generationDesign,
  );
  const comparison = (before: unknown, after: unknown) => {
    const beforeBytes = serializedByteLength(before);
    const afterBytes = serializedByteLength(after);
    return {
      beforeBytes,
      afterBytes,
      reductionPercent: Math.round((1 - afterBytes / beforeBytes) * 1000) / 10,
    };
  };
  return {
    artifactPath: path.join(directory, filename),
    learningUnitCount: units.length,
    sharedSourcePageCount: compactActivityInput.sourcePages.length,
    activity: comparison(legacyActivityInput, compactActivityInput),
    cards: comparison(legacyCardInput, compactCardInput),
  };
}

console.log(JSON.stringify({
  networkCallsMade: 0,
  rows,
  outlineOcr: await latestOutlineOcrComparison(),
}, null, 2));
