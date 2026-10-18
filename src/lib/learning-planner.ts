import type { Deck, StudyAttempt, StudySession } from "./types.ts";

export type LearningPlan = {
  id: string;
  date: string;
  deckId: string;
  quantity: number;
  note: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlannerReviewItem = {
  deckId: string;
  deckTitle: string;
  count: number;
};

export type PlannerStudyRecord = {
  sessionId: string;
  deckId: string;
  deckTitle: string;
  startedAt: string;
  completedCount: number;
  rememberedCount: number;
};

export type PlannerDay = {
  date: string;
  dayOfMonth: number;
  isToday: boolean;
  reviewCount: number;
  studiedCount: number;
  planCount: number;
  completedPlanCount: number;
};

export type PlannerMonth = {
  year: number;
  month: number;
  firstWeekday: number;
  days: PlannerDay[];
};

export type PlannerDayDetails = {
  date: string;
  reviews: PlannerReviewItem[];
  records: PlannerStudyRecord[];
  plans: LearningPlan[];
};

export type LearningPlanDraft = Pick<
  LearningPlan,
  "date" | "deckId" | "quantity" | "note"
>;

export function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createLearningPlan(
  draft: LearningPlanDraft,
  now: Date = new Date(),
  id = globalThis.crypto?.randomUUID?.() ?? `plan-${now.getTime()}`,
): LearningPlan {
  const timestamp = now.toISOString();
  return {
    id,
    date: draft.date,
    deckId: draft.deckId,
    quantity: Math.max(1, Math.floor(draft.quantity)),
    note: draft.note.trim(),
    completed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateLearningPlan(
  plan: LearningPlan,
  draft: LearningPlanDraft,
  now: Date = new Date(),
): LearningPlan {
  return {
    ...plan,
    date: draft.date,
    deckId: draft.deckId,
    quantity: Math.max(1, Math.floor(draft.quantity)),
    note: draft.note.trim(),
    updatedAt: now.toISOString(),
  };
}

function attemptWasRemembered(attempt: StudyAttempt): boolean {
  return attempt.activityType === "graded_problem"
    ? attempt.isCorrect
    : attempt.selfRating === "known";
}

function validDateKey(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? toLocalDateKey(date) : null;
}

function buildReviewItems(decks: Deck[], date: string): PlannerReviewItem[] {
  return decks
    .map((deck) => {
      const schedules = [
        ...deck.cards.map((card) => card.reviewSchedule),
        ...(deck.pdfMaskActivities ?? []).map((activity) => activity.reviewSchedule),
      ];
      return {
        deckId: deck.id,
        deckTitle: deck.title,
        count: schedules.filter(
          (schedule) => schedule && validDateKey(schedule.dueAt) === date,
        ).length,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.deckTitle.localeCompare(b.deckTitle));
}

function buildStudyRecords(
  decks: Deck[],
  sessions: StudySession[],
  attempts: StudyAttempt[],
  date: string,
): PlannerStudyRecord[] {
  const deckTitleById = new Map(decks.map((deck) => [deck.id, deck.title]));
  const attemptsBySession = new Map<string, StudyAttempt[]>();
  for (const attempt of attempts) {
    if (validDateKey(attempt.completedAt) !== date) continue;
    const items = attemptsBySession.get(attempt.sessionId) ?? [];
    items.push(attempt);
    attemptsBySession.set(attempt.sessionId, items);
  }

  return sessions
    .flatMap((session) => {
      const items = attemptsBySession.get(session.id) ?? [];
      if (items.length === 0) return [];
      return [{
        sessionId: session.id,
        deckId: session.deckId,
        deckTitle: deckTitleById.get(session.deckId) ?? "삭제된 학습자료",
        startedAt: session.startedAt,
        completedCount: items.length,
        rememberedCount: items.filter(attemptWasRemembered).length,
      }];
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function buildPlannerDayDetails(
  decks: Deck[],
  sessions: StudySession[],
  attempts: StudyAttempt[],
  plans: LearningPlan[],
  date: string,
): PlannerDayDetails {
  return {
    date,
    reviews: buildReviewItems(decks, date),
    records: buildStudyRecords(decks, sessions, attempts, date),
    plans: plans
      .filter((plan) => plan.date === date)
      .sort((a, b) => Number(a.completed) - Number(b.completed) || a.createdAt.localeCompare(b.createdAt)),
  };
}

export function buildPlannerMonth(
  decks: Deck[],
  sessions: StudySession[],
  attempts: StudyAttempt[],
  plans: LearningPlan[],
  monthDate: Date,
  now: Date = new Date(),
): PlannerMonth {
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = toLocalDateKey(new Date(year, monthIndex, index + 1, 12));
    const details = buildPlannerDayDetails(decks, sessions, attempts, plans, date);
    return {
      date,
      dayOfMonth: index + 1,
      isToday: date === toLocalDateKey(now),
      reviewCount: details.reviews.reduce((sum, item) => sum + item.count, 0),
      studiedCount: details.records.reduce((sum, item) => sum + item.completedCount, 0),
      planCount: details.plans.length,
      completedPlanCount: details.plans.filter((plan) => plan.completed).length,
    };
  });

  return {
    year,
    month: monthIndex + 1,
    firstWeekday: new Date(year, monthIndex, 1).getDay(),
    days,
  };
}
