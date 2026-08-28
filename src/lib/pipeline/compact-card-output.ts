import type { CardDraft } from "./generate.ts";
import type {
  ActivityRecommendation,
  AnalysisResult,
  CardStrategy,
  LearningUnit,
  LearningActivityType,
  StructureRecallKind,
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
  | (CompactCardCommon & { activityType: "cloze"; clozeText: string; answer: string })
  | (CompactCardCommon & { activityType: "true_false"; correctBoolean: boolean })
  | (CompactCardCommon & {
      activityType: "multiple_choice";
      options: string[];
      correctOptionIndex: number;
    })
  | (CompactCardCommon & {
      activityType: "structure_recall";
      structureNodes: StructureRecallNode[];
      structureRecallKind?: StructureRecallKind;
      supportedStructureRecallModes?: StructureRecallMode[];
      structureRecallMode: StructureRecallMode;
    });

export type GeneratedCardContent = (
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
      activityType: "cloze";
      front: string;
      clozeText: string;
      answer: string;
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
      structureRecallKind?: StructureRecallKind;
      supportedStructureRecallModes?: StructureRecallMode[];
      structureRecallMode: StructureRecallMode;
      basis: string;
      strategy: CardStrategy;
      difficulty: number;
      explanation: string;
    }
) & { conceptNodeIds?: string[] };

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
    structureRecallKind: "hierarchy" as StructureRecallKind,
    supportedStructureRecallModes: ["word_bank"] as StructureRecallMode[],
    structureRecallMode: "word_bank" as StructureRecallMode,
    recommendationReason: recommendation.reason,
    hint: "",
    tags: analysis.keyTopics.slice(0, 3),
    basis: card.basis,
    learningUnitId: learningUnit.id,
    objectiveId: recommendation.objectiveId ?? "",
    blueprintId: recommendation.blueprintId ?? "",
    conceptNodeIds: card.conceptNodeIds,
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
  if (card.activityType === "cloze") {
    return {
      ...common,
      type: "cloze",
      activityType: card.activityType,
      front: card.clozeText,
      clozeText: card.clozeText,
      answer: card.answer,
      answers: [card.answer],
      back: card.answer,
    };
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
  const structureRecallKind = card.structureRecallKind ?? inferStructureRecallKind(card.structureNodes);
  return {
    ...common,
    activityType: card.activityType,
    structureNodes: card.structureNodes,
    structureRecallKind,
    supportedStructureRecallModes: card.supportedStructureRecallModes ?? [card.structureRecallMode],
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
    structureRecallKind: "hierarchy" as StructureRecallKind,
    supportedStructureRecallModes: ["word_bank"] as StructureRecallMode[],
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
  if (card.activityType === "cloze") {
    return {
      ...common,
      type: "cloze",
      activityType: card.activityType,
      front: card.clozeText,
      clozeText: card.clozeText,
      answer: card.answer,
      answers: [card.answer],
      back: card.answer,
    };
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
  const structureRecallKind = card.structureRecallKind ?? inferStructureRecallKind(card.structureNodes);
  return {
    ...common,
    activityType: card.activityType,
    structureNodes: card.structureNodes,
    structureRecallKind,
    supportedStructureRecallModes: card.supportedStructureRecallModes ?? [card.structureRecallMode],
    structureRecallMode: card.structureRecallMode,
  };
}

function inferStructureRecallKind(nodes: StructureRecallNode[]): StructureRecallKind {
  const childCounts = new Map<string | null, number>();
  for (const node of nodes) {
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }
  return nodes.length > 1 && [...childCounts.values()].every((count) => count === 1)
    ? "sequence"
    : "hierarchy";
}
