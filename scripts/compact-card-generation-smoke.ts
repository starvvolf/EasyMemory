import fs from "node:fs/promises";
import path from "node:path";

import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
} from "../src/lib/model-config.ts";
import { runCardGeneration } from "../src/lib/pipeline/generate.ts";
import type {
  ActivityDesign,
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

const baselinePaths = process.argv.slice(2);
if (baselinePaths.length === 0) {
  throw new Error("비교할 기존 activity 결과 파일이 필요합니다.");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/compact-card-generation-v1");
await fs.mkdir(outputDirectory, { recursive: true });

for (const baselinePathValue of baselinePaths) {
  const baselinePath = path.resolve(baselinePathValue);
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as {
    source?: { preparedPath?: string };
    problemAdvice?: string;
    input?: { learningGoal: string; advice: string; maxUnits: number };
    analysis?: AnalysisResult;
    material?: OrganizedMaterial;
    activityDesign: ActivityDesign;
    cards: unknown[];
    usage: ApiTokenUsage[];
  };
  const prepared = baseline.source?.preparedPath ? JSON.parse(
    await fs.readFile(path.resolve(baseline.source.preparedPath), "utf8"),
  ) as {
    input: { learningGoal: string };
    plan: WholeDocumentCorePlan;
    prepare: {
      analysis: AnalysisResult;
      organizedMaterial: OrganizedMaterial;
    };
  } : null;
  const learningGoal = prepared?.input.learningGoal ?? baseline.input?.learningGoal ?? "";
  const problemAdvice = baseline.problemAdvice ?? baseline.input?.advice ?? "";
  const analysis = prepared?.prepare.analysis ?? baseline.analysis;
  const material = prepared?.prepare.organizedMaterial ?? baseline.material;
  const maxUnits = prepared?.plan.maxLearningUnitCount ?? baseline.input?.maxUnits;
  if (!analysis || !material || !maxUnits) {
    throw new Error(`기준 결과의 생성 입력을 복원할 수 없습니다: ${baselinePath}`);
  }
  const usage: ApiTokenUsage[] = [];
  const result = await runCardGeneration(
    "flashcard",
    material,
    analysis,
    [
      `학습 목표:\n${learningGoal}`,
      `문제 만들기 방향:\n${problemAdvice}`,
    ].join("\n\n"),
    JSON.stringify({
      countPolicy: "soft_budget",
      learningUnitSoftBudget: { max: maxUnits },
    }),
    "",
    "",
    "",
    JSON.stringify(baseline.activityDesign),
    {
      activitySelectionMode: "automatic",
      cards: {
        model: DEFAULT_MODEL,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        compactInput: true,
        sourceName: path.basename(baselinePath),
        experimentId: `compact-card-${stamp}`,
        onUsage: (record) => {
          usage.push(record);
        },
      },
    },
  );
  const machineIssues = result.cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  const outputPath = path.join(
    outputDirectory,
    `${path.basename(baselinePath, ".json")}-${stamp}.json`,
  );
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-compact-card-generation-smoke",
      completedAt: new Date().toISOString(),
      baselinePath,
      baselineCardCount: baseline.cards.length,
      cards: result.cards,
      usage,
      machineIssues,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({ outputPath, cardCount: result.cards.length, usage, machineIssues }));
}
