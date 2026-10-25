"use client";
// 지식 사이드바: the 지식창 made small, always at the right edge of the app. It shows what relates to the screen in view
// (the material or problem open now), lets the learner look an item up, ask "이거 ○○이랑 연결돼?" with their knowledge
// as context, and take one check question — without leaving what they are doing.
import { useCallback, useEffect, useState } from "react";
import { call, errorText, go, later, type Detail, type ItemLite, type Question, type ScreenContext, type Tree } from "./api";
import { QuestionCard } from "./QuestionCard";
import { StateChip } from "./KnowledgeWindow";
import { Rich } from "./Rich";

type Answer = { answer: string; link: { from: string; to: string; relation: string } };

export default function KnowledgeSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [context, setContext] = useState<ScreenContext | null>(null);
  const [related, setRelated] = useState<ItemLite[]>([]);
  const [recent, setRecent] = useState<ItemLite[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ItemLite[] | null>(null);
  const [sel, setSel] = useState<Detail | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setContext((e as CustomEvent<ScreenContext>).detail);
    window.addEventListener("recaller:context", on);
    return () => window.removeEventListener("recaller:context", on);
  }, []);
  const loadRelated = useCallback(async () => {
    if (!open) return;
    try {
      const fromRefs = context?.refs.length ? (await call<{ items: ItemLite[] }>(`/api/knowledge/related?prefix=1&${context.refs.slice(0, 20).map((r) => `ref=${encodeURIComponent(r)}`).join("&")}`)).items : [];
      const { items } = await call<Tree>("/api/knowledge");
      const byId = new Map(items.map((i) => [i.id, i]));
      const fromIds = (context?.knowledgeIds ?? []).map((id) => byId.get(id)).filter(Boolean) as ItemLite[];
      const merged = [...fromIds, ...fromRefs.filter((i) => !fromIds.some((x) => x.id === i.id))];
      setRelated(merged.sort((a, b) => (a.state === "unknown" ? -1 : 0) - (b.state === "unknown" ? -1 : 0) || b.weak - a.weak).slice(0, 30));
      setRecent([...items].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 8));
    } catch (e) { setError(errorText(e)); }
  }, [open, context]);
  useEffect(() => later(() => void loadRelated()), [loadRelated]);
  const pick = useCallback(async (id: string) => { setQuestion(null); try { setSel(await call<Detail>(`/api/knowledge/item/${id}`)); } catch (e) { setError(errorText(e)); } }, []);
  useEffect(() => {
    const on = () => { void loadRelated(); if (sel) void pick(sel.item.id); };
    window.addEventListener("recaller:knowledge-changed-sidebar", on);
    return () => window.removeEventListener("recaller:knowledge-changed-sidebar", on);
  }, [loadRelated, pick, sel]);
  useEffect(() => {
    return later(() => { if (!query.trim()) { setHits(null); return; } call<{ hits: ItemLite[] }>(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=12`).then((r) => setHits(r.hits)).catch(() => setHits([])); }, query.trim() ? 160 : 0);
  }, [query]);
  // A selection made on the page looks itself up.
  useEffect(() => later(() => { if (context?.selection && context.selection.length <= 40) setQuery(context.selection); }), [context?.selection]);

  const oneQuestion = async () => {
    if (!sel) return;
    const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/item/${sel.item.id}/questions`);
    setQuestion(questions[questions.length > 1 ? 1 + Math.floor(Math.random() * (questions.length - 1)) : 0]);
  };
  const send = async () => {
    if (!ask.trim() || busy) return;
    setBusy(true); setError(""); setAnswer(null); setLinked(false);
    try {
      const focusIds = [...(sel ? [sel.item.id] : []), ...related.slice(0, 4).map((r) => r.id)].slice(0, 6);
      setAnswer(await call<Answer>("/api/knowledge/ask", { question: ask, focusIds, context: context ? `${context.view} · ${context.title}${context.text ? `\n${context.text.slice(0, 2000)}` : ""}` : "" }));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const addLink = async () => {
    if (!answer?.link.from) return;
    try {
      const [a, b] = await Promise.all([answer.link.from, answer.link.to].map(async (t) => (await call<{ hits: ItemLite[] }>(`/api/knowledge/search?q=${encodeURIComponent(t)}&limit=1`)).hits[0]));
      if (!a || !b) throw new Error("이을 지식을 찾지 못했어요.");
      await call("/api/knowledge/link", { from: a.id, to: b.id, relation: answer.link.relation });
      setLinked(true);
      window.dispatchEvent(new Event("recaller:knowledge-changed"));
    } catch (e) { setError(errorText(e)); }
  };

  const list = hits ?? related;
  return (
    <aside className="sb" hidden={!open} aria-label="지식 사이드바">
      <div className="sb-head"><b>지식</b><div className="row"><button className="btn ghost small" onClick={() => go("knowledge")}>지식창</button><button className="btn ghost small" aria-label="닫기" onClick={onClose}>✕</button></div></div>
      <input className="ws-input" type="search" placeholder="지식 찾기" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="사이드바 지식 찾기" />
      {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}

      {sel ? (
        <section className="sb-card">
          <div className="row" style={{ justifyContent: "space-between" }}><StateChip state={sel.item.state} graduated={sel.item.graduated} /><button className="btn ghost small" onClick={() => setSel(null)}>목록</button></div>
          <h4>{sel.item.title}</h4>
          <p className="small muted">{sel.path || "폴더 없음"}</p>
          {sel.item.body ? <Rich text={sel.item.body} className="small" /> : <p className="small muted">설명이 아직 없어요.</p>}
          {sel.links.length || sel.backlinks.length ? <ul className="sb-links small">
            {sel.backlinks.map((l) => <li key={`b${l.item.id}`}><button className="linkish" onClick={() => void pick(l.item.id)}>{l.item.title}</button> —{l.relation}→ 이것</li>)}
            {sel.links.map((l) => <li key={`f${l.item.id}`}>이것 —{l.relation}→ <button className="linkish" onClick={() => void pick(l.item.id)}>{l.item.title}</button></li>)}</ul> : null}
          <p className="small muted num">맞힘 {sel.item.stats.correct} · 틀림 {sel.item.stats.wrong} · 힌트 {sel.item.stats.hint} · 물어봄 {sel.item.stats.asked}</p>
          <div className="row"><button className="btn small" onClick={() => void oneQuestion()}>확인 문제</button><button className="btn ghost small" onClick={() => { go("knowledge"); window.setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:knowledge-focus", { detail: { id: sel.item.id } })), 50); }}>자세히</button></div>
          {question ? <QuestionCard key={question.id} question={question} compact onDone={() => window.dispatchEvent(new Event("recaller:knowledge-changed"))} /> : null}
        </section>
      ) : (
        <section>
          <p className="eyebrow">{hits ? `찾은 것 ${hits.length}` : context?.title ? `지금 화면: ${context.title.slice(0, 30)}` : "지금 화면과 관련된 지식"}</p>
          {!list.length ? <p className="small muted">{hits ? "찾은 지식이 없어요." : "이 화면과 이어진 지식이 아직 없어요."}</p> : null}
          <ul className="sb-list">{list.map((i) => <li key={i.id}><button className="sb-item" onClick={() => void pick(i.id)}><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></button></li>)}</ul>
          {!hits && recent.length ? <><p className="eyebrow">최근</p><ul className="sb-list">{recent.map((i) => <li key={i.id}><button className="sb-item" onClick={() => void pick(i.id)}><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></button></li>)}</ul></> : null}
        </section>
      )}

      <section className="sb-ask">
        <p className="eyebrow">물어보기</p>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea className="ws-input" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={sel ? `"${sel.item.title}"이랑 연결돼?` : "이거 전에 배운 거랑 연결돼?"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <button className="btn primary small" disabled={busy || !ask.trim()}>{busy ? "생각하는 중…" : "묻기"}</button>
        </form>
        {answer ? <div className="sb-answer"><Rich text={answer.answer} className="small" />
          {answer.link.from && answer.link.to ? <div className="row small"><span className="muted">고리 제안: {answer.link.from} —{answer.link.relation}→ {answer.link.to}</span>{linked ? <span className="chip good">이었어요</span> : <button className="btn small" onClick={() => void addLink()}>잇기</button>}</div> : null}</div> : null}
      </section>
    </aside>
  );
}
