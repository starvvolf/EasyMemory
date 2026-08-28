"use client";

import {
  BookOpen,
  ChevronDown,
  Info,
  Pencil,
  Trash2,
} from "lucide-react";
import { countDuePdfMasks } from "@/lib/pdf-mask-activity";
import { countDueReviews } from "@/lib/spaced-repetition";
import { getLearningActivityType } from "@/lib/learning-activity";
import type {
  Deck,
  DeckBoardColumn,
  LearningActivityType,
  StudyMode,
} from "@/lib/types";
import type { LearningHistoryItem } from "@/lib/learning-manager";

type CallbackResult = void | Promise<void>;

export type CompactDeckListProps = {
  decks: Deck[];
  onStartStudy: (deck: Deck) => CallbackResult;
  onOpenDetail: (deck: Deck) => CallbackResult;
  onRename: (deck: Deck) => CallbackResult;
  onDelete: (deckId: string) => CallbackResult;
  onChangeStatus: (
    deckId: string,
    status: DeckBoardColumn,
  ) => CallbackResult;
  renamingDeckId?: string | null;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onSaveRename?: (deck: Deck) => CallbackResult;
  onCancelRename?: () => void;
  className?: string;
};

const boardColumns: Array<{
  id: DeckBoardColumn;
  label: string;
  badgeClassName: string;
}> = [
  {
    id: "new",
    label: "새 자료",
    badgeClassName: "bg-[#2D312E] text-[#ECEEEB]",
  },
  {
    id: "learning",
    label: "학습 중",
    badgeClassName: "bg-[#3A3D36] text-[#DDD6AC]",
  },
  {
    id: "completed",
    label: "학습 완료",
    badgeClassName: "bg-[#303B35] text-[#B9D6C7]",
  },
];

const activityLabels: Record<LearningActivityType, string> = {
  flashcard: "플래시카드",
  cloze: "빈칸",
  true_false: "OX",
  multiple_choice: "객관식",
  structure_recall: "구조 복원",
};

const modeLabels: Record<StudyMode, string> = {
  flashcard: "플래시카드",
  cloze: "빈칸 문제",
  translation: "영작 리콜",
};

function getBoardColumn(status: DeckBoardColumn) {
  return boardColumns.find((column) => column.id === status) ?? boardColumns[0];
}

