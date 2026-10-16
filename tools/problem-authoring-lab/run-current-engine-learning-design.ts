import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSelectedOutlineSourceText,
  filterOutlineToSelection,
  filterPlanToOutlineSelection,
  getDefaultNodeSelection,
  getDefaultOutlineSelection,
} from "../../src/lib/learning-outline.ts";
import type { GenerateInput, PdfInput } from "../../src/lib/pipeline/generate.ts";
import type { ConfirmedStudyGuideline, PdfAnalysisResponse } from "../../src/lib/types.ts";
import { adaptLearningDesignArtifact, type EngineLearningDesignArtifact } from "./learning-design-bridge.ts";

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("인수가 올바르지 않습니다.");
    values.set(key.slice(2), value);
  }
  const pdf = values.get("pdf");
  const goal = values.get("goal");
  const runId = values.get("run-id");
  if (!pdf || !goal || !runId) {
    throw new Error("사용법: run-current-engine-learning-design.ts --pdf <pdf> --goal <goal> --run-id <run-id> [--model <model>] [--instruction <instruction>]");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error("run-id 형식이 올바르지 않습니다.");
  return { pdf, goal, runId, instruction: values.get("instruction") ?? "", model: values.get("model") ?? "gpt-6-astra" };
}

function confirmedGuideline(plan: NonNullable<ConfirmedStudyGuideline["wholeDocumentCore"]>): ConfirmedStudyGuideline {
  return {
    summary: plan.summary,
    selectedGroup: {
      id: "whole-document-core",
      title: "전체 자료 핵심 학습 범위",
      description: plan.selectionRationale,
      itemCount: plan.maxLearningUnitCount,
      itemLabel: "핵심 Knowledge Unit",
      selectionInstruction: "선택된 원문 목차에서 학습 목표에 필요한 핵심만 설계하고 exclusions는 제외합니다.",
    },
    wholeDocumentCore: plan,
    countPolicy: "soft_budget",
    learningUnitSoftBudget: { max: plan.maxLearningUnitCount },
  };
}

const { pdf, goal, runId, instruction, model } = parseArguments(process.argv.slice(2));
const startedAt = new Date().toISOString();
const outputDirectory = path.resolve("tools/problem-authoring-lab/runs", runId);
await mkdir(outputDirectory);
await mkdir(path.join(outputDirectory, "stages"));
const writeJson = (fileName: string, value: unknown) =>
  writeFile(path.join(outputDirectory, fileName), `${JSON.stringify(value, null, 2)}\n`);
