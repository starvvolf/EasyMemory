import type { Deck, StudyAttempt, StudySession } from "./types.ts";
import { isReviewDue } from "./spaced-repetition.ts";

export type DeckLearningSummary = {
  deckId: string;
  title: string;
  subject: string;
  totalCount: number;
  knownCount: number;
  reviewCount: number;
  newCount: number;
  dueCount: number;
  progressPercent: number;
  completedAttemptCount: number;
  lastStudiedAt: string | null;
};

export type DailyLearningRecord = {
  date: string;
  completedCount: number;
  rememberedCount: number;
  reviewCount: number;
};

export type LearningManagerSnapshot = {
  dueCount: number;
  newCount: number;
  todayCompletedCount: number;
  todayRememberedCount: number;
  todayReviewCount: number;
  activeSessionCount: number;
  recommendedDeckId: string | null;
  recommendationReason: string;
  decks: DeckLearningSummary[];
  recentDays: DailyLearningRecord[];
};

export type LearningCalendarDay = {
  date: string;
  dayOfMonth: number;
  completedCount: number;
  scheduledReviewCount: number;
  isToday: boolean;
};

export type LearningCalendar = {
  year: number;
  month: number;
  firstWeekday: number;
  days: LearningCalendarDay[];
};

export type LearningHistoryItem = {
  sessionId: string;
  deckId: string;
  deckTitle: string;
  startedAt: string;
  endedAt: string | null;
  status: StudySession["status"];
  plannedCount: number;
  completedCount: number;
  rememberedCount: number;
  reviewCount: number;
};

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function attemptWasRemembered(attempt: StudyAttempt): boolean {
  return attempt.activityType === "graded_problem"
    ? attempt.isCorrect
    : attempt.selfRating === "known";
}

export function buildLearningManagerSnapshot(
  decks: Deck[],
  sessions: StudySession[],
  attempts: StudyAttempt[],
  now: Date = new Date(),
): LearningManagerSnapshot {
  const todayKey = localDateKey(now);
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const deckActivity = new Map<
    string,
    { completedAttemptCount: number; lastStudiedAt: string | null }
  >();

  for (const attempt of attempts) {
    const deckId = sessionsById.get(attempt.sessionId)?.deckId;
    if (!deckId) continue;
    const current = deckActivity.get(deckId) ?? {
      completedAttemptCount: 0,
      lastStudiedAt: null,
    };
    current.completedAttemptCount += 1;
    if (!current.lastStudiedAt || attempt.completedAt > current.lastStudiedAt) {
      current.lastStudiedAt = attempt.completedAt;
    }
    deckActivity.set(deckId, current);
  }

  const deckSummaries = decks.map((deck) => {
    const knownCount = deck.cards.filter((card) => card.status === "known").length;
    const reviewCount = deck.cards.filter((card) => card.status === "review").length;
    const newCount = deck.cards.filter((card) => card.status === "new").length;
    const dueCardCount = deck.cards.filter((card) => isReviewDue(card, now)).length;
    const dueMaskCount = (deck.pdfMaskActivities ?? []).filter((activity) =>
      isReviewDue(activity, now),
    ).length;
    const activity = deckActivity.get(deck.id);
    return {
      deckId: deck.id,
      title: deck.title,
      subject: deck.subject,
      totalCount: deck.cards.length,
      knownCount,
      reviewCount,
      newCount,
      dueCount: dueCardCount + dueMaskCount,
      progressPercent:
        deck.cards.length === 0
          ? 0
          : Math.round((knownCount / deck.cards.length) * 100),
      completedAttemptCount: activity?.completedAttemptCount ?? 0,
      lastStudiedAt: activity?.lastStudiedAt ?? null,
    };
  });

  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      date: localDateKey(date),
      completedCount: 0,
      rememberedCount: 0,
      reviewCount: 0,
    };
  });
  const recentDayByKey = new Map(recentDays.map((day) => [day.date, day]));

  for (const attempt of attempts) {
    const completedAt = new Date(attempt.completedAt);
    if (!Number.isFinite(completedAt.getTime())) continue;
    const day = recentDayByKey.get(localDateKey(completedAt));
    if (!day) continue;
    day.completedCount += 1;
    if (attemptWasRemembered(attempt)) day.rememberedCount += 1;
    else day.reviewCount += 1;
  }

  const today = recentDayByKey.get(todayKey) ?? {
    completedCount: 0,
    rememberedCount: 0,
    reviewCount: 0,
  };
  const recommended = [...deckSummaries]
    .filter((deck) => deck.totalCount > 0)
    .sort(
      (a, b) =>
        b.dueCount - a.dueCount ||
        b.reviewCount - a.reviewCount ||
        b.newCount - a.newCount ||
        (b.lastStudiedAt ?? "").localeCompare(a.lastStudiedAt ?? ""),
    )[0];

  let recommendationReason = "저장된 학습 덱이 없습니다.";
  if (recommended) {
    if (recommended.dueCount > 0) {
      recommendationReason = `복습 예정 항목이 ${recommended.dueCount}개로 가장 많습니다.`;
    } else if (recommended.reviewCount > 0) {
      recommendationReason = `다시 볼 문제가 ${recommended.reviewCount}개 남아 있습니다.`;
    } else if (recommended.newCount > 0) {
      recommendationReason = `아직 학습하지 않은 문제가 ${recommended.newCount}개 있습니다.`;
    } else {
      recommendationReason = "현재 예정된 복습은 없지만 전체 학습을 다시 시작할 수 있습니다.";
    }
  }

  return {
    dueCount: deckSummaries.reduce((sum, deck) => sum + deck.dueCount, 0),
    newCount: deckSummaries.reduce((sum, deck) => sum + deck.newCount, 0),
    todayCompletedCount: today.completedCount,
    todayRememberedCount: today.rememberedCount,
    todayReviewCount: today.reviewCount,
    activeSessionCount: sessions.filter((session) => session.status === "active").length,
    recommendedDeckId: recommended?.deckId ?? null,
    recommendationReason,
    decks: deckSummaries.sort(
      (a, b) =>
        b.dueCount - a.dueCount ||
        (b.lastStudiedAt ?? "").localeCompare(a.lastStudiedAt ?? ""),
    ),
    recentDays,
  };
}

