import fs from "node:fs/promises";
import path from "node:path";

import { runActivityDesign } from "../src/lib/pipeline/generate.ts";
import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  LearningOperation,
  LearningUnit,
  OrganizedMaterial,
} from "../src/lib/types.ts";

const targetDirectory = path.resolve("eval/local/learning-target-v1");
const outlineDirectory = path.resolve("eval/local/analyze-outline-v1");
const outputDirectory = path.resolve("eval/local/learning-target-activity-v1");
const requested = process.argv.slice(2);

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");
}

type TargetArtifact = {
  source: { id: string; filename: string };
  result: {
    learningGoal: string;
    chunks: Array<{
      id: string;
      title: string;
      learningTargets: Array<{
        target: string;
        operation: LearningOperation;
        successCriterion: string;
        evidenceNodeIds: string[];
      }>;
    }>;
  };
};

type OutlineArtifact = {
  result: {
    nodes: Array<{
      id: string;
      title: string;
      summary: string;
      sourceRange: string;
    }>;
  };
};

async function latestFile(directory: string, suffix: string) {
  const filename = (await fs.readdir(directory))
    .filter((item) => item.endsWith(suffix))
    .sort()
    .at(-1);
  if (!filename) throw new Error(`${suffix}: 실험 결과가 없습니다.`);
  return path.join(directory, filename);
}

const ids = requested.length > 0 ? requested : ["opic", "dfs-bfs", "calculus-problems"];
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary: Array<{
  id: string;
  outputPath: string;
  design: ActivityDesign;
  usage: ApiTokenUsage | null;
}> = [];

await fs.mkdir(outputDirectory, { recursive: true });

for (const id of ids) {
  const targetPath = await latestFile(targetDirectory, `-${id}.json`);
  const outlinePath = await latestFile(outlineDirectory, `-${id}.json`);
  const targetArtifact = JSON.parse(await fs.readFile(targetPath, "utf8")) as TargetArtifact;
  const outlineArtifact = JSON.parse(await fs.readFile(outlinePath, "utf8")) as OutlineArtifact;
  const nodeById = new Map(outlineArtifact.result.nodes.map((node) => [node.id, node]));
  const learningUnits: LearningUnit[] = targetArtifact.result.chunks.flatMap((chunk) =>
    chunk.learningTargets.map((item, index) => {
      const evidence = item.evidenceNodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
      return {
        id: `${chunk.id}-T${index + 1}`,
        sourceId: targetArtifact.source.filename,
        sourcePage: 0,
        sourceRange: evidence.map((node) => node?.sourceRange).filter(Boolean).join("; "),
        sourceText: evidence.map((node) => `${node?.title}: ${node?.summary}`).join("\n"),
        knowledgeType: "other",
        fixedPart: "",
        variableSlots: [],
        generalizedForm: "",
        target: item.target,
        operation: item.operation,
        successCriterion: item.successCriterion,
        rationale: chunk.title,
      };
    }),
  );
  const analysis: AnalysisResult = {
    detectedGoal: targetArtifact.result.learningGoal,
    sourceType: "mixed",
    keyTopics: targetArtifact.result.chunks.map((chunk) => chunk.title),
    recommendedStrategy: "학습 대상의 성공 행동을 직접 연습",
    learningUnits,
  };
  const material: OrganizedMaterial = {
    title: targetArtifact.source.filename,
    sections: learningUnits.map((unit) => ({
      heading: unit.target ?? unit.id,
      content: unit.sourceText,
      learningUnitIds: [unit.id],
    })),
  };
  let usage: ApiTokenUsage | null = null;
  const design = await runActivityDesign(analysis, material, {
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    sourceName: targetArtifact.source.filename,
    experimentId: `learning-target-activity-${runStamp}-${id}`,
    onUsage: (value) => {
      usage = value;
    },
  });
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-learning-target-activity-smoke",
      artifactVersion: "v1",
      completedAt: new Date().toISOString(),
      source: { id, targetPath, outlinePath },
      analysis,
      design,
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  summary.push({ id, outputPath, design, usage });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({ summaryPath }));
