"use client";
// 오늘: 두 칸만 (2026-11-06 사용자 "딱 두 가지로, 문제 풀기랑 이어서 하기, 조잡하지 않게"). 문제 풀기를 누르면 무엇을 풀지
// 고르는 목록이 열리고(지식 복습·PDF 문제·틀린 알고리즘·알고리즘 문제·미리 연습), 이어서 하기는 자료·알고리즘·실습마다 마지막 하나(11/9).
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
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m || 1}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

export default function TodayBoard() {
  const [review, setReview] = useState<ItemLite[]>([]);
  // 11/9 사용자 "자료/실습/알고리즘 기억 구분": 복습 차례를 갈래마다 따로
  const [byOrigin, setByOrigin] = useState<Record<"theory" | "algo" | "lab", number>>({ theory: 0, algo: 0, lab: 0 });
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
    const counts = await Promise.all((["theory", "algo", "lab"] as const).map((o) => call<{ items: ItemLite[] }>(`/api/knowledge/review?limit=50&origin=${o}`).then((x) => x.items.length).catch(() => 0)));
    setByOrigin({ theory: counts[0], algo: counts[1], lab: counts[2] });
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

  // 이어서 하기 (11/9 사용자 "자료/알고리즘/실습 세 가지 탭에서 각각 하나씩"): 갈래마다 가장 최근에 한 것 하나.
  const newest = (xs: Array<Last | null>) => xs.filter((x): x is Last => !!x).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const openPdf = (s: Studied) => () => { const gen = /^(gen_[a-z0-9]+)/.exec(s.ref)?.[1]; if (gen) window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: gen } })); else go("practice"); };
  const lastSource = [...sources].sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
  const lastProblem = [...problems].filter((p) => p.lastAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  const material = newest([
    ...studied.filter((x) => x.kind === "pdf").slice(0, 1).map((x): Last => ({ kind: "pdf", title: x.title, at: x.last, open: openPdf(x), note: "자료 지도 열기" })),
    ...studied.filter((x) => x.kind === "web").slice(0, 1).map((x): Last => { const src = sources.find((y) => y.title === x.title); return { kind: "web", title: x.title, at: x.last, open: () => (src ? go("web", { id: src.id }) : go("practice")), note: "이어서 읽기" }; }),
    lastSource ? { kind: "web", title: lastSource.title, at: lastSource.readAt, open: () => go("web", { id: lastSource.id }), note: "이어서 읽기" } : null,
  ]);
  const algo = newest([
    ...studied.filter((x) => x.kind === "code" && x.ref.startsWith("code:")).slice(0, 1).map((x): Last => ({ kind: "code", title: x.title, at: x.last, open: () => go("code", { id: x.ref.slice(5) }), note: "이어서 풀기" })),
    lastProblem ? { kind: "code", title: lastProblem.title, at: lastProblem.lastAt, open: () => go("code", { id: lastProblem.id }), note: "이어서 풀기" } : null,
  ]);
  const lab = newest(studied.filter((x) => x.kind === "code" && x.ref.startsWith("project:")).slice(0, 1)
    .map((x): Last => ({ kind: "project", title: x.title.replace(/^프로젝트 코스: /, ""), at: x.last, open: () => go("project"), note: "실습 열기" })));
  const rows: Array<{ label: string; last: Last | null; empty: string; to: () => void }> = [
    { label: "자료", last: material, empty: "자료 열기", to: () => go("practice") },
    { label: "알고리즘", last: algo, empty: "알고리즘 열기", to: () => go("code") },
    { label: "실습", last: lab, empty: "실습 열기", to: () => go("project") },
  ];

  return (
    <div className="td-two">
      <section className="td-card">
        <p className="eyebrow">문제 풀기</p>
        <p className="td-big num">{due}<small>개 복습 차례</small></p>
        {!pick ? (
          <>
            <p className="small muted">{unknown ? `몰랐던 기억 ${unknown}개가 먼저 나와요.` : due ? "오래 안 본 것부터 나와요." : "복습 차례는 없어요. 미리 연습하거나 새 문제를 풀어 보세요."}</p>
            <button className="btn primary" onClick={() => setPick(true)}>문제 풀기</button>
          </>
        ) : (
          <>
            <ul className="td-pick">
              {([["theory", "자료 기억 복습"], ["algo", "알고리즘 기억 복습"], ["lab", "실습 기억 복습"]] as const).map(([o, label]) => byOrigin[o]
                ? <li key={o}><button onClick={() => void quiz(label, `/api/knowledge/quiz?count=10&origin=${o}`)}><span><b>{label}</b> <small>{byOrigin[o]}개 중 {Math.min(10, byOrigin[o])}장</small></span><span aria-hidden="true">→</span></button></li> : null)}
              {pdfLeft && pdf ? <li><button onClick={() => pdf.start()}><span><b>PDF 문제</b> <small>{pdfLeft}개 · 약 {pdf.minutes}분</small></span><span aria-hidden="true">→</span></button></li> : null}
              {wrong.length ? <li><button onClick={() => go("code", { id: wrong[0].id })}><span><b>틀린 알고리즘 다시</b> <small>{wrong[0].title}{wrong.length > 1 ? ` 외 ${wrong.length - 1}개` : ""}</small></span><span aria-hidden="true">→</span></button></li> : null}
              <li><button onClick={() => go("code")}><span><b>알고리즘 문제 고르기</b> <small>안 푼 것 {unsolved.length}개</small></span><span aria-hidden="true">→</span></button></li>
              {([["theory", "자료"], ["algo", "알고리즘"], ["lab", "실습"]] as const).map(([o, label]) =>
                <li key={`p${o}`}><button onClick={() => void quiz(`${label} 미리 연습`, `/api/knowledge/quiz?count=20&all=1&origin=${o}`)}><span><b>{label} 미리 연습</b> <small>복습 날이 안 된 {label} 기억까지</small></span><span aria-hidden="true">→</span></button></li>)}
            </ul>
            {note ? <p className="small muted">{note}</p> : null}
            <button className="btn ghost small" onClick={() => setPick(false)}>닫기</button>
          </>
        )}
      </section>
      <section className="td-card">
        <p className="eyebrow">이어서 하기</p>
        <ul className="td-cont">
          {rows.map((r) => <li key={r.label}>
            <span className="td-cont-k">{r.label}</span>
            {r.last ? <button className="td-cont-b" onClick={r.last.open} title={r.last.note}><span className="td-cont-t">{r.last.title}</span><small className="muted">{ago(r.last.at)} · {r.last.note}</small></button>
              : <button className="td-cont-b" onClick={r.to}><span className="td-cont-t muted">아직 없음</span><small className="muted">{r.empty}</small></button>}
          </li>)}
        </ul>
      </section>
    </div>
  );
}
