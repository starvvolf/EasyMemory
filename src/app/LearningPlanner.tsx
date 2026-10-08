"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type { Deck, StudyAttempt, StudySession } from "@/lib/types";
import {
  buildPlannerDayDetails,
  buildPlannerMonth,
  createLearningPlan,
  toLocalDateKey,
  updateLearningPlan,
  type LearningPlan,
  type LearningPlanDraft,
} from "@/lib/learning-planner";
import { loadLearningPlans, saveLearningPlans } from "@/lib/learning-plan-storage";

type LearningPlannerProps = {
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  onStartStudy?: (deck: Deck) => void;
};

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

export default function LearningPlanner({
  decks,
  sessions,
  attempts,
  onStartStudy,
}: LearningPlannerProps) {
  const today = useMemo(() => new Date(), []);
  const [monthDate, setMonthDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(today));
  const [plans, setPlans] = useState<LearningPlan[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [editor, setEditor] = useState<LearningPlan | "new" | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlans(loadLearningPlans());
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (storageReady) saveLearningPlans(plans);
  }, [plans, storageReady]);

  const month = useMemo(
    () => buildPlannerMonth(decks, sessions, attempts, plans, monthDate, today),
    [attempts, decks, monthDate, plans, sessions, today],
  );
  const details = useMemo(
    () => buildPlannerDayDetails(decks, sessions, attempts, plans, selectedDate),
    [attempts, decks, plans, selectedDate, sessions],
  );

  function moveMonth(offset: number) {
    const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + offset, 1);
    setMonthDate(next);
    setSelectedDate(toLocalDateKey(next));
    setEditor(null);
  }

  function savePlan(draft: LearningPlanDraft) {
    setPlans((current) => {
      if (editor === "new") return [...current, createLearningPlan(draft)];
      if (!editor) return current;
      return current.map((plan) =>
        plan.id === editor.id ? updateLearningPlan(plan, draft) : plan,
      );
    });
    setSelectedDate(draft.date);
    const nextDate = parseDateKey(draft.date);
    setMonthDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setEditor(null);
  }

  return (
    <section className="overflow-hidden border border-[#3B3F3C] bg-[#202321]">
      <header className="flex flex-col gap-4 border-b border-[#3B3F3C] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#6E746F]">
            학습 플래너
          </p>
          <h2 className="mt-1 text-xl font-black tracking-[-0.025em] text-[#F0F2EF]">
            {month.year}년 {month.month}월
          </h2>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => {
              const current = new Date();
              setMonthDate(new Date(current.getFullYear(), current.getMonth(), 1));
              setSelectedDate(toLocalDateKey(current));
              setEditor(null);
            }}
            className="h-9 border border-[#4B4F4B] px-3 text-xs font-black text-[#D1D4D0] transition hover:bg-[#2D312E]"
          >
            오늘
          </button>
          <button type="button" aria-label="이전 달" onClick={() => moveMonth(-1)} className="grid h-9 w-9 place-items-center border border-[#4B4F4B] text-[#D1D4D0] hover:bg-[#2D312E]">
            <ChevronLeft size={17} />
          </button>
          <button type="button" aria-label="다음 달" onClick={() => moveMonth(1)} className="grid h-9 w-9 place-items-center border border-[#4B4F4B] text-[#D1D4D0] hover:bg-[#2D312E]">
            <ChevronRight size={17} />
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(310px,0.85fr)]">
        <div className="min-w-0 p-3 sm:p-5 lg:border-r lg:border-[#3B3F3C]">
          <div className="grid grid-cols-7 text-center text-[10px] font-black text-[#777E79] sm:text-xs">
            {weekdays.map((weekday) => <span key={weekday} className="py-2">{weekday}</span>)}
            {Array.from({ length: month.firstWeekday }, (_, index) => (
              <span key={`empty-${index}`} aria-hidden="true" />
            ))}
            {month.days.map((day) => {
              const selected = day.date === selectedDate;
              return (
                <button
                  type="button"
                  key={day.date}
                  aria-label={`${day.date} 학습 일정 보기`}
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedDate(day.date);
                    setEditor(null);
                  }}
                  className={`min-h-20 border-t px-1.5 py-2 text-left transition sm:min-h-28 sm:px-2 ${
                    selected
                      ? "border-[#ECEEEB] bg-[#222523] shadow-[inset_0_0_0_1px_#ECEEEB]"
                      : "border-[#353936] hover:bg-[#292D2A]"
                  }`}
                >
                  <span className={`grid h-6 w-6 place-items-center text-[11px] font-black sm:text-xs ${day.isToday ? "rounded-full bg-[#ECEEEB] text-[#202321]" : "text-[#D1D4D0]"}`}>
                    {day.dayOfMonth}
                  </span>
                  <span className="mt-2 flex flex-col gap-1">
                    {day.planCount > 0 ? <DayBadge tone="plan" label={`계획 ${day.completedPlanCount}/${day.planCount}`} /> : null}
                    {day.reviewCount > 0 ? <DayBadge tone="review" label={`복습 ${day.reviewCount}`} /> : null}
                    {day.studiedCount > 0 ? <DayBadge tone="record" label={`학습 ${day.studiedCount}`} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-bold text-[#A6AAA5]">
            <Legend color="bg-[#F7B7A8]" label="나의 계획" />
            <Legend color="bg-[#FDE68A]" label="자동 복습" />
            <Legend color="bg-[#A7F3D0]" label="실제 학습" />
          </div>
        </div>

        <aside className="border-t border-[#3B3F3C] bg-[#242725] p-4 sm:p-6 lg:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#777E79]">선택한 날짜</p>
              <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">{formatDateLabel(selectedDate)}</h3>
            </div>
            <button
              type="button"
              disabled={decks.length === 0}
              onClick={() => setEditor("new")}
              className="inline-flex h-9 items-center gap-1.5 bg-[#ECEEEB] px-3 text-xs font-black text-[#202321] transition hover:bg-[#D5D8D4] disabled:cursor-not-allowed disabled:bg-[#B9BDB9]"
            >
              <CirclePlus size={15} /> 계획 추가
            </button>
          </div>

          {editor ? (
            <PlanEditor
              key={editor === "new" ? `new-${selectedDate}` : editor.id}
              decks={decks}
              initial={editor === "new" ? null : editor}
              selectedDate={selectedDate}
              onSave={savePlan}
              onCancel={() => setEditor(null)}
            />
          ) : null}

          <div className="mt-6 space-y-6">
            <DetailGroup title="나의 학습계획" count={details.plans.length} tone="plan">
              {details.plans.length > 0 ? details.plans.map((plan) => {
                const deck = decks.find((item) => item.id === plan.deckId);
                return (
                  <article key={plan.id} className={`border border-[#393D3A] bg-[#2A2E2B] p-3 ${plan.completed ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        aria-label={plan.completed ? "계획을 미완료로 변경" : "계획 완료"}
                        onClick={() => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, completed: !item.completed, updatedAt: new Date().toISOString() } : item))}
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border ${plan.completed ? "border-[#ECEEEB] bg-[#ECEEEB] text-[#202321]" : "border-[#C97A67] text-transparent"}`}
                      >
                        <Check size={13} strokeWidth={3} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-black text-[#F0F2EF] ${plan.completed ? "line-through" : ""}`}>{deck?.title ?? "삭제된 학습자료"}</p>
                        <p className="mt-1 text-xs font-bold text-[#B2B6B1]">{plan.quantity}개 학습</p>
                        {plan.note ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#A6AAA5]">{plan.note}</p> : null}
                      </div>
                      <div className="flex shrink-0">
                        <button type="button" aria-label="계획 수정" onClick={() => setEditor(plan)} className="grid h-8 w-8 place-items-center text-[#B2B6B1] hover:bg-[#2D312E]"><Pencil size={14} /></button>
                        <button type="button" aria-label="계획 삭제" onClick={() => setPlans((current) => current.filter((item) => item.id !== plan.id))} className="grid h-8 w-8 place-items-center text-[#AE2E24] hover:bg-[#FFECEB]"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {!plan.completed && deck && onStartStudy ? (
                      <button type="button" onClick={() => onStartStudy(deck)} className="mt-3 w-full border border-[#4B4F4B] py-2 text-xs font-black text-[#D8DCD7] hover:bg-[#2D312E]">이 학습 시작</button>
                    ) : null}
                  </article>
                );
              }) : <EmptyLine label={decks.length ? "아직 직접 세운 계획이 없습니다." : "학습자료를 만든 뒤 계획을 추가할 수 있습니다."} />}
            </DetailGroup>

            <DetailGroup title="자동 복습" count={details.reviews.reduce((sum, item) => sum + item.count, 0)} tone="review">
              {details.reviews.length > 0 ? details.reviews.map((item) => {
                const deck = decks.find((candidate) => candidate.id === item.deckId);
                return (
                  <div key={item.deckId} className="flex items-center justify-between gap-3 border-b border-[#3B3F3C] py-2.5 last:border-b-0">
                    <p className="min-w-0 truncate text-sm font-bold text-[#F0F2EF]">{item.deckTitle}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-black text-[#DDD6AC]">{item.count}개</span>
                      {deck && onStartStudy ? <button type="button" onClick={() => onStartStudy(deck)} className="border border-[#68675F] px-2 py-1 text-[11px] font-black text-[#DDD6AC] hover:bg-[#34332D]">복습</button> : null}
                    </div>
                  </div>
                );
              }) : <EmptyLine label="예정된 자동 복습이 없습니다." />}
            </DetailGroup>

            <DetailGroup title="실제 학습 기록" count={details.records.reduce((sum, item) => sum + item.completedCount, 0)} tone="record">
              {details.records.length > 0 ? details.records.map((record) => (
                <div key={record.sessionId} className="border-b border-[#3B3F3C] py-2.5 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-bold text-[#F0F2EF]">{record.deckTitle}</p>
                    <span className="shrink-0 text-xs font-black text-[#B9D6C7]">{record.completedCount}개 완료</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#A6AAA5]">{formatTime(record.startedAt)} · 기억남·정답 {record.rememberedCount}</p>
                </div>
              )) : <EmptyLine label="이 날짜에 완료한 학습이 없습니다." />}
            </DetailGroup>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PlanEditor({ decks, initial, selectedDate, onSave, onCancel }: {
  decks: Deck[];
  initial: LearningPlan | null;
  selectedDate: string;
  onSave: (draft: LearningPlanDraft) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? selectedDate);
  const [deckId, setDeckId] = useState(initial?.deckId ?? decks[0]?.id ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity ?? 10);
  const [note, setNote] = useState(initial?.note ?? "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (date && deckId && quantity > 0) onSave({ date, deckId, quantity, note });
      }}
      className="mt-4 border border-[#393D3A] bg-[#2A2E2B] p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-[#F0F2EF]">{initial ? "학습계획 수정" : "새 학습계획"}</p>
        <button type="button" aria-label="닫기" onClick={onCancel} className="grid h-7 w-7 place-items-center text-[#B2B6B1] hover:bg-[#2D312E]"><X size={15} /></button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label className="text-[11px] font-black text-[#B2B6B1]">날짜<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block h-10 w-full border border-[#4B4F4B] bg-[#2A2E2B] px-2 text-sm font-bold text-[#F0F2EF] outline-none focus:border-[#ECEEEB]" /></label>
        <label className="text-[11px] font-black text-[#B2B6B1]">학습자료<select required value={deckId} onChange={(event) => setDeckId(event.target.value)} className="mt-1 block h-10 w-full border border-[#4B4F4B] bg-[#2A2E2B] px-2 text-sm font-bold text-[#F0F2EF] outline-none focus:border-[#ECEEEB]">{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.title}</option>)}</select></label>
        <label className="text-[11px] font-black text-[#B2B6B1]">학습 분량<input required min={1} max={9999} type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 block h-10 w-full border border-[#4B4F4B] bg-[#2A2E2B] px-2 text-sm font-bold text-[#F0F2EF] outline-none focus:border-[#ECEEEB]" /></label>
        <label className="text-[11px] font-black text-[#B2B6B1] sm:col-span-2 lg:col-span-1 xl:col-span-2">메모<textarea value={note} maxLength={300} rows={2} placeholder="집중할 내용이나 목표" onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full resize-none border border-[#4B4F4B] bg-[#2A2E2B] p-2 text-sm text-[#F0F2EF] outline-none placeholder:text-[#9892A4] focus:border-[#ECEEEB]" /></label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 border border-[#4B4F4B] px-3 text-xs font-black text-[#B2B6B1]">취소</button>
        <button type="submit" className="h-9 bg-[#ECEEEB] px-4 text-xs font-black text-[#202321] hover:bg-[#D5D8D4]">저장</button>
      </div>
    </form>
  );
}

function DayBadge({ tone, label }: { tone: "plan" | "review" | "record"; label: string }) {
  const colors = { plan: "bg-[#43332F] text-[#E0B6AA]", review: "bg-[#3A392F] text-[#DDD6AC]", record: "bg-[#303B35] text-[#B9D6C7]" };
  return <span className={`block truncate px-1 py-0.5 text-[9px] font-black sm:px-1.5 sm:text-[10px] ${colors[tone]}`}>{label}</span>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 ${color}`} />{label}</span>;
}

function DetailGroup({ title, count, tone, children }: { title: string; count: number; tone: "plan" | "review" | "record"; children: React.ReactNode }) {
  const colors = { plan: "bg-[#43332F] text-[#E0B6AA]", review: "bg-[#3A392F] text-[#DDD6AC]", record: "bg-[#303B35] text-[#B9D6C7]" };
  return <section><div className="mb-2 flex items-center gap-2"><h4 className="text-sm font-black text-[#D1D4D0]">{title}</h4><span className={`min-w-5 px-1.5 py-0.5 text-center text-[10px] font-black ${colors[tone]}`}>{count}</span></div>{children}</section>;
}

function EmptyLine({ label }: { label: string }) {
  return <div className="border border-dashed border-[#4B4F4B] px-3 py-4 text-center text-xs text-[#A6AAA5]"><CalendarDays className="mx-auto mb-2" size={18} />{label}</div>;
}

function parseDateKey(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(parseDateKey(date));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