const stageLog: Array<{ stage: "analyze" | "plan" | "learning-design" | "bridge"; status: "completed"; startedAt: string; completedAt: string }> = [];
const executionBase = {
  runId,
  sourcePath: pdf,
  learningGoal: goal,
  instruction,
  requestedModel: model,
  requestedReasoningEffort: "medium",
  startedAt,
  provider: "codex-subscription",
  retryPolicy: "no runner retry; provider may replace only an invalid existing thread",
  stageCalls: ["analyzePdf", "createWholeDocumentCorePlan", "runLearningDesign", "adaptLearningDesignArtifact"],
  telemetry: {
    analyzeAndPlanThreadIds: "not exposed by current pipeline wrappers",
    learningDesignThreadId: "recorded in stages/30-learning-design.json when available",
    tokenUsage: "not exposed by the current Codex app server response contract",
  },
};
await writeJson("execution.json", { ...executionBase, status: "running", stages: stageLog });
process.env.CODEX_MODEL = model;
process.env.CODEX_EXTRACTION_MODEL = model;
let activeStage = "initialization";
let activeStageStartedAt = startedAt;
let providerTouched = false;
try {
  const [{ analyzePdf }, { createWholeDocumentCorePlan }, { runLearningDesign }, { getPublicModelConfig }] = await Promise.all([
    import("../../src/lib/pipeline/analyze.ts"),
    import("../../src/lib/pipeline/plan.ts"),
    import("../../src/lib/pipeline/generate.ts"),
    import("../../src/lib/model-config.ts"),
  ]);
  const pdfPath = path.resolve(pdf);
  const pdfBytes = await readFile(pdfPath);
  const fileName = path.basename(pdfPath);
  if (!fileName.toLowerCase().endsWith(".pdf")) throw new Error("PDF 파일만 사용할 수 있습니다.");
  const sourceSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  await writeJson("input.json", { sourcePath: pdf, sourceFileName: fileName, sourceSha256, learningGoal: goal, instruction, model, reasoningEffort: "medium" });
  const file = new File([pdfBytes], fileName, { type: "application/pdf" });
  const pdfInput: PdfInput = { filename: fileName, mimeType: "application/pdf", base64: pdfBytes.toString("base64") };

  activeStage = "analyze";
  activeStageStartedAt = new Date().toISOString();
  providerTouched = true;
  const analyze: PdfAnalysisResponse = { files: [{ fileName, ...(await analyzePdf(file)) }] };
  await writeJson("stages/10-analyze.json", analyze);
  stageLog.push({ stage: "analyze", status: "completed", startedAt: activeStageStartedAt, completedAt: new Date().toISOString() });
  const sourceOutline = analyze.files[0]?.sourceOutline;
  if (!sourceOutline) throw new Error("Analyze 결과에 원문 목차가 없습니다.");
  const selectedSourceOutline = filterOutlineToSelection(sourceOutline, getDefaultNodeSelection(sourceOutline.nodes));

  activeStage = "plan";
  activeStageStartedAt = new Date().toISOString();
  const planned = await createWholeDocumentCorePlan(analyze, instruction, [pdfInput], goal, {}, selectedSourceOutline);
  const selectedLeafIds = getDefaultOutlineSelection(planned);
  const selectedPlan = filterPlanToOutlineSelection(planned, selectedLeafIds);
  const plan = confirmedGuideline(selectedPlan);
  await writeJson("stages/20-plan.json", { raw: planned, selectedLeafIds, confirmed: plan });
  stageLog.push({ stage: "plan", status: "completed", startedAt: activeStageStartedAt, completedAt: new Date().toISOString() });

  activeStage = "learning-design";
  activeStageStartedAt = new Date().toISOString();
  const generateInput: GenerateInput = {
    title: fileName.replace(/\.pdf$/i, ""), subject: "", tags: [],
    sourceText: buildSelectedOutlineSourceText(selectedPlan.learningOutline?.nodes ?? [], selectedLeafIds),
    instruction: [goal, instruction].filter(Boolean).join("\n"),
    analysisContext: JSON.stringify(analyze), studyGuideline: JSON.stringify(plan),
    activityDesign: "", learningDesign: "", codexThreadId: "", activitySelectionMode: "automatic",
    stage: "prepare", preparedAnalysis: "", preparedMaterial: "", mode: "flashcard",
  };
  const learningDesignResult = await runLearningDesign(generateInput, [pdfInput]);
  await writeJson("stages/30-learning-design.json", { request: generateInput, response: learningDesignResult });
  stageLog.push({ stage: "learning-design", status: "completed", startedAt: activeStageStartedAt, completedAt: new Date().toISOString() });
  const artifact: EngineLearningDesignArtifact = {
    schemaVersion: "engine-learning-design-artifact-v1", artifactId: runId, title: generateInput.title,
    analyze, plan, learningDesignResult,
    execution: {
      sourceFileName: fileName, sourceSha256, learningGoal: goal, instruction, startedAt,
      completedAt: new Date().toISOString(), modelConfiguration: getPublicModelConfig(),
    },
  };
  await writeJson("engine-artifact.json", artifact);

  activeStage = "bridge";
  activeStageStartedAt = new Date().toISOString();
  const bridge = adaptLearningDesignArtifact(artifact);
  await Promise.all([
    writeJson("source-packet.json", bridge.packet),
    writeJson("bridge-report.json", bridge.report),
  ]);
  stageLog.push({ stage: "bridge", status: "completed", startedAt: activeStageStartedAt, completedAt: new Date().toISOString() });
  await writeJson("execution.json", { ...executionBase, status: "completed", completedAt: new Date().toISOString(), stages: stageLog });
  console.log(outputDirectory);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeJson("execution.json", { ...executionBase, status: "failed", failedStage: activeStage, failedStageStartedAt: activeStageStartedAt, completedAt: new Date().toISOString(), stages: stageLog, error: { message } });
  throw error;
} finally {
  if (providerTouched) {
    try {
      const { getCodexAppServer } = await import("../../src/lib/codex-app-server.ts");
      (await getCodexAppServer()).close();
    } catch (error) {
      console.error(`Codex App Server 종료 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
