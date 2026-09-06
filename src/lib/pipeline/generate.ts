import { NextResponse } from "next/server.js";
import { z } from "zod";
import type {
  ActivityDesign,
  ActivitySelectionMode,
  AnalysisResult,
  Card,
  CardStrategy,
  GeneratePipelineResult,
  LearningDesignPlan,
  KnowledgeType,
  LearningUnit,
  LearningActivityType,
  LearningOperation,
  LearningObjective,
  PracticeBlueprint,
  LearningUnitSample,
  OrganizedMaterial,
  ExampleSource,
  SlotMode,
  SourceExpressionMode,
  StudyMode,
} from "../types.ts";
import {
  activityRecommendationKey,
  assessBlueprintSupport,
  createLegacyObjectiveAndBlueprint,
  defaultGenerationPolicy,
  ensureMemorizationCoverage,
  recommendationFromBlueprint,
} from "../practice-blueprint.ts";
import {
  CRITIC_ENABLED,
  CRITIC_MODEL,
  CRITIC_REASONING_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  EXTRACTION_MODEL,
  EXTRACTION_REASONING_EFFORT,
  type ReasoningEffort,
} from "../model-config.ts";
import { validateLearningActivity } from "../learning-activity.ts";
import {
  type ApiUsageCapture,
  type ApiUsageStage,
} from "../api-usage.ts";
import {
  callCodexJson as callCodexProviderJson,
  callCodexJsonWithThread as callCodexProviderJsonWithThread,
} from "../ai/codex-provider.ts";
import { toCodexHttpError } from "../ai/codex-errors.ts";
import {
  assertActivityDesignReady,
  assertGenerationSelectionReady,
  assertLearningUnitsReady,
} from "./preflight.ts";
import {
  createCompactActivityDesignInput,
  createCompactCardGenerationInput,
  learningUnitTarget,
} from "./compact-input.ts";
import {
  hydrateGeneratedCardContent,
  type GeneratedCardContent,
} from "./compact-card-output.ts";

const requestSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  tags: z.array(z.string()).default([]),
  sourceText: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  analysisContext: z.string().optional().default(""),
  studyGuideline: z.string().optional().default(""),
  activityDesign: z.string().optional().default(""),
  learningDesign: z.string().optional().default(""),
  codexThreadId: z.string().optional().default(""),
  activitySelectionMode: z
    .enum(["automatic", "manual"])
    .optional()
    .default("automatic"),
  sourceExpressionMode: z.enum(["preserve", "adapt"]).optional(),
  stage: z
    .enum(["prepare", "design", "activity-design", "generate-from-plan", "cards"])
    .optional()
    .default("prepare"),
  preparedAnalysis: z.string().optional().default(""),
  preparedMaterial: z.string().optional().default(""),
  mode: z.enum(["flashcard", "cloze", "translation"]),
});

export type GenerateInput = z.infer<typeof requestSchema>;
export type PdfInput = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type StageRuntimeOptions = ApiUsageCapture & {
  projectId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  instruction?: string;
  usageStage?: ApiUsageStage;
  compactInput?: boolean;
  preparePromptMode?: "current" | "simplified";
  sourceExpressionMode?: SourceExpressionMode;
};

export type CardPipelineRuntimeOptions = {
  cards?: StageRuntimeOptions;
  critic?: StageRuntimeOptions;
  onCardsGenerated?: (cards: CardDraft[]) => void | Promise<void>;
  onCriticCompleted?: (cards: CardDraft[]) => void | Promise<void>;
  activitySelectionMode?: ActivitySelectionMode;
};

export type CardContract = {
  mode: StudyMode;
  slotMode: SlotMode;
  exampleSource: ExampleSource;
  preservePlaceholders: boolean;
  cueExample: string;
  targetExample: string;
  supportingInfoExample: string;
  recallDesign: unknown;
  feedback: string;
  rules: string[];
};

const knowledgeTypes = [
  "vocabulary",
  "fact",
  "concept",
  "relationship",
  "procedure",
  "formula",
  "speaking_pattern",
  "writing_pattern",
  "problem_solving_pattern",
  "example",
  "other",
] as const satisfies readonly KnowledgeType[];

const cardStrategies = [
  "production",
  "recognition",
  "concept",
  "contrast",
  "procedure",
  "application",
] as const satisfies readonly CardStrategy[];

const learningActivityTypes = [
  "flashcard",
  "cloze",
  "true_false",
  "multiple_choice",
  "structure_recall",
] as const satisfies readonly LearningActivityType[];

const learningOperations = [
  "recall",
  "reconstruct",
  "discriminate",
  "apply",
] as const satisfies readonly LearningOperation[];

const variableSlotSchema = z.object({
  name: z.string(),
  example: z.string(),
});

const learningUnitSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  sourceText: z.string(),
  knowledgeType: z.enum(knowledgeTypes),
  fixedPart: z.string(),
  variableSlots: z.array(variableSlotSchema),
  generalizedForm: z.string(),
  target: z.string().min(1).optional(),
  operation: z.enum(learningOperations).optional(),
  successCriterion: z.string().min(1).optional(),
  intent: z.string().min(1).optional(),
  rationale: z.string(),
}).refine((unit) => Boolean(unit.target?.trim() || unit.intent?.trim()), {
  message: "학습 대상이 비어 있습니다.",
});

const structureRecallNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  correctLabel: z.string(),
});

const structureRecallKindSchema = z.enum(["sequence", "hierarchy"]);
const structureRecallModeSchema = z.enum(["word_bank", "free_input"]);
const supportedStructureRecallModesSchema = z.array(structureRecallModeSchema)
  .min(1)
  .max(2)
  .refine((modes) => new Set(modes).size === modes.length, {
    message: "지원 풀이 방식은 중복될 수 없습니다.",
  });

export const analysisSchema = z.object({
  detectedGoal: z.string(),
  sourceType: z.enum(["concept", "comparison", "script", "definition", "mixed"]),
  keyTopics: z.array(z.string()),
  recommendedStrategy: z.string(),
  extractedMaterial: z.string(),
  primaryKnowledgeType: z.enum(knowledgeTypes),
  learningUnits: z.array(learningUnitSchema).min(1),
});

export const organizedMaterialSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
      learningUnitIds: z.array(z.string()),
    }),
  ),
});

export const cardDraftSchema = z.object({
  type: z.enum(["flashcard", "cloze", "translation"]),
  activityType: z.enum(learningActivityTypes),
  front: z.string(),
  back: z.string(),
  clozeText: z.string(),
  answer: z.string(),
  answers: z.array(z.string()),
  options: z.array(z.string()),
  correctOptionIndex: z.number().int(),
  correctBoolean: z.boolean(),
  structureNodes: z.array(structureRecallNodeSchema),
  structureRecallKind: structureRecallKindSchema.optional(),
  supportedStructureRecallModes: supportedStructureRecallModesSchema.optional(),
  structureRecallMode: structureRecallModeSchema.optional(),
  recommendationReason: z.string(),
  hint: z.string(),
  tags: z.array(z.string()),
  basis: z.string(),
  learningUnitId: z.string(),
  objectiveId: z.string().optional().default(""),
  blueprintId: z.string().optional().default(""),
  conceptNodeIds: z.array(z.string().min(1)).optional(),
  strategy: z.enum(cardStrategies),
  sourceId: z.string(),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  rationale: z.string(),
  difficulty: z.number().int().min(1).max(5),
  qualityPassed: z.boolean(),
  qualityNotes: z.array(z.string()),
  qualityStatus: z
    .enum(["not_run", "passed", "failed", "waived"])
    .optional()
    .default("not_run"),
  explanation: z.string().optional().default(""),
});

export const cardsSchema = z.object({
  cards: z.array(cardDraftSchema).min(1),
});

const generatedCardCommonShape = {
  learningUnitId: z.string(),
  conceptNodeIds: z.array(z.string().min(1)).optional(),
  front: z.string(),
  basis: z.string(),
  strategy: z.enum(cardStrategies),
  difficulty: z.number().int().min(1).max(5),
  explanation: z.string(),
};

const generatedCardContentSchema = z.discriminatedUnion("activityType", [
  z.object({
    ...generatedCardCommonShape,
    activityType: z.literal("flashcard"),
    back: z.string(),
  }),
  z.object({
    ...generatedCardCommonShape,
    activityType: z.literal("cloze"),
    clozeText: z.string().min(1),
    answer: z.string().min(1),
  }),
  z.object({
    ...generatedCardCommonShape,
    activityType: z.literal("true_false"),
    correctBoolean: z.boolean(),
  }),
  z.object({
    ...generatedCardCommonShape,
    activityType: z.literal("multiple_choice"),
    options: z.array(z.string()),
    correctOptionIndex: z.number().int(),
  }),
  z.object({
    ...generatedCardCommonShape,
    activityType: z.literal("structure_recall"),
    structureNodes: z.array(structureRecallNodeSchema),
    structureRecallKind: structureRecallKindSchema.optional(),
    supportedStructureRecallModes: supportedStructureRecallModesSchema.optional(),
    structureRecallMode: structureRecallModeSchema,
  }),
]);

export const generatedCardsContentSchema = z.object({
  cards: z.array(generatedCardContentSchema).min(1),
});

export type CardDraft = z.infer<typeof cardDraftSchema>;

const activityRecommendationSchema = z.object({
  learningUnitId: z.string(),
  objectiveId: z.string().optional(),
  blueprintId: z.string().optional(),
  assessmentLevel: z
    .enum(["exact", "scaffold", "proxy", "unsupported"])
    .optional(),
  supportLevel: z.enum(["supported", "partial", "unsupported"]),
  recommendedType: z.enum(learningActivityTypes).nullable(),
  reason: z.string(),
  limitation: z.string(),
  includeInGeneration: z.boolean(),
});

const successCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean(),
});

export const learningObjectiveSchema = z.object({
  id: z.string(),
  outlineNodeId: z.string(),
  learningUnitId: z.string(),
  target: z.string(),
  terminalOperation: z.enum(learningOperations),
  successCriteria: z.array(successCriterionSchema).length(1),
  importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export const practiceBlueprintSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  learningUnitId: z.string(),
  relationToObjective: z.enum(["direct", "scaffold", "proxy"]),
  elicitedOperation: z.enum(learningOperations),
  coverageCriterionIds: z.array(z.string()).min(1),
  given: z.array(z.object({
    type: z.enum(["instruction", "context", "data", "diagram", "example"]),
    description: z.string(),
  })).min(1),
  hidden: z.array(z.object({
    description: z.string(),
    reason: z.enum(["target_answer", "required_inference", "intermediate_step"]),
  })).min(1),
  expectedResponse: z.object({
    kind: z.enum([
      "short_text",
      "structured_text",
      "single_choice",
      "multiple_choice",
      "ordered_structure",
      "unordered_structure",
      "numeric",
      "code",
      "graph_annotation",
      "audio",
      "checklist",
    ]),
    description: z.string(),
  }),
  scoringRubric: z.array(z.object({
    criterionId: z.string(),
    description: z.string(),
    weight: z.number().positive(),
    gradingMode: z.enum(["exact", "semantic", "rule", "self"]),
  })).min(1),
  difficulty: z.object({
    cueLevel: z.enum(["high", "medium", "low"]),
    responseComplexity: z.enum(["atomic", "multi_part", "multi_step"]),
    transferDistance: z.enum(["same_context", "near_transfer", "far_transfer"]),
  }),
  requiredCapabilities: z.array(z.string()),
  conceptNodeIds: z.array(z.string().min(1)).min(1).optional(),
  recommendedType: z.enum(learningActivityTypes),
}).superRefine((blueprint, context) => {
  if (blueprint.expectedResponse.kind !== "numeric") return;
  const exactAnswer = blueprint.hidden.find(
    (item) => item.reason === "target_answer",
  )?.description ?? "";
  if (!/-?\d+(?:\.\d+)?/.test(exactAnswer)) {
    context.addIssue({
      code: "custom",
      path: ["hidden"],
      message: "숫자 문제 설계서에는 아라비아 숫자로 확정한 정답이 필요합니다.",
    });
  }
});

const supportAssessmentSchema = z.object({
  blueprintId: z.string(),
  rendererType: z.enum(learningActivityTypes),
  level: z.enum(["exact", "scaffold", "proxy", "unsupported"]),
  preservesOperation: z.boolean(),
  capturesRequiredResponse: z.boolean(),
  supportsRequiredInput: z.boolean(),
  supportsScoring: z.boolean(),
  missingCapabilities: z.array(z.string()),
  rationale: z.string(),
});

