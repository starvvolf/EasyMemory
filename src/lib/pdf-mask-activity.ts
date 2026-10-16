import type {
  LearningOutline,
  LearningUnit,
  PdfMaskActivity,
} from "@/lib/types";
import { isReviewDue } from "./spaced-repetition.ts";

export function createPdfMaskActivities(
  learningUnits: LearningUnit[],
  outline?: LearningOutline,
): PdfMaskActivity[] {
  const importanceById = new Map(
    (outline?.nodes ?? []).map((node) => [node.id, node.importance ?? 2]),
  );

  return learningUnits.flatMap((unit) => {
    if (!unit.sourceText.trim() || unit.sourcePage < 1) return [];
    const rawImportance =
      importanceById.get(unit.sourceId) ?? importanceById.get(unit.id) ?? 2;
    if (rawImportance < 1) return [];
    const importance = Math.min(3, Math.max(1, rawImportance)) as 1 | 2 | 3;
    return [{
      id: `pdf-mask:${unit.id}`,
      learningUnitId: unit.id,
      sourceId: unit.sourceId,
      sourcePage: unit.sourcePage,
      importance,
      status: "new" as const,
    }];
  });
}

export function selectPdfMaskActivities(
  activities: PdfMaskActivity[],
  dueOnly: boolean,
  now: Date = new Date(),
) {
  return activities.filter((activity) =>
    dueOnly ? isReviewDue(activity, now) : true,
  );
}

export function countDuePdfMasks(
  activities: PdfMaskActivity[],
  now: Date = new Date(),
) {
  return activities.filter((activity) => isReviewDue(activity, now)).length;
}
