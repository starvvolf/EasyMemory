"use client";
// 오늘: 두 칸만 (2026-11-06 사용자 "딱 두 가지로, 문제 풀기랑 이어서 하기, 조잡하지 않게"). 문제 풀기를 누르면 무엇을 풀지
// 고르는 목록이 열리고(지식 복습·PDF 문제·틀린 알고리즘·알고리즘 문제·미리 연습), 이어서 하기는 마지막으로 한 공부 하나를 보여 준다.
// 기한·할 일 칩은 뺐다(일정 탭에서 할 일·기한을 없앰).
import { useCallback, useEffect, useState } from "react";
import { call, go, later, type ItemLite, type Question } from "./api";
import { QuestionRun } from "./QuestionCard";

type PdfToday = { left: number; chunk: number; minutes: number; doneToday: number; start: () => void };
const pdfNow = (): PdfToday | null => (typeof window !== "undefined" ? ((window as unknown as { __recallerPdfToday?: PdfToday }).__recallerPdfToday ?? null) : null);
type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt: string };
type SourceLite = { id: string; title: string; readAt: string; goals: Record<string, { done: boolean }> };
type Studied = { kind: string; title: string; ref: string; n: number; last: string };
type Last = { kind: string; title: string; at: string; open: () => void; note: string };
const KIND: Record<string, string> = { pdf: "PDF", web: "웹 글", code: "알고리즘", project: "실습", manual: "직접 넣은 것", review: "복습" };
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m || 1}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