const learningDesignObjectiveSchema = z.object({
  id: z.string().min(1),
  outlineNodeIds: z.array(z.string().min(1)).min(1),
  target: z.string().min(1),
  terminalOperation: z.enum(learningOperations),
  successCriteria: z.array(successCriterionSchema).min(1).max(3),
  importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

const knowledgeUnitSchema = z.object({
  id: z.string().min(1),
  objectiveId: z.string().min(1),
  outlineNodeIds: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
  sourceId: z.string().min(1),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  sourceText: z.string().min(1),
  knowledgeType: z.enum(knowledgeTypes),
  rationale: z.string().min(1),
  conceptNodeIds: z.array(z.string().min(1)).min(1).optional(),
});

const assessmentBlueprintSchema = z.object({
  id: z.string().min(1),
  objectiveId: z.string().min(1),
  knowledgeUnitId: z.string().min(1),
  relationToObjective: z.enum(["direct", "scaffold", "proxy"]),
  elicitedOperation: z.enum(learningOperations),
  coverageCriterionIds: z.array(z.string().min(1)).min(1),
  given: z.array(z.object({
    type: z.enum(["instruction", "context", "data", "diagram", "example"]),
    description: z.string().min(1),
  })).min(1),
  hidden: z.array(z.object({
    description: z.string().min(1),
    reason: z.enum(["target_answer", "required_inference", "intermediate_step"]),
  })).min(1),
  expectedResponse: z.object({
    kind: z.enum([
      "short_text",
      "structured_text",
      "single_choice",
      "multiple_choice",
      "ordered_structure",
      "unordered_structure",
      "numeric",
      "code",
      "graph_annotation",
      "audio",
      "checklist",
    ]),
    description: z.string().min(1),
  }),
  scoringRubric: z.array(z.object({
    criterionId: z.string().min(1),
    description: z.string().min(1),
    weight: z.number().positive(),
    gradingMode: z.enum(["exact", "semantic", "rule", "self"]),
  })).min(1),
  difficulty: z.object({
    cueLevel: z.enum(["high", "medium", "low"]),
    responseComplexity: z.enum(["atomic", "multi_part", "multi_step"]),
    transferDistance: z.enum(["same_context", "near_transfer", "far_transfer"]),
  }),
  requiredCapabilities: z.array(z.string()),
  conceptNodeIds: z.array(z.string().min(1)).min(1).optional(),
});

export const learningDesignSchema = z.object({
  objectives: z.array(learningDesignObjectiveSchema).min(1),
  knowledgeUnits: z.array(knowledgeUnitSchema).min(1),
  assessmentBlueprints: z.array(assessmentBlueprintSchema).min(1),
});

export const compactLearningDesignSchema = z.object({
  objectives: z.array(z.object({
    nodes: z.array(z.string().min(1)).min(1),
    target: z.string().min(1),
    operation: z.enum(learningOperations),
    criteria: z.array(z.object({
      description: z.string().min(1),
    })).min(1).max(3),
    importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })).min(1),
  units: z.array(z.object({
    objective: z.number().int().min(1),
    nodes: z.array(z.string().min(1)).min(1),
    content: z.string().min(1),
    evidence: z.string().min(1),
    kind: z.enum(knowledgeTypes),
    rationale: z.string().min(1),
  })).min(1),
  checks: z.array(z.object({
    unit: z.number().int().min(1),
    operation: z.enum(learningOperations),
    criteria: z.array(z.number().int().min(1)).min(1),
    relation: z.enum(["direct", "scaffold", "proxy"]),
    given: z.object({
      type: z.enum(["instruction", "context", "data", "diagram", "example"]),
      description: z.string().min(1),
    }),
    hidden: z.object({
      description: z.string().min(1),
      reason: z.enum(["target_answer", "required_inference", "intermediate_step"]),
    }),
    response: z.object({
      kind: z.enum([
        "short_text",
        "structured_text",
        "single_choice",
        "multiple_choice",
        "ordered_structure",
        "unordered_structure",
        "numeric",
        "code",
        "graph_annotation",
        "audio",
        "checklist",
      ]),
      description: z.string().min(1),
    }),
    grading: z.enum(["exact", "semantic", "rule", "self"]),
  })).min(1),
});

export type CompactLearningDesign = z.infer<typeof compactLearningDesignSchema>;

const plannedActivitySchema = z.object({
  blueprintId: z.string().min(1),
  recommendedType: z.enum(learningActivityTypes).nullable(),
  supportLevel: z.enum(["exact", "scaffold", "unsupported"]),
  reason: z.string().min(1),
  limitation: z.string(),
  includeInGeneration: z.boolean(),
});

const plannedCardCommonShape = {
  blueprintId: z.string().min(1),
  conceptNodeIds: z.array(z.string().min(1)).min(1).optional(),
  front: z.string().min(1),
  basis: z.string().min(1),
  strategy: z.enum(cardStrategies),
  difficulty: z.number().int().min(1).max(5),
  explanation: z.string().min(1),
  sourceGrounded: z.boolean(),
  verificationNotes: z.array(z.string()),
};

const plannedCardSchema = z.discriminatedUnion("activityType", [
  z.object({
    ...plannedCardCommonShape,
    activityType: z.literal("flashcard"),
    back: z.string().min(1),
  }),
  z.object({
    ...plannedCardCommonShape,
    activityType: z.literal("cloze"),
    clozeText: z.string().min(1),
    answer: z.string().min(1),
  }),
  z.object({
    ...plannedCardCommonShape,
    activityType: z.literal("true_false"),
    correctBoolean: z.boolean(),
  }),
  z.object({
    ...plannedCardCommonShape,
    activityType: z.literal("multiple_choice"),
    options: z.array(z.string().min(1)).min(3).max(5),
    correctOptionIndex: z.number().int().min(0),
  }),
  z.object({
    ...plannedCardCommonShape,
    activityType: z.literal("structure_recall"),
    structureNodes: z.array(structureRecallNodeSchema).min(3).max(8),
    structureRecallKind: structureRecallKindSchema,
    supportedStructureRecallModes: supportedStructureRecallModesSchema,
    structureRecallMode: structureRecallModeSchema,
  }),
]);

export const learningPlanGenerationSchema = z.object({
  activities: z.array(plannedActivitySchema).min(1),
  cards: z.array(plannedCardSchema),
});

export const activityDesignSchema = z.object({
  recommendations: z.array(activityRecommendationSchema).min(1),
  objectives: z.array(learningObjectiveSchema).optional(),
  blueprints: z.array(practiceBlueprintSchema).optional(),
  supportAssessments: z.array(supportAssessmentSchema).optional(),
  policy: z.object({
    includeExact: z.literal(true),
    includeScaffold: z.boolean(),
    includeProxy: z.boolean(),
    includeUnsupported: z.literal(false),
  }).optional(),
});

export const activityAuthoringResultSchema = z.object({
  objectives: z.array(learningObjectiveSchema),
  blueprints: z.array(practiceBlueprintSchema),
});

type CardGenerationBaselineTrace = {
  generatedCards: Array<z.infer<typeof cardDraftSchema>>;
  criticCards: Array<z.infer<typeof cardDraftSchema>>;
};

type GenerateCardsResponse = GeneratePipelineResult & {
  baselineTrace: CardGenerationBaselineTrace;
};

type PipelineStep = "analysis" | "activity" | "cards" | "critic";

const stepMessages: Record<PipelineStep, string> = {
  analysis: "학습 자료 분석에 실패했습니다.",
  activity: "문제 방식 추천에 실패했습니다.",
  cards: "암기 카드 생성에 실패했습니다.",
  critic: "암기 카드 품질 검사에 실패했습니다.",
};

const fallbackTitle = "새 학습 덱";

class PipelineError extends Error {
  readonly step: PipelineStep;
  readonly detail?: unknown;

  constructor(
    step: PipelineStep,
    message = stepMessages[step],
    detail?: unknown,
  ) {
    super(message);
    this.step = step;
    this.detail = detail;
  }
}

export async function POST(request: Request) {
  try {
    const { input, pdfs } = await parseGenerateRequest(request);

    if (
      input.stage !== "cards" &&
      input.stage !== "activity-design" &&
      input.stage !== "generate-from-plan" &&
      !input.sourceText.trim() &&
      pdfs.length === 0
    ) {
      return NextResponse.json(
        {
          message: "학습 자료 텍스트 또는 PDF 파일이 필요합니다.",
          step: "input",
        },
        { status: 400 },
      );
    }

    if (input.stage === "design") {
      const result = await runLearningDesign(input, pdfs);
      return NextResponse.json(result);
    }

    if (input.stage === "generate-from-plan") {
      if (
        !input.preparedAnalysis ||
        !input.preparedMaterial ||
        !input.learningDesign ||
        !input.codexThreadId
      ) {
        return NextResponse.json(
          {
            message: "확정한 학습 설계와 이어갈 Codex 대화가 필요합니다.",
            step: "input",
          },
          { status: 400 },
        );
      }
      const analysis = analysisSchema.parse(JSON.parse(input.preparedAnalysis));
      const organizedMaterial = organizedMaterialSchema.parse(
        JSON.parse(input.preparedMaterial),
      );
      const learningDesign = learningDesignSchema.parse(
        JSON.parse(input.learningDesign),
      );
      const result = await runLearningPlanGeneration({
        input,
        analysis,
        organizedMaterial,
        learningDesign,
      });
      return NextResponse.json(result);
    }

    if (input.stage === "activity-design" || input.stage === "cards") {
      if (!input.preparedAnalysis || !input.preparedMaterial) {
        return NextResponse.json(
          {
            message: "카드 생성에 사용할 추출 결과가 필요합니다.",
            step: "input",
          },
          { status: 400 },
        );
      }
      if (input.stage === "cards" && !input.activityDesign.trim()) {
        return NextResponse.json(
          {
            message: "문제 생성에 사용할 문제 설계 결과가 필요합니다.",
            step: "input",
          },
          { status: 400 },
        );
      }

      const analysis = analysisSchema.parse(
        JSON.parse(input.preparedAnalysis),
      );
      const organizedMaterial = organizedMaterialSchema.parse(
        JSON.parse(input.preparedMaterial),
      );

      if (input.stage === "activity-design") {
        const activityDesign = await runActivityDesign(analysis, organizedMaterial, {
          projectId: input.projectId,
          compactInput: true,
          instruction: input.instruction,
          sourceExpressionMode: input.sourceExpressionMode ?? "adapt",
        });
        return NextResponse.json({
          analysis,
          organizedMaterial,
          activityDesign,
          cards: [],
        });
      }

      const cardGeneration = await runCardGeneration(
        input.mode,
        organizedMaterial,
        analysis,
        input.instruction,
        input.studyGuideline,
        "",
        "",
        "",
        input.activityDesign,
        {
          activitySelectionMode: input.activitySelectionMode,
          cards: {
            projectId: input.projectId,
            compactInput: true,
            sourceExpressionMode: input.sourceExpressionMode ?? "adapt",
          },
          critic: { projectId: input.projectId },
        },
      );

      return NextResponse.json({
        analysis,
        organizedMaterial,
        cards: cardGeneration.cards,
        baselineTrace: cardGeneration.baselineTrace,
      } satisfies GenerateCardsResponse);
    }

    const analysis = await runAnalysis(input, pdfs);
    const organizedMaterial = buildReviewMaterial(input, analysis);

    const result: GeneratePipelineResult = {
      analysis,
      organizedMaterial,
      cards: [],
    };

    return NextResponse.json(result);
  } catch (error) {
    const codexFailure = toCodexHttpError(
      error,
      "암기자료 생성 요청을 처리하지 못했습니다.",
    );
    if (codexFailure.code !== "unknown") {
      const step = error instanceof PipelineError ? error.step : "unknown";
      console.error(codexFailure.message, { code: codexFailure.code, step });
      return NextResponse.json(
        {
          message: codexFailure.message,
          code: codexFailure.code,
          step,
        },
        { status: codexFailure.status },
      );
    }

    if (error instanceof PipelineError) {
      console.error(error.message, { step: error.step, detail: error.detail });
      return NextResponse.json(
        {
          message: error.message,
          step: error.step,
        },
        { status: 500 },
      );
    }

    console.error("generate route failed", error);
    return NextResponse.json(
      {
        message: "암기자료 생성 요청을 처리하지 못했습니다.",
        step: "unknown",
      },
      { status: 400 },
    );
  }
}

async function parseGenerateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      input: requestSchema.parse(await request.json()),
      pdfs: [],
    };
  }

  const formData = await request.formData();
  const files = [
    ...formData.getAll("pdfs"),
    formData.get("pdf"),
  ].filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
  const tagsText = String(formData.get("tags") ?? "[]");
  const input = requestSchema.parse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    tags: JSON.parse(tagsText),
    sourceText: String(formData.get("sourceText") ?? ""),
    instruction: String(formData.get("instruction") ?? ""),
    analysisContext: String(formData.get("analysisContext") ?? ""),
    studyGuideline: String(formData.get("studyGuideline") ?? ""),
    activityDesign: String(formData.get("activityDesign") ?? ""),
    learningDesign: String(formData.get("learningDesign") ?? ""),
    codexThreadId: String(formData.get("codexThreadId") ?? ""),
    activitySelectionMode: String(
      formData.get("activitySelectionMode") ?? "automatic",
    ),
    sourceExpressionMode: String(
      formData.get("sourceExpressionMode") ?? "adapt",
    ),
    stage: String(formData.get("stage") ?? "prepare"),
    preparedAnalysis: String(formData.get("preparedAnalysis") ?? ""),
    preparedMaterial: String(formData.get("preparedMaterial") ?? ""),
    mode: String(formData.get("mode") ?? "flashcard"),
  });

  if (files.length > 20) {
    throw new Error("한 번에 최대 20개의 PDF를 생성에 사용할 수 있습니다.");
  }

  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error("생성에 사용하는 PDF 전체 용량은 최대 50MB입니다.");
  }

  if (files.some((file) => file.type !== "application/pdf")) {
    throw new Error("PDF 파일만 업로드할 수 있습니다.");
  }

  const pdfs = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      return {
        filename: file.name,
        mimeType: file.type,
        base64: bytes.toString("base64"),
      };
    }),
  );

  return {
    input,
    pdfs,
  };
}

export async function runAnalysis(
  input: GenerateInput,
  pdfs: PdfInput[],
  runtime: StageRuntimeOptions = {},
) {
  const selectedOutlineLeafIds = getSelectedOutlineLeafIds(input.studyGuideline);
  const usesSelectedOutlineEvidence =
    selectedOutlineLeafIds.length > 0 &&
    input.sourceText.trim().length > 0 &&
    hasCompleteSelectedOutlineEvidence(
      input.studyGuideline,
      selectedOutlineLeafIds,
    );
  const analysisPdfs = usesSelectedOutlineEvidence ? [] : pdfs;
  const maxLearningUnitCount = getMaxLearningUnitCount(input.studyGuideline);
  const content = await callCodexJson({
    schemaName: "study_material_analysis",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "detectedGoal",
        "sourceType",
        "keyTopics",
        "recommendedStrategy",
        "extractedMaterial",
        "primaryKnowledgeType",
        "learningUnits",
      ],
      properties: {
        detectedGoal: { type: "string" },
        sourceType: {
          type: "string",
          enum: ["concept", "comparison", "script", "definition", "mixed"],
        },
        keyTopics: { type: "array", items: { type: "string" } },
        recommendedStrategy: { type: "string" },
        extractedMaterial: { type: "string" },
        primaryKnowledgeType: {
          type: "string",
          enum: knowledgeTypes,
        },
        learningUnits: {
          type: "array",
          minItems: 1,
          ...(maxLearningUnitCount
            ? { maxItems: maxLearningUnitCount }
            : {}),
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "sourceText",
              "knowledgeType",
              "fixedPart",
              "variableSlots",
              "generalizedForm",
              "target",
              "operation",
              "successCriterion",
              "rationale",
            ],
            properties: {
              id: { type: "string" },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              sourceText: { type: "string" },
              knowledgeType: { type: "string", enum: knowledgeTypes },
              fixedPart: { type: "string" },
              variableSlots: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "example"],
                  properties: {
                    name: { type: "string" },
                    example: { type: "string" },
                  },
                },
              },
              generalizedForm: { type: "string" },
              target: { type: "string" },
              operation: { type: "string", enum: learningOperations },
              successCriterion: { type: "string" },
              rationale: { type: "string" },
            },
          },
        },
      },
    },
    system:
      "당신은 선택된 원문 근거를 문제 하나 크기의 LearningUnit으로 정리하는 학습 분석가입니다. 문제는 만들지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    user: runtime.preparePromptMode === "current" || selectedOutlineLeafIds.length === 0
      ? buildAnalysisPrompt(input, analysisPdfs, runtime.instruction)
      : buildSimplifiedAnalysisPrompt(input, analysisPdfs, runtime.instruction),
    files: analysisPdfs,
    step: "analysis",
    model: runtime.model ?? EXTRACTION_MODEL,
    reasoningEffort: runtime.reasoningEffort ?? EXTRACTION_REASONING_EFFORT,
    projectId: input.projectId || runtime.projectId,
    usage: { ...runtime, stage: runtime.usageStage ?? "prepare" },
  });

  const parsed = analysisSchema.parse(content);
  if (
    maxLearningUnitCount &&
    (parsed.learningUnits?.length ?? 0) > maxLearningUnitCount
  ) {
    throw new PipelineError(
      "analysis",
      `학습 단위가 안전선 ${maxLearningUnitCount}개를 초과했습니다.`,
    );
  }
  return parsed;
}

function buildAnalysisPrompt(
  input: GenerateInput,
  pdfs: PdfInput[],
  runtimeInstruction?: string,
) {
  const usesSoftBudget = hasSoftCountPolicy(input.studyGuideline);
  const selectedOutlineLeafIds = getSelectedOutlineLeafIds(input.studyGuideline);
  return [
    `제목: ${input.title || fallbackTitle}`,
    `과목: ${input.subject || "미지정"}`,
    `태그: ${input.tags.join(", ") || "없음"}`,
    `사용자 추가 지시사항: ${
      input.instruction || "없음. 자료 성격을 기준으로 자동 판단합니다."
    }`,
    "",
    pdfs.length > 0
      ? `분석할 PDF 파일 (${pdfs.length}개): ${pdfs
          .map((pdf) => pdf.filename)
          .join(", ")}`
      : "분석할 학습 자료:",
    input.sourceText || "텍스트 입력 없음. 첨부 PDF를 기준으로 분석합니다.",
    input.analysisContext
      ? `\n사용자가 확인한 사전 구조 분석 결과:\n${input.analysisContext}`
      : "",
    input.studyGuideline
      ? `\n사용자가 확정한 학습 가이드:\n${input.studyGuideline}`
      : "",
    "",
    "해야 할 일:",
    "- 사용자가 자료를 학습한 뒤 실제로 무엇을 할 수 있어야 하는지 파악합니다.",
    ...(selectedOutlineLeafIds.length > 0
      ? [
          `- 사용자가 선택한 원문 목차 ID는 ${selectedOutlineLeafIds.join(", ")}입니다. 이 범위 밖의 내용을 LearningUnit으로 만들지 않습니다.`,
          "- 원문 목차는 문서의 구조이지 문제 하나의 크기가 아닙니다. 한 항목에 독립적으로 채점할 내용이 여러 개면 LearningUnit을 나누고, 여러 항목이 하나의 공통 관계·틀을 함께 설명하면 중복 없이 하나로 정리할 수 있습니다.",
          "- LearningUnit.id는 새 문제 단위의 고유 ID로 만들고, sourceId에는 주된 원문 목차 ID 또는 원본 파일명을 기록해 추적 가능하게 합니다.",
          pdfs.length > 0
            ? "- 각 최종 목차의 sourceEvidence는 학습 범위를 정하는 경계입니다. 첨부된 원본 PDF에서 같은 범위의 정확한 문장·수치·관계를 다시 확인해 sourceText와 sourceRange를 보강합니다."
            : "- 각 최종 목차의 sourceEvidence는 Plan에서 원본 PDF를 확인해 보존한 확정 근거입니다. 그 문장·수치·관계를 빠뜨리거나 바꾸지 말고 sourceText와 sourceRange에 보존합니다.",
          "- sourceText에 '사용자 참고 내용'이 있으면 이를 별도 참고 출처로 보존하고, 목차 근거나 PDF 원문으로 덮어쓰거나 누락하지 않습니다.",
        ]
      : []),
    "- 자료에서 실제로 학습해야 할 핵심 대상을 최소하고 독립적인 learningUnits로 추출합니다.",
    "- 자료 성격을 concept, comparison, script, definition, mixed 중 하나로 분류합니다.",
    `- 기존 호환용 메타데이터로 각 학습 단위를 지식 유형(${knowledgeTypes.join(", ")}) 중 하나로 분류하고 전체의 primaryKnowledgeType을 정합니다. 이 유형을 학습 행동이나 문제 방식 결정에 사용하지 마세요.`,
    "- 특정 유형을 미리 가정하지 않습니다. 자료에 근거가 없으면 speaking_pattern으로 억지 분류하지 않습니다.",
    "- sourceId에는 PDF 파일명 또는 direct-text를, sourcePage에는 확인 가능한 PDF 페이지 번호를 기록합니다. 페이지를 확인할 수 없으면 0을 씁니다.",
    "- sourceRange에는 페이지 안에서 원문을 다시 찾을 수 있는 제목·문단·문장 범위를 기록합니다.",
    "- sourceText에는 판단 근거가 된 원문을 보존합니다.",
    "- 반복 사용 가능한 패턴만 fixedPart와 variableSlots로 분리하고 generalizedForm에 일반화합니다.",
    "- 일반화하면 의미가 손실되는 지식은 fixedPart와 generalizedForm을 빈 문자열로 둡니다.",
    "- rationale에는 이 단위를 선택하고 분류한 이유를 자료 근거 중심으로 기록합니다.",
    "- target에는 이 단위에서 학습자가 가져가야 할 대상을 분류명 없이 구체적인 자연어 한 문장으로 적습니다.",
    "- operation에는 학습자가 그 대상에 대해 성공적으로 보여야 할 주 행동 하나만 정합니다: recall은 자료 없이 대상 자체를 말하거나 적기, reconstruct는 자료에서 배운 고정된 구성·관계·순서를 같은 구조로 복원하기, discriminate는 조건을 보고 맞음·틀림 또는 적절한 대상을 판별하기, apply는 새로운 입력에 지식이나 규칙을 사용해 입력에 따라 달라지는 결과 만들기입니다.",
    "- 그래프·수치·상황 등 새로운 입력에 따라 정답이 달라지면 순서를 쓰더라도 reconstruct가 아니라 apply입니다.",
    "- 절차의 순서 자체를 자료 없이 재현하는 목표는 reconstruct이지만, 그 절차를 실제 상황에서 실행하는 목표는 apply입니다. target과 successCriterion의 행동이 서로 달라지면 안 됩니다.",
    "- 하나의 target과 successCriterion에는 독립적으로 성공·실패를 판정할 수 있는 행동 하나만 둡니다.",
    "- ‘A를 하거나 B를 한다’처럼 서로 다른 성공 방법을 하나로 묶지 마세요. 방문 결과 산출과 코드 구현처럼 각각 따로 평가할 수 있으면 별도 LearningUnit입니다.",
    "- 하나의 LearningUnit은 보통 한 번의 집중된 연습에서 하나의 질문과 하나의 답으로 성공 여부를 판단할 수 있는 크기여야 합니다.",
    "- 한 target에 서로 독립적인 여러 결과·규칙·판단이 들어가 일부만 맞을 수 있다면 LearningUnit을 나눕니다.",
    "- 단, 여러 요소의 순서·분류·대응 관계 전체를 복원하거나 하나의 공통 틀을 완성하는 것이 목표라면 요소 수만 보고 쪼개지 않습니다.",
    "- 긴 장 전체를 한 번에 모두 재현하게 하지 말고, 자료가 실제로 함께 다루는 의미 단위 중 한 번에 연습 가능한 가장 큰 단위로 만듭니다.",
    "- 네 operation은 난이도 순서가 아닙니다. 자료에 같은 공식이 있어도 공식 자체가 학습 대상이면 recall, 새 문제에 사용하는 능력이 목표면 apply가 될 수 있습니다.",
    "- successCriterion에는 학습자가 무엇을 하면 이 target을 배웠다고 판정할 수 있는지 관찰 가능한 행동으로 한 문장에 적습니다.",
    "- 보조 행동을 추가하지 마세요. 서로 독립적으로 성공하거나 실패할 수 있는 행동이 둘이면 target과 LearningUnit을 분리합니다.",
    "- 이후 암기자료 생성을 위한 추천 전략을 제안합니다.",
    "- extractedMaterial에는 추출한 학습 단위를 원문 확인용 목록으로 정리합니다. 카드 앞면·뒷면이나 Cue·Target 형태로 만들지 않습니다.",
    "- PDF 안에 그림이나 슬라이드 구조가 의미를 가진다면 텍스트로 설명해 extractedMaterial에 포함합니다.",
    "- 확정 학습 가이드에 selectedGroup이 있으면 그 영역만 추출하고 다른 영역의 내용은 제외합니다.",
    "- 하나의 LearningUnit에는 독립적으로 질문하고 정답을 판정할 수 있는 하나의 학습 목표만 둡니다.",
    "- 두 내용을 각각 따로 질문하고 각각 맞거나 틀릴 수 있다면 별도 LearningUnit으로 분리합니다.",
    "- 순서·상하 관계·분류 구조 자체가 학습 목표라면 관계를 구성하는 요소를 억지로 낱개 사실로 분해하지 않고 관계 전체를 하나의 LearningUnit으로 유지합니다.",
    "- 개수를 맞추기 위해 독립 목표를 합치거나 하나의 의미를 낮은 가치 조각으로 쪼개지 않습니다.",
    ...(usesSoftBudget
      ? [
          "- 학습 목표에 필요한 핵심 의미 단위를 빠짐없이 추출합니다.",
          "- soft budget을 채우기 위해 낮은 가치 내용, 반복 요약, 예시의 고유 정보 또는 메타데이터를 추가하지 않습니다.",
          "- learningUnitSoftBudget.max는 과다 추출을 막는 안전선이며, max까지 채우라는 뜻이 아닙니다.",
          "- 학습 가치가 있는 독립 LearningUnit만 반환합니다. 최소 개수나 예상 개수는 없습니다.",
          "- 의미적 완결성과 원자성이 soft budget보다 우선합니다.",
        ]
      : [
          "- selectedGroup.itemCount는 해당 범위를 빠짐없이 확인하기 위한 참고값이며 원자성과 학습 가치를 훼손하면서 정확히 맞추지 않습니다.",
        ]),
    "- 패턴, 예문, 스크립트는 요약하지 말고 PDF의 원문 표현과 번역을 그대로 보존합니다.",
    "- 이 단계에서는 카드 형식, Cue, Target, 빈칸 또는 질문·답변을 만들지 않습니다.",
    "- 대표 예시와 인출 방식은 이후 카드 생성 단계가 적용하므로 여기서는 원문 지식 구조만 추출합니다.",
    "- 불확실한 내용은 추측하지 말고 확인 가능한 내용 중심으로 씁니다.",
    ...(runtimeInstruction
      ? ["", "실험 실행 추가 지시:", runtimeInstruction]
      : []),
  ].join("\n");
}