function getActivityMixLabel(deck: Deck) {
  if (deck.cards.length === 0) return modeLabels[deck.mode];

  const counts = new Map<LearningActivityType, number>();
  for (const card of deck.cards) {
    const type = getLearningActivityType(card);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 1) {
    const type = counts.keys().next().value as LearningActivityType;
    return activityLabels[type];
  }
  return `혼합 문제 · ${[...counts.entries()]
    .map(([type, count]) => `${activityLabels[type]} ${count}`)
    .join(" / ")}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 없음";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CompactDeckList({
  decks,
  onStartStudy,
  onOpenDetail,
  onRename,
  onDelete,
  onChangeStatus,
  renamingDeckId = null,
  renameValue = "",
  onRenameValueChange,
  onSaveRename,
  onCancelRename,
  className = "",
}: CompactDeckListProps) {
  if (decks.length === 0) return null;

  return (
    <div
      className={`divide-y divide-[#393D3A] border-y border-[#393D3A] ${className}`}
    >
      {decks.map((deck) => {
        const knownCount = deck.cards.filter(
          (card) => card.status === "known",
        ).length;
        const progress =
          deck.cards.length === 0
            ? 0
            : Math.round((knownCount / deck.cards.length) * 100);
        const dueCount =
          countDueReviews(deck.cards) +
          countDuePdfMasks(deck.pdfMaskActivities ?? []);
        const column = getBoardColumn(deck.boardColumn);
        const detailsId = `deck-details-${deck.id}`;

        return (
          <details key={deck.id} className="group bg-[#2A2E2B] open:bg-[#202321]">
            <summary
              aria-controls={detailsId}
              className="grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ECEEEB] sm:grid-cols-[minmax(0,1fr)_auto_7rem] sm:px-4 [&::-webkit-details-marker]:hidden"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-black text-[#F0F2EF] sm:text-[15px]">
                    {deck.title}
                  </span>
                  {dueCount > 0 ? (
                    <span className="shrink-0 text-[11px] font-black text-[#C9372C]">
                      복습 {dueCount}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] font-bold text-[#A6AAA5]">
                  <span className={`rounded px-1.5 py-0.5 ${column.badgeClassName}`}>
                    {column.label}
                  </span>
                  <span>{progress}% 완료</span>
                </span>
              </span>

              <span className="hidden items-center gap-2 sm:flex" aria-hidden="true">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[#393D3A]">
                  <span
                    className="block h-full rounded-full bg-[#22A06B]"
                    style={{ width: `${progress}%` }}
                  />
                </span>
              </span>

              <span className="flex items-center justify-end gap-2 text-xs font-bold text-[#A6AAA5]">
                <span className="hidden group-open:inline sm:inline">상세</span>
                <ChevronDown
                  size={17}
                  className="transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </span>
            </summary>

            <div
              id={detailsId}
              className="border-t border-[#393D3A] px-3 py-3 sm:px-4"
            >
              {renamingDeckId === deck.id ? (
                <div className="mb-3 flex flex-col gap-2 border-b border-[#393D3A] pb-3 sm:flex-row">
                  <input
                    autoFocus
                    aria-label={`${deck.title} 새 이름`}
                    value={renameValue}
                    onChange={(event) => onRenameValueChange?.(event.target.value)}
                    className="h-9 min-w-0 flex-1 border border-[#4B4F4B] bg-[#2A2E2B] px-3 text-sm font-bold text-[#F0F2EF] outline-none focus:border-[#ECEEEB]"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void onSaveRename?.(deck)} className="h-9 bg-[#ECEEEB] px-3 text-xs font-black text-[#202321] hover:bg-[#D5D8D4]">저장</button>
                    <button type="button" onClick={onCancelRename} className="h-9 border border-[#4B4F4B] px-3 text-xs font-black text-[#B2B6B1]">취소</button>
                  </div>
                </div>
              ) : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="font-bold text-[#A6AAA5]">과목</dt>
                  <dd className="mt-0.5 truncate font-bold text-[#F0F2EF]">
                    {deck.subject || "과목 없음"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-[#A6AAA5]">구성</dt>
                  <dd className="mt-0.5 truncate font-bold text-[#F0F2EF]">
                    {getActivityMixLabel(deck)}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-[#A6AAA5]">학습 항목</dt>
                  <dd className="mt-0.5 font-bold text-[#F0F2EF]">
                    카드 {deck.cards.length}개
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-[#A6AAA5]">최근 수정</dt>
                  <dd className="mt-0.5 font-bold text-[#F0F2EF]">
                    {formatDate(deck.updatedAt)}
                  </dd>
                </div>
              </dl>

              {deck.tags.length > 0 ? (
                <p className="mt-3 truncate text-xs text-[#A6AAA5]">
                  <span className="font-bold">태그</span> · {deck.tags.join(", ")}
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2 border-t border-[#393D3A] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center justify-between gap-3 text-xs font-bold text-[#B2B6B1] sm:justify-start">
                  상태
                  <select
                    value={deck.boardColumn}
                    onChange={(event) =>
                      void onChangeStatus(
                        deck.id,
                        event.target.value as DeckBoardColumn,
                      )
                    }
                    className="h-9 rounded border border-[#4B4F4B] bg-[#2A2E2B] px-2 text-xs font-bold text-[#F0F2EF] outline-none focus:border-[#ECEEEB] focus:ring-2 focus:ring-[#393D3A]"
                    aria-label={`${deck.title} 상태 변경`}
                  >
                    {boardColumns.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:justify-end">
                  <ActionButton onClick={() => void onStartStudy(deck)} primary>
                    <BookOpen size={15} aria-hidden="true" /> 학습 시작
                  </ActionButton>
                  <ActionButton onClick={() => void onOpenDetail(deck)}>
                    <Info size={15} aria-hidden="true" /> 상세 정보
                  </ActionButton>
                  <ActionButton onClick={() => void onRename(deck)}>
                    <Pencil size={15} aria-hidden="true" /> 이름 수정
                  </ActionButton>
                  <ActionButton danger onClick={() => void onDelete(deck.id)}>
                    <Trash2 size={15} aria-hidden="true" /> 삭제
                  </ActionButton>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = primary
    ? "bg-[#ECEEEB] text-[#202321] hover:bg-[#D5D8D4]"
    : danger
      ? "text-[#AE2E24] hover:bg-[#FFECEB]"
      : "text-[#B2B6B1] hover:bg-[#222523]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-black outline-none focus-visible:ring-2 focus-visible:ring-[#ECEEEB] ${tone}`}
    >
      {children}
    </button>
  );
}

export type CollapsibleSessionLogProps = {
  history: LearningHistoryItem[];
  initiallyOpen?: boolean;
  visibleCount?: number;
  onSelectSession?: (item: LearningHistoryItem) => CallbackResult;
  className?: string;
};

const sessionStatusLabels: Record<LearningHistoryItem["status"], string> = {
  active: "진행 중",
  completed: "완료",
  abandoned: "중단",
};

function formatSessionDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 없음";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CollapsibleSessionLog({
  history,
  initiallyOpen = false,
  visibleCount = 20,
  onSelectSession,
  className = "",
}: CollapsibleSessionLogProps) {
  const visibleHistory = history.slice(0, visibleCount);
  const latest = history[0];
  const completedSessionCount = history.filter(
    (item) => item.status === "completed",
  ).length;

  return (
    <details
      open={initiallyOpen || undefined}
      className={`group border-y border-[#393D3A] bg-[#2A2E2B] ${className}`}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-3 py-3 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ECEEEB] sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-black text-[#F0F2EF]">
            최근 학습 세션
          </span>
          <span className="mt-1 block truncate text-xs text-[#A6AAA5]">
            {latest
              ? `${history.length}개 기록 · 최근 ${formatSessionDate(latest.startedAt)} · 완료 ${completedSessionCount}회`
              : "아직 기록된 학습 세션이 없습니다."}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-[#A6AAA5]">
          <span>{history.length > 0 ? "로그 보기" : "비어 있음"}</span>
          <ChevronDown
            size={17}
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
          />
        </span>
      </summary>

      {visibleHistory.length > 0 ? (
        <div className="divide-y divide-[#393D3A] border-t border-[#393D3A]">
          {visibleHistory.map((item) => {
            const completionPercent =
              item.plannedCount === 0
                ? 0
                : Math.min(
                    100,
                    Math.round((item.completedCount / item.plannedCount) * 100),
                  );
            const content = (
              <>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-black text-[#F0F2EF]">
                      {item.deckTitle}
                    </span>
                    <span className="shrink-0 rounded bg-[#222523] px-1.5 py-0.5 text-[10px] font-bold text-[#B2B6B1]">
                      {sessionStatusLabels[item.status]}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] text-[#A6AAA5]">
                    {formatSessionDate(item.startedAt)} · {item.completedCount}/
                    {item.plannedCount} 완료
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-black text-[#F0F2EF]">
                    {completionPercent}%
                  </span>
                  <span className="mt-1 block text-[10px] font-bold text-[#A6AAA5]">
                    기억남 {item.rememberedCount} · 다시 보기 {item.reviewCount}
                  </span>
                </span>
              </>
            );

            return onSelectSession ? (
              <button
                key={item.sessionId}
                type="button"
                onClick={() => void onSelectSession(item)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left outline-none hover:bg-[#202321] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ECEEEB] sm:px-4"
                aria-label={`${item.deckTitle} 세션 상세 보기`}
              >
                {content}
              </button>
            ) : (
              <div
                key={item.sessionId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4"
              >
                {content}
              </div>
            );
          })}
          {history.length > visibleHistory.length ? (
            <p className="px-3 py-2 text-center text-xs font-bold text-[#A6AAA5] sm:px-4">
              최근 {visibleHistory.length}개만 표시합니다.
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
