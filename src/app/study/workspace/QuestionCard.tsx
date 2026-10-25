"use client";
// 문제 블록: one look for every question from knowledge — the same chip ("객관식", "주관식", "OX", "빈칸", "플래시카드",
// "알아보기"), the prompt, the answer area by kind, then the result with its explanation. Grading goes to the server,
// which also writes the result into the knowledge record.
import { useState } from "react";
import { call, errorText, type Graded, type Question } from "./api";
import { Rich } from "./Rich";

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
      <p className="ws-q-prompt">{question.prompt}</p>
      {question.kind === "flashcard" ? (
        !shown ? <button className="btn" onClick={() => setShown(true)}>뜻 보기</button> : (
          <>
            <div className="ws-q-back"><Rich text={question.answer} /></div>
            {!result ? <div className="row"><button className="btn primary small" disabled={busy} onClick={() => submit("knew")}>알았어요</button><button className="btn small" disabled={busy} onClick={() => submit("didnt")}>몰랐어요</button></div> : null}
          </>
        )
      ) : question.options ? (
        <div className={`ws-opts${question.kind === "ox" ? " ox" : ""}`} role="group">
          {question.options.map((o, i) => <button key={o} className={optionClass(o)} disabled={busy || Boolean(result)} onClick={() => submit(o)}>{question.kind === "ox" ? null : <span className="k">{i + 1}</span>}<span>{o}</span></button>)}
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
          {!result.correct && question.kind !== "flashcard" ? <span> · 정답: {result.expected}</span> : null}
          {result.note ? <span className="muted"> · {result.note}</span> : null}
          {question.explain && !(question.kind === "flashcard") ? <div className="small muted">{question.explain}</div> : null}
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
  if (!questions.length) return <div className="panel small muted">낼 문제가 없어요. 지식에 설명을 적거나 고리를 이으면 문제가 생겨요. <button className="btn ghost small" onClick={onClose}>닫기</button></div>;
  const done = i >= questions.length;
  return (
    <section className="panel ws-run">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{title ?? "확인 문제"}</b>
        <span className="small muted num">{Math.min(i + 1, questions.length)} / {questions.length}</span>
        <button className="btn ghost small" onClick={onClose}>그만하기</button>
      </div>
      {done ? (
        <div className="stack"><p><b>{questions.length}문제 중 {score.right}개 맞혔어요.</b></p><p className="small muted">결과는 각 지식의 기록에 남았어요. 틀린 것은 몰랐음이 되어 복습에 먼저 나와요.</p>
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