function buildSimplifiedAnalysisPrompt(
  input: GenerateInput,
  pdfs: PdfInput[],
  runtimeInstruction?: string,
) {
  const selectedOutlineLeafIds = getSelectedOutlineLeafIds(input.studyGuideline);
  return [
    `제목: ${input.title || fallbackTitle}`,
    `과목: ${input.subject || "미지정"}`,
    `사용자 추가 지시사항: ${input.instruction || "없음"}`,
    "",
    pdfs.length > 0 ? "첨부 PDF와 아래 정보를 함께 사용합니다." : "아래 확정 근거만 사용합니다.",
    input.sourceText || "텍스트 입력 없음",
    input.analysisContext ? `\n사전 구조 분석:\n${input.analysisContext}` : "",
    input.studyGuideline ? `\n확정 학습 가이드:\n${input.studyGuideline}` : "",
    "",
    "목표: 선택된 원문 근거를 한 번의 문제로 연습하고 판정할 수 있는 LearningUnit으로 정리합니다. 아직 문제를 만들지 않습니다.",
    "",
    "단위 경계:",
    selectedOutlineLeafIds.length > 0
      ? `- 선택된 원문 목차 ID(${selectedOutlineLeafIds.join(", ")}) 안에서 한 번에 질문하고 채점할 수 있는 LearningUnit을 만듭니다. 원문 목차와 LearningUnit을 억지로 1:1로 맞추지 않습니다.`
      : "- 자료에서 한 문제로 연습하고 성공 여부를 판정할 수 있는 LearningUnit을 만듭니다.",
    "- 독립적으로 성공·실패할 수 있는 행동은 나누고, 순서·상하·분류 관계 자체가 목표면 관계 전체를 유지합니다. 개수를 맞추려고 합치거나 잘게 쪼개지 않습니다.",
    "- target에는 무엇을 익힐지, successCriterion에는 그것을 배웠다고 판정할 관찰 가능한 행동 하나를 씁니다.",
    "",
    "operation 선택:",
    "- recall=배운 대상 자체를 말하거나 적기, reconstruct=배운 고정 구조·관계·순서를 복원하기, discriminate=주어진 조건에서 맞는 대상을 판별하기, apply=새 입력을 계산·변환·구성해 달라지는 결과 만들기입니다.",
    "- 학습 목표와 원문이 실제로 요구하는 행동을 선택합니다. 조건문이 있다는 이유만으로 apply로, 여러 사실이 있다는 이유만으로 reconstruct로 분류하지 않습니다.",
    "- target, operation, successCriterion은 같은 행동을 가리켜야 하며 원래 목표를 더 쉬운 암기나 더 어려운 수행으로 바꾸지 않습니다.",
    "",
    "근거와 호환 필드:",
    "- sourceText에는 근거의 문장·수치·공식·관계와 원문 표현을 보존합니다.",
    "- 반복 사용 가능한 표현만 fixedPart, variableSlots, generalizedForm으로 일반화하고, 나머지는 빈 값으로 둡니다.",
    "- sourceType, knowledgeType, primaryKnowledgeType은 호환용 내용 분류이며 operation 판단에 사용하지 않습니다.",
    "- rationale은 판단 근거를 짧게, extractedMaterial은 단위별 근거 목록을 짧게, recommendedStrategy는 전체 학습 방향을 한 문장으로 씁니다.",
    "- 질문·정답·보기·카드·빈칸을 만들지 않고 근거 밖 사실을 추가하지 않습니다.",
    ...(runtimeInstruction ? ["", "실험 추가 지시:", runtimeInstruction] : []),
  ].join("\n");
}

export function buildReviewMaterial(
  input: GenerateInput,
  analysis: AnalysisResult,
) : OrganizedMaterial {
  return {
    title: input.title || analysis.keyTopics[0] || fallbackTitle,
    sections: (analysis.learningUnits ?? []).map((unit, index) => ({
      heading: learningUnitTarget(unit) || `학습 단위 ${index + 1}`,
      content: unit.generalizedForm || unit.sourceText,
      learningUnitIds: [unit.id],
    })),
  };
}

export async function runLearningDesign(
  input: GenerateInput,
  pdfs: PdfInput[],
): Promise<GeneratePipelineResult> {
  const selectedOutlineLeafIds = getSelectedOutlineLeafIds(input.studyGuideline);
  const maxKnowledgeUnits = getMaxLearningUnitCount(input.studyGuideline) ?? 80;
  const result = await callCodexJsonThread({
    schemaName: "compact_learning_design",
    schema: buildCompactLearningDesignJsonSchema(maxKnowledgeUnits),
    system:
      "당신은 원문 근거를 능동 인출 학습 설계로 바꾸는 학습 설계자입니다. 아직 문제 문장이나 문제 형식은 만들지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      `제목: ${input.title || fallbackTitle}`,
      `사용자 학습 목표와 추가 지시: ${input.instruction || "없음"}`,
      "",
      "사용자가 선택한 원문 범위와 근거:",
      input.sourceText || "첨부 PDF의 선택 범위",
      "",
      input.analysisContext
        ? `앞 단계 Analyze 결과:\n${input.analysisContext}`
        : "",
      input.studyGuideline
        ? `사용자가 확정한 범위와 학습 가이드:\n${input.studyGuideline}`
        : "",
      "",
      "이번 턴에서는 분석 결과를 다시 요약한 새 목차를 만들지 말고 다음 세 작업만 순서대로 수행하세요.",
      "1. 선택된 원문 목차에 Learning Objective를 연결합니다. 학습자가 무엇을 설명·구별·적용·복원할 수 있어야 하는지와 성공 기준을 정합니다.",
      "2. 각 목표를 이루기 위해 실제로 익혀야 하는 의미적으로 완결된 Knowledge Unit을 만듭니다. 문제 하나 크기로 자르지 않습니다.",
      "3. 각 Knowledge Unit을 어떤 학습 행동으로 확인할지 Assessment Blueprint를 만듭니다.",
      "",
      "엄격한 설계 규칙:",
      `- nodes에는 사용자가 선택한 원문 목차 ID만 사용합니다: ${selectedOutlineLeafIds.join(", ") || "제공된 범위 전체"}`,
      "- objective, unit, criteria 참조 번호는 각 배열에서 위에서부터 세는 1부터 시작하는 번호입니다.",
      "- Knowledge Unit 하나에는 기본적으로 Assessment Blueprint 하나만 둡니다.",
      "- 서로 다른 성공 기준이나 서로 다른 학습 행동을 따로 확인해야 할 때만 2~3개로 늘립니다.",
      "- 중요도가 높다는 이유만으로 문제 수를 늘리지 않습니다.",
      "- 같은 답을 문제 형식만 바꾸어 반복하는 Blueprint를 만들지 않습니다.",
      "- 문제 형식, 실제 질문, 보기, 정답 문장은 아직 결정하지 않습니다.",
      "- evidence에는 해당 학습 내용의 근거가 되는 원문을 짧고 정확하게 옮깁니다.",
      "- ID, 파일명, 페이지, 채점표 반복 항목과 난이도 기본값은 서버가 조립하므로 출력하지 않습니다.",
      "- grading은 기대 응답을 실제로 어떻게 판정할지에 맞게 지정합니다.",
    ].filter(Boolean).join("\n"),
    files: pdfs,
    step: "analysis",
    model: EXTRACTION_MODEL,
    reasoningEffort: EXTRACTION_REASONING_EFFORT,
    projectId: input.projectId,
    threadScope: "job",
  });

  let learningDesign: LearningDesignPlan;
  try {
    learningDesign = materializeCompactLearningDesign(
      result.data,
      input.studyGuideline,
      input.title || fallbackTitle,
    );
  } catch (error) {
    throw new PipelineError(
      "analysis",
      "AI 학습 설계에 필수 항목이 빠졌습니다. 다시 시도해 주세요.",
      error,
    );
  }
  validateLearningDesignPlan(learningDesign, selectedOutlineLeafIds, maxKnowledgeUnits);
  const analysis = adaptLearningDesignToAnalysis(learningDesign, input);
  const organizedMaterial = buildReviewMaterial(input, analysis);
  return {
    analysis,
    organizedMaterial,
    cards: [],
    learningDesign,
    codexThreadId: result.threadId,
  };
}

export async function runLearningPlanGeneration({
  input,
  analysis,
  organizedMaterial,
  learningDesign,
}: {
  input: GenerateInput;
  analysis: AnalysisResult;
  organizedMaterial: OrganizedMaterial;
  learningDesign: LearningDesignPlan;
}): Promise<GeneratePipelineResult> {
  const includedUnitIds = new Set(
    organizedMaterial.sections.flatMap((section) => section.learningUnitIds ?? []),
  );
  const scopedDesign = filterLearningDesign(
    learningDesign,
    includedUnitIds.size > 0 ? includedUnitIds : null,
  );
  validateLearningDesignPlan(scopedDesign, [], undefined);

  const result = await callCodexJsonThread({
    schemaName: "activity_design_cards_and_verification",
    schema: buildLearningPlanGenerationJsonSchema(
      scopedDesign.assessmentBlueprints.length,
    ),
    system:
      "당신은 확정된 학습 설계를 실행 가능한 능동 인출 문제로 표현하고 원문과 대조 검수하는 출제자입니다. 앞 턴의 설계를 바꾸지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      "앞 턴에서 확정한 학습 설계를 이어서 처리하세요.",
      "",
      "사용자가 확인한 최종 설계:",
      JSON.stringify(scopedDesign, null, 2),
      "",
      `사용자 추가 지시: ${input.instruction || "없음"}`,
      "",
      "이번 턴의 순서:",
      "1. 각 Assessment Blueprint마다 현재 앱의 형식(플래시카드, OX, 객관식, 구조복원) 중 하나를 고릅니다.",
      "2. 완전 지원·보조 지원·미지원을 구분합니다. 미지원이면 recommendedType은 null이고 카드를 만들지 않습니다.",
      "3. 지원되는 Blueprint 하나를 Card 하나로 표현합니다. 목표·학습내용·문제 수를 다시 판단하지 않습니다.",
      "4. 완성한 모든 카드를 원문 근거와 다시 대조해 정답 오류, 근거 없는 내용, 중복, 애매한 표현을 바로 수정합니다.",
      "",
      "필수 규칙:",
      "- activity와 card는 반드시 blueprintId로 연결합니다.",
      "- 같은 Blueprint에서 카드 여러 개를 만들지 않습니다.",
      "- front에 정답을 노출하지 않고 한 카드에는 하나의 분명한 학습 행동만 둡니다.",
      "- 객관식 오답도 원문과 모순 여부를 검토하고 외부 사실을 새 학습내용처럼 넣지 않습니다.",
      "- basis에는 정답을 확인할 수 있는 짧은 원문 근거를 넣습니다.",
      "- 최종 대조가 끝난 카드만 sourceGrounded=true로 반환합니다. false인 카드는 수정한 뒤 반환하세요.",
      ...buildSourceExpressionRules(input.sourceExpressionMode ?? "adapt"),
    ].join("\n"),
    threadId: input.codexThreadId,
    step: "cards",
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    projectId: input.projectId,
    threadScope: "job",
  });

  let generated: z.infer<typeof learningPlanGenerationSchema>;
  try {
    generated = learningPlanGenerationSchema.parse(result.data);
  } catch (error) {
    throw new PipelineError(
      "cards",
      "AI가 만든 문제 또는 검수 결과가 형식에 맞지 않습니다. 다시 시도해 주세요.",
      error,
    );
  }
  const { activityDesign, cards } = materializeLearningPlanGeneration(
    generated,
    scopedDesign,
    analysis,
  );
  return {
    analysis,
    organizedMaterial,
    cards,
    learningDesign: scopedDesign,
    activityDesign,
    codexThreadId: result.threadId,
  };
}

type LearningDesignOutlineNode = {
  id: string;
  title: string;
  sourceEvidence: string;
  sourceRefs: Array<{
    sourceId?: string;
    fileName: string;
    pageNumbers: number[];
  }>;
};

function getLearningDesignOutlineNodes(studyGuideline: string) {
  if (!studyGuideline.trim()) return [];
  try {
    const guideline = JSON.parse(studyGuideline) as {
      wholeDocumentCore?: {
        learningOutline?: { nodes?: LearningDesignOutlineNode[] };
      };
    };
    return guideline.wholeDocumentCore?.learningOutline?.nodes ?? [];
  } catch {
    return [];
  }
}

