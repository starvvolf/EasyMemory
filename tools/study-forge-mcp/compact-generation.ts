// MCP natural-language output keeps its compact hydration contract separately from API direct JSON.
import { z } from "zod";
import { cardDraftSchema, learningPlanGenerationSchema as directPlanSchema, materializeCards } from "../../src/lib/pipeline/generate.ts";
class PipelineError extends Error {
  constructor(step: string, message: string, details?: unknown) {
    super(`${step}: ${message}${details ? ` (${JSON.stringify(details)})` : ""}`);
  }
}
import { hydrateGeneratedCardContent, type GeneratedCardContent } from "../../src/lib/pipeline/compact-card-output.ts";
import { assessBlueprintSupport, defaultGenerationPolicy } from "../../src/lib/practice-blueprint.ts";
import { validateLearningActivity } from "../../src/lib/learning-activity.ts";
import type { LearningDesignPlan, AnalysisResult, ActivityDesign, PracticeBlueprint } from "../../src/lib/types.ts";
const cardStrategies = cardDraftSchema.shape.strategy.options;
const structureRecallNodeSchema = cardDraftSchema.shape.structureNodes.element;
const structureRecallKindSchema = z.enum(["sequence", "hierarchy"]);
const structureRecallModeSchema = z.enum(["word_bank", "free_input"]);
const supportedStructureRecallModesSchema = z.array(structureRecallModeSchema).min(1);
const plannedActivitySchema = directPlanSchema.shape.activities.element;
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
