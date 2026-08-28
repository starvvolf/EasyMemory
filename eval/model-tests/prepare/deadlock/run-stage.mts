import fs from "node:fs/promises";
import path from "node:path";

import type { ApiTokenUsage } from "../../../../src/lib/api-usage.ts";
import { validateLearningActivity } from "../../../../src/lib/learning-activity.ts";
import {
  runActivityDesign,
  runCardGeneration,
} from "../../../../src/lib/pipeline/generate.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  OrganizedMaterial,
  WholeDocumentCorePlan,
} from "../../../../src/lib/types.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below gives the useful error.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const stage = argument("--stage");
const preparedPath = argument("--prepared");
const activityPath = argument("--activity");
const model = argument("--model");
const label = argument("--label");
if (stage !== "activity" && stage !== "cards") {
  throw new Error("--stage activity 또는 cards가 필요합니다.");
}
if (!preparedPath || !model || !label) {
  throw new Error("--prepared, --model, --label이 필요합니다.");
}
if (stage === "cards" && !activityPath) {
  throw new Error("cards 단계에는 --activity가 필요합니다.");
}

const prepared = JSON.parse(
  await fs.readFile(path.resolve(preparedPath), "utf8"),
) as {
  input?: { learningGoal?: string; instruction?: string };
  plan?: WholeDocumentCorePlan;
  prepare: { analysis: AnalysisResult; organizedMaterial: OrganizedMaterial };
};
const analysis = prepared.prepare.analysis;
const material = prepared.prepare.organizedMaterial;
const usage: ApiTokenUsage[] = [];
const usageContext = {
  model,
  reasoningEffort: "medium" as const,
  sourceName: "technical-deadlocks.pdf",
  experimentId: label,
  onUsage: (record: ApiTokenUsage) => {
    usage.push(record);
  },
};
const outputDirectory = path.resolve("eval/model-tests/prepare/deadlock/artifacts");
await fs.mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `${label}.json`);

if (stage === "activity") {
  const activityDesign = await runActivityDesign(analysis, material, usageContext);
  await fs.writeFile(outputPath, `${JSON.stringify({
    artifactType: "study-forge-model-stage-test",
    stage,
    completedAt: new Date().toISOString(),
    preparedPath: path.resolve(preparedPath),
    model,
    reasoningEffort: "medium",
    activityDesign,
    usage,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ outputPath, usage }));
} else {
  const activityArtifact = JSON.parse(
    await fs.readFile(path.resolve(activityPath!), "utf8"),
  ) as { activityDesign: ActivityDesign };
  const learningGoal = prepared.input?.learningGoal?.trim() ||
    prepared.plan?.learningGoal || analysis.detectedGoal;
  const instruction = prepared.input?.instruction?.trim() || "";
  const maxLearningUnitCount = prepared.plan?.maxLearningUnitCount ??
    analysis.learningUnits?.length ?? 1;
  const generation = await runCardGeneration(
    "flashcard",
    material,
    analysis,
    [
      `학습 목표:\n${learningGoal}`,
      ...(instruction ? [`추가 지시:\n${instruction}`] : []),
    ].join("\n\n"),
    JSON.stringify({
      countPolicy: "soft_budget",
      learningUnitSoftBudget: { max: maxLearningUnitCount },
    }),
    "",
    "",
    "",
    JSON.stringify(activityArtifact.activityDesign),
    {
      activitySelectionMode: "automatic",
      cards: { ...usageContext, compactInput: true },
    },
  );
  const machineIssues = generation.cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  await fs.writeFile(outputPath, `${JSON.stringify({
    artifactType: "study-forge-model-stage-test",
    stage,
    completedAt: new Date().toISOString(),
    preparedPath: path.resolve(preparedPath),
    activityPath: path.resolve(activityPath!),
    model,
    reasoningEffort: "medium",
    activityDesign: activityArtifact.activityDesign,
    cards: generation.cards,
    usage,
    checks: {
      cardCount: generation.cards.length,
      machineIssues,
    },
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    outputPath,
    usage,
    checks: { cardCount: generation.cards.length, machineIssues },
  }));
}
