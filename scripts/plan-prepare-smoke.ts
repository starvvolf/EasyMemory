import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePdf } from "../src/lib/pipeline/analyze.ts";
import { createWholeDocumentCorePlan } from "../src/lib/pipeline/plan.ts";
import { buildReviewMaterial, runAnalysis } from "../src/lib/pipeline/generate.ts";
import {
  buildSelectedOutlineSourceText,
  filterOutlineToSelection,
  filterPlanToOutlineSelection,
  getDefaultNodeSelection,
  getDefaultOutlineSelection,
} from "../src/lib/learning-outline.ts";
import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import type { ReasoningEffort } from "../src/lib/model-config.ts";
import { getGitInfo, promptChecksums, sha256 } from "./eval-runner.ts";

function values(argv: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("인수가 올바르지 않습니다.");
    result.set(key.slice(2), value);
  }
  return result;
}

export async function runPlanPrepareSmoke(argv: string[]) {
  const args = values(argv);
  const analyzeArgument = args.get("analyze");
  const analyzePath = analyzeArgument ? path.resolve(analyzeArgument) : null;
  const reusePlanArgument = args.get("reuse-plan");
  const reusePlanPath = reusePlanArgument ? path.resolve(reusePlanArgument) : null;
  const pdfPath = path.resolve(args.get("pdf") ?? "");
  const label = args.get("label") ?? "plan-prepare";
  const learningGoal = args.get("goal") ?? "";
  const instruction = args.get("instruction") ?? "";
  const prepareModel = args.get("prepare-model") ?? "";
  const prepareReasoning = args.get("prepare-reasoning") as ReasoningEffort | undefined;
  const preparePromptMode = args.get("prepare-prompt-mode") as
    | "current"
    | "simplified"
    | undefined;
  const includePreparePdf = args.get("include-prepare-pdf") !== "false";
  const repoRoot = process.cwd();
  const usage: ApiTokenUsage[] = [];
  const usageContext = {
    sourceName: path.basename(pdfPath),
    experimentId: label,
    onUsage: (record: ApiTokenUsage) => {
      usage.push(record);
    },
  };

  try {
    process.loadEnvFile(path.join(repoRoot, ".env.local"));
  } catch {
    // The API call below reports a missing key.
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");

  const pdfBytes = await fs.readFile(pdfPath);
  const fileName = path.basename(pdfPath);
  const reusedArtifactBytes = reusePlanPath ? await fs.readFile(reusePlanPath) : null;
  const reusedArtifact = reusedArtifactBytes
    ? JSON.parse(reusedArtifactBytes.toString("utf8")) as {
        analyze?: unknown;
        plan?: unknown;
      }
    : null;
  const resolvedAnalysis = reusedArtifact
    ? (reusedArtifact.analyze ?? null)
    : analyzePath
      ? await fs.readFile(analyzePath, "utf8").then((value) => {
          const artifact = JSON.parse(value);
          return artifact.response ?? artifact;
        })
      : {
          files: [
            {
              fileName,
              ...(await analyzePdf(
                new File([pdfBytes], fileName, { type: "application/pdf" }),
                usageContext,
              )),
            },
          ],
        };
  const pdfInput = {
  filename:
    resolvedAnalysis && typeof resolvedAnalysis === "object" && "files" in resolvedAnalysis
      ? ((resolvedAnalysis as { files?: Array<{ fileName?: string }> }).files?.[0]?.fileName ?? fileName)
      : fileName,
  mimeType: "application/pdf",
  base64: pdfBytes.toString("base64"),
  };
  const startedAt = new Date().toISOString();
  const sourceOutline = resolvedAnalysis && typeof resolvedAnalysis === "object"
    ? (
        "sourceOutline" in resolvedAnalysis
          ? resolvedAnalysis.sourceOutline
          : "files" in resolvedAnalysis && Array.isArray(resolvedAnalysis.files)
            ? resolvedAnalysis.files[0]?.sourceOutline
            : undefined
      )
    : undefined;
  const selectedSourceOutline = sourceOutline && typeof sourceOutline === "object" &&
    "nodes" in sourceOutline && Array.isArray(sourceOutline.nodes)
    ? filterOutlineToSelection(
        sourceOutline as Parameters<typeof filterOutlineToSelection>[0],
        getDefaultNodeSelection(
          sourceOutline.nodes as Parameters<typeof getDefaultNodeSelection>[0],
        ),
      )
    : undefined;
  const plan = reusedArtifact?.plan
    ? reusedArtifact.plan as Awaited<ReturnType<typeof createWholeDocumentCorePlan>>
    : await createWholeDocumentCorePlan(
        resolvedAnalysis as Parameters<typeof createWholeDocumentCorePlan>[0],
        instruction,
        [pdfInput],
        learningGoal,
        usageContext,
        selectedSourceOutline,
      );
  const selectedOutlineLeafIds = getDefaultOutlineSelection(plan);
  const selectedPlan = filterPlanToOutlineSelection(plan, selectedOutlineLeafIds);
  const selectedSourceText = plan.learningOutline
    ? buildSelectedOutlineSourceText(
        plan.learningOutline.nodes,
        selectedOutlineLeafIds,
      )
    : "";
  const guideline = {
  summary: plan.summary,
  selectedGroup: {
    id: "whole-document-core",
    title: "전체 자료 핵심 학습 범위",
    description: plan.selectionRationale,
    itemCount: plan.maxLearningUnitCount,
    itemLabel: "핵심 LearningUnit",
    selectionInstruction:
      "wholeDocumentCore.areas의 학습 가치가 높은 핵심만 추출하고 exclusions는 제외합니다. max는 과다 추출 안전선이며 채울 목표가 아닙니다.",
  },
  wholeDocumentCore: selectedPlan,
  countPolicy: "soft_budget" as const,
  learningUnitSoftBudget: { max: plan.maxLearningUnitCount },
  };
  const generateInput = {
  title: fileName.replace(/\.pdf$/i, ""),
  subject: "",
  tags: [],
  sourceText: selectedSourceText,
  instruction,
  analysisContext: resolvedAnalysis ? JSON.stringify(resolvedAnalysis) : "",
  studyGuideline: JSON.stringify(guideline),
  recallDesign: "",
  approvedSample: "",
  sampleFeedback: "",
  activityDesign: "",
  activitySelectionMode: "automatic" as const,
  stage: "prepare" as const,
  preparedAnalysis: "",
  preparedMaterial: "",
  mode: "flashcard" as const,
  };
  const preparedAnalysis = await runAnalysis(
    generateInput,
    includePreparePdf ? [pdfInput] : [],
    {
    ...usageContext,
    usageStage: "prepare",
    ...(prepareModel ? { model: prepareModel } : {}),
    ...(prepareReasoning ? { reasoningEffort: prepareReasoning } : {}),
    ...(preparePromptMode ? { preparePromptMode } : {}),
    },
  );
  const prepare = {
  analysis: preparedAnalysis,
  organizedMaterial: buildReviewMaterial(generateInput, preparedAnalysis),
  cards: [],
  };
  const artifact = {
  artifactType: "study-forge-plan-prepare-smoke",
  artifactVersion: "v1",
  startedAt,
  completedAt: new Date().toISOString(),
  source: {
    fileName: pdfInput.filename,
    pdfPath,
    pdfSha256: sha256(pdfBytes),
    analyzePath,
    reusePlanPath,
    reusePlanChecksum: reusedArtifactBytes ? sha256(reusedArtifactBytes) : null,
  },
  lineage: {
    analyze: reusedArtifact?.analyze ? "frozen-legacy" : analyzePath ? "frozen" : reusedArtifact ? "not-used" : "executed",
    plan: reusedArtifact?.plan ? "frozen-legacy" : "executed",
    prepare: "executed",
  },
  runtime: {
    git: getGitInfo(repoRoot),
    promptChecksums: await promptChecksums(repoRoot),
  },
  input: {
    learningGoal,
    instruction,
    prepareModel: prepareModel || null,
    prepareReasoning: prepareReasoning || null,
    preparePromptMode: preparePromptMode || "current",
    includePreparePdf,
  },
  analyze: resolvedAnalysis,
  plan,
  prepare,
  usage,
  estimatedCostUsd: usage.reduce(
    (sum, record) => sum + (record.estimatedCostUsd ?? 0),
    0,
  ),
  observations: {
    maxLearningUnitCount: plan.maxLearningUnitCount,
    selectedOutlineLeafCount: selectedOutlineLeafIds.length,
    generatedLearningUnitCount: preparedAnalysis.learningUnits?.length ?? 0,
  },
  };
  const outputDirectory = path.join(repoRoot, "eval", "local", "plan-prepare-v1");
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${label}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { outputPath, observations: artifact.observations };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    console.log(JSON.stringify(await runPlanPrepareSmoke(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
