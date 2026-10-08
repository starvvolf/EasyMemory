"use client";

import { ArrowRight, Clock3, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildLearningManagerSnapshot } from "@/lib/learning-manager";
import type { Deck, StudyAttempt, StudySession } from "@/lib/types";

const HEATMAP_WEEK_COUNT = 18;
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

type HeatmapDay = {
  date: string;
  count: number;
  isToday: boolean;
  isFuture: boolean;
};

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildHeatmap(attempts: StudyAttempt[], now: Date) {
  const countByDate = new Map<string, number>();
  for (const attempt of attempts) {
    const completedAt = new Date(attempt.completedAt);
    if (!Number.isFinite(completedAt.getTime())) continue;
    const key = localDateKey(completedAt);
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  }

  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (HEATMAP_WEEK_COUNT - 1) * 7);

  const weeks = Array.from({ length: HEATMAP_WEEK_COUNT }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex): HeatmapDay => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
      const key = localDateKey(date);
      return {
        date: key,
        count: countByDate.get(key) ?? 0,
        isToday: key === localDateKey(today),
        isFuture: date.getTime() > today.getTime(),
      };
    }),
  );

  const visibleDays = weeks.flat().filter((day) => !day.isFuture);
  return {
    weeks,
    activeDayCount: visibleDays.filter((day) => day.count > 0).length,
    completedCount: visibleDays.reduce((sum, day) => sum + day.count, 0),
  };
}