export function materializeCompactLearningDesign(
  value: unknown,
  studyGuideline: string,
  fallbackSourceId = fallbackTitle,
): LearningDesignPlan {
  const compact = compactLearningDesignSchema.parse(value);
  const outlineById = new Map(
    getLearningDesignOutlineNodes(studyGuideline).map((node) => [node.id, node]),
  );

  const objectives = compact.objectives.map((objective, objectiveIndex) => ({
    id: `objective-${objectiveIndex + 1}`,
    outlineNodeIds: objective.nodes,
    target: objective.target,
    terminalOperation: objective.operation,
    successCriteria: objective.criteria.map((criterion, criterionIndex) => ({
      id: `criterion-${objectiveIndex + 1}-${criterionIndex + 1}`,
      description: criterion.description,
      required: true,
    })),
    importance: objective.importance,
  }));

  const knowledgeUnits = compact.units.map((unit, unitIndex) => {
    const objective = objectives[unit.objective - 1];
    if (!objective) {
      throw new PipelineError(
        "analysis",
        `학습 내용 ${unitIndex + 1}이 존재하지 않는 목표 ${unit.objective}번을 참조합니다.`,
      );
    }
    const outlineNodes = unit.nodes
      .map((nodeId) => outlineById.get(nodeId))
      .filter((node): node is LearningDesignOutlineNode => Boolean(node));
    const sourceRef = outlineNodes.flatMap((node) => node.sourceRefs ?? [])[0];
    return {
      id: `knowledge-unit-${unitIndex + 1}`,
      objectiveId: objective.id,
      outlineNodeIds: unit.nodes,
      content: unit.content,
      sourceId: sourceRef?.sourceId || sourceRef?.fileName || fallbackSourceId,
      sourcePage: sourceRef?.pageNumbers?.[0] ?? 0,
      sourceRange: outlineNodes.map((node) => node.title).filter(Boolean).join(" / "),
      sourceText: unit.evidence,
      knowledgeType: unit.kind,
      rationale: unit.rationale,
    };
  });

  const assessmentBlueprints = compact.checks.map((check, checkIndex) => {
    const unit = knowledgeUnits[check.unit - 1];
    if (!unit) {
      throw new PipelineError(
        "analysis",
        `평가 설계 ${checkIndex + 1}이 존재하지 않는 학습 내용 ${check.unit}번을 참조합니다.`,
      );
    }
    const objective = objectives.find((item) => item.id === unit.objectiveId)!;
    const criteria = check.criteria.map((criterionNumber) => {
      const criterion = objective.successCriteria[criterionNumber - 1];
      if (!criterion) {
        throw new PipelineError(
          "analysis",
          `평가 설계 ${checkIndex + 1}이 목표에 없는 성공 기준 ${criterionNumber}번을 참조합니다.`,
        );
      }
      return criterion;
    });
    const multiPartKinds = new Set([
      "structured_text",
      "ordered_structure",
      "unordered_structure",
      "checklist",
    ]);
    return {
      id: `blueprint-${checkIndex + 1}`,
      objectiveId: objective.id,
      knowledgeUnitId: unit.id,
      relationToObjective: check.relation,
      elicitedOperation: check.operation,
      coverageCriterionIds: criteria.map((criterion) => criterion.id),
      given: [check.given],
      hidden: [check.hidden],
      expectedResponse: check.response,
      scoringRubric: criteria.map((criterion) => ({
        criterionId: criterion.id,
        description: criterion.description,
        weight: 1,
        gradingMode: check.grading,
      })),
      difficulty: {
        cueLevel: "medium" as const,
        responseComplexity: check.operation === "apply"
          ? "multi_step" as const
          : multiPartKinds.has(check.response.kind)
            ? "multi_part" as const
            : "atomic" as const,
        transferDistance: check.operation === "apply"
          ? "near_transfer" as const
          : "same_context" as const,
      },
      requiredCapabilities: [
        ...(check.given.type === "diagram" ? ["graph_annotation"] : []),
        ...(["code", "graph_annotation", "audio", "checklist"].includes(
          check.response.kind,
        ) ? [check.response.kind] : []),
      ].filter((item, index, values) => values.indexOf(item) === index),
    };
  });

  return learningDesignSchema.parse({
    objectives,
    knowledgeUnits,
    assessmentBlueprints,
  }) as LearningDesignPlan;
}

export function adaptLearningDesignToAnalysis(
  design: LearningDesignPlan,
  input: GenerateInput,
): AnalysisResult {
  const objectiveById = new Map(design.objectives.map((item) => [item.id, item]));
  const learningUnits: LearningUnit[] = design.knowledgeUnits.map((unit) => {
    const objective = objectiveById.get(unit.objectiveId);
    return {
      id: unit.id,
      sourceId: unit.sourceId,
      sourcePage: unit.sourcePage,
      sourceRange: unit.sourceRange,
      sourceText: unit.sourceText,
      knowledgeType: unit.knowledgeType,
      fixedPart: unit.content,
      variableSlots: [],
      generalizedForm: unit.content,
      target: unit.content,
      operation: objective?.terminalOperation ?? "recall",
      successCriterion: objective?.successCriteria.map((item) => item.description).join(" / "),
      rationale: unit.rationale,
    };
  });
  return {
    detectedGoal:
      design.objectives.map((item) => item.target).join(" / ") || input.instruction,
    sourceType: "mixed",
    keyTopics: design.objectives.map((item) => item.target).slice(0, 8),
    recommendedStrategy: "확정한 목표와 평가 설계에 따라 능동 인출 문제를 생성합니다.",
    extractedMaterial: design.knowledgeUnits.map((item) => item.content).join("\n\n"),
    primaryKnowledgeType: design.knowledgeUnits[0]?.knowledgeType ?? "other",
    learningUnits,
  };
}

function filterLearningDesign(
  design: LearningDesignPlan,
  includedUnitIds: Set<string> | null,
): LearningDesignPlan {
  if (!includedUnitIds) return design;
  const knowledgeUnits = design.knowledgeUnits.filter((unit) =>
    includedUnitIds.has(unit.id),
  );
  const knowledgeUnitIds = new Set(knowledgeUnits.map((unit) => unit.id));
  const objectiveIds = new Set(knowledgeUnits.map((unit) => unit.objectiveId));
  return {
    objectives: design.objectives.filter((item) => objectiveIds.has(item.id)),
    knowledgeUnits,
    assessmentBlueprints: design.assessmentBlueprints.filter((item) =>
      knowledgeUnitIds.has(item.knowledgeUnitId),
    ),
  };
}

export function validateLearningDesignPlan(
  design: LearningDesignPlan,
  selectedOutlineIds: string[] = [],
  maxKnowledgeUnits?: number,
) {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(design.objectives.map((item) => item.id)) ||
    !unique(design.knowledgeUnits.map((item) => item.id)) ||
    !unique(design.assessmentBlueprints.map((item) => item.id))
  ) {
    throw new PipelineError("analysis", "학습 설계의 ID가 중복되었습니다.");
  }
  if (maxKnowledgeUnits && design.knowledgeUnits.length > maxKnowledgeUnits) {
    throw new PipelineError(
      "analysis",
      `학습 내용이 안전선 ${maxKnowledgeUnits}개를 초과했습니다.`,
    );
  }
  const selectedIds = new Set(selectedOutlineIds);
  const objectiveById = new Map(design.objectives.map((item) => [item.id, item]));
  const unitById = new Map(design.knowledgeUnits.map((item) => [item.id, item]));
  for (const objective of design.objectives) {
    if (
      selectedIds.size > 0 &&
      objective.outlineNodeIds.some((id) => !selectedIds.has(id))
    ) {
      throw new PipelineError("analysis", "선택하지 않은 원문 목차가 학습 목표에 포함되었습니다.");
    }
    if (!design.knowledgeUnits.some((unit) => unit.objectiveId === objective.id)) {
      throw new PipelineError("analysis", "학습 내용이 연결되지 않은 학습 목표가 있습니다.");
    }
  }
  const blueprintCountByUnit = new Map<string, number>();
  for (const unit of design.knowledgeUnits) {
    if (!objectiveById.has(unit.objectiveId)) {
      throw new PipelineError("analysis", "학습 내용의 학습 목표 연결이 올바르지 않습니다.");
    }
    if (selectedIds.size > 0 && unit.outlineNodeIds.some((id) => !selectedIds.has(id))) {
      throw new PipelineError("analysis", "선택하지 않은 원문 목차가 학습 내용에 포함되었습니다.");
    }
  }
  for (const blueprint of design.assessmentBlueprints) {
    const unit = unitById.get(blueprint.knowledgeUnitId);
    const objective = objectiveById.get(blueprint.objectiveId);
    if (!unit || !objective || unit.objectiveId !== objective.id) {
      throw new PipelineError("analysis", "평가 설계의 학습 내용 연결이 올바르지 않습니다.");
    }
    const criterionIds = new Set(objective.successCriteria.map((item) => item.id));
    if (blueprint.coverageCriterionIds.some((id) => !criterionIds.has(id))) {
      throw new PipelineError("analysis", "평가 설계가 존재하지 않는 성공 기준을 참조합니다.");
    }
    blueprintCountByUnit.set(
      unit.id,
      (blueprintCountByUnit.get(unit.id) ?? 0) + 1,
    );
  }
  for (const unit of design.knowledgeUnits) {
    const count = blueprintCountByUnit.get(unit.id) ?? 0;
    if (count < 1 || count > 3) {
      throw new PipelineError(
        "analysis",
        "학습 내용 하나에는 평가 설계가 1~3개여야 합니다.",
      );
    }
  }
}

export async function runActivityDesign(
  analysis: AnalysisResult,
  organizedMaterial: OrganizedMaterial,
  runtime: StageRuntimeOptions = {},
): Promise<ActivityDesign> {
  const learningUnits = selectLearningUnitsForCards(analysis, organizedMaterial);
  if (learningUnits.length === 0) {
    throw new PipelineError("activity", "추천할 학습 내용이 없습니다.");
  }
  assertLearningUnitsReady({ learningUnits });
  const activityDesignInput = createCompactActivityDesignInput(
    analysis,
    learningUnits,
    runtime.sourceExpressionMode ?? "adapt",
  );

  const content = await callCodexJson({
    schemaName: "practice_blueprint_design",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["objectives", "blueprints"],
      properties: {
        objectives: {
          type: "array",
          minItems: learningUnits.length,
          maxItems: learningUnits.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id", "outlineNodeId", "learningUnitId", "target",
              "terminalOperation", "successCriteria", "importance",
            ],
            properties: {
              id: { type: "string" },
              outlineNodeId: { type: "string" },
              learningUnitId: { type: "string" },
              target: { type: "string" },
              terminalOperation: { type: "string", enum: learningOperations },
              successCriteria: {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "description", "required"],
                  properties: {
                    id: { type: "string" },
                    description: { type: "string" },
                    required: { type: "boolean" },
                  },
                },
              },
              importance: { type: "integer", minimum: 0, maximum: 3 },
            },
          },
        },
        blueprints: {
          type: "array",
          minItems: learningUnits.length,
          maxItems: learningUnits.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id", "objectiveId", "learningUnitId", "relationToObjective",
              "elicitedOperation", "coverageCriterionIds", "given", "hidden",
              "expectedResponse", "scoringRubric", "difficulty",
              "requiredCapabilities", "recommendedType",
            ],
            properties: {
              id: { type: "string" },
              objectiveId: { type: "string" },
              learningUnitId: { type: "string" },
              relationToObjective: {
                type: "string",
                enum: ["direct", "scaffold", "proxy"],
              },
              elicitedOperation: { type: "string", enum: learningOperations },
              coverageCriterionIds: { type: "array", minItems: 1, maxItems: 1, items: { type: "string" } },
              given: {
                type: "array", minItems: 1,
                items: {
                  type: "object", additionalProperties: false,
                  required: ["type", "description"],
                  properties: {
                    type: { type: "string", enum: ["instruction", "context", "data", "diagram", "example"] },
                    description: { type: "string" },
                  },
                },
              },
              hidden: {
                type: "array", minItems: 1,
                items: {
                  type: "object", additionalProperties: false,
                  required: ["description", "reason"],
                  properties: {
                    description: { type: "string" },
                    reason: { type: "string", enum: ["target_answer", "required_inference", "intermediate_step"] },
                  },
                },
              },
              expectedResponse: {
                type: "object", additionalProperties: false,
                required: ["kind", "description"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["short_text", "structured_text", "single_choice", "multiple_choice", "ordered_structure", "unordered_structure", "numeric", "code", "graph_annotation", "audio", "checklist"],
                  },
                  description: { type: "string" },
                },
              },
              scoringRubric: {
                type: "array", minItems: 1, maxItems: 1,
                items: {
                  type: "object", additionalProperties: false,
                  required: ["criterionId", "description", "weight", "gradingMode"],
                  properties: {
                    criterionId: { type: "string" },
                    description: { type: "string" },
                    weight: { type: "number", exclusiveMinimum: 0 },
                    gradingMode: { type: "string", enum: ["exact", "semantic", "rule", "self"] },
                  },
                },
              },
              difficulty: {
                type: "object", additionalProperties: false,
                required: ["cueLevel", "responseComplexity", "transferDistance"],
                properties: {
                  cueLevel: { type: "string", enum: ["high", "medium", "low"] },
                  responseComplexity: { type: "string", enum: ["atomic", "multi_part", "multi_step"] },
                  transferDistance: { type: "string", enum: ["same_context", "near_transfer", "far_transfer"] },
                },
              },
              requiredCapabilities: { type: "array", items: { type: "string" } },
              recommendedType: { type: "string", enum: learningActivityTypes },
            },
          },
        },
      },
    },
    system:
      "당신은 확정된 학습 내용을 학습목표와 실제 문제 설계서로 분리하는 평가 설계자입니다. 문제 문장을 바로 만들지 말고 학생에게 줄 정보, 숨길 정보, 기대 응답과 채점 기준을 먼저 설계합니다. 결과는 한국어 JSON으로만 반환합니다.",
    user: [
      "확정된 학습 내용:",
      JSON.stringify(activityDesignInput, null, 2),
      "sourcePages는 문서별 공통 원문이며, 각 unit의 pageRefs가 참조하는 페이지만 해당 unit의 근거로 사용합니다.",
      "",
      "사용 가능한 문제 화면:",
      "- flashcard: 단서를 보고 답을 먼저 떠올린 뒤 뒷면과 자기 확인",
      "- cloze: 문장 속 ____ 한 곳을 짧은 정답으로 직접 입력해 자동 채점",
      "- true_false: 명제 하나를 O/X로 자동 채점",
      "- multiple_choice: 후보 3~4개 중 정답 하나를 선택해 자동 채점",
      "- structure_recall: 고정된 순서·상하 관계·분류 구조를 짧은 라벨로 복원",
      "",
      ...buildSourceExpressionRules(runtime.sourceExpressionMode ?? "adapt"),
      "",
      "목표: 각 LearningUnit의 학습 행동을 보존하면서, 현재 화면으로 만들 문제 설계서를 하나씩 확정합니다. 아직 최종 문제 문장은 만들지 않습니다.",
      "",
      "경계와 성공 기준:",
      "- LearningUnit마다 LearningObjective 하나와 PracticeBlueprint 하나를 만들고 다시 쪼개거나 합치지 않습니다.",
      "- operation은 terminalOperation으로 유지하고, target과 successCriterion을 새 목표로 바꾸지 않습니다. successCriteria와 scoringRubric은 각각 하나입니다.",
      "- relationToObjective는 최종 행동 자체면 direct, 필수 하위 연습이면 scaffold, 관련은 있지만 숙련 증거가 아니면 proxy입니다.",
      "",
      "문제 설계:",
      "- given에는 학생에게 보여줄 완성된 입력만, hidden에는 정답·필수 추론·중간 결과만 둡니다. 결론이나 정답을 given에 노출하지 않습니다.",
      "- apply·discriminate는 실제로 풀 수 있는 구체 입력 하나와 그 입력을 풀어 확정한 target_answer를 만듭니다. 입력의 종류나 정답의 형식만 적지 않습니다.",
      "- expectedResponse는 학생이 직접 해야 할 응답을, scoringRubric은 그 한 문제의 성공 조건을 나타냅니다. numeric 응답이면 실제 숫자 정답을 포함합니다.",
      "- 현재 형식으로 최종 수행을 직접 채점할 수 없어도, 구체 입력을 front에 주고 먼저 수행한 뒤 back과 비교하는 flashcard scaffold는 가능합니다. 이를 정의 회상으로 낮추지 않습니다.",
      "- structure_recall은 고정된 순서·상하 관계·분류 구조 자체가 목표일 때만 사용합니다.",
      "",
      "지원 판단:",
      "- requiredCapabilities에는 네 화면과 텍스트 자기확인으로 표현할 수 없는 기능만 적습니다. short_text·structured_text 같은 응답 모양이나 텍스트로 제시한 숫자·간선·격자는 별도 기능이 아닙니다.",
      "- 숫자 직접입력 자동채점은 numeric, 그림 위 직접 표시는 graph_annotation, 코드 실행 채점은 code처럼 실제 추가 기능이 필요할 때만 기록합니다.",
      "- recommendedType은 네 형식 중 가장 가까운 하나를 선택합니다. 직접 지원이 어렵다면 핵심 원리·조건·판단 절차를 보존한 scaffold를 설계하고 한계를 relationToObjective에 정직하게 표시합니다.",
      "",
      "품질 기준:",
      "- 한 설계에는 하나의 구체 사례와 하나의 정답만 둡니다. 원문 근거 밖 사실을 추가하지 않습니다.",
      "- 사용자 문제 방향은 given·hidden·expectedResponse에 실제로 반영하고 설명에만 반복하지 않습니다.",
      "- 풀이·판별·생성이 목표면 원래 답이나 결론을 단서에 주지 않습니다.",
      ...(runtime.instruction ? ["", "추가 지시:", runtime.instruction] : []),
    ].join("\n"),
    step: "activity",
    model: runtime.model ?? DEFAULT_MODEL,
    reasoningEffort: runtime.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    projectId: runtime.projectId,
    usage: { ...runtime, stage: runtime.usageStage ?? "activity-design" },
  });

  return finalizeActivityDesignResult(content, learningUnits);
}

