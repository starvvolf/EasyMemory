"use client";

import { getLearningActivityType,getStructureRecallChoices,getStructureRecallKind,getStudyStructureRecallMode,getSupportedStructureRecallModes,isAutomaticallyGradedActivity,validateLearningActivity } from "@/lib/learning-activity";
import { countDueReviews } from "@/lib/spaced-repetition";
import type { Card,Deck,StudyAnswer,StudySelectionMode } from "@/lib/types";
import { Check,ChevronDown,Settings2,X } from "lucide-react";
import { useState } from "react";
import { Feedback,getLearningActivityLabel,getStudyPromptLabel,inputClassName,renderClozeForStudy } from "../study-forge-shared";
import type { StudyCompletionSummary } from "../study-forge-types";
import { StudyCardSourceReader } from "./StudyCardSourceReader";

export function StudyView({
  selectedDeck,
  error,
  currentStudyCard,
  studyIndex,
  plannedItemCount,
  sessionId,
  sessionCounts,
  completion,
  isAnswerVisible,
  gradedUserAnswer,
  gradedResult,
  isSaving,
  setGradedUserAnswer,
  submitGradedAnswer,
  advanceAfterGradedAnswer,
  toggleAnswer,
  markCard,
  closeStudy,
  startNewSession,
  retryReviewed,
}: {
  selectedDeck: Deck | null;
  error: string;
  currentStudyCard: Card | undefined;
  studyIndex: number;
  plannedItemCount: number;
  sessionId: string;
  sessionCounts: { known: number; review: number };
  completion: StudyCompletionSummary | null;
  isAnswerVisible: boolean;
  gradedUserAnswer: StudyAnswer;
  gradedResult: boolean | null;
  isSaving: boolean;
  setGradedUserAnswer: (answer: StudyAnswer) => void;
  submitGradedAnswer: () => void;
  advanceAfterGradedAnswer: () => void;
  toggleAnswer: () => void;
  markCard: (status: "known" | "review") => Promise<void>;
  closeStudy: () => void;
  startNewSession: (mode: StudySelectionMode, randomCount?: number) => void;
  retryReviewed: () => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRetryMenuOpen, setIsRetryMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<StudySelectionMode>("all");
  const [randomCount, setRandomCount] = useState(
    Math.min(5, selectedDeck?.cards.length ?? 0),
  );

  const cardCount = selectedDeck?.cards.length ?? 0;
  const dueCount = selectedDeck ? countDueReviews(selectedDeck.cards) : 0;
  const reviewCount = selectedDeck?.cards.filter((card) => card.status === "review").length ?? 0;
  const newCount = selectedDeck?.cards.filter((card) => card.status === "new").length ?? 0;
  const selectedCount = selectionMode === "all"
    ? cardCount
    : selectionMode === "random"
      ? randomCount
      : selectionMode === "due"
        ? dueCount
        : selectionMode === "review_only"
          ? reviewCount
          : newCount;
  const isGraded = currentStudyCard
    ? isAutomaticallyGradedActivity(currentStudyCard)
    : false;
  const progress = completion
    ? 100
    : plannedItemCount > 0
      ? Math.min(100, ((studyIndex + 1) / plannedItemCount) * 100)
      : 0;

  const scopeOptions: Array<{
    mode: StudySelectionMode;
    label: string;
    count: number;
  }> = [
    { mode: "all", label: "전체", count: cardCount },
    { mode: "due", label: "오늘 복습", count: dueCount },
    { mode: "review_only", label: "모르는 것만", count: reviewCount },
    { mode: "new_only", label: "새 문제만", count: newCount },
    { mode: "random", label: "랜덤", count: randomCount },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-3 backdrop-blur-[2px] sm:p-5">
      <section className="relative flex h-[min(760px,calc(100vh-24px))] w-[min(920px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-[#3B3B3B] bg-[#1B1B1B] shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[#303030] px-4 sm:px-5">
            <div className="min-w-0">
              <p className="text-[10px] text-[#767676]">
                {completion
                  ? `${completion.completedItemCount} / ${completion.completedItemCount}`
                  : `${Math.min(studyIndex + 1, plannedItemCount)} / ${plannedItemCount}`}
              </p>
              <h3 className="mt-0.5 truncate text-sm font-medium text-[#E8E8E8]">
                {selectedDeck?.title ?? "학습"}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              {selectedDeck ? (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen((open) => !open)}
                  aria-label="학습 설정"
                  aria-pressed={isSettingsOpen}
                  className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] transition hover:bg-[#282828] hover:text-[#E8E8E8]"
                >
                  <Settings2 size={16} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeStudy}
                aria-label="학습 창 닫기"
                className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] transition hover:bg-[#282828] hover:text-[#E8E8E8]"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="h-0.5 shrink-0 bg-[#292929]">
            <div className="h-full bg-[#E7E7E7] transition-[width]" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {error ? <div className="px-5 pt-4"><Feedback error={error} notice="" /></div> : null}

            {selectedDeck && completion ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#E7E7E7] text-[#171717]">
                  <Check size={18} />
                </span>
                <h4 className="mt-5 text-2xl font-medium text-[#E8E8E8]">오늘 학습 완료</h4>
                <p className="mt-2 text-xs text-[#858585]">진행 내용은 자동으로 저장됐습니다.</p>
                <dl className="mt-8 flex justify-center gap-8 sm:gap-12">
                  <StudyCompletionItem label="학습" value={completion.completedItemCount} />
                  <StudyCompletionItem label="알고 있음" value={completion.knownCount} />
                  <StudyCompletionItem label="다시 보기" value={completion.reviewCount} />
                </dl>
                <div className="mt-9 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={closeStudy}
                    className="min-h-11 rounded-[11px] border border-[#3B3B3B] bg-[#202020] px-5 text-xs font-medium text-[#B5B5B5]"
                  >
                    닫기
                  </button>
                  <div className="relative">
                    {isRetryMenuOpen ? (
                      <div className="absolute bottom-[calc(100%+8px)] right-0 z-10 w-52 overflow-hidden rounded-[11px] border border-[#3B3B3B] bg-[#202020] p-1.5 text-left shadow-[0_16px_44px_rgba(0,0,0,0.42)]">
                        {completion.reviewCount > 0 ? (
                          <StudyRetryOption
                            label="모르겠음만"
                            count={completion.reviewCount}
                            onClick={() => {
                              setIsRetryMenuOpen(false);
                              retryReviewed();
                            }}
                          />
                        ) : null}
                        <StudyRetryOption
                          label="오늘 복습"
                          count={dueCount}
                          disabled={dueCount === 0}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("due");
                          }}
                        />
                        <StudyRetryOption
                          label="전체"
                          count={cardCount}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("all");
                          }}
                        />
                        <StudyRetryOption
                          label="랜덤"
                          count={Math.min(5, cardCount)}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("random", Math.min(5, cardCount));
                          }}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setIsRetryMenuOpen((open) => !open)}
                      aria-expanded={isRetryMenuOpen}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[11px] bg-[#E7E7E7] px-5 text-xs font-medium text-[#171717]"
                    >
                      다시 학습 <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedDeck && currentStudyCard ? (
              <>
                <div className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-12">
                  <div className="mb-6 flex items-center justify-between gap-3 text-[11px] text-[#767676]">
                    <span className="text-[#B5B5B5]">
                      {isGraded
                        ? getLearningActivityLabel(getLearningActivityType(currentStudyCard))
                        : getStudyPromptLabel(currentStudyCard.type)}
                    </span>
                    <span>정답 {sessionCounts.known} · 다시 보기 {sessionCounts.review}</span>
                  </div>

                  {isGraded ? (
                    <GradedActivityInput
                      key={currentStudyCard.id}
                      card={currentStudyCard}
                      userAnswer={gradedUserAnswer}
                      result={gradedResult}
                      sessionId={sessionId}
                      onAnswer={setGradedUserAnswer}
                    />
                  ) : (
                    <div>
                      <div className="text-2xl font-medium leading-10 text-[#E8E8E8] sm:text-[28px]">
                        {currentStudyCard.type === "flashcard" || currentStudyCard.type === "translation"
                          ? currentStudyCard.front
                          : renderClozeForStudy(currentStudyCard, isAnswerVisible)}
                      </div>
                      {isAnswerVisible && currentStudyCard.type !== "cloze" ? (
                        <div className="mt-8 border-t border-[#303030] pt-6">
                          <p className="text-[11px] text-[#767676]">
                            {currentStudyCard.type === "translation" ? "영어 표현" : "답"}
                          </p>
                          <p className="mt-2 text-lg leading-8 text-[#B5B5B5]">{currentStudyCard.back}</p>
                          {currentStudyCard.hint ? (
                            <p className="mt-2 text-xs text-[#858585]">힌트: {currentStudyCard.hint}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <StudyCardSourceReader deck={selectedDeck} card={currentStudyCard} />
                </div>

                <footer className="shrink-0 border-t border-[#303030] p-3.5 sm:px-5">
                  {isGraded ? (
                    <button
                      type="button"
                      disabled={
                        isSaving ||
                        (gradedResult === null && !isCompleteGradedAnswer(currentStudyCard, gradedUserAnswer))
                      }
                      onClick={gradedResult === null ? submitGradedAnswer : advanceAfterGradedAnswer}
                      className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {gradedResult === null ? "정답 확인" : "다음 문제"}
                    </button>
                  ) : isAnswerVisible ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void markCard("review")}
                        disabled={isSaving}
                        className="min-h-11 rounded-[11px] border border-[#3B3B3B] bg-[#202020] px-4 text-sm font-medium text-[#B5B5B5] disabled:opacity-40"
                      >
                        다시 보기
                      </button>
                      <button
                        type="button"
                        onClick={() => void markCard("known")}
                        disabled={isSaving}
                        className="min-h-11 rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:opacity-40"
                      >
                        알고 있음
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleAnswer}
                      className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717]"
                    >
                      답 보기
                    </button>
                  )}
                </footer>
              </>
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="text-sm font-medium text-[#E8E8E8]">학습할 문제가 없습니다.</p>
                  <button type="button" onClick={closeStudy} className="mt-4 text-xs text-[#B5B5B5] underline underline-offset-4">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {isSettingsOpen && selectedDeck ? (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(300px,calc(100%-44px))] flex-col border-l border-[#303030] bg-[#202020] shadow-[-18px_0_50px_rgba(0,0,0,0.45)] sm:relative sm:w-[300px] sm:shrink-0 sm:shadow-none">
            <header className="flex min-h-16 items-center justify-between border-b border-[#303030] px-4">
              <h4 className="text-sm font-medium text-[#E8E8E8]">학습 설정</h4>
              <button type="button" onClick={() => setIsSettingsOpen(false)} aria-label="설정 닫기" className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] hover:bg-[#282828] hover:text-[#E8E8E8]"><X size={16} /></button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="mb-2 text-[11px] text-[#B5B5B5]">학습 범위</p>
              <div className="space-y-1" role="radiogroup" aria-label="학습 범위">
                {scopeOptions.map((option) => {
                  const selected = option.mode === selectionMode;
                  const disabled = option.count === 0;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={disabled}
                      onClick={() => setSelectionMode(option.mode)}
                      className={`grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border px-2.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-35 ${selected ? "border-[#3B3B3B] bg-[#282828] text-[#E8E8E8]" : "border-transparent text-[#B5B5B5] hover:bg-[#282828]"}`}
                    >
                      <span className={`grid h-4 w-4 place-items-center rounded-full border ${selected ? "border-[#E7E7E7]" : "border-[#555555]"}`}>
                        {selected ? <span className="h-2 w-2 rounded-full bg-[#E7E7E7]" /> : null}
                      </span>
                      <span>{option.label}</span>
                      <span className="text-[10px] text-[#767676]">{option.count}개</span>
                    </button>
                  );
                })}
              </div>
              {selectionMode === "random" ? (
                <label className="mt-4 flex items-center justify-between border-t border-[#303030] pt-4 text-xs text-[#B5B5B5]">
                  문제 수
                  <input
                    type="number"
                    min={1}
                    max={cardCount}
                    value={randomCount}
                    onChange={(event) => setRandomCount(Math.min(cardCount, Math.max(1, Number(event.target.value) || 1)))}
                    className="h-9 w-20 rounded-[9px] border border-[#3B3B3B] bg-[#1B1B1B] px-2 text-[#E8E8E8] outline-none"
                  />
                </label>
              ) : null}
            </div>
            <div className="border-t border-[#303030] p-3.5">
              <button
                type="button"
                disabled={selectedCount === 0 || isSaving}
                onClick={() => {
                  setIsSettingsOpen(false);
                  startNewSession(selectionMode, randomCount);
                }}
                className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
              >
                이 범위로 시작
              </button>
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  );
}

export function StudyCompletionItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16">
      <dd className="text-2xl font-medium text-[#E8E8E8]">{value}</dd>
      <dt className="mt-1 text-[10px] text-[#767676]">{label}</dt>
    </div>
  );
}

export function StudyRetryOption({
  label,
  count,
  disabled = false,
  onClick,
}: {
  label: string;
  count: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] px-2.5 text-left text-xs text-[#B5B5B5] transition hover:bg-[#282828] hover:text-[#E8E8E8] disabled:cursor-not-allowed disabled:opacity-35"
    >
      <span>{label}</span>
      <span className="text-[10px] text-[#767676]">{count}개</span>
    </button>
  );
}

export function GradedActivityInput({
  card,
  userAnswer,
  result,
  sessionId,
  onAnswer,
}: {
  card: Card;
  userAnswer: StudyAnswer;
  result: boolean | null;
  sessionId: string;
  onAnswer: (answer: StudyAnswer) => void;
}) {
  const type = getLearningActivityType(card);
  const supportedStructureModes = getSupportedStructureRecallModes(card);
  const [structureMode, setStructureMode] = useState(getStudyStructureRecallMode(card));
  const [activeStructureNodeId, setActiveStructureNodeId] = useState<string | null>(null);
  const answerRecord = asStudyAnswerRecord(userAnswer);
  const structureChoices = type === "structure_recall"
    ? getStructureRecallChoices(card.structureNodes ?? [], sessionId, card.id)
    : [];
  const usedStructureChoiceCounts = new Map<string, number>();
  for (const answer of Object.values(answerRecord)) {
    if (typeof answer !== "string" || !answer) continue;
    usedStructureChoiceCounts.set(answer, (usedStructureChoiceCounts.get(answer) ?? 0) + 1);
  }
  const usedStructureChoiceIndexes = new Set<number>();
  for (let index = 0; index < structureChoices.length; index += 1) {
    const choice = structureChoices[index];
    const remaining = usedStructureChoiceCounts.get(choice) ?? 0;
    if (remaining <= 0) continue;
    usedStructureChoiceIndexes.add(index);
    usedStructureChoiceCounts.set(choice, remaining - 1);
  }
  return (
    <div className="mt-8">
      <p className="text-2xl font-black leading-10 text-[#F0F2EF]">{card.front}</p>

      {type === "true_false" ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={result !== null}
              onClick={() => onAnswer(value)}
              className={`rounded-lg border px-4 py-6 text-2xl font-black ${
                userAnswer === value
                  ? "border-[#ECEEEB] bg-[#2D312E] text-[#ECEEEB]"
                  : "border-[#393D3A] bg-[#2A2E2B] text-[#F0F2EF]"
              } disabled:cursor-default`}
            >
              {value ? "O" : "X"}
            </button>
          ))}
        </div>
      ) : null}

      {type === "multiple_choice" ? (
        <div className="mt-6 space-y-2">
          {(card.options ?? []).map((option, index) => (
            <button
              key={`${option}-${index}`}
              type="button"
              disabled={result !== null}
              onClick={() => onAnswer(index)}
              className={`block w-full rounded-md border p-3 text-left font-bold ${
                userAnswer === index
                  ? "border-[#ECEEEB] bg-[#2D312E]"
                  : "border-[#393D3A] bg-[#2A2E2B]"
              } disabled:cursor-default`}
            >
              {index + 1}. {option}
            </button>
          ))}
        </div>
      ) : null}

      {type === "cloze" ? (
        <input
          aria-label="빈칸 정답"
          disabled={result !== null}
          value={typeof userAnswer === "string" ? userAnswer : ""}
          placeholder="정답 입력"
          onChange={(event) => onAnswer(event.target.value)}
          className={`${inputClassName} mt-6 min-h-12 text-base font-bold`}
        />
      ) : null}

      {type === "structure_recall" ? (
        <div className="mt-6 rounded-lg border border-[#393D3A] bg-[#202321] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs font-black text-[#B2B6B1]">
              {getStructureRecallKind(card) === "sequence" ? "순서 복원" : "계층·분류 구조 복원"}
            </p>
            {supportedStructureModes.length > 1 && result === null ? (
              <div className="flex rounded-md border border-[#454945] p-0.5">
                {supportedStructureModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setStructureMode(mode);
                      setActiveStructureNodeId(null);
                      onAnswer(null);
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-bold ${
                      structureMode === mode
                        ? "bg-[#ECEEEB] text-[#202321]"
                        : "text-[#A6AAA5]"
                    }`}
                  >
                    {mode === "word_bank" ? "보기" : "직접입력"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {getStructureRecallKind(card) === "hierarchy" && hasUnorderedStructureGroup(card.structureNodes ?? []) ? (
            <p className="mb-3 text-xs font-bold text-[#B2B6B1]">
              같은 가지에 나란히 놓인 빈칸은 순서와 관계없이 채점됩니다.
            </p>
          ) : null}
          <div className="space-y-3">
            {(card.structureNodes ?? []).map((node, index, nodes) => {
              const answer = String(answerRecord[node.id] ?? "");
              const depth = getStructureNodeDepth(node.id, nodes);
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-2"
                  style={{ marginLeft: `${getStructureRecallKind(card) === "hierarchy" ? depth * 28 : 0}px` }}
                >
                  <span className="w-5 shrink-0 text-center font-black text-[#A5A9A4]">
                    {getStructureRecallKind(card) === "sequence" ? index + 1 : depth > 0 ? "└" : "●"}
                  </span>
                  {structureMode === "word_bank" ? (
                    <button
                      type="button"
                      disabled={result !== null}
                      aria-label={`구조복원 빈칸 ${index + 1}`}
                      onClick={() => {
                        setActiveStructureNodeId(node.id);
                        if (answer) onAnswer(removeStructureAnswer(answerRecord, node.id));
                      }}
                      className={`min-h-12 min-w-40 flex-1 rounded-md border-2 border-dashed px-4 py-2 text-left font-black transition ${
                        activeStructureNodeId === node.id
                          ? "border-[#ECEEEB] bg-[#2D312E]"
                          : answer
                            ? "border-[#A6AAA5] bg-[#2A2E2B] text-[#F0F2EF]"
                            : "border-[#4B4F4B] bg-[#2A2E2B] text-[#A5A9A4]"
                      }`}
                    >
                      {answer || "빈칸"}
                    </button>
                  ) : (
                    <input
                      aria-label={`구조복원 빈칸 ${index + 1}`}
                      disabled={result !== null}
                      value={answer}
                      placeholder="답 입력"
                      onChange={(event) =>
                        onAnswer({ ...answerRecord, [node.id]: event.target.value })
                      }
                      className={`${inputClassName} min-h-12 border-2 border-dashed bg-[#2A2E2B] font-bold`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {structureMode === "word_bank" ? (
            <div className="mt-6 border-t border-[#393D3A] pt-4">
              <p className="mb-3 text-xs font-black text-[#B2B6B1]">답 모음</p>
              <div className="flex flex-wrap gap-2">
                {structureChoices.map((choice, choiceIndex) => {
                  const used = usedStructureChoiceIndexes.has(choiceIndex);
                  return (
                    <button
                      key={`${choice}-${choiceIndex}`}
                      type="button"
                      disabled={result !== null || used}
                      onClick={() => {
                        const nodes = card.structureNodes ?? [];
                        const targetId = activeStructureNodeId ??
                          nodes.find((node) => !String(answerRecord[node.id] ?? ""))?.id;
                        if (!targetId) return;
                        const nextAnswer = { ...answerRecord, [targetId]: choice };
                        onAnswer(nextAnswer);
                        setActiveStructureNodeId(
                          nodes.find(
                            (node) => node.id !== targetId && !String(nextAnswer[node.id] ?? ""),
                          )?.id ?? null,
                        );
                      }}
                      className="rounded-md border border-[#4B4F4B] bg-[#2A2E2B] px-3 py-2 text-sm font-bold text-[#F0F2EF] hover:border-[#ECEEEB] disabled:opacity-35"
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-[#A6AAA5]">
                빈칸을 누른 뒤 아래 답을 고르세요. 채운 빈칸을 다시 누르면 답을 뺄 수 있습니다.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {result !== null ? (
        <div
          className={`mt-6 rounded-md border p-4 ${
            result
              ? "border-[#22A06B] bg-[#DCFFF1]"
              : "border-[#C9372C] bg-[#FFECEB]"
          }`}
        >
          <p className="font-black text-[#F0F2EF]">
            {result ? "정답입니다." : "틀렸습니다."}
          </p>
          <p className="mt-2 text-sm text-[#B2B6B1]">
            정답: {formatCorrectStudyAnswer(card)}
          </p>
          {card.explanation ? (
            <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
              판단 근거: {card.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function isCompleteGradedAnswer(card: Card, answer: StudyAnswer) {
  if (validateLearningActivity(card).length > 0) return false;
  const type = getLearningActivityType(card);
  if (type === "true_false") return typeof answer === "boolean";
  if (type === "multiple_choice") return typeof answer === "number";
  if (type === "cloze") return typeof answer === "string" && Boolean(answer.trim());
  if (type === "structure_recall") {
    const record = asStudyAnswerRecord(answer);
    return (card.structureNodes ?? []).every(
      (node) => typeof record[node.id] === "string" && String(record[node.id]).trim(),
    );
  }
  return false;
}

export function asStudyAnswerRecord(answer: StudyAnswer) {
  return typeof answer === "object" && answer !== null && !Array.isArray(answer)
    ? answer
    : {};
}

export function removeStructureAnswer(
  answers: Record<string, StudyAnswer>,
  nodeId: string,
) {
  return Object.fromEntries(
    Object.entries(answers).filter(([id]) => id !== nodeId),
  );
}

export function getStructureNodeDepth(
  nodeId: string,
  nodes: NonNullable<Card["structureNodes"]>,
  visited = new Set<string>(),
): number {
  if (visited.has(nodeId)) return 0;
  const node = nodes.find((item) => item.id === nodeId);
  if (!node?.parentId) return 0;
  visited.add(nodeId);
  return 1 + getStructureNodeDepth(node.parentId, nodes, visited);
}

export function hasUnorderedStructureGroup(
  nodes: NonNullable<Card["structureNodes"]>,
) {
  const childCounts = new Map<string | null, number>();
  for (const node of nodes) {
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }
  return [...childCounts.values()].some((count) => count > 1);
}

export function formatCorrectStudyAnswer(card: Card) {
  const type = getLearningActivityType(card);
  if (type === "true_false") return card.correctBoolean ? "O" : "X";
  if (type === "multiple_choice") {
    return card.options?.[card.correctOptionIndex ?? -1] ?? "정답 없음";
  }
  if (type === "cloze") return card.answer ?? card.answers?.[0] ?? "정답 없음";
  if (type === "structure_recall") {
    const nodes = card.structureNodes ?? [];
    const nodesByParent = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const siblings = nodesByParent.get(node.parentId) ?? [];
      siblings.push(node);
      nodesByParent.set(node.parentId, siblings);
    }
    return [...nodesByParent.entries()]
      .map(([parentId, siblings]) => {
        if (siblings.length === 1) return siblings[0].correctLabel;
        const parent = nodes.find((node) => node.id === parentId);
        return `${parentId === null ? "최상위" : (parent?.correctLabel ?? "같은 가지")} 아래(순서 없음): ${siblings
          .map((node) => node.correctLabel)
          .join(", ")}`;
      })
      .join(" → ");
  }
  return card.back ?? card.answer ?? "";
}
