"use client";
// 문제 블록: one look for every question from knowledge — the same chip ("객관식", "주관식", "OX", "빈칸", "플래시카드",
// "알아보기"), the prompt, the answer area by kind, then the result with its explanation. Grading goes to the server,
// which also writes the result into the knowledge record.
import { useState } from "react";
import { call, errorText, type Graded, type Question } from "./api";
import { Inline, Rich } from "./Rich";

export function QuestionCard({ question, sourceId, onDone, compact }: { question: Question; sourceId?: string; onDone?: (g: Graded) => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [result, setResult] = useState<Graded | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (answer: string) => {
    if (busy || result) return;
    setBusy(true); setError(""); setPicked(answer);
    try { const g = await call<Graded>("/api/knowledge/grade", { question, answer, ...(sourceId ? { sourceId } : {}) }); setResult(g); onDone?.(g); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const optionClass = (o: string) => !result ? (picked === o ? "ws-opt on" : "ws-opt") : o === question.answer ? "ws-opt is-correct" : o === picked ? "ws-opt is-wrong" : "ws-opt";
  return (
    <article className={`ws-q${compact ? " compact" : ""}`} aria-live="polite">
      <div className="ws-q-head"><span className="chip">{question.label}</span></div>
      {question.context ? <blockquote className="ws-q-context">{question.context}</blockquote> : null}
      <p className="ws-q-prompt"><Inline text={question.prompt} /></p>
      {question.kind === "flashcard" ? (
        !shown ? <button className="btn" onClick={() => setShown(true)}>뜻 보기</button> : (
          <>
            <div className="ws-q-back"><Rich text={question.answer} /></div>
            {!result ? <div className="row"><button className="btn primary small" disabled={busy} onClick={() => submit("knew")}>알았어요</button><button className="btn small" disabled={busy} onClick={() => submit("didnt")}>몰랐어요</button></div> : null}
          </>
        )
      ) : question.options ? (
        <div className={`ws-opts${question.kind === "ox" ? " ox" : ""}`} role="group">
          {question.options.map((o, i) => <button key={o} className={optionClass(o)} disabled={busy || Boolean(result)} onClick={() => submit(o)}>{question.kind === "ox" ? null : <span className="k">{i + 1}</span>}<span><Inline text={o} /></span></button>)}
        </div>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) submit(text); }}>
          <input className="ws-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="답을 적어요" disabled={Boolean(result)} autoFocus={!compact} />
          <button className="btn primary small" disabled={busy || !text.trim() || Boolean(result)}>확인</button>
        </form>
      )}
      {result ? (
        <div className={`ws-q-result ${result.correct ? "good" : "bad"}`}>
          <b>{question.kind === "flashcard" ? (result.correct ? "알았어요 → 앎" : "몰랐어요 → 몰랐음") : result.correct ? "맞았어요" : "틀렸어요"}</b>
          {!result.correct && question.kind !== "flashcard" ? <span> · 정답: <Inline text={result.expected} /></span> : null}
          {result.note ? <span className="muted"> · {result.note}</span> : null}
          {question.explain && !(question.kind === "flashcard") ? <div className="small muted"><Inline text={question.explain} /></div> : null}
        </div>
      ) : null}
      {error ? <p className="ws-err">{error}</p> : null}
    </article>
  );
}

