import type {
  ActivityDesign,
  ActivityRecommendation,
  LearningUnit,
} from "../types.ts";
import { finalLearningContent } from "./compact-input.ts";

export type GenerationSelection = Pick<
  ActivityRecommendation,
  | "learningUnitId"
  | "blueprintId"
  | "assessmentLevel"
  | "supportLevel"
  | "recommendedType"
  | "includeInGeneration"
>;

export class GenerationPreflightError extends Error {}

export function assertLearningUnitsReady(input: {
  learningUnits: LearningUnit[];
  maxLearningUnitCount?: number;
}) {
  if (input.learningUnits.length === 0) {
    throw new GenerationPreflightError("포함할 학습내용이 없습니다.");
  }
  if (
    input.maxLearningUnitCount !== undefined &&
    input.learningUnits.length > input.maxLearningUnitCount
  ) {
    throw new GenerationPreflightError(
      `학습내용 ${input.learningUnits.length}개가 안전선 ${input.maxLearningUnitCount}개를 초과합니다.`,
    );
  }
  const ids = input.learningUnits.map((unit) => unit.id);
  if (new Set(ids).size !== ids.length) {
    throw new GenerationPreflightError("중복된 학습내용 ID가 있습니다.");
  }
  for (const unit of input.learningUnits) {
    if (!unit.id.trim() || !finalLearningContent(unit)) {
      throw new GenerationPreflightError("ID 또는 최종 학습내용이 비어 있습니다.");
    }
    if (!unit.sourceId.trim() || !unit.sourceRange.trim()) {
      throw new GenerationPreflightError(`원문 출처가 비어 있는 학습내용입니다: ${unit.id}`);
    }
  }
}

export function assertActivityDesignReady(
  learningUnits: LearningUnit[],
  design: ActivityDesign,
) {
  const expected = learningUnits.map((unit) => unit.id);
  const actual = design.recommendations.map((item) => item.learningUnitId);
  const recommendationKeys = design.recommendations.map(
    (item) => item.blueprintId ?? item.learningUnitId,
  );
  if (
    new Set(recommendationKeys).size !== recommendationKeys.length ||
    expected.some((id) => !actual.includes(id)) ||
    actual.some((id) => !expected.includes(id))
  ) {
    throw new GenerationPreflightError("문제 방식 추천 수 또는 학습내용 연결이 일치하지 않습니다.");
  }
}

export function assertGenerationSelectionReady(input: {
  selections: GenerationSelection[];
  automatic: boolean;
}) {
  const included = input.selections.filter((item) => item.includeInGeneration);
  if (included.length === 0) throw new GenerationPreflightError("문제로 생성할 지원 학습내용이 없습니다.");
  for (const item of included) {
    if (item.supportLevel === "unsupported" || item.recommendedType === null) {
      throw new GenerationPreflightError(`미지원 학습내용은 문제로 생성할 수 없습니다: ${item.learningUnitId}`);
    }
    if (
      input.automatic &&
      (item.assessmentLevel === "proxy" ||
        (!item.assessmentLevel && item.supportLevel === "partial"))
    ) {
      throw new GenerationPreflightError(`자동 흐름에는 부분 지원 중 대체 연습을 포함할 수 없습니다: ${item.learningUnitId}`);
    }
  }
}
