"use client";
// 웹 글 하나 공부하기: 이 글의 지식(예전에 배운 것 / 새로 만난 것), 고리, 그리고 목표 넷(용어 / 주장 / 고리 / 다른 글에서
// 알아보기)을 문제로 확인. Used by the 공부 → 웹 글 screen and by the Chrome extension's side panel.
import { useState } from "react";
import { call, errorText, type Question } from "./api";
import { QuestionRun } from "./QuestionCard";
import { StateChip } from "./KnowledgeWindow";

export type GoalId = "terms" | "claim" | "chains" | "recognize";
export type SourceView = {
  id: string; title: string; url: string; readAt?: string; claim: { text: string; basis: string[] }; chains: Array<{ from: string; relation: string; to: string }>;
  againIds: string[]; knowledgeIds: string[]; goals: Record<GoalId, { done: boolean; note?: string }>; goalText: Record<GoalId, string>;
  items: Array<{ id: string; title: string; state: "met" | "unknown" | "known"; graduated: boolean; again: boolean; quote: string }>;
};
const GOALS: GoalId[] = ["terms", "claim", "chains", "recognize"];

export function ArticleKnowledge({ source }: { source: SourceView }) {
  const again = source.items.filter((i) => i.again), fresh = source.items.filter((i) => !i.again);
  return (
    <div className="stack">
      {again.length ? <div className="ext-again"><b className="small">예전에 배운 것 {again.length}</b>
        <ul className="sb-list">{again.map((i) => <li key={i.id} className="sb-item"><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></li>)}</ul></div> : null}
      <div><b className="small">새로 만난 것 {fresh.length}</b>
        <ul className="sb-list">{fresh.map((i) => <li key={i.id} className="sb-item"><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></li>)}</ul></div>
      {source.chains.length ? <details className="ws-fold"><summary>고리 {source.chains.length}</summary>
        <ul className="kw-links small">{source.chains.map((c, k) => <li key={k}>{c.from} <span className="muted">—{c.relation}→</span> {c.to}</li>)}</ul></details> : null}
    </div>
  );
}

export function ArticleGoals({ source, onChanged }: { source: SourceView; onChanged: (s: SourceView) => void }) {
  const [run, setRun] = useState<{ title: string; questions: Question[] } | null>(null);
  const [claim, setClaim] = useState("");
  const [claimOpen, setClaimOpen] = useState(false);
  const [result, setResult] = useState<{ verdict: string; feedback: string; claim: { text: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => onChanged((await call<{ source: SourceView }>(`/api/knowledge/source/${source.id}`)).source);
  const quiz = async (goal: GoalId) => {
    setError("");
    try {
      if (goal === "claim") { setClaimOpen(true); return; }
      if (goal === "recognize") { const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/source/${source.id}/recognize`); setRun({ title: "다른 글에서 알아보기", questions }); return; }
      const chainTitles = new Set(source.chains.flatMap((c) => [c.from, c.to]));
      const pick = source.items.filter((i) => goal === "chains" ? chainTitles.has(i.title) : !chainTitles.has(i.title) || source.items.every((x) => chainTitles.has(x.title)));
      const questions: Question[] = [];
      for (const item of pick.slice(0, 10)) {
        const qs = (await call<{ questions: Question[] }>(`/api/knowledge/item/${item.id}/questions`)).questions;
        const want = goal === "chains" ? qs.find((q) => q.kind === "blank") : qs.find((q) => q.kind === "choice") ?? qs[0];
        if (want) questions.push(want);
      }
      setRun({ title: goal === "chains" ? "고리 빈칸" : "용어 확인", questions });
    } catch (e) { setError(errorText(e)); }
  };
  const check = async () => {
    if (!claim.trim()) return;
    setBusy(true); setError("");
    try { setResult(await call("/api/knowledge/claim", { sourceId: source.id, answer: claim })); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const done = GOALS.filter((g) => source.goals[g].done).length;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}><b>잘 읽었는지 확인</b><span className="small muted num">{done} / 4 달성</span></div>
      <div className="ag-goals">
        {GOALS.map((g, n) => {
          const locked = g === "recognize" && !source.againIds.length;
          return (
            <button key={g} className={`ag-goal${source.goals[g].done ? " done" : ""}`} disabled={locked} onClick={() => void quiz(g)}>
              <span className="ag-goal-n num">{source.goals[g].done ? "✓" : n + 1}</span>
              <span className="ag-goal-t">{source.goalText[g]}</span>
              <span className="small muted">{locked ? "예전 지식이 나오면 열려요" : g === "claim" ? "한 줄 쓰기" : g === "recognize" ? "알아보기" : g === "chains" ? "빈칸" : "객관식"}</span>
            </button>
          );
        })}
      </div>
      {claimOpen ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <label className="small muted" htmlFor={`claim-${source.id}`}>글을 덮고, 이 글의 주장을 한 줄로 써 보세요.</label>
          <textarea id={`claim-${source.id}`} className="ws-input" rows={2} value={claim} onChange={(e) => setClaim(e.target.value)} />
          <div className="row"><button className="btn primary small" disabled={!claim.trim() || busy}>{busy ? "확인 중…" : "확인"}</button><button type="button" className="btn ghost small" onClick={() => setClaimOpen(false)}>닫기</button></div>
        </form>
      ) : null}
      {result ? <div className={`ws-q-result ${result.verdict === "맞음" ? "good" : "bad"}`}><b>{result.verdict}</b> · {result.feedback}<div className="small muted">글의 주장: {result.claim.text}</div></div> : null}
      {error ? <p className="ws-err">{error}</p> : null}
      {run ? <QuestionRun title={run.title} questions={run.questions} sourceId={source.id} onClose={() => { setRun(null); void refresh(); }} /> : null}
    </div>
  );
}
