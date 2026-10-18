import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  allocateRunId,
  createStageArtifact,
  deriveObservations,
  getGitInfo,
  promptChecksums,
  sha256,
  writeRunDirectory,
} from "./eval-runner.ts";

const STAGE_FILES = {
  analyze: "stages/10-analyze.json",
  plan: "stages/20-plan.json",
  recall: "stages/30-recall.json",
  prepare: "stages/40-prepare.json",
  cards: "stages/50-cards.json",
  critic: "stages/60-critic.json",
  finalCards: "stages/70-final-cards.json",
} as const;

export const FULL_RUN_STAGES = ["analyze", "plan", "recall", "prepare", "cards", "critic", "finalCards"] as const;
export type FullRunStage = (typeof FULL_RUN_STAGES)[number];
export type FullRunEvent = { stage: FullRunStage; status: "running" | "completed" | "failed"; message?: string };

export type FullRunOptions = {
  pdfPath?: string;
  pdfBytes?: Buffer;
  fileName?: string;
  learningGoal: string;
  label?: string;
  caseId?: string;
  repoRoot?: string;
  onEvent?: (event: FullRunEvent) => void | Promise<void>;
};

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slug(value: string, fallback: string) {
  const result = value.toLowerCase().replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return result || fallback;
}

function stageModels(publicModels: Record<string, unknown>) {
  return {
    analyze: publicModels.default,
    plan: publicModels.default,
    recall: publicModels.default,
    prepare: publicModels.extraction,
    cards: publicModels.default,
    critic: publicModels.critic,
    finalCards: publicModels.critic,
  } as Record<string, unknown>;
}

function wholeDocumentGuideline(plan: Record<string, unknown>) {
  const maxLearningUnitCount = Number(plan.maxLearningUnitCount);
  return {
    summary: plan.summary,
    selectedGroup: {
      id: "whole-document-core",
      title: "전체 자료 핵심 학습 범위",
      description: plan.selectionRationale,
      itemCount: maxLearningUnitCount,
      itemLabel: "핵심 LearningUnit",
      selectionInstruction: [
        "특정 영역 하나로 제한하지 않고 wholeDocumentCore.areas 전체에서 핵심 단위를 추출합니다.",
        "모든 영역을 균등하게 배분하지 말고 learningValue를 반영합니다.",
        "중요한 하위 영역은 누락하지 않되 예시, 반복 요약, 메타데이터는 핵심 단위보다 낮은 우선순위로 둡니다.",
        "wholeDocumentCore.exclusions에 포함된 내용은 핵심 LearningUnit으로 만들지 않습니다.",
      ].join(" "),
    },
    wholeDocumentCore: plan,
    countPolicy: "soft_budget",
    learningUnitSoftBudget: { max: maxLearningUnitCount },
  };
}

function selectRecommendedRecall(draft: Record<string, unknown>) {
  const options = Array.isArray(draft.options) ? draft.options as Array<Record<string, unknown>> : [];
  const option = options.find((item) => item.id === draft.recommendedOptionId) ?? options[0];
  if (!option) throw new Error("Recall Design이 선택 가능한 option을 만들지 못했습니다.");
  const variants = Array.isArray(option.variants) ? option.variants as Array<Record<string, unknown>> : [];
  const variant = variants.find((item) => item.slotMode === "template") ?? variants[0];
  if (!variant) throw new Error("Recall Design이 선택 가능한 variant를 만들지 못했습니다.");
  return { selectedOption: option, selectedVariant: variant };
}

function failedManifest(input: Record<string, unknown>, stageFiles: Record<string, string>) {
  return { ...input, status: "failed", stageFiles };
}

