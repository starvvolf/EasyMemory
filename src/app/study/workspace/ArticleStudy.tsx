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
  map?: ArticleMapView;
};
/** 글 지도 (2026-10-29): 읽기 전에 보는 질문·흐름·핵심, 그리고 모르는 것만 고르는 개념어. */
export type ArticleMapView = {
  genre: string; question: string; flow: string[]; consider: string[];
  ideas: Array<{ title: string; body: string; ask?: string; id: string }>;
  terms: Array<{ name: string; line: string; have: "new" | "met" | "known"; id?: string }>;
  termIds: string[];
};
const GENRE: Record<string, string> = { concept: "개념 설명", case: "사례·설계", opinion: "주장·칼럼", news: "소식", other: "글" };

/**
 * 글 지도: 이 글이 답하는 질문과 흐름을 먼저 보고(훑어보기), 핵심을 확인하고, 개념어는 모르는 것만 눌러 지식으로 남긴다.
 * 이미 아는 말(✓)은 누를 필요가 없다.
 */
export function ArticleMap({ source, onChanged }: { source: SourceView; onChanged: (s: SourceView) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const map = source.map;
  if (!map) return null;
  const picked = new Set(map.termIds);
  type Term = ArticleMapView["terms"][number];
  const isPicked = (t: Term) => Boolean(t.id && picked.has(t.id));
  const toggle = async (t: Term) => {
    setBusy(t.name); setError("");
    try { onChanged((await call<{ source: SourceView }>(`/api/knowledge/source/${source.id}/terms`, { names: [t.name], on: !isPicked(t) })).source); }
    catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  };
  // 개념어는 "이름 — 이 글에서의 뜻"으로 늘 보이게 (A 10/29: 마우스를 올려야 보이면 고르기 어렵고 태블릿에선 안 보임).
  // 모르는 것을 고르기 쉽게 아는 것(✓)은 뒤로, 처음엔 8개만.
  const terms = [...map.terms].sort((x, y) => Number(x.have === "known") - Number(y.have === "known"));
  const shown = all ? terms : terms.slice(0, 8);
  const known = terms.filter((t) => t.have === "known");
  const againIdeas = map.ideas.filter((x) => source.againIds.includes(x.id));
  return (
    <div className="am stack">
      <div className="am-head"><span className="chip">{GENRE[map.genre] ?? "글"}</span><p className="am-q">{map.question}</p></div>
      {map.flow.length ? <ol className="am-flow">{map.flow.map((f, i) => <li key={i}>{f}</li>)}</ol> : null}
      <div><p className="eyebrow">이 글의 핵심 {map.ideas.length}</p>
        <ul className="am-ideas">{map.ideas.map((x) => <li key={x.id}><b>{x.title}{source.againIds.includes(x.id) ? <span className="am-again">이미 있던 지식</span> : null}</b><span>{x.body}</span></li>)}</ul></div>
      <div className="stack">
        <p className="eyebrow">개념어 {terms.length} · 모르는 것만 눌러 주세요</p>
        <ul className="am-terms">{shown.map((t) => (
          <li key={t.name}><button className={`am-term ${t.have}${isPicked(t) ? " on" : ""}`} disabled={t.have === "known" || busy === t.name} aria-pressed={isPicked(t)} onClick={() => void toggle(t)}>
            <span className="am-mark" aria-hidden>{t.have === "known" ? "✓" : isPicked(t) ? "＋" : ""}</span>
            <b>{t.name}</b><span className="am-line">{t.line}</span>{t.have === "met" ? <span className="am-tag">만난 적 있음</span> : t.have === "known" ? <span className="am-tag">아는 말</span> : null}
          </button></li>))}</ul>
        {terms.length > 8 ? <button className="linkish small am-more" onClick={() => setAll(!all)}>{all ? "접기" : `나머지 ${terms.length - 8}개 보기`}</button> : null}
        <p className="small muted">누른 말은 ‘몰랐음’으로 지식창에 들어가 복습에 나와요{map.termIds.length ? ` · 지금 ${map.termIds.length}개 골랐어요` : ""}. 다시 누르면 빠져요.
          {known.length || againIdeas.length ? ` 이미 아는 것: ${[...againIdeas.map((x) => x.title), ...known.map((t) => t.name)].join(", ")}.` : ""}</p>
      </div>
      {map.consider.length ? <details className="ws-fold"><summary>생각해 볼 점 {map.consider.length}</summary><ul className="small am-consider">{map.consider.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <p className="small muted">글에 없는 AI의 의견이에요. 글의 내용과 따로 봐 주세요.</p></details> : null}
      <GoalPlace source={source} />
      {error ? <p className="ws-err">{error}</p> : null}
    </div>
  );
}

/** 목표·기한에 넣기 (웹 글은 기한이 보통 없어 접어 둔다): 이 글을 목표에 넣으면 이 글의 지식이 그 목표로 따라간다. */
function GoalPlace({ source }: { source: SourceView }) {
  const [goals, setGoals] = useState<Array<{ id: string; name: string; closed: boolean }> | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const load = async () => { try { setGoals((await call<{ goals: Array<{ id: string; name: string; closed: boolean }> }>("/api/knowledge/goals")).goals.filter((g) => !g.closed)); } catch { setGoals([]); } };
  const put = async (goalId: string, label: string) => {
    try { await call(`/api/knowledge/goals/${goalId}/source`, { kind: "web", title: source.title, ...(source.url ? { url: source.url } : {}), on: true }); setNote(`‘${label}’ 목표에 넣었어요. 기한은 일정에서 정할 수 있어요.`); }
    catch (e) { setNote(errorText(e)); }
  };
  return (
    <details className="ws-fold" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !goals) void load(); }}><summary>목표·기한에 넣기 (시험이나 수업 자료라면)</summary>
      <div className="row small">
        {goals?.length ? <select className="ws-select" value="" aria-label="목표에 넣기" onChange={(e) => { const g = goals.find((x) => x.id === e.target.value); if (g) void put(g.id, g.name); }}>
          <option value="">있는 목표에…</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select> : null}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void call<{ goal: { id: string } }>("/api/knowledge/goals", { name: name.trim() }).then((r) => put(r.goal.id, name.trim())).catch((err) => setNote(errorText(err))); }}>
          <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="새 목표 이름" maxLength={60} /><button className="btn small" disabled={!name.trim()}>만들어 넣기</button></form>
      </div>
      {note ? <p className="small muted">{note}</p> : null}
    </details>
  );
}

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
      const ideaIds = new Set(source.map?.ideas.map((x) => x.id) ?? []);
      const pick = source.map ? source.items.filter((i) => goal === "chains" ? ideaIds.has(i.id) : source.map!.termIds.includes(i.id))
        : source.items.filter((i) => goal === "chains" ? chainTitles.has(i.title) : !chainTitles.has(i.title) || source.items.every((x) => chainTitles.has(x.title)));
      const questions: Question[] = [];
      for (const item of pick.slice(0, 10)) {
        const qs = (await call<{ questions: Question[] }>(`/api/knowledge/item/${item.id}/questions`)).questions;
        const want = goal === "chains" ? qs.find((q) => q.kind === "blank") ?? (source.map ? qs[0] : undefined) : qs.find((q) => q.kind === "choice") ?? qs[0];
        if (want) questions.push(want);
      }
      setRun({ title: goal === "chains" ? (source.map ? "핵심 확인" : "고리 빈칸") : "용어 확인", questions });
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
          const locked = (g === "recognize" && !source.againIds.length) || (g === "terms" && Boolean(source.map) && !source.map!.termIds.length);
          return (
            <button key={g} className={`ag-goal${source.goals[g].done ? " done" : ""}`} disabled={locked} onClick={() => void quiz(g)}>
              <span className="ag-goal-n num">{source.goals[g].done ? "✓" : n + 1}</span>
              <span className="ag-goal-t">{source.goalText[g]}</span>
              <span className="small muted">{locked ? (g === "terms" ? "모르는 개념어를 고르면 열려요" : "예전 지식이 나오면 열려요") : g === "claim" ? "한 줄 쓰기" : g === "recognize" ? "알아보기" : g === "chains" ? (source.map ? "핵심 문제" : "빈칸") : "객관식"}</span>
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