export function finalizeActivityDesignResult(
  result: unknown,
  learningUnits: LearningUnit[],
) {
  const raw = z.object({
    objectives: z.array(learningObjectiveSchema).optional(),
    blueprints: z.array(practiceBlueprintSchema).optional(),
    recommendations: z.array(
      activityRecommendationSchema.omit({ includeInGeneration: true }),
    ).optional(),
  }).parse(result);
  let objectives: LearningObjective[];
  let blueprints: PracticeBlueprint[];
  if (raw.objectives?.length && raw.blueprints?.length) {
    objectives = raw.objectives;
    blueprints = raw.blueprints;
  } else {
    const recommendationByUnitId = new Map(
      (raw.recommendations ?? []).map((item) => [item.learningUnitId, item]),
    );
    const legacy = learningUnits.map((unit) =>
      createLegacyObjectiveAndBlueprint(
        unit,
        recommendationByUnitId.get(unit.id)?.recommendedType ?? "flashcard",
      ),
    );
    objectives = legacy.map((item) => item.objective);
    blueprints = legacy.map((item) => item.blueprint);
  }
  const operationByUnitId = new Map(
    learningUnits.map((unit) => [unit.id, unit.operation]),
  );
  objectives = objectives.map((objective) => ({
    ...objective,
    terminalOperation:
      operationByUnitId.get(objective.learningUnitId) ?? objective.terminalOperation,
    successCriteria: objective.successCriteria.some((criterion) => criterion.required)
      ? objective.successCriteria
      : objective.successCriteria.map((criterion) => ({ ...criterion, required: true })),
  }));
  blueprints = normalizeProblemTypesForBoundaries(objectives, blueprints);
  const objectiveById = new Map(
    objectives.map((objective) => [objective.id, objective]),
  );
  blueprints = blueprints.map((blueprint) => {
    const objective = objectiveById.get(blueprint.objectiveId);
    return blueprint.relationToObjective === "direct" &&
      objective &&
      blueprint.elicitedOperation !== objective.terminalOperation
      ? { ...blueprint, relationToObjective: "scaffold" as const }
      : blueprint;
  });
  validateOneProblemBoundaries(learningUnits, objectives, blueprints);
  validateObjectiveBlueprintLinks(learningUnits, objectives, blueprints);
  blueprints = ensureMemorizationCoverage(
    objectives,
    blueprints,
    defaultGenerationPolicy,
  );
  validateObjectiveBlueprintLinks(learningUnits, objectives, blueprints);
  const supportAssessments = blueprints.map((blueprint) =>
    assessBlueprintSupport(blueprint, blueprint.recommendedType),
  );
  const recommendations = blueprints.map((blueprint) =>
    recommendationFromBlueprint(
      blueprint,
      supportAssessments.find((item) => item.blueprintId === blueprint.id)!,
      defaultGenerationPolicy,
    ),
  );
  return activityDesignSchema.parse({
    objectives,
    blueprints,
    recommendations,
  });
}

function validateObjectiveBlueprintLinks(
  learningUnits: LearningUnit[],
  objectives: LearningObjective[],
  blueprints: PracticeBlueprint[],
) {
  const unitIds = new Set(learningUnits.map((unit) => unit.id));
  const objectiveIds = new Set(objectives.map((objective) => objective.id));
  const blueprintIds = new Set(blueprints.map((blueprint) => blueprint.id));
  if (objectiveIds.size !== objectives.length || blueprintIds.size !== blueprints.length) {
    throw new PipelineError("activity", "학습목표 또는 문제 설계서 ID가 중복되었습니다.");
  }
  if (learningUnits.some((unit) => !objectives.some((objective) => objective.learningUnitId === unit.id))) {
    throw new PipelineError("activity", "일부 학습내용에 학습목표가 없습니다.");
  }
  for (const objective of objectives) {
    if (!unitIds.has(objective.learningUnitId)) {
      throw new PipelineError("activity", `알 수 없는 학습내용을 참조합니다: ${objective.id}`);
    }
    if (!blueprints.some((blueprint) => blueprint.objectiveId === objective.id)) {
      throw new PipelineError("activity", `문제 설계서가 없는 학습목표입니다: ${objective.id}`);
    }
    const coveredCriterionIds = new Set(
      blueprints
        .filter((blueprint) => blueprint.objectiveId === objective.id)
        .flatMap((blueprint) => blueprint.coverageCriterionIds),
    );
    const uncoveredRequired = objective.successCriteria.filter(
      (criterion) => criterion.required && !coveredCriterionIds.has(criterion.id),
    );
    if (uncoveredRequired.length > 0) {
      throw new PipelineError(
        "activity",
        `필수 성공 기준을 연습하는 문제 설계서가 없습니다: ${objective.id}`,
        uncoveredRequired.map((criterion) => criterion.id),
      );
    }
  }
  for (const blueprint of blueprints) {
    const objective = objectives.find((item) => item.id === blueprint.objectiveId);
    if (!objective || objective.learningUnitId !== blueprint.learningUnitId) {
      throw new PipelineError("activity", `문제 설계서의 학습목표 연결이 잘못되었습니다: ${blueprint.id}`);
    }
    const criteria = new Set(objective.successCriteria.map((criterion) => criterion.id));
    if (blueprint.coverageCriterionIds.some((id) => !criteria.has(id))) {
      throw new PipelineError("activity", `문제 설계서가 알 수 없는 성공 기준을 참조합니다: ${blueprint.id}`);
    }
    if (
      blueprint.scoringRubric.some(
        (rubric) => !blueprint.coverageCriterionIds.includes(rubric.criterionId),
      )
    ) {
      throw new PipelineError(
        "activity",
        `채점 기준이 이번 문제의 평가 범위를 벗어났습니다: ${blueprint.id}`,
      );
    }
  }
}

function validateOneProblemBoundaries(
  learningUnits: LearningUnit[],
  objectives: LearningObjective[],
  blueprints: PracticeBlueprint[],
) {
  if (
    objectives.length !== learningUnits.length ||
    blueprints.length !== learningUnits.length
  ) {
    throw new PipelineError(
      "activity",
      "문제 하나 크기로 확정된 학습내용을 다시 쪼개거나 합칠 수 없습니다.",
    );
  }
  for (const unit of learningUnits) {
    const unitObjectives = objectives.filter(
      (objective) => objective.learningUnitId === unit.id,
    );
    const unitBlueprints = blueprints.filter(
      (blueprint) => blueprint.learningUnitId === unit.id,
    );
    if (unitObjectives.length !== 1 || unitBlueprints.length !== 1) {
      throw new PipelineError(
        "activity",
        `학습내용마다 문제 설계서는 하나여야 합니다: ${unit.id}`,
      );
    }
    const objective = unitObjectives[0];
    const blueprint = unitBlueprints[0];
    if (unit.operation && objective.terminalOperation !== unit.operation) {
      throw new PipelineError(
        "activity",
        `학습내용의 요구 행동이 문제 설계에서 바뀌었습니다: ${unit.id}`,
      );
    }
    if (
      blueprint.relationToObjective === "direct" &&
      blueprint.elicitedOperation !== objective.terminalOperation
    ) {
      throw new PipelineError(
        "activity",
        `직접 문제의 요구 행동이 학습목표와 다릅니다: ${blueprint.id}`,
      );
    }
  }
}

function normalizeProblemTypesForBoundaries(
  objectives: LearningObjective[],
  blueprints: PracticeBlueprint[],
) {
  const objectiveById = new Map(
    objectives.map((objective) => [objective.id, objective]),
  );
  return blueprints.map((blueprint) => {
    const objective = objectiveById.get(blueprint.objectiveId);
    if (
      blueprint.recommendedType !== "structure_recall" ||
      objective?.terminalOperation === "reconstruct"
    ) {
      return blueprint;
    }
    const recommendedType = objective?.terminalOperation === "discriminate"
      ? "multiple_choice" as const
      : "flashcard" as const;
    return {
      ...blueprint,
      elicitedOperation: objective?.terminalOperation ?? blueprint.elicitedOperation,
      recommendedType,
      expectedResponse: {
        ...blueprint.expectedResponse,
        kind: recommendedType === "multiple_choice"
          ? "single_choice" as const
          : blueprint.expectedResponse.kind === "structured_text"
            ? "structured_text" as const
            : "short_text" as const,
      },
      scoringRubric: blueprint.scoringRubric.map((rubric) => ({
        ...rubric,
        gradingMode: recommendedType === "flashcard" ? "self" as const : "exact" as const,
      })),
      requiredCapabilities: blueprint.requiredCapabilities.filter(
        (capability) => !["ordered_structure", "unordered_structure"].includes(capability),
      ),
    };
  });
}