export function buildLearningCalendar(
  decks: Deck[],
  attempts: StudyAttempt[],
  monthDate: Date,
  now: Date = new Date(),
): LearningCalendar {
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(year, monthIndex, index + 1, 12, 0, 0, 0);
    return {
      date: localDateKey(date),
      dayOfMonth: index + 1,
      completedCount: 0,
      scheduledReviewCount: 0,
      isToday: localDateKey(date) === localDateKey(now),
    };
  });
  const dayByKey = new Map(days.map((day) => [day.date, day]));

  for (const attempt of attempts) {
    const completedAt = new Date(attempt.completedAt);
    if (!Number.isFinite(completedAt.getTime())) continue;
    const day = dayByKey.get(localDateKey(completedAt));
    if (day) day.completedCount += 1;
  }

  for (const deck of decks) {
    const schedules = [
      ...deck.cards.map((card) => card.reviewSchedule),
      ...(deck.pdfMaskActivities ?? []).map((activity) => activity.reviewSchedule),
    ];
    for (const schedule of schedules) {
      if (!schedule) continue;
      const dueAt = new Date(schedule.dueAt);
      if (!Number.isFinite(dueAt.getTime())) continue;
      const day = dayByKey.get(localDateKey(dueAt));
      if (day) day.scheduledReviewCount += 1;
    }
  }

  return {
    year,
    month: monthIndex + 1,
    firstWeekday: new Date(year, monthIndex, 1).getDay(),
    days,
  };
}

export function buildLearningHistory(
  decks: Deck[],
  sessions: StudySession[],
  attempts: StudyAttempt[],
): LearningHistoryItem[] {
  const deckTitleById = new Map(decks.map((deck) => [deck.id, deck.title]));
  const attemptsBySession = new Map<string, StudyAttempt[]>();
  for (const attempt of attempts) {
    const items = attemptsBySession.get(attempt.sessionId) ?? [];
    items.push(attempt);
    attemptsBySession.set(attempt.sessionId, items);
  }

  return sessions
    .map((session) => {
      const sessionAttempts = attemptsBySession.get(session.id) ?? [];
      const rememberedCount = sessionAttempts.filter(attemptWasRemembered).length;
      return {
        sessionId: session.id,
        deckId: session.deckId,
        deckTitle: deckTitleById.get(session.deckId) ?? "삭제된 덱",
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        status: session.status,
        plannedCount: session.plannedItemCount,
        completedCount: sessionAttempts.length,
        rememberedCount,
        reviewCount: sessionAttempts.length - rememberedCount,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
