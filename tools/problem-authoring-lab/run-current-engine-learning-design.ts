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
process.env.CODEX_MODEL = model;
process.env.CODEX_EXTRACTION_MODEL = model;
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
const file = new File([pdfBytes], fileName, { type: "application/pdf" });
const pdfInput: PdfInput = { filename: fileName, mimeType: "application/pdf", base64: pdfBytes.toString("base64") };

const analyze: PdfAnalysisResponse = { files: [{ fileName, ...(await analyzePdf(file)) }] };
const sourceOutline = analyze.files[0]?.sourceOutline;
if (!sourceOutline) throw new Error("Analyze 결과에 원문 목차가 없습니다.");
const selectedSourceOutline = filterOutlineToSelection(sourceOutline, getDefaultNodeSelection(sourceOutline.nodes));
const planned = await createWholeDocumentCorePlan(analyze, instruction, [pdfInput], goal, {}, selectedSourceOutline);
const selectedPlan = filterPlanToOutlineSelection(planned, getDefaultOutlineSelection(planned));
const plan = confirmedGuideline(selectedPlan);
const selectedLeafIds = getDefaultOutlineSelection(selectedPlan);
const generateInput: GenerateInput = {
  title: fileName.replace(/\.pdf$/i, ""),
  subject: "",
  tags: [],
  sourceText: buildSelectedOutlineSourceText(selectedPlan.learningOutline?.nodes ?? [], selectedLeafIds),
  instruction: [goal, instruction].filter(Boolean).join("\n"),
  analysisContext: JSON.stringify(analyze),
  studyGuideline: JSON.stringify(plan),
  activityDesign: "",
  learningDesign: "",
  codexThreadId: "",
  activitySelectionMode: "automatic",
  stage: "prepare",
  preparedAnalysis: "",
  preparedMaterial: "",
  mode: "flashcard",
};
const learningDesignResult = await runLearningDesign(generateInput, [pdfInput]);
const artifact: EngineLearningDesignArtifact = {
  schemaVersion: "engine-learning-design-artifact-v1",
  artifactId: runId,
  title: generateInput.title,
  analyze,
  plan,
  learningDesignResult,
  execution: {
    sourceFileName: fileName,
    sourceSha256: createHash("sha256").update(pdfBytes).digest("hex"),
    learningGoal: goal,
    instruction,
    startedAt,
    completedAt: new Date().toISOString(),
    modelConfiguration: getPublicModelConfig(),
  },
};
const bridge = adaptLearningDesignArtifact(artifact);
const outputDirectory = path.resolve("tools/problem-authoring-lab/runs", runId);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "engine-artifact.json"), JSON.stringify(artifact, null, 2)),
  writeFile(path.join(outputDirectory, "source-packet.json"), JSON.stringify(bridge.packet, null, 2)),
  writeFile(path.join(outputDirectory, "bridge-report.json"), JSON.stringify(bridge.report, null, 2)),
]);
console.log(outputDirectory);
