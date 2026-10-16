import fs from "node:fs/promises";
import path from "node:path";

import type { ApiTokenUsage } from "../../../../src/lib/api-usage.ts";
import { validateLearningActivity } from "../../../../src/lib/learning-activity.ts";
import { runCardGeneration } from "../../../../src/lib/pipeline/generate.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  OrganizedMaterial,
} from "../../../../src/lib/types.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit check below gives the useful error.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const baselinePath = path.resolve(
  "eval/local/current-app-prepared-smoke/dfs-bfs-evidence-only-attempt-1-2026-08-16T184959962Z.json",
);
const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as {
  learningGoal: string;
  instruction: string;
  analysis: AnalysisResult;
  material: OrganizedMaterial;
  activityDesign: ActivityDesign;
  cards: unknown[];
};
const usage: ApiTokenUsage[] = [];
const model = "gpt-5.6-luna";
const result = await runCardGeneration(
  "flashcard",
  baseline.material,
  baseline.analysis,
  [
    `학습 목표:\n${baseline.learningGoal}`,
    ...(baseline.instruction
      ? [`추가 지시:\n${baseline.instruction}`]
      : []),
  ].join("\n\n"),
  JSON.stringify({
    countPolicy: "soft_budget",
    learningUnitSoftBudget: {
      max: baseline.analysis.learningUnits?.length ?? 1,
    },
  }),
  "",
  "",
  "",
  JSON.stringify(baseline.activityDesign),
  {
    activitySelectionMode: "automatic",
    cards: {
      model,
      reasoningEffort: "medium",
      compactInput: true,
      sourceName: path.basename(baselinePath),
      experimentId: "dfs-bfs-cards-luna-r1",
      onUsage: (record) => {
        usage.push(record);
      },
    },
  },
);
const machineIssues = result.cards.flatMap((card) =>
  validateLearningActivity(card).map((issue) =>
    `${card.learningUnitId}: ${issue}`
  ),
);
const outputPath = path.resolve(
  "eval/model-tests/artifacts/dfs-bfs-cards-luna-r1.json",
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({
    artifactType: "study-forge-dfs-bfs-isolated-card-model-test",
    completedAt: new Date().toISOString(),
    baselinePath,
    fixedActivityDesign: baseline.activityDesign,
    model,
    reasoningEffort: "medium",
    cards: result.cards,
    usage,
    checks: {
      baselineCardCount: baseline.cards.length,
      cardCount: result.cards.length,
      machineIssues,
    },
  }, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify({ outputPath, usage, machineIssues }));
