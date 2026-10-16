import type {
  ActivityDesign,
  AnalysisResult,
  LearningActivityType,
  LearningOperation,
  LearningUnit,
  SourceExpressionMode,
} from "../types.ts";

export type CompactActivityDesignUnit = {
  learningUnitId: string;
  target: string;
  operation: LearningOperation | null;
  successCriterion: string;
  finalContent: string;
  pageRefs: string[];
};

export type CompactActivityDesignInput = {
  learningGoal: string;
  sourcePages: CompactSourcePage[];
  units: CompactActivityDesignUnit[];
};

export type CompactSourcePage = {
  id: string;
  sourceId: string;
  pageNumber: number;
  text: string;
};

export type CompactCardGenerationUnit = {
  learningUnitId: string;
  finalContent: string;
  activityType: LearningActivityType;
  pageRefs: string[];
  objectiveTarget: string;
  elicitedOperation: LearningOperation | null;
  relationToObjective: "direct" | "scaffold" | "proxy";
  given: Array<{ type: string; description: string }>;
  hidden: Array<{ description: string; reason: string }>;
  expectedResponse: { kind: string; description: string };
  scoringRubric: Array<{
    criterionId: string;
    description: string;
    weight: number;
    gradingMode: string;
  }>;
};

export type CompactCardGenerationInput = {
  learningGoal: string;
  sourceType: AnalysisResult["sourceType"];
  sourcePages: CompactSourcePage[];
  units: CompactCardGenerationUnit[];
};

type ParsedLearningContent = {
  evidence: string;
  pages: Array<{ pageNumber: number; text: string }>;
};

const sourcePageMarker = /^해당 원문 페이지\s+(\d+)\s*:\s*/gm;

function pageNumbersFromSourceRange(sourceRange: string) {
  if (!/(?:쪽|pages?|p\.)/i.test(sourceRange)) return [];
  const numbers = [...sourceRange.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length === 2 && /[~\-–—]/.test(sourceRange)) {
    const [start, end] = numbers;
    if (end >= start) {
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }
  }
  return [...new Set(numbers)];
}

function parseLearningContent(
  content: string,
  sourceRange: string,
  sourcePage: number,
): ParsedLearningContent {
  const matches = [...content.matchAll(sourcePageMarker)];
  if (matches.length === 0) return { evidence: content, pages: [] };

  const evidence = content.slice(0, matches[0].index).trim();
  const rangePageNumbers = pageNumbersFromSourceRange(sourceRange);
  const fallbackPageNumbers = sourcePage > 0 ? [sourcePage] : [];
  const referencedPageNumbers = rangePageNumbers.length === matches.length
    ? rangePageNumbers
    : fallbackPageNumbers.length === matches.length
      ? fallbackPageNumbers
      : [];
  const pages = matches.map((match, index) => {
    const textStart = (match.index ?? 0) + match[0].length;
    const textEnd = matches[index + 1]?.index ?? content.length;
    return {
      pageNumber: referencedPageNumbers[index] ?? Number(match[1]),
      text: content.slice(textStart, textEnd).trim(),
    };
  });
  return { evidence, pages };
}

function compactLearningContents(
  learningUnits: LearningUnit[],
  sourceExpressionMode: SourceExpressionMode = "adapt",
) {
  const parsedByUnitId = new Map(
    learningUnits.map((unit) => [
      unit.id,
      parseLearningContent(
        sourceExpressionMode === "preserve"
          ? originalLearningContent(unit)
          : finalLearningContent(unit),
        unit.sourceRange,
        unit.sourcePage,
      ),
    ]),
  );
  const pageTextById = new Map<string, string>();
  const conflictedPageIds = new Set<string>();

  for (const unit of learningUnits) {
    for (const page of parsedByUnitId.get(unit.id)?.pages ?? []) {
      const id = `${unit.sourceId}#page-${page.pageNumber}`;
      const existing = pageTextById.get(id);
      if (existing !== undefined && existing !== page.text) {
        conflictedPageIds.add(id);
      } else {
        pageTextById.set(id, page.text);
      }
    }
  }

  const sourcePages: CompactSourcePage[] = [];
  const seenPageIds = new Set<string>();
  const contentByUnitId = new Map<
    string,
    { finalContent: string; pageRefs: string[] }
  >();

  for (const unit of learningUnits) {
    const parsed = parsedByUnitId.get(unit.id)!;
    const pageRefs: string[] = [];
    const fallbackPages: string[] = [];
    for (const page of parsed.pages) {
      const id = `${unit.sourceId}#page-${page.pageNumber}`;
      if (conflictedPageIds.has(id)) {
        fallbackPages.push(`해당 원문 페이지 ${page.pageNumber}: ${page.text}`);
        continue;
      }
      pageRefs.push(id);
      if (!seenPageIds.has(id)) {
        sourcePages.push({
          id,
          sourceId: unit.sourceId,
          pageNumber: page.pageNumber,
          text: page.text,
        });
        seenPageIds.add(id);
      }
    }
    contentByUnitId.set(unit.id, {
      finalContent: [parsed.evidence, ...fallbackPages].filter(Boolean).join("\n"),
      pageRefs,
    });
  }

  return { sourcePages, contentByUnitId };
}

