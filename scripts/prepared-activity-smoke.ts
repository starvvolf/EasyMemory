import fs from "node:fs/promises";
import path from "node:path";

import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
} from "../src/lib/model-config.ts";
import {
  runActivityDesign,
  runCardGeneration,
} from "../src/lib/pipeline/generate.ts";
import type {
  AnalysisResult,
  OrganizedMaterial,
  WholeDocumentCorePlan,
} from "../src/lib/types.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit check below gives the useful error.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const preparedPaths = process.argv.slice(2);
if (preparedPaths.length === 0) throw new Error("Prepare 결과 파일이 필요합니다.");

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/current-app-prepared-smoke");
await fs.mkdir(outputDirectory, { recursive: true });

for (const preparedPathValue of preparedPaths) {
  const preparedPath = path.resolve(preparedPathValue);
  const artifact = JSON.parse(await fs.readFile(preparedPath, "utf8")) as {
    source?: { fileName?: string; name?: string };
    input: {
      learningGoal?: string;
      instruction?: string;
      advice?: string;
      maxUnits?: number;
    };
    plan?: WholeDocumentCorePlan;
    prepare?: {
      analysis: AnalysisResult;
      organizedMaterial: OrganizedMaterial;
    };
    analysis?: AnalysisResult;
    material?: OrganizedMaterial;
  };
  const preparedAnalysis = artifact.prepare?.analysis ?? artifact.analysis;
  const preparedMaterial = artifact.prepare?.organizedMaterial ?? artifact.material;
  if (!preparedAnalysis || !preparedMaterial) {
    throw new Error(`Prepare 결과를 읽을 수 없습니다: ${preparedPath}`);
  }
  const learningGoal = artifact.input.learningGoal?.trim() ||
    artifact.plan?.learningGoal ||
    preparedAnalysis.detectedGoal;
  const instruction = artifact.input.instruction?.trim() ||
    artifact.input.advice?.trim() ||
    "";
  const maxLearningUnitCount = artifact.plan?.maxLearningUnitCount ??
    artifact.input.maxUnits ??
    preparedAnalysis.learningUnits?.length ??
    1;
  const usage: ApiTokenUsage[] = [];
  const sourceName = artifact.source?.fileName ??
    artifact.source?.name ??
    path.basename(preparedPath);
  const experimentId = `${path.basename(preparedPath, ".json")}-${stamp}`;
  const usageContext = {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    sourceName,
    experimentId,
    onUsage: (record: ApiTokenUsage) => {
      usage.push(record);
    },
  };
  const activityDesign = await runActivityDesign(
    preparedAnalysis,
    preparedMaterial,
    { ...usageContext, instruction },
  );
  const generation = await runCardGeneration(
    "flashcard",
    preparedMaterial,
    preparedAnalysis,
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
    JSON.stringify(activityDesign),
    {
      activitySelectionMode: "automatic",
      cards: { ...usageContext, compactInput: true },
    },
  );
  const machineIssues = generation.cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  const outputPath = path.join(outputDirectory, `${experimentId}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-current-app-prepared-smoke",
      completedAt: new Date().toISOString(),
      preparedPath,
      learningGoal,
      instruction,
      analysis: preparedAnalysis,
      material: preparedMaterial,
      activityDesign,
      cards: generation.cards,
      usage,
      checks: {
        learningUnitCount: preparedAnalysis.learningUnits?.length ?? 0,
        recommendationCount: activityDesign.recommendations.length,
        cardCount: generation.cards.length,
        machineIssues,
      },
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({ outputPath, usage, checks: {
    learningUnitCount: preparedAnalysis.learningUnits?.length ?? 0,
    recommendationCount: activityDesign.recommendations.length,
    cardCount: generation.cards.length,
    machineIssues,
  } }));
}
