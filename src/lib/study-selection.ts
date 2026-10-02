import type { Card, StudySelectionMode } from "@/lib/types";
import { isReviewDue } from "./spaced-repetition.ts";

export function selectStudyActivityIds(
  cards: Card[],
  mode: StudySelectionMode,
  randomCount?: number,
  random: () => number = Math.random,
  now: Date = new Date(),
): string[] {
  if (mode === "due") {
    return cards.filter((card) => isReviewDue(card, now)).map((card) => card.id);
  }
  if (mode === "review_only") {
    return cards.filter((card) => card.status === "review").map((card) => card.id);
  }
  if (mode === "new_only") {
    return cards.filter((card) => card.status === "new").map((card) => card.id);
  }
  if (mode === "all") {
    return cards.map((card) => card.id);
  }

  const count = Math.min(
    cards.length,
    Math.max(0, Math.floor(randomCount ?? 0)),
  );
  const shuffledIds = cards.map((card) => card.id);
  for (let index = shuffledIds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledIds[index], shuffledIds[swapIndex]] = [
      shuffledIds[swapIndex],
      shuffledIds[index],
    ];
  }
  return shuffledIds.slice(0, count);
}