function heatmapColor(count: number, isFuture: boolean) {
  if (isFuture) return "bg-[#202020]";
  if (count === 0) return "bg-[#292929]";
  if (count <= 2) return "bg-[#444444]";
  if (count <= 5) return "bg-[#686868]";
  if (count <= 9) return "bg-[#A0A0A0]";
  return "bg-[#E2E2E2]";
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatToday(value: Date) {
  return value.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatSessionStartedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시작 시간 기록 없음";
  return `${date.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  })} ${date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })} 시작`;
}

export default function TodayHome({
  decks,
  sessions,
  attempts,
  activeSession,
  loading,
  onResume,
  onStartStudy,
  onCreate,
}: {
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  activeSession: StudySession | null;
  loading: boolean;
  onResume: () => void;
  onStartStudy: (deck: Deck) => void;
  onCreate: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = useMemo(
    () => buildLearningManagerSnapshot(decks, sessions, attempts, now),
    [decks, sessions, attempts, now],
  );
  const heatmap = useMemo(() => buildHeatmap(attempts, now), [attempts, now]);
  const activeDeck = activeSession
    ? decks.find((deck) => deck.id === activeSession.deckId) ?? null
    : null;
  const recommendedDeck =
    decks.find((deck) => deck.id === snapshot.recommendedDeckId) ?? null;
  const remainingCount = activeSession
    ? Math.max(0, activeSession.plannedItemCount - activeSession.completedItemCount)
    : 0;
  const activeProgress = activeSession?.plannedItemCount
    ? Math.round(
        (activeSession.completedItemCount / activeSession.plannedItemCount) * 100,
      )
    : 0;

  return (
    <div className="space-y-4">
      <section className="grid overflow-hidden rounded-2xl border border-[#303030] bg-[#1B1B1B] lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="flex min-h-[278px] flex-col items-center justify-center border-b border-[#303030] px-6 py-8 text-center lg:border-b-0 lg:border-r">
          <p className="text-xs text-[#858585]">{formatToday(now)}</p>
          <p className="mt-4 text-[clamp(3.25rem,7vw,5.25rem)] font-medium leading-none tracking-[-0.055em] text-[#E8E8E8]">
            {formatClock(now)}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-x-9 gap-y-4">
            <TodayMetric label="오늘 완료" value={snapshot.todayCompletedCount} />
            <TodayMetric label="복습 예정" value={snapshot.dueCount} />
            <TodayMetric label="새 문제" value={snapshot.newCount} />
          </div>
        </div>

        <div className="flex min-h-[278px] flex-col justify-between bg-[#1E1E1E] p-6 sm:p-8">
          {activeSession && activeDeck ? (
            <>
              <div>
                <p className="flex items-center gap-2 text-[11px] text-[#858585]">
                  <Clock3 size={14} /> 진행 중인 학습
                </p>
                <h3 className="mt-5 text-2xl font-medium leading-tight text-[#E8E8E8]">
                  {activeDeck.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-[#858585]">
                  {formatSessionStartedAt(activeSession.startedAt)} · {remainingCount}문제 남음
                </p>
                <div className="mt-7">
                  <div className="flex justify-between text-[11px] text-[#858585]">
                    <span>{activeSession.completedItemCount}/{activeSession.plannedItemCount} 완료</span>
                    <span>{activeProgress}%</span>
                  </div>
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[#303030]">
                    <span className="block h-full rounded-full bg-[#D8D8D8]" style={{ width: `${activeProgress}%` }} />
                  </span>
                </div>
              </div>
              <HomeAction onClick={onResume}>이어서 하기 <ArrowRight size={15} /></HomeAction>
            </>
          ) : recommendedDeck ? (
            <>
              <div>
                <p className="flex items-center gap-2 text-[11px] text-[#858585]">
                  <RotateCcw size={14} /> 오늘의 학습
                </p>
                <h3 className="mt-5 text-2xl font-medium leading-tight text-[#E8E8E8]">
                  {recommendedDeck.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-[#858585]">
                  {snapshot.recommendationReason}
                </p>
              </div>
              <HomeAction onClick={() => onStartStudy(recommendedDeck)}>
                {snapshot.dueCount > 0 ? "복습 시작하기" : "학습 시작하기"}
                <ArrowRight size={15} />
              </HomeAction>
            </>
          ) : (
            <>
              <div>
                <p className="text-[11px] text-[#858585]">첫 학습 준비</p>
                <h3 className="mt-5 text-2xl font-medium leading-tight text-[#E8E8E8]">
                  학습자료를 문제로 바꿔보세요.
                </h3>
                <p className="mt-2 text-xs leading-5 text-[#858585]">
                  PDF를 추가하면 핵심 내용을 골라 학습 세트로 만듭니다.
                </p>
              </div>
              <HomeAction onClick={onCreate}>학습 만들기 <Plus size={15} /></HomeAction>
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#303030] bg-[#1B1B1B] px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] text-[#858585]">학습 기록</p>
            <h3 className="mt-1 text-lg font-medium text-[#E8E8E8]">최근 {HEATMAP_WEEK_COUNT}주</h3>
          </div>
          <p className="text-xs text-[#858585]">
            {heatmap.activeDayCount}일 학습 · {heatmap.completedCount}문제 완료
          </p>
        </div>

        <div className="mt-6 overflow-x-auto pb-2">
          <div className="mx-auto grid w-max grid-cols-[22px_auto] gap-3 px-1">
            <div className="grid grid-rows-[repeat(7,14px)] gap-1.5 pt-0.5 text-[10px] text-[#696969]">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={label} className="flex h-3 items-center">
                  {index % 2 === 1 ? label : ""}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(18,14px)] gap-1.5">
              {heatmap.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-rows-[repeat(7,14px)] gap-1.5">
                  {week.map((day) => (
                    <span
                      key={day.date}
                      title={`${day.date} · ${day.count}문제 완료`}
                      aria-label={`${day.date}, ${day.count}문제 완료`}
                      className={`block size-[14px] rounded-[4px] ${heatmapColor(day.count, day.isFuture)} ${
                        day.isToday
                          ? "ring-1 ring-[#D8D8D8] ring-offset-2 ring-offset-[#1B1B1B]"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#303030] pt-4">
          <p className="text-[11px] text-[#696969]">
            {loading ? "학습 기록 갱신 중" : "문제를 완료한 날과 학습량"}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-[#696969]">
            <span>적음</span>
            {["bg-[#292929]", "bg-[#444444]", "bg-[#686868]", "bg-[#A0A0A0]", "bg-[#E2E2E2]"].map(
              (color) => <span key={color} className={`size-3 rounded-[3px] ${color}`} />,
            )}
            <span>많음</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function HomeAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-8 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#E6E6E6] px-4 text-xs font-medium text-[#171717] transition hover:bg-[#D4D4D4]"
    >
      {children}
    </button>
  );
}

function TodayMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-14">
      <span className="block text-[10px] text-[#696969]">{label}</span>
      <strong className="mt-1 block text-lg font-medium text-[#E8E8E8]">{value}</strong>
    </div>
  );
}
