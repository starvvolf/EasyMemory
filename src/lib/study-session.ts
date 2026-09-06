import type {
  FlashcardStudyAttempt,
  StudyAttempt,
  StudySelfRating,
  StudySelectionMode,
  StudySession,
} from "@/lib/types";

export type RestoredStudySessionState = {
  studyIndex: number;
  knownCount: number;
  reviewCount: number;
  reviewActivityIds: string[];
};

export function createStudySession(
  deckId: string,
  selectionMode: StudySelectionMode,
  plannedActivityIds: string[],
  startedAt: string,
  id: string,
): StudySession {
  if (plannedActivityIds.length === 0) {
    throw new Error("StudySession requires at least one planned activity.");
  }
  return {
    id,
    deckId,
    activityType: "flashcard",
    startedAt,
    endedAt: null,
    status: "active",
    selectionMode,
    plannedActivityIds: [...plannedActivityIds],
    plannedItemCount: plannedActivityIds.length,
    completedItemCount: 0,
    currentIndex: 0,
  };
}

export function createStudyAttempt(input: {
  id: string;
  sessionId: string;
  activityId: string;
  learningUnitId?: string;
  startedAt: string;
  answerRevealedAt: string | null;
  completedAt: string;
  selfRating: StudySelfRating;
  wasNew: boolean;
}): FlashcardStudyAttempt {
  return {
    ...input,
    activityType: "flashcard",
  };
}

export type StudySessionProgress = Pick<
  StudySession,
  | "status"
  | "endedAt"
  | "plannedItemCount"
  | "completedItemCount"
  | "currentIndex"
>;

export function advanceStudySession<T extends StudySessionProgress>(
  session: T,
  completedAt: string,
): T {
  const completedItemCount = Math.min(
    session.completedItemCount + 1,
    session.plannedItemCount,
  );
  const completed = completedItemCount >= session.plannedItemCount;

  return {
    ...session,
    completedItemCount,
    currentIndex: completed
      ? session.plannedItemCount
      : Math.min(session.currentIndex + 1, session.plannedItemCount - 1),
    status: completed ? "completed" : "active",
    endedAt: completed ? completedAt : null,
  } as T;
}

export function abandonStudySession(
  session: StudySession,
  endedAt: string,
): StudySession {
  if (session.status !== "active") return session;
  return { ...session, status: "abandoned", endedAt };
}

export function findLatestActiveStudySession(
  sessions: StudySession[],
  deckId?: string,
): StudySession | null {
  return sessions
    .filter(
      (session) =>
        session.status === "active" && (!deckId || session.deckId === deckId),
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;
}

export function restoreStudySessionState(
  session: StudySession,
  attempts: StudyAttempt[],
): RestoredStudySessionState {
  const latestAttemptByActivityId = new Map<string, StudyAttempt>();
  for (const attempt of attempts) {
    if (
      attempt.sessionId === session.id &&
      session.plannedActivityIds.includes(attempt.activityId)
    ) {
      latestAttemptByActivityId.set(attempt.activityId, attempt);
    }
  }

  const completedActivityIds = session.plannedActivityIds.slice(
    0,
    session.completedItemCount,
  );
  const reviewActivityIds: string[] = [];
  let knownCount = 0;
  let reviewCount = 0;
  for (const activityId of completedActivityIds) {
    const attempt = latestAttemptByActivityId.get(activityId);
    if (!attempt) continue;
    const known = attempt.activityType === "graded_problem"
      ? attempt.isCorrect
      : attempt.selfRating === "known";
    if (known) {
      knownCount += 1;
    } else {
      reviewCount += 1;
      reviewActivityIds.push(activityId);
    }
  }

  return {
    studyIndex: Math.max(
      0,
      Math.min(session.currentIndex, session.plannedItemCount - 1),
    ),
    knownCount,
    reviewCount,
    reviewActivityIds,
  };
}