export async function runFullEval(options: FullRunOptions) {
  const startedAt = new Date().toISOString();
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  try { process.loadEnvFile(path.join(repoRoot, ".env.local")); } catch {}
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");
  const pdfBytes = options.pdfBytes ?? (options.pdfPath ? await readFile(path.resolve(repoRoot, options.pdfPath)) : null);
  if (!pdfBytes?.length) throw new Error("실행할 PDF가 필요합니다.");
  if (pdfBytes.length > 50 * 1024 * 1024) throw new Error("PDF 용량은 최대 50MB입니다.");
  const fileName = options.fileName ?? path.basename(options.pdfPath ?? "source.pdf");
  if (!fileName.toLowerCase().endsWith(".pdf")) throw new Error("PDF 파일만 실행할 수 있습니다.");
  const learningGoal = options.learningGoal.trim();
  if (!learningGoal) throw new Error("학습 목표가 필요합니다.");

  const sourceHash = sha256(pdfBytes);
  const caseId = options.caseId ?? `generation-lab-${slug(fileName, "pdf")}-${sourceHash.slice(0, 8)}`;
  const outputRoot = path.join(repoRoot, "eval", "runs", caseId);
  await mkdir(outputRoot, { recursive: true });
  const runId = await allocateRunId(outputRoot, options.label ?? `generation-lab-${slug(fileName, "pdf")}`, new Date());
  const outputDirectory = path.join(outputRoot, runId);
  const localSourcePath = path.join(repoRoot, "eval", "local", "sources", `${sourceHash}.pdf`);
  await mkdir(path.dirname(localSourcePath), { recursive: true });
  await writeFile(localSourcePath, pdfBytes, { flag: "wx" }).catch((error) => { if (error?.code !== "EEXIST") throw error; });

  const analyzePipeline = await import("../src/lib/pipeline/analyze.ts");
  const planPipeline = await import("../src/lib/pipeline/plan.ts");
  const recallPipeline = await import("../src/lib/pipeline/recall.ts");
  const generate = await import("../src/lib/pipeline/generate.ts");
  const modelModule = await import("../src/lib/model-config.ts");
  const publicModels = modelModule.getPublicModelConfig() as Record<string, unknown>;
  const models = stageModels(publicModels);
  const git = getGitInfo(repoRoot);
  const prompts = await promptChecksums(repoRoot);
  const artifacts = new Map<string, string | Buffer>();
  const stageLineage: Record<string, unknown> = {};
  let activeStage: FullRunStage = "analyze";
  let prepareResponse: unknown = null;
  let generatedCards: unknown = [];
  let criticCards: unknown = [];
  let finalCards: unknown = [];

  const emit = async (stage: FullRunStage, status: FullRunEvent["status"], message?: string) => {
    activeStage = stage;
    await options.onEvent?.({ stage, status, message });
  };
  const addStage = (stage: keyof typeof STAGE_FILES, request: unknown, response: unknown, refs: string[]) => {
    const relativePath = STAGE_FILES[stage];
    artifacts.set(relativePath, json(createStageArtifact({ runId, stage: stage === "finalCards" ? "final-cards" : stage, modelConfiguration: models[stage], inputRefs: refs, request, response, sourceRunId: null })));
    stageLineage[stage] = { status: "executed", sourceRunId: null, sourceArtifact: null };
  };

  const baseManifest = {
    artifactType: "study-forge-eval-run",
    artifactVersion: "v0",
    runId,
    caseId,
    runKind: "exploratory",
    runMode: "whole_document_core",
    provenance: "eval-runner-v1-full-pipeline",
    status: "completed",
    sourceRunId: null,
    fromStage: "analyze",
    frozenStages: [],
    executedStages: [...FULL_RUN_STAGES],
    startedAt,
    completedAt: null,
    code: { ...git, runtimePromptChecksums: prompts },
    modelConfiguration: models,
    overrideFile: null,
    overrideChecksum: null,
    stageLineage,
    stageFiles: STAGE_FILES,
  };
  const sourceFiles = [{ name: fileName, mimeType: "application/pdf", size: pdfBytes.length, sha256: sourceHash, localPath: path.relative(repoRoot, localSourcePath).replaceAll(path.sep, "/") }];

  try {
    const fileBuffer = new ArrayBuffer(pdfBytes.length);
    new Uint8Array(fileBuffer).set(pdfBytes);
    const file = new File([fileBuffer], fileName, { type: "application/pdf" });
    const pdfInput = { filename: fileName, mimeType: "application/pdf", base64: pdfBytes.toString("base64") };

    await emit("analyze", "running");
    const analysis = { files: [{ fileName, ...(await analyzePipeline.analyzePdf(file)) }] };
    addStage("analyze", { sourceFiles }, analysis, ["inputs.json"]);
    await emit("analyze", "completed");

    await emit("plan", "running");
    const wholePlan = await planPipeline.createWholeDocumentCorePlan(
      analysis,
      "",
      [pdfInput],
      learningGoal,
    );
    const guideline = wholeDocumentGuideline(wholePlan as unknown as Record<string, unknown>);
    const planResponse = { plan: null, wholeDocumentCorePlan: wholePlan, selectedLearningArea: null, effectiveStudyGuideline: guideline };
    addStage("plan", { analysis, instruction: "", learningGoal, runMode: "whole_document_core", sourceFiles }, planResponse, [STAGE_FILES.analyze, "inputs.json"]);
    await emit("plan", "completed");

    await emit("recall", "running");
    const recallDraft = await recallPipeline.createRecallDesign(analysis, guideline as never, [pdfInput]);
    const selectedRecallDesign = selectRecommendedRecall(recallDraft as unknown as Record<string, unknown>);
    const recallResponse = { recallDesign: recallDraft, selectedRecallDesign };
    addStage("recall", { analysis, guideline, sourceFiles }, recallResponse, [STAGE_FILES.analyze, STAGE_FILES.plan]);
    await emit("recall", "completed");

    const representativeExample = selectedRecallDesign.selectedVariant.sample;
    const mode = String(selectedRecallDesign.selectedOption.mode ?? "flashcard") as "flashcard" | "cloze" | "translation";
    const generateInput = {
      title: fileName.replace(/\.pdf$/i, ""), subject: "", tags: [], sourceText: "", instruction: learningGoal,
      analysisContext: JSON.stringify(analysis), studyGuideline: JSON.stringify(guideline), recallDesign: JSON.stringify(selectedRecallDesign),
      approvedSample: JSON.stringify(representativeExample), sampleFeedback: "", activityDesign: "", activitySelectionMode: "automatic" as const, stage: "prepare" as const, preparedAnalysis: "", preparedMaterial: "", mode,
    };

    await emit("prepare", "running");
    const preparedAnalysis = await generate.runAnalysis(generateInput, [pdfInput]);
    prepareResponse = { analysis: preparedAnalysis, organizedMaterial: generate.buildReviewMaterial(generateInput, preparedAnalysis), cards: [] };
    addStage("prepare", { ...generateInput, sourceFiles }, prepareResponse, [STAGE_FILES.analyze, STAGE_FILES.plan, STAGE_FILES.recall]);
    await emit("prepare", "completed");

    await emit("cards", "running");
    const cardResult = await generate.runCardGeneration(
      mode, (prepareResponse as Record<string, unknown>).organizedMaterial as never, preparedAnalysis, learningGoal,
      generateInput.studyGuideline, generateInput.recallDesign, generateInput.approvedSample, "",
      "",
      {
        onCardsGenerated: async (cards) => { generatedCards = cards; addStage("cards", { prepare: prepareResponse, selectedRecallDesign }, cards, [STAGE_FILES.prepare, STAGE_FILES.recall]); await emit("cards", "completed"); await emit("critic", "running"); },
        onCriticCompleted: async (cards) => { criticCards = cards; addStage("critic", { cards: generatedCards, prepare: prepareResponse }, cards, [STAGE_FILES.cards, STAGE_FILES.prepare]); await emit("critic", "completed"); },
      },
    );
    finalCards = cardResult.cards;
    await emit("finalCards", "running");
    addStage("finalCards", null, finalCards, [STAGE_FILES.critic]);
    await emit("finalCards", "completed");

    const inputs = {
      artifactType: "study-forge-eval-run-inputs", artifactVersion: "v0", runId, sourceRunId: null, runMode: "whole_document_core",
      sourceFiles, userSelections: { instruction: learningGoal, wholeDocumentCore: wholePlan, recallOption: selectedRecallDesign.selectedOption, recallVariant: selectedRecallDesign.selectedVariant, representativeExample, cardMode: mode }, override: null,
    };
    const observations = deriveObservations(runId, prepareResponse, generatedCards, criticCards, finalCards);
    artifacts.set("run.json", json({ ...baseManifest, completedAt: new Date().toISOString(), stageLineage }));
    artifacts.set("inputs.json", json(inputs));
    artifacts.set("observations.json", json(observations));
    await writeRunDirectory(repoRoot, outputDirectory, artifacts);
    return { runId, caseId, outputDirectory, observations };
  } catch (error) {
    await emit(activeStage, "failed", error instanceof Error ? error.message : String(error));
    const message = error instanceof Error ? error.message : String(error);
    artifacts.set("run.json", json(failedManifest({ ...baseManifest, completedAt: new Date().toISOString(), failureStage: activeStage, stageLineage }, STAGE_FILES)));
    artifacts.set("inputs.json", json({ artifactType: "study-forge-eval-run-inputs", artifactVersion: "v0", runId, runMode: "whole_document_core", sourceFiles, userSelections: { instruction: learningGoal } }));
    artifacts.set("observations.json", json(deriveObservations(runId, prepareResponse, generatedCards, criticCards, finalCards)));
    artifacts.set("errors.json", json({ artifactType: "study-forge-run-errors", artifactVersion: "v0", runId, stage: activeStage, message, capturedAt: new Date().toISOString() }));
    await writeRunDirectory(repoRoot, outputDirectory, artifacts);
    const failure = new Error(message) as Error & { runId?: string; caseId?: string; stage?: string };
    failure.runId = runId; failure.caseId = caseId; failure.stage = activeStage;
    throw failure;
  }
}

function parseCli(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const pdfPath = values.get("--pdf");
  const learningGoal = values.get("--goal");
  if (!pdfPath || !learningGoal) throw new Error("사용법: npm run eval:full-run -- --pdf <path> --goal <학습 목표>");
  return { pdfPath, learningGoal, label: values.get("--label"), caseId: values.get("--case") };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { console.log(JSON.stringify(await runFullEval(parseCli(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
