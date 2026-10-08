import { learningPlanGenerationSchema, materializeLearningPlanGeneration } from "./compact-generation.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { readVerifiedMcpRunRaw } from "../../src/lib/mcp-run-view.ts";
import { getRegisteredMcpSource, readRegisteredMcpSourcePdf } from "../../src/lib/mcp-source-registry.ts";
import { studyAbilities } from "../../src/lib/mcp-experiment-requests.ts";
import { inspectAbilityCoverage } from "./ability-coverage.ts";
import { extractPdfPageTexts, inspectSourceEvidence, type EvidenceCheck } from "./source-evidence.ts";
import {
  adaptLearningDesignToAnalysis,
  buildReviewMaterial,
  validateLearningDesignPlan,
  type GenerateInput,
} from "../../src/lib/pipeline/generate.ts";
import {
  combineSourceOutlines,
  pdfAnalysisResponseSchema,
} from "../../src/lib/pipeline/analyze.ts";
import {
  learningOutlineSchema,
} from "../../src/lib/pipeline/plan.ts";
import { createPdfMaskActivities } from "../../src/lib/pdf-mask-activity.ts";
import {
  getRendererCapabilities,
  shouldIncludeAssessment,
} from "../../src/lib/practice-blueprint.ts";
import type {
  AssessmentBlueprint,
  KnowledgeType,
  LearningActivityType,
  LearningDesignPlan,
  LearningOperation,
  PracticeBlueprint,
  SupportAssessment,
} from "../../src/lib/types.ts";
import { parseConceptTreeOutline } from "../concept-tree-mcp/outline-parser.ts";
import type { ConceptTreeNode } from "../concept-tree-mcp/types.ts";

export const chatGptParityStages = [
  "analyze",
  "concept-tree",
  "learning-design",
  "activity-design",
  "cards",
] as const;

export type ChatGptParityStage = (typeof chatGptParityStages)[number];

const startInputSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(200).optional(),
  title: z.string().min(1),
  files: z.array(z.object({
    fileName: z.string().min(1),
    pageCount: z.number().int().min(1).optional(),
    sourceId: z.string().regex(/^src_[a-f0-9]{64}$/).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })).min(1).max(20),
  learningGoal: z.string().default(""),
  abilities: z.array(z.enum(studyAbilities)).max(studyAbilities.length).optional(),
  instruction: z.string().default(""),
  subject: z.string().default(""),
  tags: z.array(z.string()).default([]),
  sourceExpressionMode: z.enum(["preserve", "adapt"]).default("adapt"),
  stopAfterStage: z.enum(chatGptParityStages).default("cards"),
  selectedObjectiveIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "학습목표 ID가 중복되었습니다.").optional(),
});

const outlineTextSchema = z.object({
  outlineText: z.string().trim().min(1),
});

const conceptTreeTextSchema = z.object({
  treeText: z.string().trim().min(1),
});

const learningDesignTextSchema = z.object({
  learningDesignText: z.string().trim().min(1),
});

const activityDesignTextSchema = z.object({
  activityDesignText: z.string().trim().min(1),
});

const cardsTextSubmissionSchema = z.object({
  cardsText: z.string().trim().min(1),
});

const reuseAnalyzeOutputSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9._-]+$/),
  sourceRunId: z.string().regex(/^[A-Za-z0-9._-]+$/),
  sourceRunSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const reusablePrefixStages = ["analyze", "concept-tree", "learning-design", "activity-design"] as const;
const reuseStagePrefixSchema = reuseAnalyzeOutputSchema.extend({
  stage: z.enum(reusablePrefixStages),
  selectedOutlineLeafIds: z.array(z.string().min(1)).min(1).optional(),
  selectedPageNumbers: z.array(z.number().int().positive()).min(1).optional(),
});

type ConceptTreeArtifact = {
  treeText: string;
  nodes: Array<ConceptTreeNode & { outlineNodeIds: string[] }>;
  warnings: string[];
};

type LearningDesignBase = Omit<LearningDesignPlan, "assessmentBlueprints"> & {
  assessmentBlueprints: [];
};

/** Keep the recorded Learning Design intact; narrow only the subsequent problem work. */
export function selectLearningDesignObjectives(base: LearningDesignBase, selectedIds?: string[]): LearningDesignBase {
  if (!selectedIds) return base;
  const chosen = new Set(selectedIds);
  const objectives = base.objectives.filter((objective) => chosen.has(objective.id));
  if (objectives.length !== chosen.size || !objectives.length) {
    throw new Error("선택한 학습목표 ID가 기존 학습 설계에 없습니다.");
  }
  const knowledgeUnits = base.knowledgeUnits.filter((unit) => chosen.has(unit.objectiveId));
  if (!knowledgeUnits.length || objectives.some((objective) => !knowledgeUnits.some((unit) => unit.objectiveId === objective.id))) {
    throw new Error("선택한 학습목표에 연결된 학습 내용이 없습니다.");
  }
  return { objectives, knowledgeUnits, assessmentBlueprints: [] };
}

type LearningDesignArtifact = {
  learningDesignText: string;
  learningDesign: LearningDesignBase;
  analysis: ReturnType<typeof adaptLearningDesignToAnalysis>;
  organizedMaterial: ReturnType<typeof buildReviewMaterial>;
  sourceEvidenceChecks?: EvidenceCheck[];
};

type ActivityDesignArtifact = {
  activityDesignText: string;
  learningDesign: LearningDesignPlan;
  activities: z.infer<typeof learningPlanGenerationSchema>["activities"];
  structureModes: Record<string, "word_bank" | "free_input">;
  structureKinds: Record<string, "sequence" | "hierarchy">;
  abilityWarnings?: string[];
};

export type StartChatGptParityInput = z.input<typeof startInputSchema>;

type ChatGptParityRun = {
  id: string;
  engine: "chatgpt-mcp";
  createdAt: string;
  updatedAt: string;
  config: z.output<typeof startInputSchema>;
  selectedOutlineLeafIds: string[];
  artifacts: Partial<Record<ChatGptParityStage, unknown>>;
  stageStartedAt: Partial<Record<ChatGptParityStage, string>>;
  stageCompletedAt: Partial<Record<ChatGptParityStage, string>>;
  stageDurationsMs: Partial<Record<ChatGptParityStage, number>>;
  stageAttemptCounts?: Partial<Record<ChatGptParityStage, number>>;
  stageValidationFailures?: Partial<Record<ChatGptParityStage, Array<{
    at: string;
    error: string;
  }>>>;
  cardDrafts?: Record<string, string>;
  stageReuse?: Partial<Record<ChatGptParityStage, {
    kind: "output";
    sourceRunId: string;
    sourceRunSha256: string;
    sourceArtifactSha256: string;
    sourcePdfSha256: string;
    appliedAt: string;
  }>>;
  cancelledAt?: string;
  publishedAt?: string;
};

const defaultDataRoot = path.join(
  process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"),
  "mcp",
);

type TrustedSourcePdf = { path: string; pageCount: number; sha256: string };

function defaultTrustedSourcePdf(fileName: string): TrustedSourcePdf | null {
  const source = fileName === "02_Geometric Transformations.pdf"
    ? { pageCount: 32, sha256: "73beb50cced41ee5da481f375fc21dff3b40d12054743767d6ad334d88fb7dca" }
    : fileName === "ilovepdf_merged.pdf"
      ? { pageCount: 44, sha256: "bfa671735178c61957ce5d78edd1746a4c585bdde2907d9b4c35f16483705254" }
      : null;
  return source ? {
    ...source,
    path: path.join(os.homedir(), "OneDrive", "바탕 화면", "예외폴", fileName),
  } : null;
}

export class ChatGptParityService {
  private readonly runRoot: string;
  private readonly publishedRoot: string;
  private readonly resolveTrustedSourcePdf: (fileName: string) => TrustedSourcePdf | null;

  constructor(
    runRoot = path.join(defaultDataRoot, "chatgpt-runs"),
    publishedRoot = path.join(defaultDataRoot, "published"),
    resolveTrustedSourcePdf: (fileName: string) => TrustedSourcePdf | null = defaultTrustedSourcePdf,
  ) {
    this.runRoot = runRoot;
    this.publishedRoot = publishedRoot;
    this.resolveTrustedSourcePdf = resolveTrustedSourcePdf;
  }

  async startRun(input: StartChatGptParityInput) {
    const config = startInputSchema.parse(input);
    for (const file of config.files) {
      if (Boolean(file.sourceId) !== Boolean(file.sha256)) throw new Error("등록 자료 ID와 SHA-256을 함께 지정해야 합니다.");
      if (!file.sourceId) continue;
      const registered = await getRegisteredMcpSource(file.sourceId);
      if (!registered || registered.sha256 !== file.sha256 || registered.pageCount !== file.pageCount || registered.fileName !== file.fileName) {
        throw new Error("등록된 원본 PDF의 ID, 해시, 파일명 또는 실제 쪽수가 다릅니다.");
      }
    }
    const fileNames = config.files.map((file) => file.fileName);
    assertUnique(fileNames, "PDF 파일명");
    if (config.clientRequestId) {
      const existingId = requestRunId(config.clientRequestId);
      try {
        const existing = await this.readRun(existingId);
        if (checksum(startInputSchema.parse(existing.config)) !== checksum(config)) {
          throw new Error("같은 clientRequestId를 다른 생성 설정에 다시 사용할 수 없습니다.");
        }
        return this.getNextStage(existing.id);
      } catch (error) {
        if (!(error instanceof Error && error.message.startsWith("ChatGPT MCP run을 찾을 수 없습니다:"))) {
          throw error;
        }
      }
    }
    const now = new Date().toISOString();
    const run: ChatGptParityRun = {
      id: config.clientRequestId
        ? requestRunId(config.clientRequestId)
        : `chatgpt-${now.replace(/[:.]/g, "-")}-${randomUUID()}`,
      engine: "chatgpt-mcp",
      createdAt: now,
      updatedAt: now,
      config,
      selectedOutlineLeafIds: [],
      artifacts: {},
      stageStartedAt: {},
      stageCompletedAt: {},
      stageDurationsMs: {},
      stageAttemptCounts: {},
      stageValidationFailures: {},
      cardDrafts: {},
    };
    await this.writeRun(run);
    return this.getNextStage(run.id);
  }

  async configureRun(input: { runId: string; selectedOutlineLeafIds: string[] }) {
    const run = await this.readRun(input.runId);
    if (run.cancelledAt) throw new Error("취소된 ChatGPT MCP run입니다.");
    const analysis = parseAnalysisArtifact(run.artifacts.analyze);
    if (run.artifacts["concept-tree"] || run.artifacts["learning-design"] || run.artifacts.cards) {
      throw new Error("개념트리 생성이 시작된 뒤에는 원문 목차 선택을 바꿀 수 없습니다.");
    }
    const validLeafIds = new Set(getLeafIds(analysis.sourceOutline!.nodes));
    const selected = [...new Set(input.selectedOutlineLeafIds)];
    if (selected.length === 0) throw new Error("원문 목차의 말단 항목을 한 개 이상 선택하세요.");
    const invalid = selected.filter((id) => !validLeafIds.has(id));
    if (invalid.length > 0) throw new Error(`선택할 수 없는 원문 목차 ID입니다: ${invalid.join(", ")}`);
    run.selectedOutlineLeafIds = selected;
    run.updatedAt = new Date().toISOString();
    await this.writeRun(run);
    return this.getNextStage(run.id);
  }

  async reuseAnalyzeOutput(rawInput: unknown) {
    return this.reuseStagePrefix({ ...reuseAnalyzeOutputSchema.parse(rawInput), stage: "analyze" });
  }