export function finalLearningContent(unit: LearningUnit) {
  return (
    unit.reviewedText?.trim() ||
    unit.generalizedForm.trim() ||
    unit.sourceText.trim()
  );
}

export function originalLearningContent(unit: LearningUnit) {
  return (
    unit.sourceText.trim() ||
    unit.reviewedText?.trim() ||
    unit.generalizedForm.trim()
  );
}

export function learningUnitTarget(unit: LearningUnit) {
  return unit.target?.trim() || unit.intent?.trim() || finalLearningContent(unit);
}

export function learningUnitSuccessCriterion(unit: LearningUnit) {
  return unit.successCriterion?.trim() || learningUnitTarget(unit);
}

export function createCompactActivityDesignInput(
  analysis: AnalysisResult,
  learningUnits: LearningUnit[],
  sourceExpressionMode: SourceExpressionMode = "adapt",
): CompactActivityDesignInput {
  const { sourcePages, contentByUnitId } = compactLearningContents(
    learningUnits,
    sourceExpressionMode,
  );
  return {
    learningGoal: analysis.detectedGoal,
    sourcePages,
    units: learningUnits.map((unit) => ({
      learningUnitId: unit.id,
      target: learningUnitTarget(unit),
      operation: unit.operation ?? null,
      successCriterion: learningUnitSuccessCriterion(unit),
      finalContent: contentByUnitId.get(unit.id)!.finalContent,
      pageRefs: contentByUnitId.get(unit.id)!.pageRefs,
    })),
  };
}

export function createCompactCardGenerationInput(
  analysis: AnalysisResult,
  learningUnits: LearningUnit[],
  activityDesign: ActivityDesign,
  sourceExpressionMode: SourceExpressionMode = "adapt",
): CompactCardGenerationInput {
  const { sourcePages, contentByUnitId } = compactLearningContents(
    learningUnits,
    sourceExpressionMode,
  );
  const objectiveById = new Map(
    (activityDesign.objectives ?? []).map((item) => [item.id, item]),
  );
  const blueprintById = new Map(
    (activityDesign.blueprints ?? []).map((item) => [item.id, item]),
  );
  const unitById = new Map(learningUnits.map((unit) => [unit.id, unit]));
  return {
    learningGoal: analysis.detectedGoal,
    sourceType: analysis.sourceType,
    sourcePages,
    units: activityDesign.recommendations.flatMap((recommendation) => {
      if (!recommendation.includeInGeneration) return [];
      if (!recommendation.recommendedType) {
        throw new Error(`미지원 학습단위는 문제 생성 입력에 포함할 수 없습니다: ${recommendation.learningUnitId}`);
      }
      const unit = unitById.get(recommendation.learningUnitId);
      if (!unit) throw new Error(`문제 방식 추천의 학습단위를 찾을 수 없습니다: ${recommendation.learningUnitId}`);
      const blueprint = recommendation.blueprintId
        ? blueprintById.get(recommendation.blueprintId)
        : undefined;
      const objective = recommendation.objectiveId
        ? objectiveById.get(recommendation.objectiveId)
        : undefined;
      const compactContent = contentByUnitId.get(unit.id)!;
      return [{
        learningUnitId: unit.id,
        finalContent: compactContent.finalContent,
        activityType: recommendation.recommendedType,
        pageRefs: compactContent.pageRefs,
        objectiveTarget: objective?.target ?? learningUnitTarget(unit),
        elicitedOperation: blueprint?.elicitedOperation ?? unit.operation ?? null,
        relationToObjective: blueprint?.relationToObjective ?? "direct",
        given: blueprint?.given ?? [],
        hidden: blueprint?.hidden ?? [],
        expectedResponse: blueprint?.expectedResponse ?? {
          kind: "short_text",
          description: learningUnitSuccessCriterion(unit),
        },
        scoringRubric: blueprint?.scoringRubric ?? [],
      }];
    }),
  };
}

export function serializedByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
