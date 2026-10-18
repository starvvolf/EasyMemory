import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card as FsrsCard,
} from "ts-fsrs";
import type { Card, FsrsCardState, SpacedRepetitionSchedule } from "@/lib/types";

const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
});

const stateToName: Record<State, FsrsCardState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const nameToState: Record<FsrsCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function toStoredSchedule(card: FsrsCard): SpacedRepetitionSchedule {
  return {
    algorithm: "fsrs",
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    repetitions: card.reps,
    lapses: card.lapses,
    state: stateToName[card.state],
    lastReviewAt: card.last_review?.toISOString(),
  };
}

function toFsrsCard(
  schedule: SpacedRepetitionSchedule | undefined,
  now: Date,
): FsrsCard {
  if (!schedule) return createEmptyCard(now);

  return {
    due: new Date(schedule.dueAt),
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsedDays,
    scheduled_days: schedule.scheduledDays,
    learning_steps: schedule.learningSteps,
    reps: schedule.repetitions,
    lapses: schedule.lapses,
    state: nameToState[schedule.state],
    last_review: schedule.lastReviewAt
      ? new Date(schedule.lastReviewAt)
      : undefined,
  };
}

export function scheduleNextReview(
  current: SpacedRepetitionSchedule | undefined,
  remembered: boolean,
  reviewedAt: Date,
): SpacedRepetitionSchedule {
  const result = scheduler.next(
    toFsrsCard(current, reviewedAt),
    reviewedAt,
    remembered ? Rating.Good : Rating.Again,
  );
  return toStoredSchedule(result.card);
}

export function isReviewDue(
  item: Pick<Card, "reviewSchedule">,
  now: Date = new Date(),
): boolean {
  if (!item.reviewSchedule) return false;
  const dueAt = new Date(item.reviewSchedule.dueAt);
  return Number.isFinite(dueAt.getTime()) && dueAt.getTime() <= now.getTime();
}

export function countDueReviews(cards: Card[], now: Date = new Date()): number {
  return cards.filter((card) => isReviewDue(card, now)).length;
}

export function getRetrievability(
  schedule: SpacedRepetitionSchedule | undefined,
  now: Date = new Date(),
): number | null {
  if (!schedule || schedule.state === "new") return null;
  const value = scheduler.get_retrievability(toFsrsCard(schedule, now), now, false);
  return Number.isFinite(value) ? value : null;
}
