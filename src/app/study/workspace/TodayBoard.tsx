"use client";
// 오늘: 다가오는 기한, 다시 볼 지식(바로 복습), 이어서 하기 — all in one look, nothing when there is nothing.
// "오늘 할 일" 카드는 뺐다(2026-10-30 사용자 "오늘 할 일 이것도 치워"). 할 일은 일정 탭에 그대로 있다.
import { useCallback, useEffect, useState } from "react";
import { call, go, later, type ItemLite, type Question } from "./api";
import { QuestionRun } from "./QuestionCard";

// 복습 입구 하나 (2026-11-02 A, 점검_UIUX화면연결 1번): PDF 문제(옛 화면의 오늘 할 것)도 이 카드의 한 줄로 받는다.
type PdfToday = { left: number; chunk: number; minutes: number; doneToday: number; start: () => void };
const pdfNow = (): PdfToday | null => (typeof window !== "undefined" ? ((window as unknown as { __recallerPdfToday?: PdfToday }).__recallerPdfToday ?? null) : null);
type Week = { today: string; upcoming: Array<{ id: string; title: string; date: string }> };
type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt: string };
type SourceLite = { id: string; title: string; readAt: string; goals: Record<string, { done: boolean }> };
const dleft = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export default function TodayBoard() {
  const [week, setWeek] = useState<Week | null>(null);
  const [review, setReview] = useState<ItemLite[]>([]);
  const [problems, setProblems] = useState<ProblemLite[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [run, setRun] = useState<Question[] | null>(null);
  const [pdf, setPdf] = useState<PdfToday | null>(pdfNow);
  useEffect(() => { const on = (e: Event) => setPdf((e as CustomEvent<PdfToday>).detail); window.addEventListener("recaller:pdf-today", on); return () => window.removeEventListener("recaller:pdf-today", on); }, []);
  const load = useCallback(async () => {
    const [w, r, p, s] = await Promise.allSettled([call<Week>("/api/schedule/week"), call<{ items: ItemLite[] }>("/api/knowledge/review?limit=50"),
      call<{ problems: ProblemLite[] }>("/api/code/problems"), call<{ sources: SourceLite[] }>("/api/knowledge/sources")]);
    if (w.status === "fulfilled") setWeek(w.value);
    if (r.status === "fulfilled") setReview(r.value.items);
    if (p.status === "fulfilled") setProblems(p.value.problems);
    if (s.status === "fulfilled") setSources(s.value.sources);
  }, []);
  useEffect(() => later(() => void load()), [load]);
  const startReview = async () => { const { questions } = await call<{ questions: Question[] }>("/api/knowledge/quiz?count=10"); if (questions.length) setRun(questions); else void load(); };

  const today = week?.today ?? "";
  const soon = (week?.upcoming ?? []).filter((d) => dleft(d.date, today) <= 14).slice(0, 3);
  const unknown = review.filter((i) => i.state === "unknown").length;
  const wrong = problems.filter((p) => p.status === "wrong");
  const lastProblem = [...problems].filter((p) => p.lastAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  const lastSource = sources.find((s) => Object.values(s.goals).some((g) => !g.done));
  const pdfLeft = pdf?.left ?? 0;
  const nothing = !soon.length && !review.length && !pdfLeft && !wrong.length && !lastProblem && !lastSource;
  if (run) return <QuestionRun title="오늘의 복습" questions={run} onClose={() => { setRun(null); void load(); }} />;
  if (!week || nothing) return null;
  return (
    <div className="td">
      {soon.length ? <div className="td-dl">{soon.map((d) => { const n = dleft(d.date, today); return <span key={d.id} className={`chip ${n <= 3 ? "bad" : "help"}`}>{d.title} · {n === 0 ? "오늘" : `D-${n}`}</span>; })}</div> : null}
      <div className="td-grid">
        {review.length || pdfLeft ? (
          <section className="td-card">
            <p className="eyebrow">오늘 복습</p>
            <p className="td-big num">{review.length + pdfLeft}<small>개</small></p>
            <ul className="td-rev">
              {review.length ? <li><span><b>지식</b> {review.length}개 · <span className="muted">{unknown ? `몰랐던 것 ${unknown}개부터` : "오래 안 본 것부터"}</span></span>
                <button className="btn primary small" onClick={() => void startReview()}>지식 복습 · 10문제</button></li> : null}
              {pdfLeft && pdf ? <li><span><b>PDF 문제</b> {pdfLeft}개 · <span className="muted">약 {pdf.minutes}분{pdf.doneToday ? ` · 오늘 ${pdf.doneToday}문제 풂` : ""}</span></span>
                <button className={`btn small${review.length ? "" : " primary"}`} onClick={() => pdf.start()}>{pdf.doneToday ? "이어서 풀기" : "PDF 문제 풀기"} · {pdf.chunk}문제</button></li> : null}
            </ul>
          </section>
        ) : null}
        {wrong.length || lastProblem || lastSource ? (
          <section className="td-card">
            <p className="eyebrow">이어서 하기</p>
            <ul className="td-next">
              {wrong.slice(0, 2).map((p) => <li key={p.id}><button className="linkish" onClick={() => go("code", { id: p.id })}>{p.title}</button> <span className="chip bad">틀린 문제</span></li>)}
              {lastProblem && !wrong.some((p) => p.id === lastProblem.id) ? <li><button className="linkish" onClick={() => go("code", { id: lastProblem.id })}>{lastProblem.title}</button> <span className="small muted">코드</span></li> : null}
              {lastSource ? <li><button className="linkish" onClick={() => go("web", { id: lastSource.id })}>{lastSource.title}</button> <span className="small muted">웹 글 · 확인 {Object.values(lastSource.goals).filter((g) => g.done).length}/4</span></li> : null}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
