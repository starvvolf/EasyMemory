import fs from "node:fs/promises";
import path from "node:path";

import {
  runActivityDesign,
  runCardGeneration,
} from "../src/lib/pipeline/generate.ts";
import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  LearningActivityType,
  OrganizedMaterial,
  WholeDocumentCorePlan,
} from "../src/lib/types.ts";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const preparedPath = argument("--prepared");
const label = argument("--label") ?? "activity-smoke";
const manualTypes = argument("--manual-types")?.split(",") as
  | LearningActivityType[]
  | undefined;
if (!preparedPath) throw new Error("--prepared JSON 경로가 필요합니다.");

const artifact = JSON.parse(await fs.readFile(path.resolve(preparedPath), "utf8")) as {
  plan: WholeDocumentCorePlan;
  prepare: {
    analysis: AnalysisResult;
    organizedMaterial: OrganizedMaterial;
  };
};
const recommendedActivityDesign = await runActivityDesign(
  artifact.prepare.analysis,
  artifact.prepare.organizedMaterial,
);
const allowedTypes = new Set<LearningActivityType>([
  "flashcard",
  "true_false",
  "multiple_choice",
  "structure_recall",
]);
if (manualTypes && manualTypes.length !== recommendedActivityDesign.recommendations.length) {
  throw new Error("--manual-types 수는 확정 학습단위 수와 같아야 합니다.");
}
if (manualTypes?.some((type) => !allowedTypes.has(type))) {
  throw new Error("--manual-types에 지원하지 않는 문제 방식이 있습니다.");
}
const activityDesign: ActivityDesign = manualTypes
  ? {
      recommendations: recommendedActivityDesign.recommendations.map(
        (recommendation, index) => ({
          ...recommendation,
          recommendedType: manualTypes[index],
          reason: "사용자가 선택한 문제 방식",
        }),
      ),
    }
  : recommendedActivityDesign;
const guideline = JSON.stringify({
  wholeDocumentCore: artifact.plan,
  countPolicy: "soft_budget",
  learningUnitSoftBudget: { max: artifact.plan.maxLearningUnitCount },
});
const generation = await runCardGeneration(
  "flashcard",
  artifact.prepare.organizedMaterial,
  artifact.prepare.analysis,
  "",
  guideline,
  "",
  "",
  "",
  JSON.stringify(activityDesign),
);
const structuralIssues = generation.cards.flatMap((card) =>
  validateLearningActivity(card).map((issue) => ({ cardId: card.id, issue })),
);
const output = {
  artifactType: "study-forge-activity-smoke",
  artifactVersion: "v1",
  completedAt: new Date().toISOString(),
  source: path.resolve(preparedPath),
  recommendedActivityDesign,
  activityDesign,
  cards: generation.cards,
  observations: {
    learningUnitCount: artifact.prepare.analysis.learningUnits?.length ?? 0,
    recommendationCount: activityDesign.recommendations.length,
    generatedCount: generation.cards.length,
    activityTypeCounts: Object.fromEntries(
      ["flashcard", "true_false", "multiple_choice", "structure_recall"].map(
        (type) => [type, generation.cards.filter((card) => card.activityType === type).length],
      ),
    ),
    structuralIssues,
  },
};
const outputDirectory = path.resolve("eval/local/activity-v1");
await fs.mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `${label}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, observations: output.observations }));