export async function runCardGeneration(
  mode: StudyMode,
  organizedMaterial: OrganizedMaterial,
  analysis: AnalysisResult,
  instruction = "",
  studyGuideline = "",
  recallDesign = "",
  approvedSample = "",
  sampleFeedback = "",
  activityDesign = "",
  runtime: CardPipelineRuntimeOptions = {},
) {
  const usesSoftBudget = hasSoftCountPolicy(studyGuideline);
  const cardContract = buildCardContract(
    mode,
    approvedSample,
    recallDesign,
    sampleFeedback,
  );
  const allLearningUnits = selectLearningUnitsForCards(
    analysis,
    organizedMaterial,
  );
  const parsedActivityDesign = parseActivityDesign(
    activityDesign,
    allLearningUnits,
  );
  assertLearningUnitsReady({
    learningUnits: allLearningUnits,
    maxLearningUnitCount: getMaxLearningUnitCount(studyGuideline),
  });
  if (activityDesign.trim()) {
    assertActivityDesignReady(allLearningUnits, parsedActivityDesign);
    assertGenerationSelectionReady({
      selections: parsedActivityDesign.recommendations,
      automatic: (runtime.activitySelectionMode ?? "automatic") === "automatic",
    });
  }
  const hasActivityDesign = Boolean(activityDesign.trim());
  const includedRecommendations = parsedActivityDesign.recommendations.filter(
    (item) => item.includeInGeneration,
  );
  const includedCountByUnit = new Map<string, number>();
  for (const recommendation of includedRecommendations) {
    includedCountByUnit.set(
      recommendation.learningUnitId,
      (includedCountByUnit.get(recommendation.learningUnitId) ?? 0) + 1,
    );
  }
  if ([...includedCountByUnit.values()].some((count) => count > 1)) {
    throw new PipelineError(
      "cards",
      "하나의 학습내용에서 문제가 여러 개 선택되었습니다.",
    );
  }
  const includedIds = new Set(
    includedRecommendations.map((item) => item.learningUnitId),
  );
  const learningUnitsForCards = hasActivityDesign
    ? allLearningUnits.filter((unit) => includedIds.has(unit.id))
    : allLearningUnits;
  const effectiveActivityDesign: ActivityDesign = {
    recommendations: includedRecommendations,
    objectives: parsedActivityDesign.objectives?.filter((objective) =>
      includedRecommendations.some((item) => item.objectiveId === objective.id),
    ),
    blueprints: parsedActivityDesign.blueprints?.filter((blueprint) =>
      includedRecommendations.some((item) => item.blueprintId === blueprint.id),
    ),
    supportAssessments: parsedActivityDesign.supportAssessments?.filter((assessment) =>
      includedRecommendations.some((item) => item.blueprintId === assessment.blueprintId),
    ),
    policy: parsedActivityDesign.policy,
  };
  const targetCardCount = usesSoftBudget
    ? hasActivityDesign
      ? includedRecommendations.length
      : undefined
    : hasActivityDesign
      ? includedRecommendations.length
      : learningUnitsForCards.length || getSelectedUnitCount(studyGuideline);
  const analysisForCards = {
    detectedGoal: analysis.detectedGoal,
    sourceType: analysis.sourceType,
    primaryKnowledgeType: analysis.primaryKnowledgeType,
    keyTopics: analysis.keyTopics,
    recommendedStrategy: analysis.recommendedStrategy,
  };
  const compactCardInput = runtime.cards?.compactInput
      ? createCompactCardGenerationInput(
        analysis,
        learningUnitsForCards,
        effectiveActivityDesign,
        runtime.cards?.sourceExpressionMode ?? "adapt",
      )
    : null;

  const compactCardCommonProperties = {
    learningUnitId: { type: "string" },
    front: { type: "string" },
    basis: { type: "string" },
    strategy: { type: "string", enum: cardStrategies },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    explanation: { type: "string" },
  };
  const compactCardCommonRequired = [
    "learningUnitId", "activityType", "front", "basis",
    "strategy", "difficulty", "explanation",
  ];
  const compactCardSchema = {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [...compactCardCommonRequired, "back"],
        properties: {
          ...compactCardCommonProperties,
          activityType: { type: "string", enum: ["flashcard"] },
          back: { type: "string" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [...compactCardCommonRequired, "clozeText", "answer"],
        properties: {
          ...compactCardCommonProperties,
          activityType: { type: "string", enum: ["cloze"] },
          clozeText: { type: "string" },
          answer: { type: "string" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [...compactCardCommonRequired, "correctBoolean"],
        properties: {
          ...compactCardCommonProperties,
          activityType: { type: "string", enum: ["true_false"] },
          correctBoolean: { type: "boolean" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [...compactCardCommonRequired, "options", "correctOptionIndex"],
        properties: {
          ...compactCardCommonProperties,
          activityType: { type: "string", enum: ["multiple_choice"] },
          options: { type: "array", items: { type: "string" } },
          correctOptionIndex: { type: "integer" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [
          ...compactCardCommonRequired,
          "structureNodes",
          "structureRecallKind",
          "supportedStructureRecallModes",
          "structureRecallMode",
        ],
        properties: {
          ...compactCardCommonProperties,
          activityType: { type: "string", enum: ["structure_recall"] },
          structureNodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "parentId", "correctLabel"],
              properties: {
                id: { type: "string" },
                parentId: { type: ["string", "null"] },
                correctLabel: { type: "string" },
              },
            },
          },
          structureRecallMode: {
            type: "string",
            enum: ["word_bank", "free_input"],
          },
          structureRecallKind: {
            type: "string",
            enum: ["sequence", "hierarchy"],
          },
          supportedStructureRecallModes: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { type: "string", enum: ["word_bank", "free_input"] },
          },
        },
      },
    ],
  };

  const content = await callCodexJson({
    schemaName: "memory_cards",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          ...(usesSoftBudget && !hasActivityDesign
            ? { minItems: 1 }
            : targetCardCount
              ? { minItems: targetCardCount, maxItems: targetCardCount }
              : {}),
          items: hasActivityDesign ? compactCardSchema : {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "activityType",
              "front",
              "back",
              "clozeText",
              "answer",
              "answers",
              "options",
              "correctOptionIndex",
              "correctBoolean",
              "structureNodes",
              "structureRecallKind",
              "supportedStructureRecallModes",
              "structureRecallMode",
              "recommendationReason",
              "hint",
              "tags",
              "basis",
              "learningUnitId",
              "objectiveId",
              "blueprintId",
              "strategy",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "rationale",
              "difficulty",
              "qualityPassed",
              "qualityNotes",
              "qualityStatus",
              "explanation",
            ],
            properties: {
              type: { type: "string", enum: ["flashcard", "cloze", "translation"] },
              activityType: { type: "string", enum: learningActivityTypes },
              front: { type: "string" },
              back: { type: "string" },
              clozeText: { type: "string" },
              answer: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
              options: { type: "array", items: { type: "string" } },
              correctOptionIndex: { type: "integer" },
              correctBoolean: { type: "boolean" },
              structureNodes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "parentId", "correctLabel"],
                  properties: {
                    id: { type: "string" },
                    parentId: { type: ["string", "null"] },
                    correctLabel: { type: "string" },
                  },
                },
              },
              structureRecallMode: {
                type: "string",
                enum: ["word_bank", "free_input"],
              },
              structureRecallKind: {
                type: "string",
                enum: ["sequence", "hierarchy"],
              },
              supportedStructureRecallModes: {
                type: "array",
                minItems: 1,
                maxItems: 2,
                uniqueItems: true,
                items: { type: "string", enum: ["word_bank", "free_input"] },
              },
              recommendationReason: { type: "string" },
              hint: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              basis: { type: "string" },
              learningUnitId: { type: "string" },
              objectiveId: { type: "string" },
              blueprintId: { type: "string" },
              strategy: { type: "string", enum: cardStrategies },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              rationale: { type: "string" },
              difficulty: { type: "integer", minimum: 1, maximum: 5 },
              qualityPassed: { type: "boolean" },
              qualityNotes: { type: "array", items: { type: "string" } },
              qualityStatus: {
                type: "string",
                enum: ["not_run", "passed", "failed", "waived"],
              },
              explanation: { type: "string" },
            },
          },
        },
      },
    },
    system: hasActivityDesign
      ? "당신은 확정된 학습 내용과 문제 방식을 자동 채점 가능한 학습 문제로 변환하는 전문가입니다. 결과는 한국어 JSON으로만 반환합니다."
      : "당신은 정리된 학습 자료를 사용자가 선택한 암기 카드 유형으로 변환하는 전문가입니다. 결과는 한국어 JSON만 반환합니다.",
    user: hasActivityDesign
      ? buildLearningActivityGenerationPrompt({
          instruction,
          analysis: analysisForCards,
          learningUnits: learningUnitsForCards,
          organizedMaterial,
          activityDesign: effectiveActivityDesign,
          compactInput: compactCardInput,
          sourceExpressionMode:
            runtime.cards?.sourceExpressionMode ?? "adapt",
        })
      : [
      `선택한 암기 유형: ${mode}`,
      `사용자 추가 지시사항: ${instruction || "없음"}`,
      `사용자가 확정한 학습 가이드: ${studyGuideline || "없음"}`,
      `사용자가 확정한 인출 방식: ${recallDesign || "없음"}`,
      `사용자가 확인한 대표 예시: ${approvedSample || "없음"}`,
      `대표 예시에 대한 사용자 피드백: ${sampleFeedback || "없음"}`,
      "승인된 카드 계약:",
      JSON.stringify(cardContract, null, 2),
      usesSoftBudget
        ? "카드 수: 의미 coverage와 자연스러운 retrieval target 수에 따라 결과적으로 결정"
        : targetCardCount
          ? `반드시 생성할 카드 수: ${targetCardCount}장`
          : "카드 수: 자료 분량에 맞게 판단",
      "",
      "1단계 분석 결과:",
      JSON.stringify(analysisForCards, null, 2),
      "",
      "구조화된 학습 단위와 원문 출처:",
      JSON.stringify(learningUnitsForCards, null, 2),
      "",
      "확정된 문제 방식:",
      JSON.stringify(effectiveActivityDesign, null, 2),
      "",
      "사용자가 검토하고 수정한 최종 학습 내용:",
      JSON.stringify(organizedMaterial, null, 2),
      "",
      "규칙:",
      "- 카드의 사실과 표현은 사용자가 검토한 최종 학습 내용에서만 가져옵니다.",
      "- learningUnit의 reviewedText가 있으면 sourceText나 generalizedForm보다 reviewedText를 카드 내용의 최종 기준으로 사용합니다.",
      ...(usesSoftBudget
        ? [
            "- 확정 학습 가이드의 선택 범위와 모든 핵심 LearningUnit의 의미 coverage를 반드시 따릅니다.",
            "- 각 LearningUnit은 최소 하나의 명확한 retrieval target을 가져야 합니다.",
            "- 하나의 LearningUnit에 자연스럽게 여러 독립 조건 분기가 있으면 1:N 카드 변환을 허용합니다.",
            "- 1:N 변환 때문에 다른 LearningUnit이 카드화되지 않아서는 안 됩니다.",
            "- 총 카드 수를 맞추기 위해 LearningUnit을 누락하지 않습니다.",
            "- LearningUnit 수와 Card 수를 동일하게 고정하지 않고 카드 수는 결과적으로 결정합니다.",
          ]
        : [
            "- 확정 학습 가이드가 있으면 선택 영역과 독립 학습 단위 수를 반드시 따릅니다.",
            "- 선택 영역의 독립 학습 단위 하나당 카드 하나를 만들고 다른 영역의 카드는 만들지 않습니다.",
          ]),
      "- 카드 앞면은 확정 인출 방식의 Cue, 뒷면은 Target이 되도록 구성합니다.",
      `- 각 학습 단위의 지식 구조에 따라 strategy를 ${cardStrategies.join(", ")} 중에서 선택합니다.`,
      "- production은 의미나 의도를 보고 표현을 생성할 때, recognition은 표현을 보고 의미를 확인할 때 사용합니다.",
      "- concept는 정의·핵심 원리를 인출할 때, contrast는 차이를 비교할 때, procedure는 순서를 인출할 때, application은 조건에 맞게 적용할 때 사용합니다.",
      "- 사용자가 선택한 카드 UI 유형은 유지하되, 앞면과 뒷면의 인출 방향은 strategy에 맞게 설계합니다.",
      "- 승인된 대표 예시와 사용자 피드백의 구조를 모든 카드에 동일하게 적용합니다.",
      "- CardContract의 cueExample과 targetExample은 문체와 정보 배치의 고정 계약입니다.",
      "- CardContract.slotMode가 template이면 각 학습 단위의 변수 자리를 빈칸 또는 플레이스홀더로 유지하고 구체적인 값으로 채우지 않습니다.",
      "- CardContract.slotMode가 filled_example이면 각 학습 단위의 변수 자리를 문맥에 맞는 구체적인 값으로 모두 채우고 빈칸을 남기지 않습니다.",
      "- 한 카드 안에서 template 방식과 filled_example 방식을 섞지 않습니다.",
      "- cueExample에 없던 과업 설명, 접두 문장 또는 메타 지시문을 front에 추가하지 않습니다.",
      "- 분석 결과는 학습 목표와 카드 구성 전략을 판단하는 용도로만 사용합니다.",
      "- flashcard 유형이면 type을 flashcard로 두고 front/back을 채웁니다. clozeText, answer, hint는 빈 문자열, answers는 빈 배열로 둡니다.",
      "- cloze 유형이면 type을 cloze로 두고 clozeText, answer, hint를 채웁니다. front/back은 빈 문자열로 둡니다.",
      "- translation 유형이면 type을 translation으로 두고 front에는 한국어 의미나 cue, back에는 외울 영어 문장을 넣습니다. clozeText, answer, hint는 빈 문자열, answers는 빈 배열로 둡니다.",
      "- translation 유형은 오픽, 영어 표현, 스크립트 자료에 적합합니다. 영어 문장 자체를 보존하고, front는 사용자가 영작할 수 있는 자연스러운 한국어 cue로 만듭니다.",
      "- translation 유형에서 '이 문장은 어떤 주제인가?' 같은 메타 질문은 만들지 않습니다.",
      "- clozeText에는 Anki 문법 {{c1::정답}}을 쓰지 않습니다.",
      "- clozeText의 정답 자리는 반드시 ____ 로 표시합니다. 예: TCP는 ____ 프로토콜이다.",
      "- answer에는 ____에 들어갈 정답만 씁니다.",
      "- 빈칸이 여러 개면 answers 배열에 빈칸 순서대로 정답을 넣고, answer에는 쉼표로 합친 값을 씁니다.",
      "- 선택한 유형이 자료와 완전히 맞지 않아도 사용자의 선택을 존중합니다.",
      "- 카드 하나에는 핵심 개념 하나만 담습니다.",
      "- 중복 카드는 만들지 않습니다.",
      "- basis에는 카드 생성 근거가 된 reviewedText 또는 원문 문장을 짧게 씁니다.",
      "- learningUnitId, sourceId, sourcePage, sourceRange는 해당 학습 단위 값을 그대로 복사합니다.",
      "- rationale에는 해당 카드 전략을 선택한 이유를 씁니다.",
      "- difficulty는 인출 길이와 추상성에 따라 1부터 5까지 평가합니다.",
      "- 이 단계의 qualityPassed는 임시로 false, qualityNotes는 빈 배열로 둡니다. 다음 단계에서 별도로 검수합니다.",
      ...(hasActivityDesign
        ? [
            "- 각 PracticeBlueprint마다 정확히 한 문제만 생성하고 activityType은 확정된 문제 방식을 그대로 따릅니다.",
            "- objectiveId와 blueprintId는 해당 문제 설계서의 값을 그대로 복사합니다.",
            "- given은 학생에게 보여줄 정보이고 hidden은 학생이 만들어야 할 답 또는 추론입니다. front에 hidden의 정답을 노출하지 않습니다.",
            "- expectedResponse와 scoringRubric을 만족하는 정답을 만들고 explanation에는 정답 판단에 필요한 짧은 근거를 씁니다.",
            "- flashcard는 front에 단서, back에 직접 떠올릴 정답을 둡니다.",
            "- true_false는 front에 하나의 명확한 명제를 쓰고 correctBoolean에 정답을 둡니다. back에는 O 또는 X만 씁니다.",
            "- multiple_choice는 front에 질문, options에 서로 겹치지 않는 선택지 3~4개, correctOptionIndex에 0부터 시작하는 정답 번호를 둡니다. back에는 정답 선택지 문구를 씁니다.",
            "- structure_recall은 원문에 실제 고정 순서 또는 상하·분류 관계가 있을 때만 사용합니다. 평면적인 조건·항목 목록에는 사용하지 않습니다.",
            "- structureRecallKind는 단계의 앞뒤가 학습 대상이면 sequence, 상하·분류 관계가 학습 대상이면 hierarchy입니다.",
            "- sequence는 노드를 하나의 부모→자식 사슬로 만들고, hierarchy는 실제 가지가 생기도록 부모·자식 관계를 표현합니다. 서로 다른 관계를 한 문제에 섞지 않습니다.",
            "- structureNodes에는 3~8개 빈자리를 둡니다. 각 노드는 고유 id, 상위 노드의 parentId, 들어갈 correctLabel을 가집니다. 시작 노드는 parentId가 null입니다.",
            "- word_bank의 답 목록이나 보기를 front에 쓰지 않습니다. 답 모음은 structureNodes의 correctLabel을 학습 화면이 자동으로 섞어 제공합니다.",
            "- supportedStructureRecallModes에는 이 정답을 안전하게 풀 수 있는 방식을 넣습니다. 짧고 표기가 하나로 확정되는 답이면 word_bank와 free_input을 모두 지원할 수 있습니다.",
            "- structureRecallMode는 최초 풀이 방식입니다. 둘 다 지원하면 word_bank를 기본으로 두고 학습 화면에서 free_input으로 바꿀 수 있게 합니다.",
            "- 사용하지 않는 형식 전용 필드는 빈 배열, 0, false로 채웁니다.",
            "- recommendationReason은 확정된 추천 이유를 그대로 보존합니다.",
          ]
        : []),
      ...(runtime.cards?.instruction
        ? ["", "실험 실행 추가 지시:", runtime.cards.instruction]
        : []),
    ].join("\n"),
    step: "cards",
    model: runtime.cards?.model ?? DEFAULT_MODEL,
    reasoningEffort:
      runtime.cards?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    projectId: runtime.cards?.projectId,
    usage: {
      ...runtime.cards,
      stage: runtime.cards?.usageStage ?? "cards",
    },
  });

  const generatedCards = hasActivityDesign
    ? generatedCardsContentSchema.parse(content).cards.map((card) => {
        const learningUnit = learningUnitsForCards.find(
          (item) => item.id === card.learningUnitId,
        );
        const recommendation = effectiveActivityDesign.recommendations.find(
          (item) => item.learningUnitId === card.learningUnitId,
        );
        if (!learningUnit || !recommendation) {
          throw new PipelineError(
            "cards",
            `생성된 문제의 학습내용 연결을 찾을 수 없습니다: ${card.learningUnitId}`,
          );
        }
        if (recommendation.recommendedType !== card.activityType) {
          throw new PipelineError(
            "cards",
            `확정된 문제 방식과 생성된 문제 방식이 다릅니다: ${card.learningUnitId}`,
          );
        }
        return hydrateGeneratedCardContent(card as GeneratedCardContent, {
          analysis,
          learningUnit,
          recommendation,
        });
      })
    : cardsSchema.parse(content).cards;
  const generated = { cards: generatedCards };
  await runtime.onCardsGenerated?.(generatedCards);
  const parsed = await runCardCritic(
    generated.cards,
    learningUnitsForCards,
    targetCardCount,
    cardContract,
    usesSoftBudget,
    runtime.critic,
  );
  await runtime.onCriticCompleted?.(parsed);
  let cards = materializeCards(parsed, mode);
  if (hasActivityDesign) {
    cards = cards.map((card) => {
      if (card.blueprintId) return card;
      const candidates = effectiveActivityDesign.recommendations.filter(
        (item) => item.learningUnitId === card.learningUnitId,
      );
      return candidates.length === 1
        ? {
          ...card,
          objectiveId: candidates[0].objectiveId,
          blueprintId: candidates[0].blueprintId,
          explanation: card.explanation || card.basis,
        }
        : card;
    });
    const selectedTypeByBlueprintKey = new Map(
      effectiveActivityDesign.recommendations.map((item) => [
        activityRecommendationKey(item),
        item.recommendedType,
      ]),
    );
    const seenBlueprintKeys = new Set<string>();
    const qualityIssues = cards.flatMap((card, index) => {
      const key = card.blueprintId || card.learningUnitId || "";
      const blueprint = effectiveActivityDesign.blueprints?.find(
        (item) => item.id === card.blueprintId,
      );
      const issues = validateLearningActivity(card);
      if (selectedTypeByBlueprintKey.get(key) !== card.activityType) {
        issues.push("확정된 문제 방식과 생성된 문제 방식이 다릅니다.");
      }
      if (seenBlueprintKeys.has(key)) {
        issues.push("같은 문제 설계서에서 문제가 중복 생성되었습니다.");
      }
      seenBlueprintKeys.add(key);
      const learningUnit = learningUnitsForCards.find(
        (item) => item.id === card.learningUnitId,
      );
      if (blueprint && learningUnit) {
        issues.push(...validateBlueprintItem(card, blueprint, learningUnit));
      }
      return issues.map((issue) => `${index + 1}번 문제: ${issue}`);
    });
    const missingBlueprints = [...selectedTypeByBlueprintKey.keys()].filter(
      (key) => !seenBlueprintKeys.has(key),
    );
    if (
      cards.length !== includedRecommendations.length ||
      qualityIssues.length > 0 ||
      missingBlueprints.length > 0
    ) {
      throw new PipelineError(
        "cards",
        "생성된 문제가 확정된 문제 설계서를 따르지 않았습니다.",
        [...qualityIssues, ...missingBlueprints.map((id) => `누락된 문제 설계서: ${id}`)],
      );
    }
    cards = cards.map((card) => ({
      ...card,
      qualityPassed: true,
      qualityStatus: "passed" as const,
      qualityNotes: [],
    }));
  }

  return {
    cards,
    baselineTrace: {
      generatedCards: generated.cards,
      criticCards: parsed,
    },
  };
}

function buildLearningActivityGenerationPrompt(input: {
  instruction: string;
  analysis: {
    detectedGoal: string;
    sourceType: AnalysisResult["sourceType"];
    primaryKnowledgeType: AnalysisResult["primaryKnowledgeType"];
    keyTopics: string[];
    recommendedStrategy: string;
  };
  learningUnits: LearningUnit[];
  organizedMaterial: OrganizedMaterial;
  activityDesign: ActivityDesign;
  compactInput: ReturnType<typeof createCompactCardGenerationInput> | null;
  sourceExpressionMode: SourceExpressionMode;
}) {
  return [
    `사용자 추가 지시사항: ${input.instruction || "없음"}`,
    "",
    "학습 목표와 자료 성격:",
    JSON.stringify(input.analysis, null, 2),
    "",
    ...(input.compactInput
      ? [
          "확정된 문제 생성 입력(최종 학습 내용·방식·출처):",
          JSON.stringify(input.compactInput, null, 2),
        ]
      : [
          "사용자가 확정한 학습 내용과 원문 근거:",
          JSON.stringify(input.learningUnits, null, 2),
          "",
          "사용자가 검토한 최종 학습 내용:",
          JSON.stringify(input.organizedMaterial, null, 2),
          "",
          "확정된 문제 방식:",
          JSON.stringify(input.activityDesign, null, 2),
        ]),
    "",
    "목표: 확정된 PracticeBlueprint를 그대로 실행 가능한 문제로 표현합니다. 설계를 다시 판단하거나 학습단위를 바꾸지 않습니다.",
    "",
    "생성 규칙:",
    ...buildSourceExpressionRules(input.sourceExpressionMode),
    "- LearningUnit마다 문제 하나를 만들고 learningUnitId·blueprintId·activityType을 그대로 유지합니다.",
    "- front는 given에서 만들고, 정답은 hidden의 target_answer를 그대로 사용합니다. 입력을 바꾸거나 답을 다시 계산하지 않으며 hidden의 결론·추론을 front에 노출하지 않습니다.",
    "- sourcePages는 unit의 pageRefs가 가리키는 페이지만 근거로 사용합니다. 문제·정답·오답은 해당 LearningUnit과 원문 근거 밖으로 확장하지 않습니다.",
    "- 한 문제에는 하나의 명확한 인출·판단 대상과 하나의 확정 가능한 정답만 둡니다. placeholder나 'keyword', '내용', '정보' 같은 자리 이름 자체는 정답이 아닙니다.",
    "- 사용자 문제 방향은 실제 질문 행동과 난이도에 반영하되 지시 문구를 front에 복사하지 않습니다.",
    "- explanation은 정답 이유를 짧게, basis는 정답을 확인할 짧은 원문 구절을 그대로 인용합니다. strategy와 difficulty는 실제 요구 행동에 맞춥니다.",
    "",
    "형식별 규칙:",
    "- flashcard: front에는 단서 또는 질문, back에는 직접 떠올릴 짧고 명확한 정답을 둡니다.",
    "- cloze: clozeText에는 ____를 정확히 한 개 두고 answer에는 그 자리에 들어갈 짧은 정답만 둡니다.",
    "- true_false: front에는 하나의 명확한 명제를 둡니다. 거짓 명제는 원문의 핵심 관계 하나만 바꾸며 애매한 수식어를 쓰지 않습니다. correctBoolean에 정답을 두고 back에는 O 또는 X만 씁니다.",
    "- multiple_choice: 질문 하나와 겹치지 않는 선택지 3~4개를 둡니다. 정답은 하나이며 correctOptionIndex는 0부터 시작하고 back은 정답 선택지 문구입니다. 오답은 그럴듯하되 새로운 학습 사실을 만들지 않습니다.",
    "- structure_recall: 세 개 이상의 요소가 가진 실제 고정 순서 또는 상하·분류 구조에만 사용합니다. 평면 목록에는 사용하지 않습니다.",
    "- structureRecallKind는 단계의 앞뒤를 복원하면 sequence, 상하·분류 관계를 복원하면 hierarchy입니다. sequence는 하나의 부모→자식 사슬이어야 하고 hierarchy는 실제 가지가 있어야 합니다.",
    "- structureNodes에는 3~8개 노드를 두고 각 노드는 고유 id, 상위 노드의 parentId, 들어갈 correctLabel을 가집니다. 시작 노드는 parentId가 null입니다.",
    "- word_bank에서는 front에 '보기:'나 답 목록을 쓰지 않습니다. front에는 문제 지시만 쓰고, 답 모음은 structureNodes의 correctLabel에 개별 저장합니다. 학습 화면이 이를 자동으로 섞습니다.",
    "- correctLabel은 서로 달라야 하고 한 카드에는 한 종류의 관계만 둡니다. 단순 목록을 거짓 계층으로 만들지 않습니다.",
    "- supportedStructureRecallModes에는 가능한 풀이 방식을 넣습니다. 짧고 표기가 하나로 확정되는 답이면 word_bank와 free_input을 모두 지원할 수 있습니다.",
    "- structureRecallMode는 최초 풀이 방식입니다. 둘 다 지원하면 word_bank를 기본으로 둡니다.",
  ].join("\n");
}

