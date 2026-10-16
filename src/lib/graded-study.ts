import {
  advanceStudySession,
  type StudySessionProgress,
} from "./study-session.ts";
import type { GradedStudyAttempt, StudyAnswer } from "./types.ts";

export type { StudyAnswer } from "./types.ts";

export type AutomaticallyGradedAttempt = GradedStudyAttempt;

export type AutomaticallyGradedSession = StudySessionProgress & {
  id: string;
  plannedActivityIds: string[];
};

export type AutomaticallyGradedSummary = {
  completedItemCount: number;
  correctCount: number;
  incorrectCount: number;
  incorrectActivityIds: string[];
};

export function recordAutomaticallyGradedResult<T extends AutomaticallyGradedSession>(
  session: T,
  input: {
    attemptId: string;
    activityId: string;
    learningUnitId?: string;
    startedAt: string;
    completedAt: string;
    isCorrect: boolean;
    userAnswer: StudyAnswer;
    correctAnswer: StudyAnswer;
  },
): {
  session: T;
  attempt: AutomaticallyGradedAttempt;
} {
  if (session.status !== "active") {
    throw new Error("Only an active study session can record a result.");
  }
  const plannedActivityId = session.plannedActivityIds[session.currentIndex];
  if (plannedActivityId !== input.activityId) {
    throw new Error("Graded activity does not match the current session item.");
  }

  return {
    session: advanceStudySession(session, input.completedAt),
    attempt: {
      id: input.attemptId,
      sessionId: session.id,
      activityType: "graded_problem",
      activityId: input.activityId,
      learningUnitId: input.learningUnitId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      isCorrect: input.isCorrect,
      userAnswer: input.userAnswer,
      correctAnswer: input.correctAnswer,
    },
  };
}

export function summarizeAutomaticallyGradedAttempts(
  plannedActivityIds: string[],
  attempts: AutomaticallyGradedAttempt[],
): AutomaticallyGradedSummary {
  const latestAttemptByActivityId = new Map<string, AutomaticallyGradedAttempt>();
  for (const attempt of attempts) {
    latestAttemptByActivityId.set(attempt.activityId, attempt);
  }
  const completedAttempts = plannedActivityIds
    .map((activityId) => latestAttemptByActivityId.get(activityId))
    .filter((attempt): attempt is AutomaticallyGradedAttempt => Boolean(attempt));
  const incorrectActivityIds = completedAttempts
    .filter((attempt) => !attempt.isCorrect)
    .map((attempt) => attempt.activityId);

  return {
    completedItemCount: completedAttempts.length,
    correctCount: completedAttempts.length - incorrectActivityIds.length,
    incorrectCount: incorrectActivityIds.length,
    incorrectActivityIds,
  };
}
