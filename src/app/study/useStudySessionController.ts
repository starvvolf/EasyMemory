"use client";

import { recordAutomaticallyGradedResult } from "@/lib/graded-study";
import {
  getCorrectStudyAnswer,
  getLearningActivityType,
  gradeStudyAnswer,
  validateLearningActivity,
} from "@/lib/learning-activity";
import { scheduleNextReview } from "@/lib/spaced-repetition";
import {
  saveStudyProgress,
  saveStudySession,
  startStudySession,
} from "@/lib/storage";
import { selectStudyActivityIds } from "@/lib/study-selection";
import {
  abandonStudySession,
  advanceStudySession,
  createStudyAttempt,
  createStudySession,
  restoreStudySessionState,
} from "@/lib/study-session";
import type {
  Card,
  Deck,
  StudyAnswer,
  StudyAttempt,
  StudySelectionMode,
  StudySession,
} from "@/lib/types";
import { useCallback,useMemo,useRef,useState } from "react";
import type { StudyCompletionSummary,View } from "../study-forge-types";

type Props = {
  view: View;
  setView: (view: View) => void;
  setDecks: React.Dispatch<React.SetStateAction<Deck[]>>;
  setStudySessions: React.Dispatch<React.SetStateAction<StudySession[]>>;
  setStudyAttempts: React.Dispatch<React.SetStateAction<StudyAttempt[]>>;
  setError: (message: string) => void;
};