export function buildSourceExpressionRules(
  mode: SourceExpressionMode,
): string[] {
  if (mode === "adapt") {
    return [
      "표현 방식: AI가 학습용으로 다듬기",
      "- 원문의 의미와 사실을 유지하면서 질문과 정답을 학습하기 좋게 정리합니다. 적용이 목표면 원문의 규칙에서 직접 유도되는 구체 입력을 사용할 수 있습니다.",
    ];
  }

  return [
    "표현 방식: 원문 중심으로 문제 만들기",
    "- finalContent와 sourcePages의 문장·패턴·정의·공식·단계·사례를 주재료로 쓰고, front의 단서도 제목·앞뒤 맥락·조건·변수·일부 구절에서 찾습니다.",
    "- 길이·문장부호·배치·지시문은 명확하게 정리할 수 있지만 핵심 의미·관계·조건·표현 특징은 유지합니다. 학습 가치가 있는 변수 자리와 기호도 보존합니다.",
    "- 적용·판별 문제는 원문의 규칙과 사례를 우선 사용합니다. 필요하면 원문에서 직접 유도되는 작은 입력을 만들 수 있지만 외부 지식이나 불필요한 설정은 추가하지 않습니다.",
    "- 형식에 관계없이 원문 맥락을 질문과 정답 근거로 사용합니다. 거짓 명제는 핵심 관계 하나만 바꾸고, 구조복원은 원문에 실제로 존재하는 구조만 사용합니다.",
  ];
}

function normalizeComparableText(value: string | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/[.,!?;:'"`()\[\]{}<>·—–-]/g, "");
}

export function validateBlueprintItem(
  card: Card,
  blueprint: PracticeBlueprint,
  learningUnit: LearningUnit,
) {
  const issues: string[] = [];
  if (card.learningUnitId !== blueprint.learningUnitId) {
    issues.push("학습내용 연결이 문제 설계서와 다릅니다.");
  }
  if (card.objectiveId !== blueprint.objectiveId || card.blueprintId !== blueprint.id) {
    issues.push("학습목표 또는 문제 설계서 ID가 다릅니다.");
  }
  if (!card.basis?.trim()) issues.push("정답을 확인할 원문 근거가 없습니다.");
  if (!card.explanation?.trim()) issues.push("정답 판단 근거가 없습니다.");
  if (
    card.sourceId !== learningUnit.sourceId ||
    card.sourcePage !== learningUnit.sourcePage ||
    card.sourceRange !== learningUnit.sourceRange
  ) {
    issues.push("문제의 출처 연결이 학습내용의 원문 출처와 다릅니다.");
  }

  const front = normalizeComparableText(card.front);
  if (card.activityType === "flashcard") {
    const answer = normalizeComparableText(card.back);
    const minimumLeakLength = /^[가-힣]+$/u.test(answer) ? 1 : 3;
    if (answer.length >= minimumLeakLength && front.includes(answer)) {
      issues.push("문제 앞면에 회상해야 할 정답이 그대로 노출되었습니다.");
    }
  }
  if (/정답\s*[:：]/u.test(card.front ?? "")) {
    issues.push("문제 앞면에 정답 표시가 포함되었습니다.");
  }
  return issues;
}

export function materializeCards(cards: CardDraft[], mode: StudyMode) {
  return cards.map<Card>((card) => {
    const answers =
      card.activityType === "cloze" || mode === "cloze"
        ? normalizeClozeAnswers(card.clozeText, card.answer, card.answers)
        : undefined;
    const resolvedMode = card.activityType === "cloze" ? "cloze" : mode;

    return {
      id: crypto.randomUUID(),
      type: resolvedMode,
      activityType: card.activityType,
      front:
        cleanEmbeddedStructureChoices(
          card.front,
          card.activityType,
          card.structureRecallMode,
        ) || undefined,
      back: card.back || undefined,
      clozeText:
        resolvedMode === "cloze" && answers
          ? normalizeClozeText(card.clozeText, answers)
          : undefined,
      answer: answers?.join(", "),
      answers,
      options: card.options.length > 0 ? card.options : undefined,
      correctOptionIndex:
        card.activityType === "multiple_choice"
          ? card.correctOptionIndex
          : undefined,
      correctBoolean:
        card.activityType === "true_false" ? card.correctBoolean : undefined,
      structureNodes:
        card.activityType === "structure_recall"
          ? card.structureNodes
          : undefined,
      structureRecallKind:
        card.activityType === "structure_recall"
          ? card.structureRecallKind ?? "hierarchy"
          : undefined,
      supportedStructureRecallModes:
        card.activityType === "structure_recall"
          ? card.supportedStructureRecallModes ?? [card.structureRecallMode ?? "word_bank"]
          : undefined,
      structureRecallMode:
        card.activityType === "structure_recall"
          ? card.structureRecallMode ?? "word_bank"
          : undefined,
      recommendationReason: card.recommendationReason || undefined,
      hint: card.hint || undefined,
      tags: card.tags,
      status: "new",
      basis: card.basis || undefined,
      learningUnitId: card.learningUnitId,
      objectiveId: card.objectiveId || undefined,
      blueprintId: card.blueprintId || undefined,
      conceptNodeIds: card.conceptNodeIds,
      strategy: card.strategy,
      sourceId: card.sourceId,
      sourcePage: card.sourcePage,
      sourceRange: card.sourceRange,
      rationale: card.rationale,
      difficulty: card.difficulty as 1 | 2 | 3 | 4 | 5,
      qualityPassed: card.qualityPassed,
      qualityNotes: card.qualityNotes,
      qualityStatus: card.qualityStatus,
      explanation: card.explanation || undefined,
    };
  });

}

function cleanEmbeddedStructureChoices(
  front: string,
  activityType: LearningActivityType,
  recallMode: "word_bank" | "free_input" | undefined,
) {
  if (activityType !== "structure_recall" || recallMode !== "word_bank") {
    return front;
  }
  return front
    .replace(/\n\s*(?:보기|답\s*모음)\s*[:：][\s\S]*$/u, "")
    .trim();
}

export function buildCardContract(
  mode: StudyMode,
  approvedSample: string,
  recallDesign: string,
  feedback: string,
): CardContract {
  const sample = parseJsonObject(approvedSample) as Partial<LearningUnitSample>;
  const parsedRecallDesign = parseJsonObject(recallDesign);
  const selectedVariant = isRecord(parsedRecallDesign.selectedVariant)
    ? parsedRecallDesign.selectedVariant
    : {};
  const slotMode =
    selectedVariant.slotMode === "filled_example"
      ? "filled_example"
      : "template";
  const exampleSource =
    selectedVariant.exampleSource === "generated" ? "generated" : "source";
  const preservePlaceholders =
    typeof selectedVariant.preservePlaceholders === "boolean"
      ? selectedVariant.preservePlaceholders
      : slotMode === "template";
  return {
    mode,
    slotMode,
    exampleSource,
    preservePlaceholders,
    cueExample: typeof sample.cue === "string" ? sample.cue : "",
    targetExample: typeof sample.target === "string" ? sample.target : "",
    supportingInfoExample:
      typeof sample.supportingInfo === "string" ? sample.supportingInfo : "",
    recallDesign: parsedRecallDesign,
    feedback,
    rules: [
      "대표 예시의 앞면·뒷면 문체와 정보 배치를 유지한다.",
      "카드 유형으로 행동이 명확하면 과업 설명을 추가하지 않는다.",
      "예시에 없는 '다음 뜻을', '영어로 말하세요', '번역하세요' 같은 메타 지시문을 추가하지 않는다.",
      slotMode === "template"
        ? "변수 자리를 빈칸 또는 플레이스홀더로 보존하고 임의의 값으로 채우지 않는다."
        : "변수 자리를 자연스러운 구체 값으로 모두 채우고 빈칸을 남기지 않는다.",
      "빈칸 유지형과 완성 예문형을 한 카드 안에서 섞지 않는다.",
      "한 카드에는 하나의 핵심 인출만 둔다.",
      "사실 오류와 원문 왜곡만 필요한 최소 범위에서 수정한다.",
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseActivityDesign(
  value: string,
  learningUnits: LearningUnit[],
): ActivityDesign {
  if (!value.trim()) {
    return {
      recommendations: learningUnits.map((unit) => ({
        learningUnitId: unit.id,
        supportLevel: "supported" as const,
        recommendedType: "flashcard" as const,
        reason: "기존 카드 생성 흐름",
        limitation: "",
        includeInGeneration: true,
      })),
    };
  }
  const raw = JSON.parse(value) as Record<string, unknown> & {
    recommendations?: Array<Record<string, unknown>>;
  };
  const normalizedRecommendations = (raw.recommendations ?? []).map((item) => {
      const supportLevel =
        item.supportLevel === "partial" || item.supportLevel === "unsupported"
          ? item.supportLevel
          : "supported";
      return {
        ...item,
        supportLevel,
        limitation: typeof item.limitation === "string" ? item.limitation : "",
        includeInGeneration:
          typeof item.includeInGeneration === "boolean"
            ? item.includeInGeneration
            : supportLevel === "supported",
      };
    });
  let design = activityDesignSchema.parse({
    ...raw,
    recommendations: normalizedRecommendations,
  });

  if (!design.objectives?.length || !design.blueprints?.length) {
    const recommendationByUnitId = new Map(
      design.recommendations.map((item) => [item.learningUnitId, item]),
    );
    const legacy = learningUnits.map((unit) => {
      const recommendation = recommendationByUnitId.get(unit.id);
      return createLegacyObjectiveAndBlueprint(
        unit,
        recommendation?.recommendedType ?? "flashcard",
      );
    });
    const objectives = legacy.map((item) => item.objective);
    const blueprints = legacy.map((item) => item.blueprint);
    const supportAssessments = blueprints.map((blueprint) =>
      assessBlueprintSupport(blueprint, blueprint.recommendedType),
    );
    design = activityDesignSchema.parse({
      objectives,
      blueprints,
      supportAssessments,
      policy: defaultGenerationPolicy,
      recommendations: learningUnits.map((unit, index) => {
        const original = recommendationByUnitId.get(unit.id);
        const computed = recommendationFromBlueprint(
          blueprints[index],
          supportAssessments[index],
          defaultGenerationPolicy,
        );
        return original
          ? {
              ...computed,
              supportLevel: original.supportLevel,
              assessmentLevel: original.assessmentLevel,
              reason: original.reason,
              limitation: original.limitation,
              includeInGeneration: original.includeInGeneration,
            }
          : computed;
      }),
    });
  } else {
    validateObjectiveBlueprintLinks(
      learningUnits,
      design.objectives,
      design.blueprints,
    );
    const recommendationByKey = new Map(
      design.recommendations.map((item) => [activityRecommendationKey(item), item]),
    );
    const policy = design.policy ?? defaultGenerationPolicy;
    const blueprints = design.blueprints.map((blueprint) => {
      const selected = recommendationByKey.get(blueprint.id);
      return selected?.recommendedType
        ? { ...blueprint, recommendedType: selected.recommendedType }
        : blueprint;
    });
    const supportAssessments = blueprints.map((blueprint) =>
      assessBlueprintSupport(blueprint, blueprint.recommendedType),
    );
    design = activityDesignSchema.parse({
      ...design,
      blueprints,
      supportAssessments,
      policy,
      recommendations: blueprints.map((blueprint, index) => {
        const computed = recommendationFromBlueprint(
          blueprint,
          supportAssessments[index],
          policy,
        );
        const selected = recommendationByKey.get(blueprint.id);
        return selected
          ? {
              ...computed,
              includeInGeneration:
                computed.supportLevel === "unsupported"
                  ? false
                  : selected.includeInGeneration,
            }
          : computed;
      }),
    });
  }
  validateObjectiveBlueprintLinks(
    learningUnits,
    design.objectives ?? [],
    design.blueprints ?? [],
  );
  return design;
}

export function selectLearningUnitsForCards(
  analysis: AnalysisResult,
  organizedMaterial: OrganizedMaterial,
): LearningUnit[] {
  const availableUnits = analysis.learningUnits ?? [];
  const hasUnitMapping = organizedMaterial.sections.some((section) =>
    Array.isArray(section.learningUnitIds),
  );

  if (!hasUnitMapping) return availableUnits;

  const selectedIds = new Set(
    organizedMaterial.sections.flatMap((section) => section.learningUnitIds ?? []),
  );
  const reviewedTextByUnitId = new Map(
    organizedMaterial.sections.flatMap((section) =>
      (section.learningUnitIds ?? []).map((id) => [id, section.content] as const),
    ),
  );
  const selectedUnits = availableUnits
    .filter((unit) => selectedIds.has(unit.id))
    .map((unit) => ({
      ...unit,
      reviewedText:
        reviewedTextByUnitId.get(unit.id) ??
        (unit.generalizedForm || unit.sourceText),
    }));
  const manualUnits = organizedMaterial.sections.flatMap((section, index) => {
    if (section.learningUnitIds?.length || !section.content.trim()) return [];

    return [
      {
        id: `manual-${index + 1}`,
        sourceId: "user-edited-material",
        sourcePage: 0,
        sourceRange: section.heading,
        sourceText: section.content,
        knowledgeType: analysis.primaryKnowledgeType ?? "other",
        fixedPart: "",
        variableSlots: [],
        generalizedForm: "",
        target: section.heading || "사용자가 추가한 학습 내용",
        rationale: "사용자가 카드 생성 전 정리본에 직접 추가한 학습 단위입니다.",
        reviewedText: section.content,
      } satisfies LearningUnit,
    ];
  });

  return [...selectedUnits, ...manualUnits];
}

export async function runCardCritic(
  cards: Array<z.infer<typeof cardDraftSchema>>,
  learningUnits: LearningUnit[],
  targetCardCount?: number,
  cardContract?: CardContract,
  usesSoftBudget = false,
  runtime: StageRuntimeOptions = {},
) {
  if (!CRITIC_ENABLED) {
    return cards;
  }

  const content = await callCodexJson({
    schemaName: "reviewed_memory_cards",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          ...(targetCardCount
            ? { minItems: targetCardCount, maxItems: targetCardCount }
            : { minItems: 1 }),
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "activityType",
              "front",
              "back",
              "clozeText",
              "answer",
              "answers",
              "options",
              "correctOptionIndex",
              "correctBoolean",
              "structureNodes",
              "structureRecallKind",
              "supportedStructureRecallModes",
              "structureRecallMode",
              "recommendationReason",
              "hint",
              "tags",
              "basis",
              "learningUnitId",
              "objectiveId",
              "blueprintId",
              "strategy",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "rationale",
              "difficulty",
              "qualityPassed",
              "qualityNotes",
              "qualityStatus",
              "explanation",
            ],
            properties: {
              type: { type: "string", enum: ["flashcard", "cloze", "translation"] },
              activityType: { type: "string", enum: learningActivityTypes },
              front: { type: "string" },
              back: { type: "string" },
              clozeText: { type: "string" },
              answer: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
              options: { type: "array", items: { type: "string" } },
              correctOptionIndex: { type: "integer" },
              correctBoolean: { type: "boolean" },
              structureNodes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "parentId", "correctLabel"],
                  properties: {
                    id: { type: "string" },
                    parentId: { type: ["string", "null"] },
                    correctLabel: { type: "string" },
                  },
                },
              },
              structureRecallMode: {
                type: "string",
                enum: ["word_bank", "free_input"],
              },
              structureRecallKind: {
                type: "string",
                enum: ["sequence", "hierarchy"],
              },
              supportedStructureRecallModes: {
                type: "array",
                minItems: 1,
                maxItems: 2,
                uniqueItems: true,
                items: { type: "string", enum: ["word_bank", "free_input"] },
              },
              recommendationReason: { type: "string" },
              hint: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              basis: { type: "string" },
              learningUnitId: { type: "string" },
              objectiveId: { type: "string" },
              blueprintId: { type: "string" },
              strategy: { type: "string", enum: cardStrategies },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              rationale: { type: "string" },
              difficulty: { type: "integer", minimum: 1, maximum: 5 },
              qualityPassed: { type: "boolean" },
              qualityNotes: { type: "array", items: { type: "string" } },
              qualityStatus: {
                type: "string",
                enum: ["not_run", "passed", "failed", "waived"],
              },
              explanation: { type: "string" },
            },
          },
        },
      },
    },
    system:
      "당신은 암기 카드 품질 검사자입니다. 원문 학습 단위와 생성된 카드를 대조해 문제가 있는 카드는 직접 수정합니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      "원문에서 추출한 구조화 학습 단위:",
      JSON.stringify(learningUnits, null, 2),
      "",
      "검사할 카드:",
      JSON.stringify(cards, null, 2),
      "",
      "승인된 카드 계약:",
      JSON.stringify(cardContract, null, 2),
      "",
      "검사 기준:",
      "- 앞면만 보고 요구되는 답을 능동적으로 인출할 수 있어야 합니다.",
      "- 카드 하나에는 하나의 핵심 인출만 있어야 합니다.",
      "- 뒷면은 불필요하게 길지 않아야 합니다.",
      "- 단순 예문 복사가 아니라 재사용 가능한 지식이어야 합니다. 단, 일반화하면 의미가 손실되는 사실은 원문을 보존합니다.",
      "- learningUnitId, objectiveId, blueprintId와 출처 연결을 그대로 보존합니다.",
      "- 원문에 없는 사실을 추가하거나 표현을 왜곡하면 안 됩니다.",
      "- reviewedText가 있으면 사용자가 확정한 내용이므로 카드 내용은 이를 우선합니다. sourceText는 출처 대조에만 사용합니다.",
      "- strategy가 지식 유형과 인출 방향에 맞아야 합니다.",
      "- Critic의 역할은 카드를 새로 개선하는 것이 아니라 계약 위반과 명백한 오류만 최소 수정하는 것입니다.",
      "- 대표 예시의 앞면·뒷면 문체와 정보 배치를 유지합니다.",
      "- CardContract.slotMode가 template이면 변수 자리를 보존하고, filled_example이면 모든 변수 자리를 구체적인 값으로 채웁니다.",
      "- template과 filled_example을 한 카드 안에서 섞지 않습니다.",
      "- 대표 예시 cue에 없던 과업 설명, 접두 문장 또는 메타 지시문을 추가하지 않습니다.",
      "- 카드 유형으로 학습 행동이 이미 명확하면 '다음 뜻을', '영어로 말하세요', '번역하세요' 같은 설명을 추가하지 않습니다.",
      "- structure_recall 카드의 structureRecallKind, supportedStructureRecallModes, structureRecallMode를 바꾸지 않습니다.",
      "- sequence는 하나의 부모→자식 사슬, hierarchy는 실제 가지가 있는 구조여야 합니다. 평면 목록이나 서로 다른 관계를 억지로 구조 문제로 바꾸지 않습니다.",
      "- 문제가 있으면 문제가 있는 최소 부분만 수정하고 qualityNotes에 수정 이유를 기록합니다.",
      "- 수정 후 모든 기준을 통과하면 qualityPassed를 true로 둡니다.",
      "- 원문 자체가 불충분해 해결할 수 없는 경우만 qualityPassed를 false로 두고 이유를 기록합니다.",
      ...(usesSoftBudget
        ? [
            "- 입력된 각 카드와 UI type을 유지하며 기존 카드의 품질만 수정합니다. 새 카드를 추가하거나 누락된 LearningUnit을 복구하지 않습니다.",
          ]
        : ["- 카드 수와 각 카드의 UI type은 유지합니다."]),
      ...(runtime.instruction
        ? ["", "실험 실행 추가 지시:", runtime.instruction]
        : []),
    ].join("\n"),
    step: "critic",
    model: runtime.model ?? CRITIC_MODEL,
    reasoningEffort: runtime.reasoningEffort ?? CRITIC_REASONING_EFFORT,
    projectId: runtime.projectId,
    usage: { ...runtime, stage: runtime.usageStage ?? "critic" },
  });

  return cardsSchema.parse(content).cards;
}

