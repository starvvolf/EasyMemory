import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  adaptLearningDesignToAnalysis,
  buildReviewMaterial,
  compactLearningDesignSchema,
  learningPlanGenerationSchema,
  materializeCompactLearningDesign,
  materializeLearningPlanGeneration,
  validateLearningDesignPlan,
  type GenerateInput,
} from "../../src/lib/pipeline/generate.ts";
import {
  combineSourceOutlines,
  pdfAnalysisResponseSchema,
} from "../../src/lib/pipeline/analyze.ts";
import {
  learningOutlineSchema,
  wholeDocumentCoreSchema,
} from "../../src/lib/pipeline/plan.ts";
import { createPdfMaskActivities } from "../../src/lib/pdf-mask-activity.ts";

export const chatGptParityStages = [
  "analyze",
  "plan",
  "learning-design",
  "cards",
] as const;

export type ChatGptParityStage = (typeof chatGptParityStages)[number];

const startInputSchema = z.object({
  title: z.string().min(1),
  files: z.array(z.object({
    fileName: z.string().min(1),
    pageCount: z.number().int().min(1).optional(),
  })).min(1).max(20),
  learningGoal: z.string().default(""),
  instruction: z.string().default(""),
  subject: z.string().default(""),
  tags: z.array(z.string()).default([]),
  sourceExpressionMode: z.enum(["preserve", "adapt"]).default("adapt"),
});

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
};

const defaultDataRoot = path.join(
  process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"),
  "mcp",
);

export class ChatGptParityService {
  private readonly runRoot: string;
  private readonly publishedRoot: string;

  constructor(
    runRoot = path.join(defaultDataRoot, "chatgpt-runs"),
    publishedRoot = path.join(defaultDataRoot, "published"),
  ) {
    this.runRoot = runRoot;
    this.publishedRoot = publishedRoot;
  }

  async startRun(input: StartChatGptParityInput) {
    const config = startInputSchema.parse(input);
    const fileNames = config.files.map((file) => file.fileName);
    assertUnique(fileNames, "PDF 파일명");
    const now = new Date().toISOString();
    const run: ChatGptParityRun = {
      id: `chatgpt-${now.replace(/[:.]/g, "-")}-${randomUUID()}`,
      engine: "chatgpt-mcp",
      createdAt: now,
      updatedAt: now,
      config,
      selectedOutlineLeafIds: [],
      artifacts: {},
      stageStartedAt: {},
      stageCompletedAt: {},
      stageDurationsMs: {},
    };
    await this.writeRun(run);
    return this.getNextStage(run.id);
  }

