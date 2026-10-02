"use client";

import { buildLearningCalendar,buildLearningHistory,buildLearningManagerSnapshot } from "@/lib/learning-manager";
import type { Deck,StudyAttempt,StudySession } from "@/lib/types";
import { ChevronLeft,ChevronRight } from "lucide-react";
import { useMemo,useState } from "react";
import { CollapsibleSessionLog } from "../CompactLearningLists";
import LearningPlanner from "../LearningPlanner";
import { EmptyState,Panel,PrimaryButton } from "../study-forge-shared";

export function LearningManagerView({
  mode,
  decks,
  sessions,
  attempts,
  loading,
  startStudy,
  goCreate,
}: {
  mode: "today" | "records";
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  loading: boolean;
  startStudy: (deck: Deck) => void;
  goCreate: () => void;
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const snapshot = useMemo(
    () => buildLearningManagerSnapshot(decks, sessions, attempts),
    [decks, sessions, attempts],
  );
  const history = useMemo(
    () => buildLearningHistory(decks, sessions, attempts).slice(0, 20),
    [decks, sessions, attempts],
  );
  const calendar = useMemo(
    () => buildLearningCalendar(decks, attempts, calendarMonth),
    [decks, attempts, calendarMonth],
  );
  const recommendedDeck = decks.find(
    (deck) => deck.id === snapshot.recommendedDeckId,
  );
  const estimatedMinutes = Math.max(3, Math.ceil(snapshot.dueCount * 1.5));
  const dueBreakdown = snapshot.decks
    .filter((item) => item.dueCount > 0)
    .slice(0, 3)
    .map((item) => `${item.title} ${item.dueCount}`)
    .join(" · ");

  if (decks.length === 0) {
    return (
      <EmptyState
        title="관리할 학습자료가 없습니다."
        body="문제를 생성해 덱으로 저장하면 오늘의 복습과 학습 기록을 여기에서 관리할 수 있습니다."
        actionLabel="첫 학습자료 만들기"
        onAction={goCreate}
      />
    );
  }

  return (
    <div className="space-y-5">
      {mode === "today" ? (
        <section className="grid overflow-hidden bg-[#1E211F] text-[#F0F2EF] lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-72 flex-col justify-between border-b border-[#3B413D] p-7 sm:p-9 lg:border-b-0 lg:border-r">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#AEB4AF]">
                오늘 해야 할 한 가지
              </p>
              <h3 className="mt-5 max-w-3xl text-3xl font-black leading-[1.12] tracking-[-0.045em] sm:text-5xl">
                {snapshot.dueCount > 0 ? "예정된 복습을 끝냅니다." : "오늘 복습을 모두 마쳤습니다."}
              </h3>
            </div>
            <p className="mt-8 text-sm font-bold text-[#C8CCC8]">
              {snapshot.dueCount > 0
                ? `약 ${estimatedMinutes}분${dueBreakdown ? ` · ${dueBreakdown}` : ""}`
                : `오늘 ${snapshot.todayCompletedCount}개 완료 · 새 문제 ${snapshot.newCount}개`}
            </p>
          </div>
          <div className="flex min-h-56 flex-col justify-between bg-[#1E211F] p-7 text-white sm:p-9">
            <div>
              <p className="text-sm font-black">오늘 복습</p>
              <strong className="mt-2 block text-7xl font-black tracking-[-0.08em]">
                {snapshot.dueCount}
              </strong>
            </div>
            {recommendedDeck ? (
              <button
                type="button"
                onClick={() => startStudy(recommendedDeck)}
                className="w-full border border-white/70 bg-[#ECEEEB] px-5 py-4 text-left text-sm font-black text-[#202321] transition hover:bg-[#D5D8D4]"
              >
                {snapshot.dueCount > 0 ? "복습 시작 →" : "새 학습 시작 →"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <Panel className={mode === "records" ? "hidden" : ""}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#ECEEEB]">다음 학습 추천</p>
            <h3 className="mt-2 text-xl font-black text-[#F0F2EF]">
              {recommendedDeck?.title ?? "추천할 덱이 없습니다"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
              {snapshot.recommendationReason}
            </p>
          </div>
          {recommendedDeck ? (
            <PrimaryButton onClick={() => startStudy(recommendedDeck)}>
              학습 범위 보기
            </PrimaryButton>
          ) : null}
        </div>
      </Panel>

      {mode === "records" ? (
        <>
          <LearningPlanner
            decks={decks}
            sessions={sessions}
            attempts={attempts}
            onStartStudy={startStudy}
          />
          <CollapsibleSessionLog history={history} />
        </>
      ) : null}

      <div className={mode === "today" ? "grid gap-5" : "grid gap-5 lg:grid-cols-[1.4fr_1fr]"}>
        <Panel className={mode === "records" ? "hidden" : ""}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#ECEEEB]">덱별 진행 상황</p>
              <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
                복습이 급한 순서
              </h3>
            </div>
            {loading ? (
              <span className="text-xs font-bold text-[#A6AAA5]">기록 갱신 중</span>
            ) : null}
          </div>
          <div className="mt-5 divide-y divide-[#393D3A]">
            {snapshot.decks.map((deckSummary) => {
              const deck = decks.find((item) => item.id === deckSummary.deckId);
              return (
                <div key={deckSummary.deckId} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-black text-[#F0F2EF]">
                        {deckSummary.title}
                      </p>
                      <p className="mt-1 text-xs text-[#A6AAA5]">
                        {deckSummary.subject || "과목 없음"} · 최근 학습 {formatLastStudiedAt(deckSummary.lastStudiedAt)}
                      </p>
                    </div>
                    {deck ? (
                      <button
                        type="button"
                        onClick={() => startStudy(deck)}
                        className="rounded-md border border-[#393D3A] px-3 py-2 text-xs font-black text-[#ECEEEB] hover:bg-[#2D312E]"
                      >
                        학습
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-[#B2B6B1]">
                    <span className={deckSummary.dueCount > 0 ? "text-[#C9372C]" : ""}>
                      복습 {deckSummary.dueCount}
                    </span>
                    <span>다시 보기 {deckSummary.reviewCount}</span>
                    <span>새 문제 {deckSummary.newCount}</span>
                    <span>누적 풀이 {deckSummary.completedAttemptCount}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#393D3A]">
                      <span
                        className="block h-full rounded-full bg-[#22A06B]"
                        style={{ width: `${deckSummary.progressPercent}%` }}
                      />
                    </span>
                    <span className="w-10 text-right text-xs font-black text-[#B2B6B1]">
                      {deckSummary.progressPercent}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#ECEEEB]">학습 캘린더</p>
              <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
                {calendar.year}년 {calendar.month}월
              </h3>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="이전 달"
                onClick={() =>
                  setCalendarMonth(
                    (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                  )
                }
                className="grid h-9 w-9 place-items-center rounded-md border border-[#393D3A] text-[#B2B6B1] hover:bg-[#222523]"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                aria-label="다음 달"
                onClick={() =>
                  setCalendarMonth(
                    (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                  )
                }
                className="grid h-9 w-9 place-items-center rounded-md border border-[#393D3A] text-[#B2B6B1] hover:bg-[#222523]"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 text-center text-[10px] font-bold text-[#A6AAA5] sm:text-xs">
            {['일', '월', '화', '수', '목', '금', '토'].map((weekday) => (
              <span key={weekday} className="py-1">{weekday}</span>
            ))}
            {Array.from({ length: calendar.firstWeekday }, (_, index) => (
              <span key={`empty-${index}`} aria-hidden="true" />
            ))}
            {calendar.days.map((day) => (
              <div
                key={day.date}
                className={`min-h-14 border-t border-[#393D3A] px-0.5 py-1 text-left sm:min-h-16 sm:px-1 ${
                  day.isToday ? "bg-[#2D312E]" : ""
                }`}
              >
                <span className={`text-[11px] font-black sm:text-xs ${day.isToday ? "text-[#ECEEEB]" : "text-[#F0F2EF]"}`}>
                  {day.dayOfMonth}
                </span>
                {day.completedCount > 0 ? (
                  <span className="mt-1 block truncate rounded bg-[#E3FCEF] px-1 py-0.5 text-[9px] font-bold text-[#216E4E] sm:text-[10px]">
                    학습 {day.completedCount}
                  </span>
                ) : null}
                {day.scheduledReviewCount > 0 ? (
                  <span className="mt-1 block truncate rounded bg-[#FFF7D6] px-1 py-0.5 text-[9px] font-bold text-[#7F5F01] sm:text-[10px]">
                    복습 {day.scheduledReviewCount}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-[11px] font-bold text-[#B2B6B1]">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#E3FCEF]" />실제 학습</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#FFF7D6]" />예정 복습</span>
          </div>
        </Panel>
      </div>

      <Panel className="hidden">
        <div>
          <p className="text-sm font-bold text-[#ECEEEB]">학습 기록</p>
          <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
            최근 학습 세션
          </h3>
        </div>
        {history.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#4B4F4B] text-xs text-[#A6AAA5]">
                  <th className="px-2 py-2 font-bold">날짜</th>
                  <th className="px-2 py-2 font-bold">학습자료</th>
                  <th className="px-2 py-2 font-bold">상태</th>
                  <th className="px-2 py-2 text-right font-bold">완료</th>
                  <th className="px-2 py-2 text-right font-bold">기억남·정답</th>
                  <th className="px-2 py-2 text-right font-bold">다시 보기·오답</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#393D3A]">
                {history.map((item) => (
                  <tr key={item.sessionId}>
                    <td className="whitespace-nowrap px-2 py-3 text-xs text-[#B2B6B1]">
                      {formatStudyHistoryDate(item.startedAt)}
                    </td>
                    <td className="max-w-72 truncate px-2 py-3 font-bold text-[#F0F2EF]">
                      {item.deckTitle}
                    </td>
                    <td className="px-2 py-3 text-xs font-bold text-[#B2B6B1]">
                      {getStudySessionStatusLabel(item.status)}
                    </td>
                    <td className="px-2 py-3 text-right font-black text-[#F0F2EF]">
                      {item.completedCount}/{item.plannedCount}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-[#216E4E]">
                      {item.rememberedCount}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-[#AE2E24]">
                      {item.reviewCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-md bg-[#222523] p-5 text-center text-sm text-[#A6AAA5]">
            아직 저장된 학습 기록이 없습니다.
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-[#A6AAA5]">
          카드·문제 학습 세션을 기록합니다.
        </p>
      </Panel>
    </div>
  );
}

export function formatLastStudiedAt(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function formatStudyHistoryDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 없음";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getStudySessionStatusLabel(status: StudySession["status"]) {
  return {
    active: "진행 중",
    completed: "완료",
    abandoned: "중단",
  }[status];
}