/** A run of questions, one at a time, with a score at the end. */
export function QuestionRun({ questions, sourceId, onClose, title }: { questions: Question[]; sourceId?: string; onClose: () => void; title?: string }) {
  const [i, setI] = useState(0);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const [answered, setAnswered] = useState(false);
  if (!questions.length) return <div className="panel small muted">낼 문제가 없어요. 기억에 설명을 적거나 고리를 이으면 문제가 생겨요. <button className="btn ghost small" onClick={onClose}>닫기</button></div>;
  const done = i >= questions.length;
  return (
    <section className="panel ws-run">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{title ?? "확인 문제"}</b>
        <span className="small muted num">{Math.min(i + 1, questions.length)} / {questions.length}</span>
        <button className="btn ghost small" onClick={onClose}>그만하기</button>
      </div>
      {done ? (
        <div className="stack"><p><b>{questions.length}문제 중 {score.right}개 맞혔어요.</b></p><p className="small muted">결과는 각 기억의 기록에 남았어요. 틀린 것은 몰랐음이 되어 복습에 먼저 나와요.</p>
          <div className="row"><button className="btn primary small" onClick={onClose}>닫기</button></div></div>
      ) : (
        <>
          <QuestionCard key={questions[i].id} question={questions[i]} sourceId={sourceId} onDone={(g) => { setScore((s) => ({ right: s.right + (g.correct ? 1 : 0), done: s.done + 1 })); setAnswered(true); }} />
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn small" disabled={!answered} onClick={() => { setI(i + 1); setAnswered(false); }}>{i + 1 < questions.length ? "다음" : "끝"}</button></div>
        </>
      )}
    </section>
  );
}

/**
 * 문제 목록 (2026-11-05, 사용자 "지식탭에서 문제 풀어보기 누르면 문제 목록 나오게"): the questions laid out first, so the
 * learner picks which to solve. A row opens its question in place; the mark (맞음/틀림) stays on the row. Grading and the
 * record are the same as one at a time (QuestionCard).
 */
const KIND_ORDER: Question["kind"][] = ["choice", "ox", "blank", "short", "flashcard", "recognize"];
export function QuestionList({ questions, title, note, nameOf, onClose, onRunAll }: { questions: Question[]; title: string; note?: string; nameOf: (knowledgeId: string) => string; onClose: () => void; onRunAll: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<Question["kind"] | "all">("all");
  const kinds = KIND_ORDER.filter((k) => questions.some((q) => q.kind === k));
  const labelOf = (k: Question["kind"]) => questions.find((q) => q.kind === k)?.label ?? k;
  const shown = kind === "all" ? questions : questions.filter((q) => q.kind === kind);
  const done = Object.keys(marks).length, right = Object.values(marks).filter(Boolean).length;
  return (
    <section className="panel ql">
      <header className="ql-top">
        <div><b>{title}</b><p className="small muted num">{questions.length}문제{done ? ` · ${done}개 풂 · ${right}개 맞힘` : " · 풀고 싶은 문제를 눌러요"}</p></div>
        <div className="row"><button className="btn primary small" onClick={onRunAll}>처음부터 차례로 풀기</button><button className="btn ghost small" onClick={onClose}>닫기</button></div>
      </header>
      {note ? <p className="small muted ql-note">{note}</p> : null}
      {kinds.length > 1 ? (
        <div className="ws-seg ql-kinds" role="group" aria-label="문제 형식">
          <button aria-pressed={kind === "all"} onClick={() => setKind("all")}>전체 {questions.length}</button>
          {kinds.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{labelOf(k)} {questions.filter((q) => q.kind === k).length}</button>)}
        </div>
      ) : null}
      <ol className="ql-list">
        {shown.map((q) => {
          const n = questions.indexOf(q) + 1, mark = marks[q.id], isOpen = open === q.id;
          return (
            <li key={q.id} className={`ql-row${isOpen ? " open" : ""}${mark === true ? " good" : mark === false ? " bad" : ""}`}>
              <button className="ql-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : q.id)}>
                <span className="ql-n num">{n}</span>
                <span className="chip">{q.label}</span>
                <span className="ql-text"><span className="ql-name">{nameOf(q.knowledgeId)}</span><span className="ql-prompt"><Inline text={q.prompt} /></span></span>
                <span className="ql-mark">{mark === true ? "맞음" : mark === false ? "틀림" : isOpen ? "닫기" : "풀기"}</span>
              </button>
              {isOpen ? <div className="ql-body"><QuestionCard question={q} compact onDone={(g) => setMarks((m) => ({ ...m, [q.id]: g.correct }))} /></div> : null}
            </li>
          );
        })}
      </ol>
      {done ? <p className="small muted">결과는 각 기억의 기록에 남았어요. 틀린 것은 몰랐음이 되어 복습에 먼저 나와요.</p> : null}
    </section>
  );
}