  async reuseStagePrefix(rawInput: unknown) {
    const input = reuseStagePrefixSchema.parse(rawInput);
    if (input.runId === input.sourceRunId) throw new Error("같은 run 안에서 출력 재사용을 요청할 수 없습니다.");
    const targetRunFile = await this.verifiedRunFile(input.runId);
    const targetRaw = await readFile(targetRunFile, "utf8");
    let sourceRaw: string;
    try {
      sourceRaw = await readFile(await this.verifiedRunFile(input.sourceRunId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const verified = await readVerifiedMcpRunRaw(`mcp:${input.sourceRunId}`);
      if (!verified) throw new Error("검증된 이전 MCP run을 찾지 못했습니다.");
      sourceRaw = verified;
    }
    const target = JSON.parse(targetRaw) as ChatGptParityRun;
    const source = JSON.parse(sourceRaw) as ChatGptParityRun;
    if (target.id !== input.runId || target.engine !== "chatgpt-mcp") {
      throw new Error("새 run 기록의 ID 또는 엔진이 다릅니다.");
    }
    if (source.id !== input.sourceRunId || source.engine !== "chatgpt-mcp") {
      throw new Error("원본 run 기록의 ID 또는 엔진이 다릅니다.");
    }
    if (target.cancelledAt) throw new Error("취소된 ChatGPT MCP run에는 재사용할 수 없습니다.");
    if (Object.keys(target.artifacts).length > 0 || target.selectedOutlineLeafIds.length > 0) {
      throw new Error("새 실행의 Analyze 전에만 출력을 재사용할 수 있습니다.");
    }
    const prefix = chatGptParityStages.slice(0, chatGptParityStages.indexOf(input.stage) + 1);
    if (chatGptParityStages.indexOf(target.config.stopAfterStage) < chatGptParityStages.indexOf(input.stage)) {
      throw new Error("새 run의 종료 단계가 재사용 단계보다 앞섭니다.");
    }
    if (prefix.some((stage) => source.artifacts[stage] === undefined || !source.stageCompletedAt[stage])) {
      throw new Error("원본 run에 요청 단계까지 완료된 연속 출력이 없습니다.");
    }
    if (target.config.files.length !== 1 || source.config.files.length !== 1) {
      throw new Error("이 최소 재사용 도구는 PDF 한 개만 지원합니다.");
    }
    const targetFile = target.config.files[0];
    const sourceFile = source.config.files[0];
    if (targetFile.fileName !== sourceFile.fileName || targetFile.pageCount !== sourceFile.pageCount) {
      throw new Error("원본과 새 run의 PDF 파일명 또는 페이지 수가 다릅니다.");
    }
    const registered = targetFile.sourceId ? await getRegisteredMcpSource(targetFile.sourceId) : null;
    const legacyTrusted = !sourceFile.sourceId ? this.resolveTrustedSourcePdf(sourceFile.fileName) : null;
    const sameRegistered = registered && sourceFile.sourceId === registered.id;
    const verifiedLegacySource = legacyTrusted && !targetFile.sourceId;
    const crossFromLegacy = registered && legacyTrusted && !sourceFile.sourceId &&
      registered.sha256 === legacyTrusted.sha256 && registered.pageCount === legacyTrusted.pageCount;
    const trusted = sameRegistered || crossFromLegacy
      ? { pageCount: registered!.pageCount, sha256: registered!.sha256, bytes: await readRegisteredMcpSourcePdf(registered!.id) }
      : verifiedLegacySource ? { ...legacyTrusted, bytes: await readFile(legacyTrusted.path) } : null;
    if (!trusted || targetFile.pageCount !== trusted.pageCount || input.sourcePdfSha256 !== trusted.sha256 ||
      (registered && targetFile.sha256 !== registered.sha256) ||
      (sameRegistered && sourceFile.sha256 !== registered!.sha256)) {
      throw new Error("원본 PDF의 파일명, 페이지 수 또는 승인된 SHA-256이 다릅니다.");
    }
    if (crossFromLegacy) {
      const legacyBytes = await readFile(legacyTrusted!.path);
      if (createHash("sha256").update(legacyBytes).digest("hex") !== registered!.sha256) {
        throw new Error("기존 run의 원본 PDF 바이트가 등록 자료와 다릅니다.");
      }
    }
    const pdfBytes = trusted.bytes;
    if (!pdfBytes) throw new Error("등록된 원본 PDF를 읽지 못했습니다.");
    if (pdfBytes.length > 10 * 1024 * 1024 ||
      createHash("sha256").update(pdfBytes).digest("hex") !== input.sourcePdfSha256) {
      throw new Error("현재 로컬 원본 PDF의 SHA-256이 요청값과 다릅니다.");
    }
    if (createHash("sha256").update(sourceRaw).digest("hex") !== input.sourceRunSha256) {
      throw new Error("원본 run 파일의 SHA-256이 요청값과 다릅니다.");
    }
    if (createHash("sha256").update(JSON.stringify(source.artifacts[input.stage])).digest("hex") !== input.sourceArtifactSha256) {
      throw new Error(`원본 ${input.stage} 산출물의 SHA-256이 요청값과 다릅니다.`);
    }
    const analysis = parseAnalysisArtifact(source.artifacts.analyze);
    if (input.stage !== "analyze") {
      if (target.config.learningGoal !== source.config.learningGoal ||
        target.config.instruction !== source.config.instruction ||
        target.config.subject !== source.config.subject ||
        target.config.sourceExpressionMode !== source.config.sourceExpressionMode) {
        throw new Error("학습 목적 또는 생성 조건이 원본 run과 다릅니다.");
      }
      const sourceLeaves = source.selectedOutlineLeafIds;
      const leaves = input.selectedOutlineLeafIds;
      if (!leaves || JSON.stringify(leaves) !== JSON.stringify(sourceLeaves)) {
        throw new Error("선택한 원문 하위목차 범위가 원본 run과 다릅니다.");
      }
      const selectedNodes = analysis.sourceOutline!.nodes.filter((node) => sourceLeaves.includes(node.id));
      const sourcePages = [...new Set(selectedNodes.flatMap((node) =>
        node.sourceRefs.flatMap((ref) => ref.pageNumbers)))].sort((a, b) => a - b);
      const requestedPages = [...new Set(input.selectedPageNumbers ?? [])].sort((a, b) => a - b);
      if (!sourcePages.length || JSON.stringify(requestedPages) !== JSON.stringify(sourcePages)) {
        throw new Error("선택한 PDF 페이지 범위가 원본 run과 다릅니다.");
      }
      if (input.stage === "learning-design") {
        selectLearningDesignObjectives(
          parseLearningDesignArtifact(source.artifacts["learning-design"]).learningDesign,
          target.config.selectedObjectiveIds,
        );
      }
    }
    target.stageReuse ??= {};
    const appliedAt = new Date().toISOString();
    for (const stage of prefix) {
      target.artifacts[stage] = structuredClone(source.artifacts[stage]);
      target.stageReuse[stage] = {
        kind: "output",
        sourceRunId: input.sourceRunId,
        sourceRunSha256: input.sourceRunSha256,
        sourceArtifactSha256: createHash("sha256").update(JSON.stringify(source.artifacts[stage])).digest("hex"),
        sourcePdfSha256: input.sourcePdfSha256,
        appliedAt,
      };
      target.stageCompletedAt[stage] = appliedAt;
      delete target.stageStartedAt[stage];
      delete target.stageDurationsMs[stage];
    }
    if (input.stage === "analyze") {
      const leafIds = new Set(getLeafIds(analysis.sourceOutline!.nodes));
      target.selectedOutlineLeafIds = analysis.sourceOutline!.nodes
        .filter((node) => node.selectedByDefault && leafIds.has(node.id))
        .map((node) => node.id);
      if (target.selectedOutlineLeafIds.length === 0) target.selectedOutlineLeafIds = [...leafIds];
    } else {
      target.selectedOutlineLeafIds = [...source.selectedOutlineLeafIds];
    }
    target.updatedAt = appliedAt;
    await this.writeRun(target);
    return {
      reused: {
        kind: "output" as const,
        stage: input.stage,
        sourceRunId: input.sourceRunId,
        sourceRunSha256: input.sourceRunSha256,
        sourceArtifactSha256: input.sourceArtifactSha256,
        sourcePdfSha256: input.sourcePdfSha256,
      },
      ...(await this.getNextStage(target.id)),
    };
  }

  async getNextStage(runId: string) {
    const run = await this.readRun(runId);
    if (run.cancelledAt) throw new Error("취소된 ChatGPT MCP run입니다.");
    const stopAfterStage = run.config.stopAfterStage ?? "cards";
    if (run.artifacts[stopAfterStage]) {
      return {
        runId,
        engine: run.engine,
        completed: stopAfterStage === "cards",
        stoppedAfterStage: stopAfterStage === "cards" ? null : stopAfterStage,
        nextStage: null,
        stageInput: null,
      };
    }
    const nextStage = chatGptParityStages.find((stage) => !run.artifacts[stage]) ?? null;
    if (!nextStage) {
      return {
        runId,
        engine: run.engine,
        completed: true,
        stoppedAfterStage: null,
        nextStage: null,
        stageInput: null,
      };
    }
    if (!run.stageStartedAt[nextStage]) {
      run.stageStartedAt[nextStage] = new Date().toISOString();
      run.updatedAt = run.stageStartedAt[nextStage]!;
      await this.writeRun(run);
    }
    return {
      runId,
      engine: run.engine,
      completed: false,
      stoppedAfterStage: null,
      nextStage,
      stageInput: this.buildStageInput(run, nextStage),
    };
  }

  async submitStage(input: {
    runId: string;
    stage: ChatGptParityStage;
    result: unknown;
  }) {
    const run = await this.readRun(input.runId);
    if (run.cancelledAt) throw new Error("취소된 ChatGPT MCP run입니다.");
    const stopAfterStage = run.config.stopAfterStage ?? "cards";
    if (stopAfterStage !== "cards" && run.artifacts[stopAfterStage]) {
      throw new Error(`${stopAfterStage} 단계에서 종료된 ChatGPT MCP run입니다. 다음 단계 결과를 받을 수 없습니다.`);
    }
    const expected = chatGptParityStages.find((stage) => !run.artifacts[stage]) ?? null;
    if (!expected) throw new Error("이미 모든 단계가 완료되었습니다.");
    if (input.stage !== expected) {
      throw new Error(`현재 제출할 단계는 ${expected}입니다. ${input.stage} 결과는 받을 수 없습니다.`);
    }
    const attemptAt = new Date().toISOString();
    run.stageAttemptCounts ??= {};
    run.stageValidationFailures ??= {};
    run.stageAttemptCounts[input.stage] = (run.stageAttemptCounts[input.stage] ?? 0) + 1;
    let value = input.result;
    if (input.stage === "cards") {
      value = this.mergeCardDraftSubmission(run, input.result);
    }
    try {
      const artifact = this.validateAndMaterialize(run, input.stage, value);
      if (input.stage === "learning-design") {
        (artifact as LearningDesignArtifact).sourceEvidenceChecks = await this.checkLearningEvidence(run, artifact as LearningDesignArtifact);
      }
      run.artifacts[input.stage] = artifact;
      if (input.stage === "activity-design") {
        const artifact = run.artifacts[input.stage] as ActivityDesignArtifact;
        artifact.abilityWarnings = inspectAbilityCoverage(
          run.config.abilities ?? [], artifact.learningDesign.assessmentBlueprints, artifact.activities,
          artifact.learningDesign.knowledgeUnits,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.stageValidationFailures[input.stage] = [
        ...(run.stageValidationFailures[input.stage] ?? []),
        { at: attemptAt, error: message },
      ];
      run.updatedAt = attemptAt;
      await this.writeRun(run);
      if (input.stage === "cards") {
        throw new Error(`${message} 이전에 제출한 카드들은 보존했습니다. 다음 제출에서는 오류가 난 CARD 블록만 같은 번호로 다시 보내세요.`);
      }
      throw error;
    }
    const completedAt = new Date().toISOString();
    run.stageCompletedAt[input.stage] = completedAt;
    const startedAt = run.stageStartedAt[input.stage];
    if (startedAt) {
      run.stageDurationsMs[input.stage] = Math.max(
        0,
        Date.parse(completedAt) - Date.parse(startedAt),
      );
    }
    if (input.stage === "analyze" && run.selectedOutlineLeafIds.length === 0) {
      const analysis = parseAnalysisArtifact(run.artifacts.analyze);
      const leafIds = new Set(getLeafIds(analysis.sourceOutline!.nodes));
      run.selectedOutlineLeafIds = analysis.sourceOutline!.nodes
        .filter((node) => node.selectedByDefault && leafIds.has(node.id))
        .map((node) => node.id);
      if (run.selectedOutlineLeafIds.length === 0) {
        run.selectedOutlineLeafIds = [...leafIds];
      }
    }
    run.updatedAt = completedAt;
    await this.writeRun(run);
    return {
      submitted: {
        stage: input.stage,
        checksum: checksum(run.artifacts[input.stage]),
        durationMs: run.stageDurationsMs[input.stage] ?? null,
        ...(input.stage === "activity-design" ? { abilityWarnings: (run.artifacts[input.stage] as ActivityDesignArtifact).abilityWarnings ?? [] } : {}),
        ...(input.stage === "learning-design" ? { sourceEvidenceChecks: (run.artifacts[input.stage] as LearningDesignArtifact).sourceEvidenceChecks ?? [] } : {}),
      },
      ...(await this.getNextStage(run.id)),
    };
  }

  /** One completed stage exactly as stored, for request records that must hash-match the run file. */
  async stageRecord(runId: string, stage: ChatGptParityStage) {
    const run = await this.readRun(runId);
    const artifact = run.artifacts[stage];
    if (artifact === undefined) throw new Error(`${stage} 단계가 아직 저장되지 않았습니다.`);
    return {
      artifact,
      startedAt: run.stageStartedAt[stage] ?? null,
      completedAt: run.stageCompletedAt[stage] ?? null,
      reusedFrom: run.stageReuse?.[stage] ?? null,
    };
  }

  async getResult(runId: string) {
    const run = await this.readRun(runId);
    const activity = parseActivityDesignArtifact(run.artifacts["activity-design"]);
    const final = parseCardsArtifact(run.artifacts.cards);
    return {
      runId,
      engine: run.engine,
      title: run.config.title,
      files: run.config.files,
      selectedOutlineLeafIds: run.selectedOutlineLeafIds,
      stageDurationsMs: run.stageDurationsMs,
      stageAttemptCounts: run.stageAttemptCounts ?? {},
      stageValidationFailures: run.stageValidationFailures ?? {},
      totalDurationMs: Object.values(run.stageDurationsMs).reduce((sum, value) => sum + (value ?? 0), 0),
      conceptTree: parseConceptTreeArtifact(run.artifacts["concept-tree"]),
      learningDesign: activity.learningDesign,
      activityDesign: final.activityDesign,
      cardCount: final.cards.length,
      cards: final.cards.map((card) => ({
        ...card,
        effectiveType: card.activityType ?? card.type,
      })),
    };
  }

  async publishRun(input: { runId: string; confirmPublish: boolean }) {
    if (!input.confirmPublish) throw new Error("발행하려면 confirmPublish=true가 필요합니다.");
    const run = await this.readRun(input.runId);
    if (run.cancelledAt) throw new Error("취소된 ChatGPT MCP run은 발행할 수 없습니다.");
    const analysisArtifact = parseAnalysisArtifact(run.artifacts.analyze);
    const design = parseLearningDesignArtifact(run.artifacts["learning-design"]);
    const final = parseCardsArtifact(run.artifacts.cards);
    const conceptTree = parseConceptTreeArtifact(run.artifacts["concept-tree"]);
    const now = new Date().toISOString();
    const selectedOutline = selectOutline(
      analysisArtifact.sourceOutline!,
      run.selectedOutlineLeafIds,
    );
    const studyGuideline = buildStudyGuideline(run, selectedOutline);
    const deck = {
      id: `mcp-run-${run.id}`,
      projectId: run.config.projectId,
      title: run.config.title,
      boardColumn: "new",
      subject: run.config.subject,
      tags: run.config.tags.length > 0 ? run.config.tags : ["MCP", "ChatGPT"],
      mode: "flashcard",
      sourceText: design.learningDesign.knowledgeUnits.map((unit) => unit.sourceText).join("\n\n"),
      sourceFileName: run.config.files.map((file) => file.fileName).join(", "),
      instruction: run.config.instruction,
      studyGuideline,
      activityDesign: final.activityDesign,
      activitySelectionMode: "automatic",
      sourceExpressionMode: run.config.sourceExpressionMode,
      outlineSelection: {
        outline: selectedOutline,
        selectedLeafIds: run.selectedOutlineLeafIds,
      },
      conceptTree: {
        id: `concept-tree-${run.id}`,
        title: run.config.title,
        sourceFileNames: run.config.files.map((file) => file.fileName),
        nodes: conceptTree.nodes.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          order: node.order,
          depth: node.depth,
          title: node.title,
          relation: node.relation,
          description: node.description,
          sourceRefs: node.sourceRefs,
        })),
      },
      conceptTreeIds: [`concept-tree-${run.id}`],
      analysis: design.analysis,
      organizedMaterial: design.organizedMaterial,
      pdfMaskActivities: createPdfMaskActivities(design.analysis.learningUnits ?? []),
      cards: final.cards.map((card) => ({
        ...card,
        effectiveType: card.activityType ?? card.type,
      })),
      createdAt: now,
      updatedAt: now,
      generationEngine: "chatgpt-mcp",
      generationRunId: run.id,
    };
    await mkdir(this.publishedRoot, { recursive: true });
    const target = path.join(this.publishedRoot, `${safeId(run.id)}.json`);
    try {
      await writeFile(target, `${JSON.stringify(deck, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    run.publishedAt ??= now;
    run.updatedAt = now;
    await this.writeRun(run);
    return { runId: run.id, deckId: deck.id, title: deck.title, cardCount: deck.cards.length };
  }

  async listRuns() {
    await mkdir(this.runRoot, { recursive: true });
    const entries = await readdir(this.runRoot, { withFileTypes: true });
    const runs = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await this.readRun(entry.name);
        } catch {
          return null;
        }
      }));
    return runs
      .filter((run): run is ChatGptParityRun => run !== null)
      .map((run) => {
        const nextStage = chatGptParityStages.find((stage) => !run.artifacts[stage]) ?? null;
        const status = run.cancelledAt
          ? "cancelled"
          : run.publishedAt
            ? "published"
            : nextStage === null ? "completed"
              : run.artifacts[run.config.stopAfterStage ?? "cards"] ? "stopped" : "active";
        return {
          runId: run.id,
          title: run.config.title,
          status,
          nextStage,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          clientRequestId: run.config.clientRequestId ?? null,
        };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async cancelRun(runId: string) {
    const run = await this.readRun(runId);
    if (run.publishedAt) throw new Error("이미 발행된 run은 취소할 수 없습니다.");
    if (!run.cancelledAt) {
      run.cancelledAt = new Date().toISOString();
      run.updatedAt = run.cancelledAt;
      await this.writeRun(run);
    }
    return { runId: run.id, cancelled: true, cancelledAt: run.cancelledAt };
  }

  private mergeCardDraftSubmission(run: ChatGptParityRun, value: unknown) {
    const submitted = cardsTextSubmissionSchema.parse(value);
    const activity = parseActivityDesignArtifact(run.artifacts["activity-design"]);
    const expectedCount = activity.activities.filter(
      (item) => item.includeInGeneration && item.supportLevel !== "unsupported" && item.recommendedType !== null,
    ).length;
    const patches = parseCardTextSegments(submitted.cardsText);
    run.cardDrafts ??= {};
    for (const [number, text] of patches) {
      if (number < 1 || number > expectedCount) {
        throw new Error(`CARD ${number}은 생성 대상 범위 1~${expectedCount} 밖입니다.`);
      }
      run.cardDrafts[String(number)] = text;
    }
    const missing = Array.from({ length: expectedCount }, (_, index) => index + 1)
      .filter((number) => !run.cardDrafts?.[String(number)]);
    if (missing.length > 0) {
      throw new Error(`아직 제출되지 않은 카드가 있습니다: ${missing.map((number) => `CARD ${number}`).join(", ")}`);
    }
    return {
      cardsText: Array.from({ length: expectedCount }, (_, index) => run.cardDrafts![String(index + 1)]).join("\n"),
    };
  }

  private buildStageInput(run: ChatGptParityRun, stage: ChatGptParityStage) {
    const outputSchema = schemaForStage(stage);
    const pdfReadingRule = run.config.files.some((file) => file.sourceId)
      ? "이 실행은 /study에 등록된 PDF입니다. 해당 요청의 선택 쪽을 get_study_generation_source_pages로 읽은 실제 글자만 근거로 사용하세요. 글자가 없는 쪽은 내용을 추측하지 마세요."
      : "현재 ChatGPT 대화에 첨부된 PDF를 직접 읽으세요. 로컬 MCP 서버에는 PDF 바이너리가 전달되지 않으므로 첨부 내용을 근거로 결과를 작성해야 합니다.";
    const common = {
      stage,
      instructions: instructionsForStage(stage),
      outputContract: z.toJSONSchema(outputSchema, {
        target: "draft-07",
        io: "input",
        unrepresentable: "any",
      }),
    };
    if (stage === "analyze") {
      return {
        ...common,
        input: {
          title: run.config.title,
          files: run.config.files,
          attachmentRule: pdfReadingRule,
          format:
            "파일마다 @file 파일명 줄을 쓰고, 목차는 # 제목 [시작-끝], ## 하위 제목 [페이지] 형식으로 작성하세요. 설명 문장은 넣지 마세요.",
        },
      };
    }
    const analysis = parseAnalysisArtifact(run.artifacts.analyze);
    const selectedOutline = selectOutline(analysis.sourceOutline!, run.selectedOutlineLeafIds);
    if (stage === "concept-tree") {
      return {
        ...common,
        userSelection: {
          selectedOutlineLeafIds: run.selectedOutlineLeafIds,
          availableLeafNodes: selectedOutline.nodes
            .filter((node) => getLeafIds(selectedOutline.nodes).includes(node.id))
            .map((node, index) => ({ number: index + 1, id: node.id, title: node.title, selected: node.selectedByDefault })),
          changeTool: "configure_chatgpt_pdf_run",
        },
        input: {
          learningGoal: run.config.learningGoal,
          instruction: run.config.instruction,
          selectedSourceOutline: selectedOutline,
          attachmentRule:
            `${pdfReadingRule} 선택된 목차 범위의 실제 내용을 다시 읽고 개념 관계만 트리로 작성하세요. 목차 순서를 복제하지 말고 의미 관계를 표현하되 선택 범위 밖으로 확장하지 마세요. 뒤에서 별도로 학습·판단해야 할 독립 내용은 한 노드의 출처에 섞어 넣지 마세요.`,
          format:
            "treeText 첫 줄은 최상위 개념, 이후는 '- [관계] 개념어 — 짧은 설명 (p.페이지) @목차(번호)' 형식입니다. 같은 페이지에 선택된 말단 목차가 여러 개면 @목차 번호를 반드시 적습니다. 하위 개념은 공백 두 칸씩 들여씁니다.",
        },
      };
    }
    const conceptTree = parseConceptTreeArtifact(run.artifacts["concept-tree"]);
    if (stage === "learning-design") {
      return {
        ...common,
        input: {
          title: run.config.title,
          learningGoal: run.config.learningGoal,
          instruction: run.config.instruction,
          conceptTree: conceptTree.nodes.map((node, index) => ({
            number: index + 1,
            parentNumber: node.parentId
              ? conceptTree.nodes.findIndex((candidate) => candidate.id === node.parentId) + 1
              : null,
            title: node.title,
            relation: node.relation,
            description: node.description,
            sourceRefs: node.sourceRefs,
          })),
          attachmentRule:
            `${pdfReadingRule} 개념트리를 기준으로 묶거나 나눕니다. PDF는 근거 문구와 실제 학습 가능 범위를 확인하는 데 사용하고 트리에 없는 학습 대상을 새로 만들지 마세요. 상위 개념의 출처를 그 아래 모든 독립 능력의 평가범위로 간주하지 마세요. 근거에는 PDF 실제 문구만 옮기고 요약은 학습내용에 쓰세요.`,
          format: learningDesignFormatExample,
        },
      };
    }
    const design = parseLearningDesignArtifact(run.artifacts["learning-design"]);
    if (stage === "activity-design") {
      const selectedDesign = selectLearningDesignObjectives(design.learningDesign, run.config.selectedObjectiveIds);
      return {
        ...common,
        input: {
          learningTargets: selectedDesign.knowledgeUnits.map((unit, index) => {
            const objective = selectedDesign.objectives.find(
              (candidate) => candidate.id === unit.objectiveId,
            )!;
            return {
              number: index + 1,
              content: unit.content,
              objective: objective.target,
              successCriterion: objective.successCriteria[0]?.description ?? "",
              sourceEvidence: unit.sourceText,
              concepts: getUnitConceptNodeIds(unit, conceptTree).map((id) => {
                const conceptIndex = conceptTree.nodes.findIndex((node) => node.id === id);
                const conceptNode = conceptTree.nodes[conceptIndex];
                return {
                  number: conceptIndex + 1,
                  title: conceptNode?.title ?? id,
                };
              }),
            };
          }),
          requestedAbilities: run.config.abilities ?? [],
          abilityRule: "사용자가 고른 능력을 형식 선택의 근거로 사용하세요. 해당 자료·학습목표에서 직접 확인할 수 없는 능력은 억지로 출제하지 말고 이유를 제한에 적으세요.",
          appCapabilities: {
            flashcard: "짧은 답 또는 자기채점형 설명·적용",
            cloze: "문맥 속 짧은 말 하나 직접 입력",
            trueFalse: "하나의 명확한 진술을 O/X로 판별",
            multipleChoice: "3~5개 선택지에서 하나를 구별",
            sequenceRecall: "고정 순서 3~8개를 선택지 또는 직접 입력으로 복원",
            structureRecall: "실제 상하·분류 구조 3~8개를 선택지 또는 직접 입력으로 복원",
          },
          format: activityDesignFormatExample,
        },
      };
    }
    const activity = parseActivityDesignArtifact(run.artifacts["activity-design"]);
    const includedActivities = activity.activities.filter(
      (item) => item.includeInGeneration && item.supportLevel !== "unsupported" && item.recommendedType !== null,
    );
    return {
      ...common,
      input: {
        instruction: run.config.instruction,
        sourceExpressionMode: run.config.sourceExpressionMode,
        problemDesigns: includedActivities.map((item, index) => {
          const blueprint = activity.learningDesign.assessmentBlueprints.find(
            (candidate) => candidate.id === item.blueprintId,
          )!;
          const unit = activity.learningDesign.knowledgeUnits.find(
            (candidate) => candidate.id === blueprint.knowledgeUnitId,
          )!;
          return {
            number: index + 1,
            learningContent: unit.content,
            sourceEvidence: unit.sourceText,
            relatedConcepts: (blueprint.conceptNodeIds ?? unit.conceptNodeIds ?? []).map((id) => {
              const node = conceptTree.nodes.find((candidate) => candidate.id === id);
              return { id, title: node?.title ?? id };
            }),
            given: blueprint.given,
            hidden: blueprint.hidden,
            expectedResponse: blueprint.expectedResponse,
            problemType: displayActivityType(
              item.recommendedType,
              activity.structureKinds[item.blueprintId],
            ),
            internalActivityType: item.recommendedType,
            structureKind: activity.structureKinds[item.blueprintId] ?? null,
            supportLevel: item.supportLevel,
            includeInGeneration: item.includeInGeneration,
            structureMode: activity.structureModes[item.blueprintId],
          };
        }),
        cardOrderRule:
          "cardsText의 CARD 번호는 includeInGeneration=true인 문제 설계의 순서를 1부터 매긴 값입니다. 앱 내부 ID는 카드 본문에 쓰지 마세요.",
        retryRule: Object.keys(run.cardDrafts ?? {}).length > 0
          ? `이전 카드 초안 ${Object.keys(run.cardDrafts ?? {}).sort((a, b) => Number(a) - Number(b)).join(", ")}번은 서버에 보존되어 있습니다. 오류 수정 시 해당 CARD 블록만 같은 번호로 다시 제출할 수 있습니다.`
          : "첫 제출에서는 생성 대상 카드 전체를 제출하세요. 검증 실패 후에는 오류 CARD 블록만 같은 번호로 다시 제출할 수 있습니다.",
        format: cardsFormatExample,
      },
    };
  }

  private validateAndMaterialize(
    run: ChatGptParityRun,
    stage: ChatGptParityStage,
    value: unknown,
  ) {
    if (stage === "analyze") {
      return materializeOutlineDraft(run, value);
    }
    if (stage === "concept-tree") {
      return materializeConceptTreeArtifact(run, value);
    }
    if (stage === "learning-design") {
      const conceptTree = parseConceptTreeArtifact(run.artifacts["concept-tree"]);
      const submitted = learningDesignTextSchema.parse(value);
      const learningDesign = materializeLearningDesignText(
        submitted.learningDesignText,
        conceptTree,
        run.selectedOutlineLeafIds,
      );
      const analysisArtifact = parseAnalysisArtifact(run.artifacts.analyze);
      const selectedOutline = selectOutline(
        analysisArtifact.sourceOutline!,
        run.selectedOutlineLeafIds,
      );
      const studyGuideline = JSON.stringify(buildStudyGuideline(run, selectedOutline));
      const generateInput = buildGenerateInput(run, studyGuideline);
      const analysis = adaptLearningDesignToAnalysis(learningDesign, generateInput);
      return {
        learningDesignText: submitted.learningDesignText,
        learningDesign,
        analysis,
        organizedMaterial: buildReviewMaterial(generateInput, analysis),
      } satisfies LearningDesignArtifact;
    }
    if (stage === "activity-design") {
      const design = parseLearningDesignArtifact(run.artifacts["learning-design"]);
      const conceptTree = parseConceptTreeArtifact(run.artifacts["concept-tree"]);
      const submitted = activityDesignTextSchema.parse(value);
      return materializeActivityDesignText(
        submitted.activityDesignText,
        selectLearningDesignObjectives(design.learningDesign, run.config.selectedObjectiveIds),
        conceptTree,
        run.selectedOutlineLeafIds,
      );
    }
    const design = parseLearningDesignArtifact(run.artifacts["learning-design"]);
    const activity = parseActivityDesignArtifact(run.artifacts["activity-design"]);
    const submitted = cardsTextSubmissionSchema.parse(value);
    const generated = materializeCardsTextSubmission(
      submitted,
      activity.learningDesign,
      activity.activities,
      activity.structureModes,
    );
    const { activityDesign, cards } = materializeLearningPlanGeneration(
      generated,
      activity.learningDesign,
      design.analysis,
    );
    return { generated, activityDesign, cards };
  }

  private async readRun(runId: string) {
    const filePath = path.join(this.runRoot, safeId(runId), "run.json");
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as ChatGptParityRun;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`ChatGPT MCP run을 찾을 수 없습니다: ${runId}`);
      }
      throw error;
    }
  }

  private async checkLearningEvidence(run: ChatGptParityRun, artifact: LearningDesignArtifact): Promise<EvidenceCheck[]> {
    const tree = parseConceptTreeArtifact(run.artifacts["concept-tree"]);
    const pageTexts = new Map<string, Map<number, string>>();
    const unitPages = new Map<string, Map<string, number[]>>();
    for (const file of run.config.files) {
      const units = artifact.learningDesign.knowledgeUnits.filter((unit) => unit.sourceId === file.fileName);
      if (!units.length) continue;
      const perUnit = new Map<string, number[]>();
      for (const unit of units) {
        const pages = tree.nodes.filter((node) => unit.conceptNodeIds?.includes(node.id))
          .flatMap((node) => node.sourceRefs.filter((ref) => ref.fileName === file.fileName).flatMap((ref) => ref.pageNumbers));
        perUnit.set(unit.id, [...new Set([unit.sourcePage, ...pages])]);
      }
      unitPages.set(file.fileName, perUnit);
      if (!file.sourceId) continue; // Old comparison runs had no locally registered PDF; leave them untouched.
      const bytes = await readRegisteredMcpSourcePdf(file.sourceId);
      if (!bytes) throw new Error(`${file.fileName}의 등록된 원본 PDF를 확인할 수 없습니다.`);
      pageTexts.set(file.fileName, await extractPdfPageTexts(bytes, [...perUnit.values()].flat()));
    }
    return inspectSourceEvidence(artifact.learningDesign.knowledgeUnits, pageTexts, unitPages);
  }

  private async verifiedRunFile(runId: string): Promise<string> {
    const [root, file] = await Promise.all([
      realpath(this.runRoot),
      realpath(path.join(this.runRoot, safeId(runId), "run.json")),
    ]);
    if (!file.startsWith(root + path.sep) || (await stat(file)).size > 24 * 1024 * 1024) {
      throw new Error("허용된 MCP run 저장 경로 또는 파일 크기를 벗어났습니다.");
    }
    return file;
  }

  private async writeRun(run: ChatGptParityRun) {
    const directory = path.join(this.runRoot, safeId(run.id));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
}

function parseOutlineText(
  outlineText: string,
  configuredFiles: Array<{ fileName: string; pageCount?: number }>,
) {
  const expectedNames = new Set(configuredFiles.map((file) => file.fileName));
  const itemsByFile = new Map<string, Array<{
    title: string;
    depth: number;
    pageStart: number;
    pageEnd?: number;
  }>>();
  let currentFileName = configuredFiles.length === 1 ? configuredFiles[0].fileName : undefined;
  const lines = outlineText.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const fileMatch = /^@file\s+(.+)$/i.exec(line);
    if (fileMatch) {
      const declaredName = fileMatch[1].trim().replace(/^["']|["']$/g, "");
      if (!expectedNames.has(declaredName)) {
        throw new Error(`${index + 1}번째 줄의 PDF 파일명이 등록된 파일과 다릅니다: ${declaredName}`);
      }
      currentFileName = declaredName;
      if (!itemsByFile.has(declaredName)) itemsByFile.set(declaredName, []);
      return;
    }
    if (!currentFileName) {
      throw new Error(`${index + 1}번째 줄 앞에 @file 파일명이 필요합니다.`);
    }
    const headingMatch = /^(#{1,8})\s+(.+?)\s+\[(?:p(?:p)?\.?\s*)?(\d+)(?:\s*[-–—~]\s*(\d+))?\]\s*$/i.exec(line);
    if (!headingMatch) {
      throw new Error(
        `${index + 1}번째 줄은 '# 제목 [페이지]' 또는 '## 제목 [시작-끝]' 형식이어야 합니다.`,
      );
    }
    const items = itemsByFile.get(currentFileName) ?? [];
    if (items.length >= 120) {
      throw new Error(`${currentFileName}의 목차 항목은 최대 120개까지 받을 수 있습니다.`);
    }
    const pageStart = Number(headingMatch[3]);
    const parsedEnd = headingMatch[4] ? Number(headingMatch[4]) : undefined;
    items.push({
      title: headingMatch[2].trim(),
      depth: headingMatch[1].length,
      pageStart,
      ...(parsedEnd === undefined ? {} : { pageEnd: parsedEnd }),
    });
    itemsByFile.set(currentFileName, items);
  });

  return {
    files: configuredFiles.map((file) => {
      const items = itemsByFile.get(file.fileName) ?? [];
      if (items.length === 0) throw new Error(`${file.fileName}의 목차 항목이 없습니다.`);
      return { fileName: file.fileName, items };
    }),
  };
}

function materializeOutlineDraft(run: ChatGptParityRun, value: unknown) {
  const submitted = outlineTextSchema.parse(value);
  const draft = parseOutlineText(submitted.outlineText, run.config.files);
  const expectedNames = run.config.files.map((file) => file.fileName);
  const submittedNames = draft.files.map((file) => file.fileName);
  assertUnique(submittedNames, "PDF 파일명");
  if (JSON.stringify([...expectedNames].sort()) !== JSON.stringify([...submittedNames].sort())) {
    throw new Error("목차 결과의 파일명이 시작할 때 등록한 PDF 목록과 다릅니다.");
  }

  const draftByName = new Map(draft.files.map((file) => [file.fileName, file]));
  const files = run.config.files.map((configuredFile) => {
    const file = draftByName.get(configuredFile.fileName);
    if (!file) throw new Error(`목차 결과에서 PDF를 찾을 수 없습니다: ${configuredFile.fileName}`);
    const ancestorIds = new Map<number, string>();
    const nodes = file.items.map((item, index) => {
      const pageEnd = item.pageEnd ?? item.pageStart;
      if (pageEnd < item.pageStart) {
        throw new Error(`${file.fileName}의 목차 페이지 범위가 뒤집혀 있습니다: ${item.title}`);
      }
      if (configuredFile.pageCount && pageEnd > configuredFile.pageCount) {
        throw new Error(`${file.fileName}의 페이지 수를 벗어난 목차 항목입니다: ${item.title}`);
      }
      const id = `outline-${index + 1}`;
      const parentDepth = [...ancestorIds.keys()]
        .filter((depth) => depth < item.depth)
        .sort((left, right) => right - left)[0];
      const parentId = parentDepth ? ancestorIds.get(parentDepth) ?? null : null;
      for (const depth of [...ancestorIds.keys()]) {
        if (depth >= item.depth) ancestorIds.delete(depth);
      }
      ancestorIds.set(item.depth, id);
      return {
        id,
        parentId,
        order: index + 1,
        title: item.title,
        summary: "",
        sourceRefs: [{
          fileName: file.fileName,
          pageNumbers: Array.from(
            { length: pageEnd - item.pageStart + 1 },
            (_, offset) => item.pageStart + offset,
          ),
        }],
        sourceEvidence: "",
        selectedByDefault: true,
        structureTags: [],
        importance: 0 as const,
      };
    });
    const outlineTitle = run.config.files.length === 1
      ? run.config.title
      : path.parse(file.fileName).name;
    return {
      fileName: file.fileName,
      documentType: "PDF 학습자료",
      summary: "",
      keyTopics: [],
      outline: nodes.map((node) => ({ heading: node.title, points: [] })),
      sourceOutline: {
        title: outlineTitle,
        summary: "",
        nodes,
      },
      suggestedRole: "학습자료",
    };
  });

  return pdfAnalysisResponseSchema.parse({
    files,
    sourceOutline: combineSourceOutlines(files),
  });
}

const learningDesignFormatExample = [
  "learningDesignText에 다음 자연어 블록을 반복합니다.",
  "--- LEARNING 1 ---",
  "개념: 2, 3, 4",
  "학습내용: 함께 묶어 익힐 의미 있는 내용",
  "학습목표: 학습자가 달성해야 할 목표",
  "성공기준: 학습내용과 같은 능력·범위를 원문 근거로 확인하는 기준 하나",
  "근거: PDF의 짧은 실제 문구 (여러 구절이면 ||로 구분; 쪽 표기는 끝의 (PDF 2쪽)처럼 별도 기입)",
  "종류: 용어 | 사실 | 개념 | 관계 | 절차 | 공식 | 문제해결 | 기타",
  "이유: 이 노드들을 묶거나 나눈 이유",
  "중요도: 0 | 1 | 2 | 3",
].join("\n");

const activityDesignFormatExample = [
  "activityDesignText에 다음 자연어 블록을 반복합니다. 학습대상 하나에 서로 다른 확인 행동이 필요할 때만 2~3개를 만듭니다.",
  "--- DESIGN 1 ---",
  "학습대상: 1",
  "관련개념: 전체 | 2, 4",
  "관계: 직접 | 보조 | 대리",
  "보여줄 것: 문제에서 학습자에게 제공할 정보",
  "감출 것: 학습자가 직접 답해야 할 내용",
  "응답: 짧은답 | 구조답 | 단일선택 | 복수선택 | 순서구조 | 계층구조 | 숫자 | 코드 | 그림표시 | 음성 | 체크목록",
  "채점: 정확 | 의미 | 규칙 | 자기채점",
  "단서: 많음 | 보통 | 적음",
  "문제방식: 플래시카드 | 빈칸 | OX | 객관식 | 순서복원 | 구조복원 | 미지원",
  "풀이방식: 선택지 | 직접입력 | 해당없음",
  "이유: 이 문제 설계가 목표를 확인하는 이유",
  "제한: 완전히 확인하지 못하는 부분이 있으면 짧게 작성",
].join("\n");

const cardsFormatExample = [
  "cardsText에 생성 대상으로 확정된 문제만 다음 형식으로 씁니다.",
  "--- CARD 1 ---",
  "유형: 플래시카드 | 빈칸 | OX | 객관식 | 순서복원 | 구조복원",
  "질문: 실제 질문",
  "정답: 실제 정답",
  "선택지:",
  "- 객관식일 때만 3~5개",
  "구조:",
  "- 구조·순서 복원일 때만 3~8개",
  "해설: 필요한 설명",
  "근거: 학습대상의 원문 근거에 실제 포함된 짧은 구절",
].join("\n");

function materializeConceptTreeArtifact(
  run: ChatGptParityRun,
  value: unknown,
): ConceptTreeArtifact {
  const submitted = conceptTreeTextSchema.parse(value);
  const lineHints = submitted.treeText.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    const match = line.match(/\s+@목차\((\d+(?:\s*,\s*\d+)*)\)\s*$/);
    return {
      cleanLine: match ? line.slice(0, match.index).trimEnd() : line,
      numbers: match ? [...new Set(match[1].split(",").map((part) => Number(part.trim())))] : null,
    };
  });
  const nodes = parseConceptTreeOutline(lineHints.map((line) => line.cleanLine).join("\n"), run.config.files);
  if (!nodes.some((node) => node.depth > 0)) {
    throw new Error("맨 위 개념만 있는 개념 구조는 학습 설계에 사용할 수 없습니다. 원문에서 하위 개념을 하나 이상 찾아 '- 개념어 (p.쪽번호)' 형식으로 추가해 주세요.");
  }
  const analysis = parseAnalysisArtifact(run.artifacts.analyze);
  const selectedOutline = selectOutline(analysis.sourceOutline!, run.selectedOutlineLeafIds);
  const selectedLeaves = selectedOutline.nodes.filter((node) => node.selectedByDefault);
  const allowedPages = new Map<string, Set<number>>();
  for (const node of selectedLeaves) {
    for (const ref of node.sourceRefs ?? []) {
      const fileName = ref.fileName;
      if (!fileName) continue;
      const pages = allowedPages.get(fileName) ?? new Set<number>();
      for (const page of ref.pageNumbers ?? []) pages.add(page);
      allowedPages.set(fileName, pages);
    }
  }
  const mapped = nodes.map((node, index) => {
    if (node.depth > 0 && node.sourceRefs.length === 0) {
      throw new Error(`개념 '${node.title}'에 PDF 페이지 근거가 필요합니다.`);
    }
    for (const ref of node.sourceRefs) {
      const allowed = allowedPages.get(ref.fileName);
      if (!allowed || ref.pageNumbers.some((page) => !allowed.has(page))) {
        throw new Error(`개념 '${node.title}'의 페이지가 선택한 원문 목차 범위를 벗어났습니다.`);
      }
    }
    const pageMatchedLeaves = node.sourceRefs.length === 0 ? selectedLeaves : selectedLeaves
        .filter((outlineNode) => (outlineNode.sourceRefs ?? []).some((outlineRef) => {
          const outlineFileName = outlineRef.fileName;
          return node.sourceRefs.some((conceptRef) =>
            conceptRef.fileName === outlineFileName &&
            conceptRef.pageNumbers.some((page) => outlineRef.pageNumbers?.includes(page))
          );
        }));
    const explicitNumbers = lineHints[index]?.numbers;
    if (!explicitNumbers && node.sourceRefs.length > 0 && pageMatchedLeaves.length > 1) {
      throw new Error(`개념 '${node.title}'은 같은 페이지의 선택 목차 ${pageMatchedLeaves.length}개와 겹칩니다. @목차(번호)로 실제 연결을 명시하세요.`);
    }
    const explicitLeaves = explicitNumbers?.map((number) => {
      const leaf = selectedLeaves[number - 1];
      if (!leaf) throw new Error(`개념 '${node.title}'의 @목차(${number})가 선택한 말단 목차 범위를 벗어났습니다.`);
      return leaf;
    });
    if (explicitLeaves?.some((leaf) => !pageMatchedLeaves.includes(leaf))) {
      throw new Error(`개념 '${node.title}'의 @목차 번호가 실제 PDF 페이지 근거와 맞지 않습니다.`);
    }
    const outlineNodeIds = (explicitLeaves ?? pageMatchedLeaves).map((leaf) => leaf.id);
    if (outlineNodeIds.length === 0) {
      throw new Error(`개념 '${node.title}'을 선택한 원문 목차와 연결할 수 없습니다.`);
    }
    return { ...node, outlineNodeIds: [...new Set(outlineNodeIds)] };
  });
  return {
    treeText: submitted.treeText,
    nodes: mapped,
    warnings: [],
  };
}

function materializeLearningDesignText(
  text: string,
  conceptTree: ConceptTreeArtifact,
  selectedOutlineLeafIds: string[],
): LearningDesignBase {
  const blocks = parseNumberedTextBlocks(text, "LEARNING", "학습 설계");
  if (blocks.length > 60) throw new Error("학습 대상은 최대 60개까지 만들 수 있습니다.");
  const selected = new Set(selectedOutlineLeafIds);
  const objectives: LearningDesignPlan["objectives"] = [];
  const knowledgeUnits: LearningDesignPlan["knowledgeUnits"] = [];
  const signatures = new Set<string>();

  blocks.forEach((block, index) => {
    const conceptNumbers = parseNumberList(block.require("개념"), "개념");
    const conceptNodes = conceptNumbers.map((number) => {
      const node = conceptTree.nodes[number - 1];
      if (!node) throw new Error(`${index + 1}번 학습 설계가 없는 개념 ${number}번을 참조합니다.`);
      return node;
    });
    const outlineNodeIds = [...new Set(conceptNodes.flatMap((node) => node.outlineNodeIds))];
    if (outlineNodeIds.some((id) => !selected.has(id))) {
      throw new Error(`${index + 1}번 학습 설계가 선택하지 않은 원문 목차를 참조합니다.`);
    }
    const target = block.require("학습목표");
    const signature = `${[...conceptNumbers].sort((a, b) => a - b).join(",")}:${normalize(target)}`;
    if (signatures.has(signature)) throw new Error(`${index + 1}번 학습 설계가 앞선 대상과 중복됩니다.`);
    signatures.add(signature);
    const objectiveId = `objective-${index + 1}`;
    const criterionId = `criterion-${index + 1}-1`;
    const sourceRef = conceptNodes.flatMap((node) => node.sourceRefs)
      .find((ref) => ref.pageNumbers.length > 0);
    if (!sourceRef) {
      throw new Error(`${index + 1}번 학습 설계는 쪽 근거가 있는 개념을 가리켜야 합니다. 맨 위 개념만 가리키지 말고 실제 내용이 있는 하위 개념 번호를 쓰세요.`);
    }
    objectives.push({
      id: objectiveId,
      outlineNodeIds,
      target,
      // 기존 공용 계약과 저장 데이터 호환을 위한 내부값입니다. MCP 입출력과 지원 판정에는 사용하지 않습니다.
      terminalOperation: "recall",
      successCriteria: [{
        id: criterionId,
        description: block.require("성공기준"),
        required: true,
      }],
      importance: parseImportance(block.require("중요도")),
    });
    knowledgeUnits.push({
      id: `knowledge-unit-${index + 1}`,
      objectiveId,
      outlineNodeIds,
      content: block.require("학습내용"),
      sourceId: sourceRef.fileName,
      sourcePage: sourceRef.pageNumbers[0],
      sourceRange: `PDF ${sourceRef.pageNumbers.join(", ")}쪽 / ${conceptNodes.map((node) => node.title).join(" / ")}`,
      sourceText: block.require("근거"),
      knowledgeType: parseKnowledgeType(block.require("종류")),
      rationale: block.require("이유"),
      conceptNodeIds: conceptNodes.map((node) => node.id),
    });
  });
  return { objectives, knowledgeUnits, assessmentBlueprints: [] };
}

function materializeActivityDesignText(
  text: string,
  base: LearningDesignBase,
  conceptTree: ConceptTreeArtifact,
  selectedOutlineLeafIds: string[],
): ActivityDesignArtifact {
  const blocks = parseNumberedTextBlocks(text, "DESIGN", "문제 설계");
  const counts = new Map<number, number>();
  const designSignatures = new Set<string>();
  const blueprints: AssessmentBlueprint[] = [];
  const activities: z.infer<typeof learningPlanGenerationSchema>["activities"] = [];
  const structureModes: Record<string, "word_bank" | "free_input"> = {};
  const structureKinds: Record<string, "sequence" | "hierarchy"> = {};

  blocks.forEach((block, index) => {
    const targetNumber = parseSingleNumber(block.require("학습대상"), "학습대상");
    const unit = base.knowledgeUnits[targetNumber - 1];
    if (!unit) throw new Error(`${index + 1}번 문제 설계가 없는 학습대상 ${targetNumber}번을 참조합니다.`);
    const count = (counts.get(targetNumber) ?? 0) + 1;
    if (count > 3) throw new Error(`학습대상 ${targetNumber}번에는 문제 설계를 최대 3개까지 만들 수 있습니다.`);
    counts.set(targetNumber, count);
    const objective = base.objectives.find((candidate) => candidate.id === unit.objectiveId)!;
    const blueprintId = `blueprint-${index + 1}`;
    const responseKind = parseResponseKind(block.require("응답"));
    const relationToObjective = parseRelation(block.require("관계"));
    const conceptNodeIds = parseRelatedConceptNodeIds(
      block.require("관련개념"),
      unit,
      conceptTree,
    );
    const activityChoice = parseActivityChoice(block.require("문제방식"));
    const compatibilityOperation = compatibilityOperationForActivity(
      activityChoice.activityType,
      responseKind,
    );
    const designSignature = [
      targetNumber,
      normalize(block.require("보여줄 것")),
      normalize(block.require("감출 것")),
    ].join(":");
    if (designSignatures.has(designSignature)) {
      throw new Error(`${index + 1}번 문제 설계가 같은 제시 정보와 답을 반복합니다.`);
    }
    designSignatures.add(designSignature);
    const requiredCapabilities = requiredCapabilitiesFor(responseKind);
    const blueprint: AssessmentBlueprint = {
      id: blueprintId,
      objectiveId: objective.id,
      knowledgeUnitId: unit.id,
      relationToObjective,
      // 기존 공용 계약과 저장 데이터 호환을 위한 내부값입니다. MCP 입출력과 지원 판정에는 사용하지 않습니다.
      elicitedOperation: compatibilityOperation,
      coverageCriterionIds: objective.successCriteria.map((criterion) => criterion.id),
      given: [{
        type: ["single_choice", "multiple_choice"].includes(responseKind) ? "context" : "instruction",
        description: block.require("보여줄 것"),
      }],
      hidden: [{ description: block.require("감출 것"), reason: "target_answer" }],
      expectedResponse: { kind: responseKind, description: block.require("감출 것") },
      scoringRubric: objective.successCriteria.map((criterion) => ({
        criterionId: criterion.id,
        description: criterion.description,
        weight: 1,
        gradingMode: parseGradingMode(block.require("채점")),
      })),
      difficulty: {
        cueLevel: parseCueLevel(block.require("단서")),
        responseComplexity: ["ordered_structure", "unordered_structure", "checklist"].includes(responseKind)
          ? "multi_part"
          : "atomic",
        transferDistance: "same_context",
      },
      requiredCapabilities,
      conceptNodeIds,
    };
    blueprints.push(blueprint);

    const recommendedType = activityChoice.activityType;
    if (!recommendedType) {
      activities.push({
        blueprintId,
        recommendedType: null,
        supportLevel: "unsupported",
        reason: block.require("이유"),
        limitation: block.optional("제한") || "현재 앱에서 직접 지원하는 문제 형식이 없습니다.",
        includeInGeneration: false,
      });
      return;
    }
    const practiceBlueprint: PracticeBlueprint = {
      ...blueprint,
      learningUnitId: unit.id,
      recommendedType,
    };
    const assessment = assessMcpToolSupport(practiceBlueprint, recommendedType);
    const supportLevel = assessment.level === "exact"
      ? "exact" as const
      : assessment.level === "scaffold" ? "scaffold" as const : "unsupported" as const;
    activities.push({
      blueprintId,
      recommendedType,
      supportLevel,
      reason: `${block.require("이유")} ${assessment.rationale}`.trim(),
      limitation: block.optional("제한") || assessment.missingCapabilities.join(", "),
      includeInGeneration: shouldIncludeAssessment(assessment),
    });
    if (recommendedType === "structure_recall") {
      const expectedKind = responseKind === "ordered_structure"
        ? "sequence"
        : responseKind === "unordered_structure" ? "hierarchy" : null;
      if (!expectedKind || activityChoice.structureKind !== expectedKind) {
        throw new Error(
          `${index + 1}번 문제 설계의 응답 방식과 문제방식이 다릅니다. 순서구조는 순서복원, 계층구조는 구조복원으로 확정하세요.`,
        );
      }
      structureKinds[blueprintId] = expectedKind;
      structureModes[blueprintId] = parseStructureMode(block.require("풀이방식"));
    }
  });

  for (let index = 1; index <= base.knowledgeUnits.length; index += 1) {
    if (!counts.has(index)) throw new Error(`학습대상 ${index}번의 문제 설계가 없습니다.`);
  }
  ensureIncludedTargetCoverage(base, blueprints, activities, structureModes, structureKinds);
  const learningDesign: LearningDesignPlan = {
    objectives: base.objectives,
    knowledgeUnits: base.knowledgeUnits,
    assessmentBlueprints: blueprints,
  };
  validateLearningDesignPlan(learningDesign, selectedOutlineLeafIds);
  return { activityDesignText: text, learningDesign, activities, structureModes, structureKinds };
}

function ensureIncludedTargetCoverage(
  base: LearningDesignBase,
  blueprints: AssessmentBlueprint[],
  activities: z.infer<typeof learningPlanGenerationSchema>["activities"],
  structureModes: Record<string, "word_bank" | "free_input">,
  structureKinds: Record<string, "sequence" | "hierarchy">,
) {
  for (const unit of base.knowledgeUnits) {
    const indexes = blueprints.flatMap((blueprint, index) =>
      blueprint.knowledgeUnitId === unit.id ? [index] : []
    );
    const hasIncluded = indexes.some((index) => {
      const activity = activities[index];
      return activity?.includeInGeneration &&
        activity.supportLevel !== "unsupported" &&
        activity.recommendedType !== null;
    });
    if (hasIncluded || indexes.length === 0) continue;

    const index = indexes[0];
    const previous = blueprints[index];
    const objective = base.objectives.find((candidate) => candidate.id === unit.objectiveId)!;
    const criteria = objective.successCriteria.filter((criterion) => criterion.required);
    const relationToObjective = "scaffold" as const;
    const fallback: AssessmentBlueprint = {
      id: previous.id,
      objectiveId: objective.id,
      knowledgeUnitId: unit.id,
      relationToObjective,
      elicitedOperation: "recall",
      coverageCriterionIds: criteria.map((criterion) => criterion.id),
      given: [{
        type: "instruction",
        description: `다음 학습내용의 핵심 원리나 판단 절차를 설명하세요: ${unit.content}`,
      }],
      hidden: [{
        description: criteria.map((criterion) => criterion.description).join(" / "),
        reason: "target_answer",
      }],
      expectedResponse: {
        kind: "short_text",
        description: criteria.map((criterion) => criterion.description).join(" / "),
      },
      scoringRubric: criteria.map((criterion) => ({
        criterionId: criterion.id,
        description: criterion.description,
        weight: 1,
        gradingMode: "self" as const,
      })),
      difficulty: {
        cueLevel: "medium",
        responseComplexity: criteria.length > 1 ? "multi_part" : "atomic",
        transferDistance: "same_context",
      },
      requiredCapabilities: [],
      conceptNodeIds: previous.conceptNodeIds?.length
        ? previous.conceptNodeIds
        : unit.conceptNodeIds,
    };
    const practiceBlueprint: PracticeBlueprint = {
      ...fallback,
      learningUnitId: unit.id,
      recommendedType: "flashcard",
    };
    const assessment = assessMcpToolSupport(practiceBlueprint, "flashcard");
    blueprints[index] = fallback;
    activities[index] = {
      blueprintId: fallback.id,
      recommendedType: "flashcard",
      supportLevel: assessment.level === "exact" ? "exact" : "scaffold",
      reason: `기존 설계가 모두 생성 대상에서 제외되어 학습대상 누락을 막기 위한 자동 보조 문제입니다. ${assessment.rationale}`,
      limitation: "최종 수행을 직접 평가하지 않고 필요한 핵심 원리의 회상을 보조합니다.",
      includeInGeneration: true,
    };
    delete structureModes[fallback.id];
    delete structureKinds[fallback.id];
  }
}

function parseNumberedTextBlocks(text: string, marker: string, label: string) {
  const expression = new RegExp(`^--- ${marker} (\\d+) ---\\s*$`, "gim");
  const matches = [...text.replace(/\r\n?/g, "\n").matchAll(expression)];
  if (matches.length === 0) throw new Error(`${label}에 --- ${marker} 1 --- 경계가 필요합니다.`);
  return matches.map((match, index) => {
    const number = Number(match[1]);
    if (number !== index + 1) throw new Error(`${label} 번호는 1부터 순서대로 이어져야 합니다: ${number}`);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    return makeTextBlock(text.slice(start, end).trim(), number);
  });
}

function parseNumberList(value: string, label: string) {
  const numbers = value.split(",").map((part) => Number(part.trim()));
  if (numbers.length === 0 || numbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error(`${label}은 쉼표로 구분한 번호여야 합니다.`);
  }
  return [...new Set(numbers)];
}

function parseSingleNumber(value: string, label: string) {
  const number = Number(value.trim());
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label}은 하나의 번호여야 합니다.`);
  return number;
}

function getUnitConceptNodeIds(
  unit: LearningDesignPlan["knowledgeUnits"][number],
  conceptTree: ConceptTreeArtifact,
) {
  const knownIds = new Set(conceptTree.nodes.map((node) => node.id));
  const stored = (unit.conceptNodeIds ?? []).filter((id) => knownIds.has(id));
  if (stored.length > 0) return [...new Set(stored)];

  const titles = new Set(
    unit.sourceRange
      .split("/")
      .map((value) => normalize(value))
      .filter(Boolean),
  );
  const inferred = conceptTree.nodes
    .filter((node) => titles.has(normalize(node.title)))
    .map((node) => node.id);
  if (inferred.length === 0) {
    throw new Error(`${unit.id}에 연결된 개념 노드를 찾지 못했습니다.`);
  }
  return inferred;
}

function parseRelatedConceptNodeIds(
  value: string,
  unit: LearningDesignPlan["knowledgeUnits"][number],
  conceptTree: ConceptTreeArtifact,
) {
  const allowedIds = getUnitConceptNodeIds(unit, conceptTree);
  const normalized = normalize(value).replace(/\s+/g, "");
  if (["전체", "all"].includes(normalized)) return allowedIds;

  const numbers = parseNumberList(value, "관련개념");
  const ids = numbers.map((number) => {
    const node = conceptTree.nodes[number - 1];
    if (!node) throw new Error(`관련개념이 없는 개념 ${number}번을 참조합니다.`);
    return node.id;
  });
  const allowed = new Set(allowedIds);
  const outside = ids.find((id) => !allowed.has(id));
  if (outside) {
    const index = conceptTree.nodes.findIndex((node) => node.id === outside) + 1;
    throw new Error(`관련개념 ${index}번은 해당 학습대상에 포함되지 않습니다.`);
  }
  return [...new Set(ids)];
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function parseKnowledgeType(value: string): KnowledgeType {
  const normalized = normalize(value);
  const mapping: Record<string, KnowledgeType> = {
    "용어": "vocabulary", "사실": "fact", "개념": "concept", "관계": "relationship",
    "절차": "procedure", "공식": "formula", "문제해결": "problem_solving_pattern", "기타": "other",
    "vocabulary": "vocabulary", "fact": "fact", "concept": "concept", "relationship": "relationship",
    "procedure": "procedure", "formula": "formula", "problem_solving_pattern": "problem_solving_pattern", "other": "other",
  };
  const result = mapping[normalized];
  if (!result) throw new Error(`지원하지 않는 학습내용 종류입니다: ${value}`);
  return result;
}

function parseImportance(value: string): 0 | 1 | 2 | 3 {
  const number = Number(value.trim());
  if (![0, 1, 2, 3].includes(number)) throw new Error("중요도는 0~3이어야 합니다.");
  return number as 0 | 1 | 2 | 3;
}

function parseRelation(value: string): "direct" | "scaffold" | "proxy" {
  const normalized = normalize(value);
  if (["직접", "direct"].includes(normalized)) return "direct";
  if (["보조", "scaffold"].includes(normalized)) return "scaffold";
  if (["대리", "proxy"].includes(normalized)) return "proxy";
  throw new Error(`지원하지 않는 목표 관계입니다: ${value}`);
}

function parseResponseKind(value: string): AssessmentBlueprint["expectedResponse"]["kind"] {
  const normalized = normalize(value).replace(/\s+/g, "");
  const mapping: Record<string, AssessmentBlueprint["expectedResponse"]["kind"]> = {
    "짧은답": "short_text", "구조답": "structured_text", "단일선택": "single_choice",
    "복수선택": "multiple_choice", "순서구조": "ordered_structure", "계층구조": "unordered_structure",
    "숫자": "numeric", "코드": "code", "그림표시": "graph_annotation", "음성": "audio", "체크목록": "checklist",
  };
  const result = mapping[normalized];
  if (!result) throw new Error(`지원하지 않는 응답 방식입니다: ${value}`);
  return result;
}

function parseGradingMode(value: string): AssessmentBlueprint["scoringRubric"][number]["gradingMode"] {
  const normalized = normalize(value);
  if (["정확", "exact"].includes(normalized)) return "exact";
  if (["의미", "semantic"].includes(normalized)) return "semantic";
  if (["규칙", "rule"].includes(normalized)) return "rule";
  if (["자기채점", "self"].includes(normalized)) return "self";
  throw new Error(`지원하지 않는 채점 방식입니다: ${value}`);
}

function parseCueLevel(value: string): AssessmentBlueprint["difficulty"]["cueLevel"] {
  const normalized = normalize(value);
  if (["많음", "high"].includes(normalized)) return "high";
  if (["보통", "medium"].includes(normalized)) return "medium";
  if (["적음", "low"].includes(normalized)) return "low";
  throw new Error(`지원하지 않는 단서 수준입니다: ${value}`);
}

function parseActivityChoice(value: string): {
  activityType: LearningActivityType | null;
  structureKind?: "sequence" | "hierarchy";
} {
  const normalized = normalize(value).replace(/\s+/g, "");
  if (["플래시카드", "flashcard"].includes(normalized)) return { activityType: "flashcard" };
  if (["빈칸", "cloze"].includes(normalized)) return { activityType: "cloze" };
  if (["ox", "o/x", "true_false"].includes(normalized)) return { activityType: "true_false" };
  if (["객관식", "multiple_choice"].includes(normalized)) return { activityType: "multiple_choice" };
  if (["순서복원", "sequence"].includes(normalized)) {
    return { activityType: "structure_recall", structureKind: "sequence" };
  }
  if (["구조복원", "hierarchy"].includes(normalized)) {
    return { activityType: "structure_recall", structureKind: "hierarchy" };
  }
  if (["미지원", "unsupported"].includes(normalized)) return { activityType: null };
  throw new Error(`지원하지 않는 문제 방식입니다: ${value}`);
}

function displayActivityType(
  activityType: LearningActivityType | null,
  structureKind?: "sequence" | "hierarchy",
) {
  if (activityType === "structure_recall") {
    return structureKind === "sequence" ? "순서복원" : "구조복원";
  }
  const labels: Record<LearningActivityType, string> = {
    flashcard: "플래시카드",
    cloze: "빈칸",
    true_false: "OX",
    multiple_choice: "객관식",
    structure_recall: "구조복원",
  };
  return activityType ? labels[activityType] : "미지원";
}

function parseStructureMode(value: string): "word_bank" | "free_input" {
  const normalized = normalize(value).replace(/\s+/g, "");
  if (["선택지", "word_bank"].includes(normalized)) return "word_bank";
  if (["직접입력", "free_input"].includes(normalized)) return "free_input";
  throw new Error(`구조·순서 복원 풀이방식은 선택지 또는 직접입력이어야 합니다: ${value}`);
}

function requiredCapabilitiesFor(
  responseKind: AssessmentBlueprint["expectedResponse"]["kind"],
) {
  return ["code", "graph_annotation", "audio", "checklist", "numeric"].includes(responseKind)
    ? [responseKind]
    : [];
}

function compatibilityOperationForActivity(
  activityType: LearningActivityType | null,
  responseKind: AssessmentBlueprint["expectedResponse"]["kind"],
): LearningOperation {
  if (
    activityType === "structure_recall" ||
    ["ordered_structure", "unordered_structure"].includes(responseKind)
  ) {
    return "reconstruct";
  }
  if (
    activityType === "true_false" ||
    activityType === "multiple_choice" ||
    ["single_choice", "multiple_choice"].includes(responseKind)
  ) {
    return "discriminate";
  }
  return "recall";
}

function expectedResponseCapability(
  blueprint: PracticeBlueprint,
  rendererType: LearningActivityType,
) {
  switch (blueprint.expectedResponse.kind) {
    case "short_text":
      return "short_text";
    case "structured_text":
      return rendererType === "flashcard" ? "short_text" : "structured_text";
    case "single_choice":
      return rendererType === "true_false" ? "boolean_choice" : "single_choice";
    case "multiple_choice":
      return "single_choice";
    case "ordered_structure":
      return "ordered_structure";
    case "unordered_structure":
      return "unordered_structure";
    case "numeric":
      return rendererType === "flashcard" ? "short_text" : "numeric";
    default:
      return blueprint.expectedResponse.kind;
  }
}

function assessMcpToolSupport(
  blueprint: PracticeBlueprint,
  rendererType: LearningActivityType,
): SupportAssessment {
  const capabilities = new Set(getRendererCapabilities()[rendererType]);
  const responseCapability = expectedResponseCapability(blueprint, rendererType);
  const required = new Set([
    "text_prompt",
    responseCapability,
    ...blueprint.requiredCapabilities,
  ]);
  const missingCapabilities = [...required].filter(
    (capability) => !capabilities.has(capability),
  );
  const supportsRequiredInput = !blueprint.requiredCapabilities.some(
    (capability) => !capabilities.has(capability),
  );
  const capturesRequiredResponse = capabilities.has(responseCapability);
  const supportsScoring = blueprint.scoringRubric.every((criterion) =>
    criterion.gradingMode === "self"
      ? capabilities.has("self_scoring")
      : capabilities.has("exact_scoring"),
  );
  const isSelfScored = blueprint.scoringRubric.some(
    (criterion) => criterion.gradingMode === "self",
  );

  let level: SupportAssessment["level"];
  if (!supportsRequiredInput || !capturesRequiredResponse) {
    level = missingCapabilities.some((value) =>
      ["audio", "code", "graph_annotation", "numeric", "checklist"].includes(value),
    )
      ? "unsupported"
      : "proxy";
  } else if (blueprint.relationToObjective === "proxy") {
    level = "proxy";
  } else if (blueprint.relationToObjective === "scaffold" || isSelfScored || !supportsScoring) {
    level = "scaffold";
  } else {
    level = "exact";
  }

  return {
    blueprintId: blueprint.id,
    rendererType,
    level,
    preservesOperation: blueprint.relationToObjective === "direct" && missingCapabilities.length === 0,
    capturesRequiredResponse,
    supportsRequiredInput,
    supportsScoring,
    missingCapabilities,
    rationale:
      level === "exact"
        ? "기대 응답을 현재 문제 형식으로 직접 받고 채점할 수 있습니다."
        : level === "scaffold"
          ? "현재 문제 형식으로 필요한 일부 연습을 제공하지만 최종 성공 기준 전체를 직접 확인하지는 않습니다."
          : level === "proxy"
            ? "관련 문제이지만 성공 기준을 충족했다는 직접 증거로 사용하기 어렵습니다."
            : `현재 화면에 필요한 기능이 없습니다: ${missingCapabilities.join(", ") || "응답 채점"}`,
  };
}

function schemaForStage(stage: ChatGptParityStage) {
  if (stage === "analyze") return outlineTextSchema;
  if (stage === "concept-tree") return conceptTreeTextSchema;
  if (stage === "learning-design") return learningDesignTextSchema;
  if (stage === "activity-design") return activityDesignTextSchema;
  return cardsTextSubmissionSchema;
}

function instructionsForStage(stage: ChatGptParityStage) {
  if (stage === "analyze") {
    return "PDF의 원문 목차만 Markdown 문자열로 제출합니다. 대화에 첨부된 PDF는 직접 읽고 /study에 등록된 PDF는 원문 읽기 도구 결과를 사용합니다. @file로 파일을 구분하고 # 개수로 계층, 마지막 [페이지] 또는 [시작-끝]으로 범위를 표시합니다. 설명·요약·핵심 개념·중요도·관계 해설·문제 설계는 쓰지 않습니다. 명시적 목차가 없으면 실제 장·절 제목이나 슬라이드 제목만 사용합니다.";
  }
  if (stage === "concept-tree") {
    return "선택된 원문 목차의 실제 내용을 의미 관계 중심 개념트리로 작성합니다. 목차를 복사하거나 학습목표·문제·예시를 노드로 만들지 않습니다. 독립적으로 학습·판단할 내용의 출처가 한 노드에 섞이지 않게 하되, 의미 관계에 맞게 묶고 나누는 자유는 유지합니다. 같은 PDF 페이지에 선택된 말단 목차가 여러 개면 노드 끝에 @목차(번호)를 써서 실제 해당하는 항목만 연결합니다. 번호는 userSelection.availableLeafNodes의 number를 사용합니다. 모델은 짧은 자연어 트리만 쓰고 MCP가 노드 ID, 부모, 순서, 목차 연결과 페이지 범위를 검사합니다.";
  }
  if (stage === "learning-design") {
    return "개념트리의 노드를 묶거나 나눠 학습 대상과 목표를 정합니다. 학습내용·목표·성공기준은 같은 능력과 범위여야 하며 제공된 원문으로 학습하고 확인할 수 있는 내용이어야 합니다. 독립 능력은 별도 학습 대상으로 나누고 상위 개념의 출처를 평가범위로 과대 해석하지 마세요. 맨 위 개념 하나로 자료 전체를 묶지 말고, 쪽 근거가 있는 실제 내용의 개념 번호를 포함하세요. 근거에는 PDF 실제 문구를 그대로 쓰며 여러 구절은 ||로 구분합니다. 요약은 학습내용에만 씁니다. 문제 수·형식·질문·보기·정답은 만들지 않습니다. MCP가 ID·출처 연결과 등록 PDF의 원문 문구를 검사합니다. 글자가 없는 쪽은 실패 대신 원문 글자 없음으로 표시합니다.";
  }
  if (stage === "activity-design") {
    return "확정된 학습 대상과 목표를 바꾸지 않고, 현재 Study Forge가 지원하는 기능과 사용자가 고른 requestedAbilities를 보고 각 대상을 1~3개의 문제 설계로 만듭니다. 관련개념에는 해당 학습대상의 concepts 중 이 문제로 확인할 번호를 쓰고 모두 확인하면 전체라고 씁니다. 실제 질문·보기·정답은 쓰지 않습니다. 지원되지 않거나 원문으로 확인할 수 없는 능력은 억지로 문제화하지 말고 제한을 적습니다. MCP가 Blueprint, 지원 수준, 포함 여부와 능력 충족 경고를 계산합니다.";
  }
  return [
    "확정된 문제 설계를 다시 판단하지 않고 includeInGeneration=true인 항목의 실제 문제만 같은 순서로 씁니다.",
    "cardsText의 카드 경계는 반드시 --- CARD 1 --- 형식으로 씁니다. 각 카드에는 유형, 질문, 정답, 해설, 근거를 한 줄씩 씁니다.",
    "유형은 플래시카드, 빈칸, OX, 객관식, 순서복원, 구조복원 중 하나입니다. 객관식은 선택지: 다음 줄에 - 항목 형식으로 3~5개를 씁니다.",
    "빈칸은 질문에 ____ 하나만 쓰고 정답에는 빈칸에 들어갈 짧은 말만 씁니다.",
    "순서복원과 구조복원은 구조: 다음 줄에 - 항목을 씁니다. 순서는 모두 같은 들여쓰기, 구조는 자식마다 공백 2칸을 더 들여씁니다.",
    "근거에는 학습 단위의 sourceText에서 정답을 확인할 수 있는 짧은 구절을 그대로 옮깁니다. 전략, 난이도, ID, sourceGrounded, verificationNotes는 쓰지 않습니다. MCP가 채웁니다.",
    "structure_recall은 원문에 실제 고정 순서나 상하·분류 관계가 있을 때만 사용하고 평면 목록에는 사용하지 않습니다.",
    "문제 수, 문제 방식, 단서 수준과 기대 응답은 앞 단계 그대로 유지합니다.",
  ].join(" ");
}

type CardsTextSubmission = z.infer<typeof cardsTextSubmissionSchema>;

function materializeCardsTextSubmission(
  submission: CardsTextSubmission,
  design: LearningDesignPlan,
  activities: z.infer<typeof learningPlanGenerationSchema>["activities"],
  structureModes: Record<string, "word_bank" | "free_input">,
): z.infer<typeof learningPlanGenerationSchema> {
  const includedActivities = activities.filter(
    (activity) => activity.includeInGeneration &&
      activity.supportLevel !== "unsupported" &&
      activity.recommendedType !== null,
  );
  const blocks = parseCardTextBlocks(submission.cardsText);
  if (blocks.length !== includedActivities.length) {
    throw new Error(
      `카드 블록은 생성 대상으로 확정된 ${includedActivities.length}개와 같아야 합니다. 현재 ${blocks.length}개입니다.`,
    );
  }
  const blueprintById = new Map(
    design.assessmentBlueprints.map((blueprint) => [blueprint.id, blueprint]),
  );
  const unitById = new Map(design.knowledgeUnits.map((unit) => [unit.id, unit]));

  const cards = blocks.map((block, index) => {
    const activity = includedActivities[index];
    const blueprint = blueprintById.get(activity.blueprintId);
    if (!blueprint || !activity.recommendedType) {
      throw new Error(`${index + 1}번 카드가 연결될 평가 설계를 찾을 수 없습니다.`);
    }
    const unit = unitById.get(blueprint.knowledgeUnitId);
    if (!unit) throw new Error(`${index + 1}번 카드의 Knowledge Unit을 찾을 수 없습니다.`);
    const parsedType = parseCardType(block.require("유형"));
    if (parsedType.activityType !== activity.recommendedType) {
      throw new Error(
        `${index + 1}번 카드 유형(${parsedType.activityType})이 확정 문제 방식(${activity.recommendedType})과 다릅니다.`,
      );
    }
    if (
      parsedType.activityType === "structure_recall" &&
      ((blueprint.expectedResponse.kind === "ordered_structure" && parsedType.structureKind !== "sequence") ||
        (blueprint.expectedResponse.kind === "unordered_structure" && parsedType.structureKind !== "hierarchy"))
    ) {
      throw new Error(`${index + 1}번 카드의 구조 종류가 확정 문제 설계와 다릅니다.`);
    }
    const front = block.require("질문");
    const basis = block.require("근거");
    if (!normalizedIncludes(unit.sourceText, basis)) {
      throw new Error(`${index + 1}번 카드의 근거가 해당 Knowledge Unit 원문에서 확인되지 않습니다.`);
    }
    const common = {
      blueprintId: blueprint.id,
      conceptNodeIds: blueprint.conceptNodeIds?.length
        ? blueprint.conceptNodeIds
        : unit.conceptNodeIds,
      activityType: parsedType.activityType,
      front,
      basis,
      strategy: strategyFromActivityType(parsedType.activityType),
      difficulty: difficultyFromBlueprint(blueprint),
      explanation: block.require("해설"),
      sourceGrounded: true,
      verificationNotes: ["MCP가 근거 문구를 학습 단위 원문과 대조함"],
    };
    const answer = block.require("정답");
    if (parsedType.activityType === "flashcard") return { ...common, back: answer };
    if (parsedType.activityType === "cloze") {
      if ((front.match(/____/g)?.length ?? 0) !== 1) {
        throw new Error(`${index + 1}번 빈칸 문제에는 ____가 정확히 한 개 있어야 합니다.`);
      }
      return { ...common, clozeText: front, answer };
    }
    if (parsedType.activityType === "true_false") {
      if (!/^(?:O|X)$/i.test(answer)) {
        throw new Error(`${index + 1}번 OX 문제의 정답은 O 또는 X여야 합니다.`);
      }
      return { ...common, correctBoolean: answer.toUpperCase() === "O" };
    }
    if (parsedType.activityType === "multiple_choice") {
      const options = block.list("선택지");
      const numericIndex = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      const correctOptionIndex = numericIndex >= 0 ? numericIndex : options.indexOf(answer);
      if (options.length < 3 || options.length > 5 || correctOptionIndex < 0) {
        throw new Error(`${index + 1}번 객관식은 선택지 3~5개와 일치하는 정답이 필요합니다.`);
      }
      return { ...common, options, correctOptionIndex };
    }
    const structureItems = block.indentedList("구조");
    const structureNodes = materializeStructureNodes(structureItems, parsedType.structureKind);
    const supportsFreeInput = structureNodes.every(
      (node) => node.correctLabel.length <= 40 && !node.correctLabel.includes("\n"),
    );
    return {
      ...common,
      structureNodes,
      structureRecallKind: parsedType.structureKind,
      supportedStructureRecallModes: supportsFreeInput
        ? ["word_bank", "free_input"] as const
        : ["word_bank"] as const,
      structureRecallMode: structureModes[blueprint.id] ?? "word_bank" as const,
    };
  });
  return learningPlanGenerationSchema.parse({ activities, cards });
}

type ParsedTextBlock = ReturnType<typeof makeTextBlock>;

function parseCardTextBlocks(value: string): ParsedTextBlock[] {
  const segments = parseCardTextSegments(value);
  const numbers = [...segments.keys()];
  numbers.forEach((number, index) => {
    if (number !== index + 1) throw new Error(`카드 번호는 1부터 순서대로 이어져야 합니다: ${number}`);
  });
  return numbers.map((number) => {
    const segment = segments.get(number)!;
    const body = segment.replace(/^--- CARD \d+ ---\s*/i, "").trim();
    return makeTextBlock(body, number);
  });
}

function parseCardTextSegments(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  const matches = [...normalized.matchAll(/^--- CARD (\d+) ---\s*$/gim)];
  if (matches.length === 0) throw new Error("cardsText에 --- CARD 1 --- 경계가 필요합니다.");
  const segments = new Map<number, string>();
  matches.forEach((match, index) => {
    const number = Number(match[1]);
    if (segments.has(number)) throw new Error(`CARD ${number}이 중복 제출되었습니다.`);
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? normalized.length;
    segments.set(number, normalized.slice(start, end).trim());
  });
  return segments;
}

function makeTextBlock(text: string, number: number) {
  const fields = new Map<string, string>();
  const lists = new Map<string, Array<{ depth: number; value: string }>>();
  let activeList: string | null = null;
  for (const rawLine of text.split("\n")) {
    const field = /^([^:：]+)\s*[:：]\s*(.*)$/.exec(rawLine.trim());
    if (field) {
      const key = field[1].trim();
      const value = field[2].trim();
      if (fields.has(key) || lists.has(key)) throw new Error(`${number}번 카드의 ${key} 항목이 중복되었습니다.`);
      if (value) fields.set(key, value);
      else lists.set(key, []);
      activeList = value ? null : key;
      continue;
    }
    if (!rawLine.trim()) continue;
    const item = /^(\s*)-\s+(.+)$/.exec(rawLine);
    if (!item || !activeList) {
      throw new Error(`${number}번 카드에서 해석할 수 없는 줄입니다: ${rawLine.trim()}`);
    }
    const spaces = item[1].replace(/\t/g, "  ").length;
    if (spaces % 2 !== 0) throw new Error(`${number}번 카드의 구조 들여쓰기는 공백 2칸 단위여야 합니다.`);
    lists.get(activeList)!.push({ depth: spaces / 2, value: item[2].trim() });
  }
  return {
    number,
    require(key: string) {
      const value = fields.get(key)?.trim();
      if (!value) throw new Error(`${number}번 카드에 ${key}: 항목이 필요합니다.`);
      return value;
    },
    optional(key: string) {
      return fields.get(key)?.trim() ?? "";
    },
    list(key: string) {
      const items = lists.get(key) ?? [];
      if (items.some((item) => item.depth !== 0)) {
        throw new Error(`${number}번 카드의 ${key} 항목은 들여쓰지 않은 목록이어야 합니다.`);
      }
      return items.map((item) => item.value);
    },
    indentedList(key: string) {
      const items = lists.get(key) ?? [];
      if (items.length === 0) throw new Error(`${number}번 카드에 ${key}: 목록이 필요합니다.`);
      return items;
    },
  };
}

function parseCardType(value: string): {
  activityType: "flashcard" | "cloze" | "true_false" | "multiple_choice" | "structure_recall";
  structureKind?: "sequence" | "hierarchy";
} {
  const normalized = value.replace(/\s+/g, "").toLocaleLowerCase();
  if (["플래시카드", "flashcard"].includes(normalized)) return { activityType: "flashcard" };
  if (["빈칸", "cloze"].includes(normalized)) return { activityType: "cloze" };
  if (["ox", "o/x", "true_false"].includes(normalized)) return { activityType: "true_false" };
  if (["객관식", "multiple_choice"].includes(normalized)) return { activityType: "multiple_choice" };
  if (["순서복원", "sequence"].includes(normalized)) {
    return { activityType: "structure_recall", structureKind: "sequence" };
  }
  if (["구조복원", "hierarchy"].includes(normalized)) {
    return { activityType: "structure_recall", structureKind: "hierarchy" };
  }
  throw new Error(`지원하지 않는 카드 유형입니다: ${value}`);
}

function materializeStructureNodes(
  items: Array<{ depth: number; value: string }>,
  kind: "sequence" | "hierarchy" | undefined,
) {
  if (items.length < 3 || items.length > 8) throw new Error("구조·순서 복원은 항목 3~8개가 필요합니다.");
  if (kind !== "sequence" && new Set(items.map((item) => item.value)).size !== items.length) {
    throw new Error("구조·순서 복원의 정답 항목은 서로 달라야 합니다.");
  }
  if (kind === "sequence" && items.some((item) => item.depth !== 0)) {
    throw new Error("순서복원 항목은 모두 같은 들여쓰기여야 합니다.");
  }
  const lastAtDepth = new Map<number, string>();
  const nodes = items.map((item, index) => {
    const id = `structure-${index + 1}`;
    let parentId: string | null;
    if (kind === "sequence") {
      parentId = index === 0 ? null : `structure-${index}`;
    } else {
      if (item.depth > 0 && !lastAtDepth.has(item.depth - 1)) {
        throw new Error("구조복원의 자식 항목 앞에 상위 항목이 필요합니다.");
      }
      parentId = item.depth === 0 ? null : lastAtDepth.get(item.depth - 1)!;
    }
    for (const depth of [...lastAtDepth.keys()]) if (depth >= item.depth) lastAtDepth.delete(depth);
    lastAtDepth.set(item.depth, id);
    return { id, parentId, correctLabel: item.value };
  });
  if (kind === "hierarchy") {
    const counts = new Map<string | null, number>();
    for (const node of nodes) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    if (![...counts.values()].some((count) => count > 1)) {
      throw new Error("구조복원에는 실제 갈래가 필요합니다.");
    }
  }
  return nodes;
}

function normalizedIncludes(source: string, excerpt: string) {
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").replace(/[“”‘’"']/g, "");
  const normalizedExcerpt = normalize(excerpt);
  return normalizedExcerpt.length >= 4 && normalize(source).includes(normalizedExcerpt);
}

function strategyFromActivityType(activityType: LearningActivityType) {
  if (activityType === "true_false" || activityType === "multiple_choice") return "contrast" as const;
  if (activityType === "structure_recall") return "procedure" as const;
  return "concept" as const;
}

function difficultyFromBlueprint(blueprint: LearningDesignPlan["assessmentBlueprints"][number]) {
  const responseScore = blueprint.difficulty.responseComplexity === "atomic"
    ? 0
    : blueprint.difficulty.responseComplexity === "multi_part" ? 1 : 2;
  const transferScore = blueprint.difficulty.transferDistance === "same_context"
    ? 0
    : blueprint.difficulty.transferDistance === "near_transfer" ? 1 : 2;
  const cueScore = blueprint.difficulty.cueLevel === "high" ? 0 : blueprint.difficulty.cueLevel === "medium" ? 1 : 2;
  return Math.min(5, Math.max(1, 1 + responseScore + transferScore + cueScore));
}

function buildGenerateInput(run: ChatGptParityRun, studyGuideline: string): GenerateInput {
  return {
    projectId: undefined,
    title: run.config.title,
    subject: run.config.subject,
    tags: run.config.tags,
    sourceText: "",
    instruction: run.config.instruction || run.config.learningGoal,
    analysisContext: "",
    studyGuideline,
    activityDesign: "",
    learningDesign: "",
    codexThreadId: "",
    activitySelectionMode: "automatic",
    sourceExpressionMode: run.config.sourceExpressionMode,
    stage: "design",
    preparedAnalysis: "",
    preparedMaterial: "",
    mode: "flashcard",
  };
}

function parseAnalysisArtifact(value: unknown) {
  if (!value) throw new Error("원문 분석 단계가 아직 완료되지 않았습니다.");
  const parsed = pdfAnalysisResponseSchema.parse(value);
  if (!parsed.sourceOutline) throw new Error("원문 분석 결과에 통합 원문 목차가 없습니다.");
  return parsed;
}

function parseConceptTreeArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("개념트리 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.treeText !== "string" || !Array.isArray(artifact.nodes)) {
    throw new Error("개념트리 산출물이 불완전합니다.");
  }
  return artifact as ConceptTreeArtifact;
}

function parseLearningDesignArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("학습설계 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (!artifact.learningDesign || !artifact.analysis || !artifact.organizedMaterial) {
    throw new Error("학습설계 산출물이 불완전합니다.");
  }
  return artifact as LearningDesignArtifact;
}

function parseActivityDesignArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("활동 설계 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (!artifact.learningDesign || !Array.isArray(artifact.activities) || !artifact.structureModes) {
    throw new Error("활동 설계 산출물이 불완전합니다.");
  }
  if (!artifact.structureKinds || typeof artifact.structureKinds !== "object") {
    const design = artifact.learningDesign as LearningDesignPlan;
    artifact.structureKinds = Object.fromEntries(
      design.assessmentBlueprints.flatMap((blueprint) =>
        blueprint.expectedResponse.kind === "ordered_structure"
          ? [[blueprint.id, "sequence"]]
          : blueprint.expectedResponse.kind === "unordered_structure"
            ? [[blueprint.id, "hierarchy"]]
            : []
      ),
    );
  }
  return artifact as ActivityDesignArtifact;
}

function parseCardsArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("카드 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (!artifact.activityDesign || !Array.isArray(artifact.cards)) {
    throw new Error("카드 산출물이 불완전합니다.");
  }
  return artifact as ReturnType<typeof materializeLearningPlanGeneration> & { generated: unknown };
}

