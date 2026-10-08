import type { CardDraft } from "./generate.ts";
import type {
  ActivityRecommendation,
  AnalysisResult,
  CardStrategy,
  LearningUnit,
  LearningActivityType,
  StructureRecallNode,
  StructureRecallMode,
} from "../types.ts";

type CompactCardCommon = {
  type: "flashcard" | "cloze" | "translation";
  activityType: LearningActivityType;
  front: string;
  recommendationReason: string;
  tags: string[];
  basis: string;
  learningUnitId: string;
  objectiveId?: string;
  blueprintId?: string;
  strategy: CardStrategy;
  sourceId: string;
  sourcePage: number;
  sourceRange: string;
  rationale: string;
  difficulty: number;
  explanation?: string;
};

export type CompactCardDraft =
  | (CompactCardCommon & { activityType: "flashcard"; back: string })
  | (CompactCardCommon & { activityType: "true_false"; correctBoolean: boolean })
  | (CompactCardCommon & {
      activityType: "multiple_choice";
      options: string[];
      correctOptionIndex: number;
    })
  | (CompactCardCommon & {
      activityType: "structure_recall";
      structureNodes: StructureRecallNode[];
      structureRecallMode: StructureRecallMode;
    });

export type GeneratedCardContent =
  | {
      learningUnitId: string;
      activityType: "flashcard";
      front: string;
      back: string;
      basis: string;
      strategy: CardStrategy;
      difficulty: number;
      explanation: string;
    }
  | {
      learningUnitId: string;
      activityType: "true_false";
      front: string;
      correctBoolean: boolean;
      basis: string;
      strategy: CardStrategy;
      difficulty: number;
      explanation: string;
    }
  | {
      learningUnitId: string;
      activityType: "multiple_choice";
      front: string;
      options: string[];
      correctOptionIndex: number;
      basis: string;
      strategy: CardStrategy;
      difficulty: number;
      explanation: string;
    }
  | {
      learningUnitId: string;
      activityType: "structure_recall";
      front: string;
      structureNodes: StructureRecallNode[];
      structureRecallMode: StructureRecallMode;
      basis: string;
      strategy: CardStrategy;
      difficulty: number;
      explanation: string;
    };

export function hydrateGeneratedCardContent(
  card: GeneratedCardContent,
  context: {
    analysis: AnalysisResult;
    learningUnit: LearningUnit;
    recommendation: ActivityRecommendation;
  },
): CardDraft {
  const { learningUnit, recommendation, analysis } = context;
  const common = {
    type: "flashcard" as const,
    front: card.front,
    back: "",
    clozeText: "",
    answer: "",
    answers: [] as string[],
    options: [] as string[],
    correctOptionIndex: 0,
    correctBoolean: false,
    structureNodes: [] as StructureRecallNode[],
    structureRecallMode: "word_bank" as StructureRecallMode,
    recommendationReason: recommendation.reason,
    hint: "",
    tags: analysis.keyTopics.slice(0, 3),
    basis: card.basis,
    learningUnitId: learningUnit.id,
    objectiveId: recommendation.objectiveId ?? "",
    blueprintId: recommendation.blueprintId ?? "",
    strategy: card.strategy,
    sourceId: learningUnit.sourceId,
    sourcePage: learningUnit.sourcePage,
    sourceRange: learningUnit.sourceRange,
    rationale: recommendation.reason,
    difficulty: card.difficulty,
    qualityPassed: false,
    qualityNotes: [] as string[],
    qualityStatus: "not_run" as const,
    explanation: card.explanation,
  };

  if (card.activityType === "flashcard") {
    return { ...common, activityType: card.activityType, back: card.back };
  }
  if (card.activityType === "true_false") {
    return {
      ...common,
      activityType: card.activityType,
      back: card.correctBoolean ? "O" : "X",
      correctBoolean: card.correctBoolean,
    };
  }
  if (card.activityType === "multiple_choice") {
    return {
      ...common,
      activityType: card.activityType,
      back: card.options[card.correctOptionIndex] ?? "",
      options: card.options,
      correctOptionIndex: card.correctOptionIndex,
    };
  }
  return {
    ...common,
    activityType: card.activityType,
    structureNodes: card.structureNodes,
    structureRecallMode: card.structureRecallMode,
  };
}

export function expandCompactCardDraft(card: CompactCardDraft): CardDraft {
  const common = {
    type: card.type,
    activityType: card.activityType,
    front: card.front,
    back: "",
    clozeText: "",
    answer: "",
    answers: [] as string[],
    options: [] as string[],
    correctOptionIndex: 0,
    correctBoolean: false,
    structureNodes: [] as StructureRecallNode[],
    structureRecallMode: "word_bank" as StructureRecallMode,
    recommendationReason: card.recommendationReason,
    hint: "",
    tags: card.tags,
    basis: card.basis,
    learningUnitId: card.learningUnitId,
    objectiveId: card.objectiveId ?? "",
    blueprintId: card.blueprintId ?? "",
    strategy: card.strategy,
    sourceId: card.sourceId,
    sourcePage: card.sourcePage,
    sourceRange: card.sourceRange,
    rationale: card.rationale,
    difficulty: card.difficulty,
    qualityPassed: false,
    qualityNotes: [] as string[],
    qualityStatus: "not_run" as const,
    explanation: card.explanation ?? "",
  };

  if (card.activityType === "flashcard") {
    return { ...common, activityType: card.activityType, back: card.back };
  }
  if (card.activityType === "true_false") {
    return {
      ...common,
      activityType: card.activityType,
      back: card.correctBoolean ? "O" : "X",
      correctBoolean: card.correctBoolean,
    };
  }
  if (card.activityType === "multiple_choice") {
    return {
      ...common,
      activityType: card.activityType,
      back: card.options[card.correctOptionIndex] ?? "",
      options: card.options,
      correctOptionIndex: card.correctOptionIndex,
    };
  }
  return {
    ...common,
    activityType: card.activityType,
    structureNodes: card.structureNodes,
    structureRecallMode: card.structureRecallMode,
  };
}