export function getSelectedUnitCount(studyGuideline: string) {
  if (!studyGuideline) {
    return undefined;
  }

  try {
    const guideline = JSON.parse(studyGuideline) as {
      selectedGroup?: { itemCount?: number };
    };
    const count = guideline.selectedGroup?.itemCount;
    return typeof count === "number" && count > 0 ? count : undefined;
  } catch {
    return undefined;
  }
}

export function hasSoftCountPolicy(studyGuideline: string) {
  if (!studyGuideline) {
    return false;
  }

  try {
    const guideline = JSON.parse(studyGuideline) as {
      countPolicy?: string;
    };
    return guideline.countPolicy === "soft_budget";
  } catch {
    return false;
  }
}

export function getMaxLearningUnitCount(studyGuideline: string) {
  if (!studyGuideline) return undefined;

  try {
    const guideline = JSON.parse(studyGuideline) as {
      wholeDocumentCore?: {
        maxLearningUnitCount?: number;
        estimatedLearningUnitCount?: number;
      };
      learningUnitSoftBudget?: {
        max?: number;
        target?: number;
      };
    };
    const candidates = [
      guideline.wholeDocumentCore?.maxLearningUnitCount,
      guideline.learningUnitSoftBudget?.max,
      guideline.wholeDocumentCore?.estimatedLearningUnitCount,
      guideline.learningUnitSoftBudget?.target,
    ];
    return candidates.find(
      (value): value is number => Number.isInteger(value) && Number(value) > 0,
    );
  } catch {
    return undefined;
  }
}

function getSelectedOutlineLeafIds(studyGuideline: string) {
  if (!studyGuideline.trim()) return [];
  try {
    const guideline = JSON.parse(studyGuideline) as {
      wholeDocumentCore?: {
        learningOutline?: {
          nodes?: Array<{
            id?: string;
            parentId?: string | null;
            selectedByDefault?: boolean;
          }>;
        };
      };
    };
    const nodes = guideline.wholeDocumentCore?.learningOutline?.nodes ?? [];
    const parentIds = new Set(
      nodes.flatMap((node) => node.parentId ? [node.parentId] : []),
    );
    return nodes
      .filter(
        (node) =>
          Boolean(node.id) &&
          node.selectedByDefault === true &&
          !parentIds.has(node.id!),
      )
      .map((node) => node.id!);
  } catch {
    return [];
  }
}

function hasCompleteSelectedOutlineEvidence(
  studyGuideline: string,
  selectedOutlineLeafIds: string[],
) {
  if (selectedOutlineLeafIds.length === 0 || !studyGuideline.trim()) return false;
  try {
    const guideline = JSON.parse(studyGuideline) as {
      wholeDocumentCore?: {
        learningOutline?: {
          nodes?: Array<{ id?: string; sourceEvidence?: string }>;
        };
      };
    };
    const evidenceById = new Map(
      (guideline.wholeDocumentCore?.learningOutline?.nodes ?? []).map((node) => [
        node.id,
        node.sourceEvidence?.trim() ?? "",
      ]),
    );
    return selectedOutlineLeafIds.every((id) => Boolean(evidenceById.get(id)));
  } catch {
    return false;
  }
}

function normalizeClozeText(clozeText: string, answers: string[]) {
  let nextText = clozeText.replace(
    /\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g,
    "____",
  );
  answers.forEach((answer) => {
    nextText = nextText.replace(answer, "____");
  });
  return nextText;
}

function normalizeClozeAnswers(
  clozeText: string,
  answer: string,
  answers: string[],
) {
  const clozeMatches = Array.from(
    clozeText.matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g),
  ).map((match) => match[1].trim());
  const candidates = clozeMatches.length > 0 ? clozeMatches : answers;
  const parsed = candidates.length > 0 ? candidates : splitAnswerText(answer);
  return parsed.filter(Boolean);
}

function splitAnswerText(answer: string) {
  return answer
    .split(/\n|,|;|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCompactLearningDesignJsonSchema(maxKnowledgeUnits: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["objectives", "units", "checks"],
    properties: {
      objectives: {
        type: "array",
        minItems: 1,
        maxItems: maxKnowledgeUnits,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nodes", "target", "operation", "criteria", "importance"],
          properties: {
            nodes: { type: "array", minItems: 1, items: { type: "string" } },
            target: { type: "string" },
            operation: { type: "string", enum: learningOperations },
            criteria: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["description"],
                properties: {
                  description: { type: "string" },
                },
              },
            },
            importance: { type: "integer", minimum: 0, maximum: 3 },
          },
        },
      },
      units: {
        type: "array",
        minItems: 1,
        maxItems: maxKnowledgeUnits,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["objective", "nodes", "content", "evidence", "kind", "rationale"],
          properties: {
            objective: { type: "integer", minimum: 1, maximum: maxKnowledgeUnits },
            nodes: { type: "array", minItems: 1, items: { type: "string" } },
            content: { type: "string" },
            evidence: { type: "string" },
            kind: { type: "string", enum: knowledgeTypes },
            rationale: { type: "string" },
          },
        },
      },
      checks: {
        type: "array",
        minItems: 1,
        maxItems: maxKnowledgeUnits * 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "unit", "operation", "criteria", "relation", "given", "hidden",
            "response", "grading",
          ],
          properties: {
            unit: { type: "integer", minimum: 1, maximum: maxKnowledgeUnits },
            operation: { type: "string", enum: learningOperations },
            criteria: { type: "array", minItems: 1, items: { type: "integer", minimum: 1, maximum: 3 } },
            relation: { type: "string", enum: ["direct", "scaffold", "proxy"] },
            given: {
              type: "object",
              additionalProperties: false,
              required: ["type", "description"],
              properties: {
                type: { type: "string", enum: ["instruction", "context", "data", "diagram", "example"] },
                description: { type: "string" },
              },
            },
            hidden: {
              type: "object",
              additionalProperties: false,
              required: ["description", "reason"],
              properties: {
                description: { type: "string" },
                reason: { type: "string", enum: ["target_answer", "required_inference", "intermediate_step"] },
              },
            },
            response: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "description"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["short_text", "structured_text", "single_choice", "multiple_choice", "ordered_structure", "unordered_structure", "numeric", "code", "graph_annotation", "audio", "checklist"],
                },
                description: { type: "string" },
              },
            },
            grading: { type: "string", enum: ["exact", "semantic", "rule", "self"] },
          },
        },
      },
    },
  };
}

function buildLearningPlanGenerationJsonSchema(blueprintCount: number) {
  const commonCardProperties = {
    blueprintId: { type: "string" },
    front: { type: "string" },
    basis: { type: "string" },
    strategy: { type: "string", enum: cardStrategies },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    explanation: { type: "string" },
    sourceGrounded: { type: "boolean" },
    verificationNotes: { type: "array", items: { type: "string" } },
  };
  const commonCardRequired = [
    "blueprintId", "activityType", "front", "basis", "strategy",
    "difficulty", "explanation", "sourceGrounded", "verificationNotes",
  ];
  return {
    type: "object",
    additionalProperties: false,
    required: ["activities", "cards"],
    properties: {
      activities: {
        type: "array",
        minItems: blueprintCount,
        maxItems: blueprintCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["blueprintId", "recommendedType", "supportLevel", "reason", "limitation", "includeInGeneration"],
          properties: {
            blueprintId: { type: "string" },
            recommendedType: {
              anyOf: [
                { type: "string", enum: learningActivityTypes },
                { type: "null" },
              ],
            },
            supportLevel: { type: "string", enum: ["exact", "scaffold", "unsupported"] },
            reason: { type: "string" },
            limitation: { type: "string" },
            includeInGeneration: { type: "boolean" },
          },
        },
      },
      cards: {
        type: "array",
        minItems: 0,
        maxItems: blueprintCount,
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: [...commonCardRequired, "back"],
              properties: {
                ...commonCardProperties,
                activityType: { type: "string", enum: ["flashcard"] },
                back: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [...commonCardRequired, "clozeText", "answer"],
              properties: {
                ...commonCardProperties,
                activityType: { type: "string", enum: ["cloze"] },
                clozeText: { type: "string" },
                answer: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [...commonCardRequired, "correctBoolean"],
              properties: {
                ...commonCardProperties,
                activityType: { type: "string", enum: ["true_false"] },
                correctBoolean: { type: "boolean" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [...commonCardRequired, "options", "correctOptionIndex"],
              properties: {
                ...commonCardProperties,
                activityType: { type: "string", enum: ["multiple_choice"] },
                options: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
                correctOptionIndex: { type: "integer", minimum: 0 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [
                ...commonCardRequired,
                "structureNodes",
                "structureRecallKind",
                "supportedStructureRecallModes",
                "structureRecallMode",
              ],
              properties: {
                ...commonCardProperties,
                activityType: { type: "string", enum: ["structure_recall"] },
                structureNodes: {
                  type: "array",
                  minItems: 3,
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "parentId", "correctLabel"],
                    properties: {
                      id: { type: "string" },
                      parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
                      correctLabel: { type: "string" },
                    },
                  },
                },
                structureRecallKind: { type: "string", enum: ["sequence", "hierarchy"] },
                supportedStructureRecallModes: {
                  type: "array",
                  minItems: 1,
                  maxItems: 2,
                  uniqueItems: true,
                  items: { type: "string", enum: ["word_bank", "free_input"] },
                },
                structureRecallMode: { type: "string", enum: ["word_bank", "free_input"] },
              },
            },
          ],
        },
      },
    },
  };
}

export function materializeLearningPlanGeneration(
  generated: z.infer<typeof learningPlanGenerationSchema>,
  design: LearningDesignPlan,
  analysis: AnalysisResult,
) {
  const blueprintById = new Map(
    design.assessmentBlueprints.map((item) => [item.id, item]),
  );
  const unitById = new Map(design.knowledgeUnits.map((item) => [item.id, item]));
  const activityIds = generated.activities.map((item) => item.blueprintId);
  if (
    new Set(activityIds).size !== activityIds.length ||
    activityIds.some((id) => !blueprintById.has(id)) ||
    activityIds.length !== blueprintById.size
  ) {
    throw new PipelineError("activity", "문제 방식이 평가 설계와 일치하지 않습니다.");
  }

  const recommendationByBlueprintId = new Map<string, ActivityDesign["recommendations"][number]>();
  const practiceBlueprints: PracticeBlueprint[] = [];
  const supportAssessments: NonNullable<ActivityDesign["supportAssessments"]> = [];
  for (const activity of generated.activities) {
    const blueprint = blueprintById.get(activity.blueprintId)!;
    const include =
      activity.includeInGeneration &&
      activity.supportLevel !== "unsupported" &&
      activity.recommendedType !== null;
    if (activity.recommendedType) {
      const practiceBlueprint: PracticeBlueprint = {
        ...blueprint,
        learningUnitId: blueprint.knowledgeUnitId,
        recommendedType: activity.recommendedType,
      };
      const assessment = assessBlueprintSupport(
        practiceBlueprint,
        activity.recommendedType,
      );
      practiceBlueprints.push(practiceBlueprint);
      supportAssessments.push(assessment);
      recommendationByBlueprintId.set(activity.blueprintId, {
        learningUnitId: blueprint.knowledgeUnitId,
        objectiveId: blueprint.objectiveId,
        blueprintId: blueprint.id,
        assessmentLevel: assessment.level,
        supportLevel: activity.supportLevel === "exact" ? "supported" : "partial",
        recommendedType: activity.recommendedType,
        reason: activity.reason,
        limitation: activity.limitation,
        includeInGeneration: include,
      });
    } else {
      recommendationByBlueprintId.set(activity.blueprintId, {
        learningUnitId: blueprint.knowledgeUnitId,
        objectiveId: blueprint.objectiveId,
        blueprintId: blueprint.id,
        assessmentLevel: "unsupported",
        supportLevel: "unsupported",
        recommendedType: null,
        reason: activity.reason,
        limitation: activity.limitation,
        includeInGeneration: false,
      });
    }
  }

  const includedIds = new Set(
    [...recommendationByBlueprintId.entries()]
      .filter(([, item]) => item.includeInGeneration)
      .map(([id]) => id),
  );
  const cardIds = generated.cards.map((item) => item.blueprintId);
  if (
    new Set(cardIds).size !== cardIds.length ||
    cardIds.some((id) => !includedIds.has(id)) ||
    cardIds.length !== includedIds.size ||
    generated.cards.some((card) => !card.sourceGrounded)
  ) {
    throw new PipelineError(
      "cards",
      "생성된 문제의 수 또는 원문 대조 결과가 확정한 평가 설계와 일치하지 않습니다.",
    );
  }

  const legacyUnitById = new Map(
    (analysis.learningUnits ?? []).map((item) => [item.id, item]),
  );
  const hydrated = generated.cards.map((card) => {
    const blueprint = blueprintById.get(card.blueprintId)!;
    const unit = unitById.get(blueprint.knowledgeUnitId)!;
    const legacyUnit = legacyUnitById.get(unit.id);
    const recommendation = recommendationByBlueprintId.get(card.blueprintId)!;
    if (!legacyUnit || card.activityType !== recommendation.recommendedType) {
      throw new PipelineError("cards", "문제 형식 또는 학습 내용 연결이 설계와 다릅니다.");
    }
    if (
      card.activityType === "multiple_choice" &&
      card.correctOptionIndex >= card.options.length
    ) {
      throw new PipelineError("cards", "객관식 정답 위치가 선택지 범위를 벗어났습니다.");
    }
    const content: GeneratedCardContent = {
      ...card,
      learningUnitId: unit.id,
    };
    return {
      ...hydrateGeneratedCardContent(content, {
        analysis,
        learningUnit: legacyUnit,
        recommendation,
      }),
      qualityPassed: true,
      qualityStatus: "passed" as const,
      qualityNotes: card.verificationNotes,
    };
  });
  const cards = materializeCards(hydrated, "flashcard");
  const invalid = cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.blueprintId}: ${issue}`),
  );
  if (invalid.length > 0) {
    throw new PipelineError("cards", "생성된 문제 형식 검증에 실패했습니다.", invalid);
  }

  const activityDesign: ActivityDesign = {
    recommendations: generated.activities.map((item) =>
      recommendationByBlueprintId.get(item.blueprintId)!,
    ),
    blueprints: practiceBlueprints,
    supportAssessments,
    policy: defaultGenerationPolicy,
  };
  return { activityDesign, cards };
}

async function callCodexJsonThread({
  schemaName,
  schema,
  system,
  user,
  files,
  threadId,
  projectId,
  threadScope,
  step,
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
}: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: PdfInput[];
  threadId?: string;
  projectId?: string;
  threadScope?: "project" | "job";
  step: PipelineStep;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}) {
  try {
    return await callCodexProviderJsonWithThread({
      schemaName,
      schema,
      system,
      user,
      files,
      threadId,
      projectId,
      threadScope,
      model,
      reasoningEffort,
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(step, stepMessages[step], error);
  }
}

async function callCodexJson({
  schemaName,
  schema,
  system,
  user,
  files,
  projectId,
  step,
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  usage,
}: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: PdfInput[];
  projectId?: string;
  step: PipelineStep;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  usage?: ApiUsageCapture & { stage: ApiUsageStage };
}) {
  try {
    void usage;
    return await callCodexProviderJson({
      schemaName,
      schema,
      system,
      user,
      files,
      projectId,
      model,
      reasoningEffort,
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      throw error;
    }
    throw new PipelineError(step, stepMessages[step], error);
  }
}