function buildStudyGuideline(
  run: ChatGptParityRun,
  learningOutline: z.infer<typeof learningOutlineSchema>,
) {
  return {
    summary: run.config.learningGoal || "선택한 원문 목차를 능동적으로 학습합니다.",
    selectedGroup: {
      id: "selected-source-outline",
      title: "선택한 원문 목차 학습",
      description: run.config.instruction || run.config.learningGoal,
      itemCount: Math.max(1, run.selectedOutlineLeafIds.length),
      itemLabel: "학습 단위",
      selectionInstruction: "선택한 원문 목차 범위에서 의미 있는 학습내용을 설계합니다.",
    },
    wholeDocumentCore: {
      summary: run.config.learningGoal || "선택한 원문 목차 학습",
      learningGoal: run.config.learningGoal,
      selectionRationale: "사용자가 원문 목차에서 직접 선택한 범위입니다.",
      areas: [],
      exclusions: [],
      maxLearningUnitCount: 60,
      learningOutline,
    },
  };
}

function selectOutline(
  outlineValue: z.infer<typeof learningOutlineSchema>,
  selectedLeafIds: string[],
) {
  const outline = learningOutlineSchema.parse(outlineValue);
  const selected = new Set(selectedLeafIds);
  const nodeById = new Map(outline.nodes.map((node) => [node.id, node]));
  const included = new Set<string>();
  for (const id of selected) {
    let current = nodeById.get(id);
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
  }
  return {
    ...outline,
    nodes: outline.nodes
      .filter((node) => included.has(node.id))
      .map((node) => ({
        ...node,
        selectedByDefault: selected.has(node.id),
        sourceEvidence: selected.has(node.id) ? node.sourceEvidence : "",
      })),
  };
}

function getLeafIds(nodes: Array<{ id: string; parentId: string | null }>) {
  const parentIds = new Set(nodes.flatMap((node) => node.parentId ? [node.parentId] : []));
  return nodes.filter((node) => !parentIds.has(node.id)).map((node) => node.id);
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label}에 중복이 있습니다.`);
}

function safeId(value: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("ID 형식이 올바르지 않습니다.");
  return value;
}

function requestRunId(clientRequestId: string) {
  const digest = createHash("sha256").update(clientRequestId, "utf8").digest("hex").slice(0, 32);
  return `chatgpt-request-${digest}`;
}

function checksum(value: unknown) {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