  async configureRun(input: { runId: string; selectedOutlineLeafIds: string[] }) {
    const run = await this.readRun(input.runId);
    const analysis = parseAnalysisArtifact(run.artifacts.analyze);
    if (run.artifacts["learning-design"] || run.artifacts.cards) {
      throw new Error("학습 설계가 시작된 뒤에는 원문 목차 선택을 바꿀 수 없습니다.");
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

  async getNextStage(runId: string) {
    const run = await this.readRun(runId);
    const nextStage = chatGptParityStages.find((stage) => !run.artifacts[stage]) ?? null;
    if (!nextStage) {
      return {
        runId,
        engine: run.engine,
        completed: true,
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
    const expected = chatGptParityStages.find((stage) => !run.artifacts[stage]) ?? null;
    if (!expected) throw new Error("이미 모든 단계가 완료되었습니다.");
    if (input.stage !== expected) {
      throw new Error(`현재 제출할 단계는 ${expected}입니다. ${input.stage} 결과는 받을 수 없습니다.`);
    }
    run.artifacts[input.stage] = this.validateAndMaterialize(run, input.stage, input.result);
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
      },
      ...(await this.getNextStage(run.id)),
    };
  }

  async getResult(runId: string) {
    const run = await this.readRun(runId);
    const design = parseDesignArtifact(run.artifacts["learning-design"]);
    const final = parseCardsArtifact(run.artifacts.cards);
    return {
      runId,
      engine: run.engine,
      title: run.config.title,
      files: run.config.files,
      selectedOutlineLeafIds: run.selectedOutlineLeafIds,
      stageDurationsMs: run.stageDurationsMs,
      totalDurationMs: Object.values(run.stageDurationsMs).reduce((sum, value) => sum + (value ?? 0), 0),
      learningDesign: design.learningDesign,
      activityDesign: final.activityDesign,
      cardCount: final.cards.length,
      cards: final.cards,
    };
  }

  async publishRun(input: { runId: string; confirmPublish: boolean }) {
    if (!input.confirmPublish) throw new Error("발행하려면 confirmPublish=true가 필요합니다.");
    const run = await this.readRun(input.runId);
    const plan = parsePlanArtifact(run.artifacts.plan);
    const design = parseDesignArtifact(run.artifacts["learning-design"]);
    const final = parseCardsArtifact(run.artifacts.cards);
    const now = new Date().toISOString();
    const studyGuideline = buildStudyGuideline(plan);
    const deck = {
      id: `mcp-run-${run.id}`,
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
        outline: plan.learningOutline,
        selectedLeafIds: run.selectedOutlineLeafIds,
      },
      analysis: design.analysis,
      organizedMaterial: design.organizedMaterial,
      pdfMaskActivities: createPdfMaskActivities(design.analysis.learningUnits ?? []),
      cards: final.cards,
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
    return { runId: run.id, deckId: deck.id, title: deck.title, cardCount: deck.cards.length };
  }

  private buildStageInput(run: ChatGptParityRun, stage: ChatGptParityStage) {
    const outputSchema = schemaForStage(stage);
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
          learningGoal: run.config.learningGoal,
          instruction: run.config.instruction,
          attachmentRule:
            "현재 ChatGPT 대화에 첨부된 PDF를 직접 읽으세요. 로컬 MCP 서버에는 PDF 바이너리가 전달되지 않으므로 첨부 내용을 근거로 결과를 작성해야 합니다.",
        },
      };
    }
    const analysis = parseAnalysisArtifact(run.artifacts.analyze);
    const selectedOutline = selectOutline(analysis.sourceOutline!, run.selectedOutlineLeafIds);
    if (stage === "plan") {
      return {
        ...common,
        userSelection: {
          selectedOutlineLeafIds: run.selectedOutlineLeafIds,
          availableLeafNodes: selectedOutline.nodes
            .filter((node) => getLeafIds(selectedOutline.nodes).includes(node.id))
            .map((node) => ({ id: node.id, title: node.title, selected: node.selectedByDefault })),
          changeTool: "configure_chatgpt_pdf_run",
        },
        input: {
          learningGoal: run.config.learningGoal,
          instruction: run.config.instruction,
          analysis,
          selectedSourceOutline: selectedOutline,
        },
      };
    }
    const plan = parsePlanArtifact(run.artifacts.plan);
    if (stage === "learning-design") {
      return {
        ...common,
        input: {
          title: run.config.title,
          learningGoal: run.config.learningGoal,
          instruction: run.config.instruction,
          analysis,
          studyGuideline: buildStudyGuideline(plan),
          selectedSourceOutline: plan.learningOutline,
        },
      };
    }
    const design = parseDesignArtifact(run.artifacts["learning-design"]);
    return {
      ...common,
      input: {
        instruction: run.config.instruction,
        sourceExpressionMode: run.config.sourceExpressionMode,
        learningDesign: design.learningDesign,
        sourceEvidence: design.learningDesign.knowledgeUnits.map((unit) => ({
          knowledgeUnitId: unit.id,
          sourceId: unit.sourceId,
          sourcePage: unit.sourcePage,
          sourceRange: unit.sourceRange,
          sourceText: unit.sourceText,
        })),
      },
    };
  }

  private validateAndMaterialize(
    run: ChatGptParityRun,
    stage: ChatGptParityStage,
    value: unknown,
  ) {
    if (stage === "analyze") {
      const parsed = pdfAnalysisResponseSchema.parse(value);
      const expectedFiles = [...run.config.files.map((file) => file.fileName)].sort();
      const actualFiles = [...parsed.files.map((file) => file.fileName)].sort();
      if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
        throw new Error("Analyze 결과의 파일명이 시작할 때 등록한 PDF 목록과 다릅니다.");
      }
      for (const file of parsed.files) {
        assertUnique(file.sourceOutline.nodes.map((node) => node.id), `${file.fileName} 목차 ID`);
        const nodeIds = new Set(file.sourceOutline.nodes.map((node) => node.id));
        for (const node of file.sourceOutline.nodes) {
          if (node.parentId && !nodeIds.has(node.parentId)) {
            throw new Error(`${file.fileName} 원문 목차의 부모 ID가 없습니다: ${node.parentId}`);
          }
          if (node.sourceRefs.some((reference) => reference.fileName !== file.fileName)) {
            throw new Error(`${file.fileName} 원문 목차의 파일 연결이 잘못되었습니다: ${node.id}`);
          }
        }
      }
      const normalized = pdfAnalysisResponseSchema.parse({
        ...parsed,
        sourceOutline: parsed.sourceOutline ?? combineSourceOutlines(parsed.files),
      });
      assertUnique(normalized.sourceOutline!.nodes.map((node) => node.id), "통합 원문 목차 ID");
      const combinedNodeIds = new Set(normalized.sourceOutline!.nodes.map((node) => node.id));
      for (const node of normalized.sourceOutline!.nodes) {
        if (node.parentId && !combinedNodeIds.has(node.parentId)) {
          throw new Error(`통합 원문 목차의 부모 ID가 없습니다: ${node.parentId}`);
        }
        if (node.sourceRefs.some((reference) => !expectedFiles.includes(reference.fileName))) {
          throw new Error(`통합 원문 목차의 파일 연결이 잘못되었습니다: ${node.id}`);
        }
      }
      return normalized;
    }
    if (stage === "plan") {
      const analysis = parseAnalysisArtifact(run.artifacts.analyze);
      const core = wholeDocumentCoreSchema.parse(value);
      const learningOutline = selectOutline(analysis.sourceOutline!, run.selectedOutlineLeafIds);
      return {
        ...core,
        maxLearningUnitCount: Math.max(core.maxLearningUnitCount, run.selectedOutlineLeafIds.length),
        learningOutline,
      };
    }
    if (stage === "learning-design") {
      const compact = compactLearningDesignSchema.parse(value);
      const plan = parsePlanArtifact(run.artifacts.plan);
      const studyGuideline = JSON.stringify(buildStudyGuideline(plan));
      const learningDesign = materializeCompactLearningDesign(
        compact,
        studyGuideline,
        run.config.files[0]?.fileName ?? run.config.title,
      );
      validateLearningDesignPlan(
        learningDesign,
        run.selectedOutlineLeafIds,
        plan.maxLearningUnitCount,
      );
      const generateInput = buildGenerateInput(run, studyGuideline);
      const analysis = adaptLearningDesignToAnalysis(learningDesign, generateInput);
      return {
        compact,
        learningDesign,
        analysis,
        organizedMaterial: buildReviewMaterial(generateInput, analysis),
      };
    }
    const generated = learningPlanGenerationSchema.parse(value);
    const design = parseDesignArtifact(run.artifacts["learning-design"]);
    const { activityDesign, cards } = materializeLearningPlanGeneration(
      generated,
      design.learningDesign,
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

  private async writeRun(run: ChatGptParityRun) {
    const directory = path.join(this.runRoot, safeId(run.id));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
}

function schemaForStage(stage: ChatGptParityStage) {
  if (stage === "analyze") return pdfAnalysisResponseSchema;
  if (stage === "plan") return wholeDocumentCoreSchema;
  if (stage === "learning-design") return compactLearningDesignSchema;
  return learningPlanGenerationSchema;
}

function instructionsForStage(stage: ChatGptParityStage) {
  if (stage === "analyze") {
    return "첨부 PDF 전체의 원문 목차·핵심 개념·페이지 근거를 보존해 분석합니다. 문제 수나 문제 형식은 정하지 않습니다.";
  }
  if (stage === "plan") {
    return "선택된 원문 목차 범위에서 학습 가치가 있는 핵심 범위와 제외 대상을 정합니다. 원문 목차를 새 목차로 재작성하지 않습니다.";
  }
  if (stage === "learning-design") {
    return "선택 목차에 Learning Objectives를 연결하고, 의미 단위 Knowledge Units와 Assessment Blueprints를 설계합니다. 실제 질문·보기·정답·문제 형식은 만들지 않습니다.";
  }
  return "각 Assessment Blueprint의 지원 문제 형식을 정하고 Card를 1:1로 만든 뒤, 첨부 PDF와 대조해 근거·정답·중복을 검수합니다.";
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
  if (!value) throw new Error("Analyze 단계가 아직 완료되지 않았습니다.");
  const parsed = pdfAnalysisResponseSchema.parse(value);
  if (!parsed.sourceOutline) throw new Error("Analyze 결과에 통합 원문 목차가 없습니다.");
  return parsed;
}

function parsePlanArtifact(value: unknown) {
  if (!value || typeof value !== "object" || !("learningOutline" in value)) {
    throw new Error("Plan 단계가 아직 완료되지 않았습니다.");
  }
  const core = wholeDocumentCoreSchema.parse(value);
  const learningOutline = learningOutlineSchema.parse(
    (value as { learningOutline: unknown }).learningOutline,
  );
  return { ...core, learningOutline };
}

function parseDesignArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Learning Design 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (!artifact.learningDesign || !artifact.analysis || !artifact.organizedMaterial) {
    throw new Error("Learning Design 산출물이 불완전합니다.");
  }
  return artifact as {
    compact: unknown;
    learningDesign: ReturnType<typeof materializeCompactLearningDesign>;
    analysis: ReturnType<typeof adaptLearningDesignToAnalysis>;
    organizedMaterial: ReturnType<typeof buildReviewMaterial>;
  };
}

function parseCardsArtifact(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Cards 단계가 아직 완료되지 않았습니다.");
  const artifact = value as Record<string, unknown>;
  if (!artifact.activityDesign || !Array.isArray(artifact.cards)) {
    throw new Error("Cards 산출물이 불완전합니다.");
  }
  return artifact as ReturnType<typeof materializeLearningPlanGeneration> & { generated: unknown };
}

function buildStudyGuideline(plan: ReturnType<typeof parsePlanArtifact>) {
  return {
    summary: plan.summary,
    selectedGroup: {
      id: "whole-document-core",
      title: "선택한 원문 목차 학습",
      description: plan.selectionRationale,
      itemCount: plan.maxLearningUnitCount,
      itemLabel: "Knowledge Unit",
      selectionInstruction: "선택한 원문 목차 범위에서 의미 있는 학습내용을 설계합니다.",
    },
    wholeDocumentCore: plan,
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