export default function TodayBoard() {
  const [review, setReview] = useState<ItemLite[]>([]);
  const [problems, setProblems] = useState<ProblemLite[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [studied, setStudied] = useState<Studied[]>([]);
  const [run, setRun] = useState<{ title: string; questions: Question[] } | null>(null);
  const [pick, setPick] = useState(false);
  const [note, setNote] = useState("");
  const [pdf, setPdf] = useState<PdfToday | null>(pdfNow);
  useEffect(() => { const on = (e: Event) => setPdf((e as CustomEvent<PdfToday>).detail); window.addEventListener("recaller:pdf-today", on); return () => window.removeEventListener("recaller:pdf-today", on); }, []);
  const load = useCallback(async () => {
    const [r, p, s, w] = await Promise.allSettled([call<{ items: ItemLite[] }>("/api/knowledge/review?limit=50"),
      call<{ problems: ProblemLite[] }>("/api/code/problems"), call<{ sources: SourceLite[] }>("/api/knowledge/sources"),
      call<{ studied?: Studied[] }>("/api/schedule/week")]);
    if (r.status === "fulfilled") setReview(r.value.items);
    if (p.status === "fulfilled") setProblems(p.value.problems);
    if (s.status === "fulfilled") setSources(s.value.sources);
    if (w.status === "fulfilled") setStudied(w.value.studied ?? []);
  }, []);
  useEffect(() => later(() => void load()), [load]);
  const quiz = async (title: string, url: string) => {
    setNote("");
    const { questions } = await call<{ questions: Question[] }>(url);
    if (questions.length) setRun({ title, questions }); else setNote("지금 풀 문제가 없어요.");
  };

  if (run) return <QuestionRun title={run.title} questions={run.questions} onClose={() => { setRun(null); setPick(false); void load(); }} />;

  const unknown = review.filter((i) => i.state === "unknown").length;
  const wrong = problems.filter((p) => p.status === "wrong");
  const unsolved = problems.filter((p) => p.status !== "solved");
  const pdfLeft = pdf?.left ?? 0;
  const due = review.length + pdfLeft;

  // 마지막으로 한 공부: 지식 기록(이번 주)에서 가장 최근 것, 없으면 알고리즘·웹 글 중 최근 것.
  const fromStudied = (s: Studied): Last | null => {
    if (s.kind === "code" && s.ref.startsWith("code:")) return { kind: "code", title: s.title, at: s.last, open: () => go("code", { id: s.ref.slice(5) }), note: "이어서 풀기" };
    if (s.kind === "code" && s.ref.startsWith("project:")) return { kind: "project", title: s.title.replace(/^프로젝트 코스: /, ""), at: s.last, open: () => go("project"), note: "실습 열기" };
    if (s.kind === "web") { const src = sources.find((x) => x.title === s.title); return { kind: "web", title: s.title, at: s.last, open: () => (src ? go("web", { id: src.id }) : go("web")), note: "이어서 읽기" }; }
    if (s.kind === "pdf") return { kind: "pdf", title: s.title, at: s.last, open: () => go("practice"), note: "PDF 자료 열기" };
    return null;
  };
  const cands: Last[] = [];
  for (const s of studied) { const l = fromStudied(s); if (l) { cands.push(l); break; } }
  const lastProblem = [...problems].filter((p) => p.lastAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  if (lastProblem) cands.push({ kind: "code", title: lastProblem.title, at: lastProblem.lastAt, open: () => go("code", { id: lastProblem.id }), note: "이어서 풀기" });
  const lastSource = [...sources].sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
  if (lastSource) cands.push({ kind: "web", title: lastSource.title, at: lastSource.readAt, open: () => go("web", { id: lastSource.id }), note: "이어서 읽기" });
  const last = cands.sort((a, b) => b.at.localeCompare(a.at))[0];

  return (
    <div className="td-two">
      <section className="td-card">
        <p className="eyebrow">문제 풀기</p>
        <p className="td-big num">{due}<small>개 복습 차례</small></p>
        {!pick ? (
          <>
            <p className="small muted">{unknown ? `몰랐던 지식 ${unknown}개가 먼저 나와요.` : due ? "오래 안 본 것부터 나와요." : "복습 차례는 없어요. 미리 연습하거나 새 문제를 풀어 보세요."}</p>
            <button className="btn primary" onClick={() => setPick(true)}>문제 풀기</button>
          </>
        ) : (
          <>
            <ul className="td-pick">
              {review.length ? <li><button onClick={() => void quiz("지식 복습", "/api/knowledge/quiz?count=10")}><span><b>지식 복습</b> <small>{review.length}개 중 10문제</small></span><span aria-hidden="true">→</span></button></li> : null}
              {pdfLeft && pdf ? <li><button onClick={() => pdf.start()}><span><b>PDF 문제</b> <small>{pdfLeft}개 · 약 {pdf.minutes}분</small></span><span aria-hidden="true">→</span></button></li> : null}
              {wrong.length ? <li><button onClick={() => go("code", { id: wrong[0].id })}><span><b>틀린 알고리즘 다시</b> <small>{wrong[0].title}{wrong.length > 1 ? ` 외 ${wrong.length - 1}개` : ""}</small></span><span aria-hidden="true">→</span></button></li> : null}
              <li><button onClick={() => go("code")}><span><b>알고리즘 문제 고르기</b> <small>안 푼 것 {unsolved.length}개</small></span><span aria-hidden="true">→</span></button></li>
              <li><button onClick={() => void quiz("미리 연습", "/api/knowledge/quiz?count=20&all=1")}><span><b>미리 연습</b> <small>복습 날이 안 된 지식까지</small></span><span aria-hidden="true">→</span></button></li>
            </ul>
            {note ? <p className="small muted">{note}</p> : null}
            <button className="btn ghost small" onClick={() => setPick(false)}>닫기</button>
          </>
        )}
      </section>
      <section className="td-card">
        <p className="eyebrow">이어서 하기</p>
        {last ? (
          <>
            <p className="td-last">{last.title}</p>
            <p className="small muted">{KIND[last.kind] ?? last.kind} · {ago(last.at)}</p>
            <button className="btn" onClick={last.open}>{last.note}</button>
          </>
        ) : (
          <>
            <p className="small muted">아직 한 공부가 없어요.</p>
            <button className="btn" onClick={() => go("start")}>+ 새 공부 시작</button>
          </>
        )}
      </section>
    </div>
  );
}