export function useStudySessionController({
  view,
  setView,
  setDecks,
  setStudySessions,
  setStudyAttempts,
  setError,
}: Props) {
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [studyIndex, setStudyIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [activeStudySession, setActiveStudySession] =
    useState<StudySession | null>(null);
  const [currentAttemptStartedAt, setCurrentAttemptStartedAt] = useState<
    string | null
  >(null);
  const [answerRevealedAt, setAnswerRevealedAt] = useState<string | null>(null);
  const [gradedUserAnswer, setGradedUserAnswer] = useState<StudyAnswer>(null);
  const [gradedResult, setGradedResult] = useState<boolean | null>(null);
  const [studySessionCounts, setStudySessionCounts] = useState({
    known: 0,
    review: 0,
  });
  const [studySessionReviewIds, setStudySessionReviewIds] = useState<string[]>([]);
  const [studyCompletion, setStudyCompletion] =
    useState<StudyCompletionSummary | null>(null);
  const [isSavingStudyProgress, setIsSavingStudyProgress] = useState(false);
  const studyReturnViewRef = useRef<View>("decks");
  const isRecordingStudyAttempt = useRef(false);

  const studySessionCards = useMemo(() => {
    if (!selectedDeck || !activeStudySession) return [];
    const cardsById = new Map(selectedDeck.cards.map((card) => [card.id, card]));
    return activeStudySession.plannedActivityIds
      .map((id) => cardsById.get(id))
      .filter((card): card is Card => Boolean(card));
  }, [activeStudySession, selectedDeck]);
  const currentStudyCard = studySessionCards[studyIndex];

  const restoreSession = useCallback((
    session: StudySession,
    deck: Deck,
    attempts: StudyAttempt[],
  ) => {
    const restored = restoreStudySessionState(session, attempts);
    setSelectedDeck(deck);
    setActiveStudySession(session);
    setStudyIndex(restored.studyIndex);
    setStudySessionCounts({
      known: restored.knownCount,
      review: restored.reviewCount,
    });
    setStudySessionReviewIds(restored.reviewActivityIds);
    setCurrentAttemptStartedAt(new Date().toISOString());
    setIsAnswerVisible(false);
    setGradedUserAnswer(null);
    setGradedResult(null);
  }, []);

  function openStudyWithMode(deck: Deck, mode: StudySelectionMode) {
    studyReturnViewRef.current =
      view === "manager" || view === "records" || view === "decks"
        ? view
        : "decks";
    void startStudy(deck, mode);
  }

  function openStudy(deck: Deck) {
    openStudyWithMode(deck, "all");
  }

  async function startStudy(
    deck: Deck,
    selectionMode: StudySelectionMode,
    randomCount?: number,
    fixedActivityIds?: string[],
    returnView?: View,
  ) {
    if (returnView) studyReturnViewRef.current = returnView;
    const plannedActivityIds = fixedActivityIds
      ? [...fixedActivityIds]
      : selectStudyActivityIds(deck.cards, selectionMode, randomCount);
    if (plannedActivityIds.length === 0) {
      setError("학습할 카드가 없습니다.");
      return;
    }

    setIsSavingStudyProgress(true);
    try {
      if (activeStudySession?.status === "active") {
        await saveStudySession(
          abandonStudySession(activeStudySession, new Date().toISOString()),
        );
      }

      const startedAt = new Date().toISOString();
      const session = createStudySession(
        deck.id,
        selectionMode,
        plannedActivityIds,
        startedAt,
        crypto.randomUUID(),
      );
      const studyDeck =
        deck.boardColumn === "new"
          ? {
              ...deck,
              boardColumn: "learning" as const,
              updatedAt: new Date().toISOString(),
            }
          : deck;

      await startStudySession(studyDeck, session);
      setStudySessions((items) => [
        ...items.filter((item) => item.id !== session.id),
        session,
      ]);
      setDecks((items) =>
        items.map((item) => (item.id === studyDeck.id ? studyDeck : item)),
      );
      setSelectedDeck(studyDeck);
      setActiveStudySession(session);
      setStudyIndex(0);
      setIsAnswerVisible(false);
      setCurrentAttemptStartedAt(startedAt);
      setAnswerRevealedAt(null);
      setGradedUserAnswer(null);
      setGradedResult(null);
      setStudySessionCounts({ known: 0, review: 0 });
      setStudySessionReviewIds([]);
      setStudyCompletion(null);
      setError("");
      setView("study");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습을 시작하지 못했습니다: ${saveError.message}`
          : "학습을 시작하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSavingStudyProgress(false);
    }
  }

  function closeStudy() {
    setIsAnswerVisible(false);
    setAnswerRevealedAt(null);
    setGradedUserAnswer(null);
    setGradedResult(null);
    setView(studyReturnViewRef.current);
  }

  function resumeSession(returnView: View) {
    if (!activeStudySession || !selectedDeck) return;
    studyReturnViewRef.current = returnView;
    setCurrentAttemptStartedAt(new Date().toISOString());
    setView("study");
  }

  function toggleStudyAnswer() {
    setIsAnswerVisible((visible) => {
      if (!visible && !answerRevealedAt) {
        setAnswerRevealedAt(new Date().toISOString());
      }
      return !visible;
    });
  }

  async function markCard(status: "known" | "review") {
    if (
      !selectedDeck ||
      !currentStudyCard ||
      !activeStudySession ||
      !currentAttemptStartedAt ||
      !answerRevealedAt ||
      isRecordingStudyAttempt.current
    ) return;

    isRecordingStudyAttempt.current = true;
    setIsSavingStudyProgress(true);
    setError("");
    try {
      const completedAt = new Date().toISOString();
      const attempt = createStudyAttempt({
        id: crypto.randomUUID(),
        sessionId: activeStudySession.id,
        activityId: currentStudyCard.id,
        learningUnitId: currentStudyCard.learningUnitId,
        startedAt: currentAttemptStartedAt,
        answerRevealedAt,
        completedAt,
        selfRating: status,
        wasNew: currentStudyCard.status === "new",
      });
      const updatedCards = selectedDeck.cards.map((card) =>
        card.id === currentStudyCard.id
          ? {
              ...card,
              status,
              reviewSchedule: scheduleNextReview(
                card.reviewSchedule,
                status === "known",
                new Date(completedAt),
              ),
            }
          : card,
      );
      const updatedDeck: Deck = {
        ...selectedDeck,
        boardColumn:
          updatedCards.length > 0 &&
          updatedCards.every((card) => card.status === "known")
            ? "completed"
            : "learning",
        cards: updatedCards,
        updatedAt: completedAt,
      };
      const updatedSession = advanceStudySession(activeStudySession, completedAt);
      const updatedCounts = {
        known: studySessionCounts.known + (status === "known" ? 1 : 0),
        review: studySessionCounts.review + (status === "review" ? 1 : 0),
      };
      const updatedReviewIds =
        status === "review"
          ? [...studySessionReviewIds, currentStudyCard.id]
          : studySessionReviewIds;

      await saveStudyProgress({ deck: updatedDeck, session: updatedSession, attempt });
      setStudySessions((items) => [
        ...items.filter((item) => item.id !== updatedSession.id),
        updatedSession,
      ]);
      setStudyAttempts((items) => [...items, attempt]);
      setSelectedDeck(updatedDeck);
      setDecks((items) =>
        items.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck)),
      );
      setStudySessionCounts(updatedCounts);
      setStudySessionReviewIds(updatedReviewIds);
      setIsAnswerVisible(false);
      setAnswerRevealedAt(null);
      setGradedUserAnswer(null);
      setGradedResult(null);

      if (updatedSession.status === "completed") {
        setActiveStudySession(null);
        setCurrentAttemptStartedAt(null);
        setStudyCompletion({
          completedItemCount: updatedSession.completedItemCount,
          knownCount: updatedCounts.known,
          reviewCount: updatedCounts.review,
          reviewActivityIds: updatedReviewIds,
        });
        return;
      }

      setActiveStudySession(updatedSession);
      setCurrentAttemptStartedAt(completedAt);
      setStudyIndex(updatedSession.currentIndex);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습 결과를 저장하지 못했습니다: ${saveError.message}`
          : "학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      isRecordingStudyAttempt.current = false;
      setIsSavingStudyProgress(false);
    }
  }

  async function submitGradedAnswer() {
    if (
      !selectedDeck ||
      !currentStudyCard ||
      !activeStudySession ||
      !currentAttemptStartedAt ||
      gradedResult !== null ||
      !isCompleteGradedAnswer(currentStudyCard, gradedUserAnswer) ||
      isRecordingStudyAttempt.current
    ) return;

    isRecordingStudyAttempt.current = true;
    setIsSavingStudyProgress(true);
    setError("");
    try {
      const completedAt = new Date().toISOString();
      const isCorrect = gradeStudyAnswer(currentStudyCard, gradedUserAnswer);
      const correctAnswer = getCorrectStudyAnswer(currentStudyCard);
      const recorded = recordAutomaticallyGradedResult(activeStudySession, {
        attemptId: crypto.randomUUID(),
        activityId: currentStudyCard.id,
        learningUnitId: currentStudyCard.learningUnitId,
        startedAt: currentAttemptStartedAt,
        completedAt,
        isCorrect,
        userAnswer: gradedUserAnswer,
        correctAnswer,
      });
      const status = isCorrect ? ("known" as const) : ("review" as const);
      const updatedCards = selectedDeck.cards.map((card) =>
        card.id === currentStudyCard.id
          ? {
              ...card,
              status,
              reviewSchedule: scheduleNextReview(
                card.reviewSchedule,
                isCorrect,
                new Date(completedAt),
              ),
            }
          : card,
      );
      const updatedDeck: Deck = {
        ...selectedDeck,
        boardColumn:
          updatedCards.length > 0 && updatedCards.every((card) => card.status === "known")
            ? "completed"
            : "learning",
        cards: updatedCards,
        updatedAt: completedAt,
      };
      const updatedCounts = {
        known: studySessionCounts.known + (isCorrect ? 1 : 0),
        review: studySessionCounts.review + (isCorrect ? 0 : 1),
      };
      const updatedReviewIds = isCorrect
        ? studySessionReviewIds
        : [...studySessionReviewIds, currentStudyCard.id];

      await saveStudyProgress({
        deck: updatedDeck,
        session: recorded.session,
        attempt: recorded.attempt,
      });
      setStudySessions((items) => [
        ...items.filter((item) => item.id !== recorded.session.id),
        recorded.session,
      ]);
      setStudyAttempts((items) => [...items, recorded.attempt]);
      setSelectedDeck(updatedDeck);
      setDecks((items) =>
        items.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck)),
      );
      setActiveStudySession(recorded.session);
      setStudySessionCounts(updatedCounts);
      setStudySessionReviewIds(updatedReviewIds);
      setAnswerRevealedAt(completedAt);
      setIsAnswerVisible(true);
      setGradedResult(isCorrect);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습 결과를 저장하지 못했습니다: ${saveError.message}`
          : "학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      isRecordingStudyAttempt.current = false;
      setIsSavingStudyProgress(false);
    }
  }

  function advanceAfterGradedAnswer() {
    if (!activeStudySession || gradedResult === null) return;
    if (activeStudySession.status === "completed") {
      setStudyCompletion({
        completedItemCount: activeStudySession.completedItemCount,
        knownCount: studySessionCounts.known,
        reviewCount: studySessionCounts.review,
        reviewActivityIds: studySessionReviewIds,
      });
      setActiveStudySession(null);
      setCurrentAttemptStartedAt(null);
    } else {
      const startedAt = new Date().toISOString();
      setStudyIndex(activeStudySession.currentIndex);
      setCurrentAttemptStartedAt(startedAt);
    }
    setIsAnswerVisible(false);
    setAnswerRevealedAt(null);
    setGradedUserAnswer(null);
    setGradedResult(null);
  }

  return {
    selectedDeck,
    setSelectedDeck,
    studyIndex,
    isAnswerVisible,
    activeStudySession,
    currentStudyCard,
    gradedUserAnswer,
    setGradedUserAnswer,
    gradedResult,
    studySessionCounts,
    studyCompletion,
    isSavingStudyProgress,
    restoreSession,
    openStudyWithMode,
    openStudy,
    startStudy,
    resumeSession,
    closeStudy,
    toggleStudyAnswer,
    markCard,
    submitGradedAnswer,
    advanceAfterGradedAnswer,
  };
}

function isCompleteGradedAnswer(card: Card, answer: StudyAnswer) {
  if (validateLearningActivity(card).length > 0) return false;
  const type = getLearningActivityType(card);
  if (type === "true_false") return typeof answer === "boolean";
  if (type === "multiple_choice") return typeof answer === "number";
  if (type === "cloze") return typeof answer === "string" && Boolean(answer.trim());
  if (type === "structure_recall") {
    const record =
      typeof answer === "object" && answer !== null && !Array.isArray(answer)
        ? answer
        : {};
    return (card.structureNodes ?? []).every(
      (node) => typeof record[node.id] === "string" && String(record[node.id]).trim(),
    );
  }
  return false;
}
