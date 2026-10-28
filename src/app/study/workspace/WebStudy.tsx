"use client";
// 공부 → 웹 글: articles read with the Chrome extension or pasted here, each with its knowledge and its four goals.
import { useCallback, useEffect, useState } from "react";
import { call, errorText, go, handoff, later } from "./api";
import { ArticleGoals, ArticleKnowledge, ArticleMap, type GoalId, type SourceView } from "./ArticleStudy";

type SourceLite = { id: string; kind: string; title: string; url: string; readAt: string; againIds: string[]; knowledgeIds: string[]; goals: Record<GoalId, { done: boolean }> };

export default function WebStudy() {
  const [list, setList] = useState<SourceLite[] | null>(null);
  const [open, setOpen] = useState<SourceView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setList((await call<{ sources: SourceLite[] }>("/api/knowledge/sources")).sources); } catch (e) { setError(errorText(e)); } }, []);
  const show = useCallback(async (id: string) => { try { setOpen((await call<{ source: SourceView }>(`/api/knowledge/source/${id}`)).source); } catch (e) { setError(errorText(e)); } }, []);
  useEffect(() => later(() => { void load(); if (handoff.webId) { void show(handoff.webId); handoff.webId = undefined; } }), [load, show]);
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (id) void show(id); };
    window.addEventListener("recaller:web-open", on);
    return () => window.removeEventListener("recaller:web-open", on);
  }, [show]);

  if (open) return (
    <div className="stack ws-narrow">
      <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => { setOpen(null); void load(); }}>← 웹 글 목록</button>
      <section className="panel stack">
        <h2 className="ws-title">{open.title}</h2>
        {open.url ? <a className="small" href={open.url} target="_blank" rel="noreferrer">원문 열기 ↗</a> : null}
        <details className="ws-fold"><summary>이 글의 요지 보기</summary><p>{open.claim.text}</p>{open.claim.basis.length ? <ul className="small muted">{open.claim.basis.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}</details>
      </section>
      {open.map ? <section className="panel"><ArticleMap source={open} onChanged={setOpen} /></section> : null}
      <section className="panel"><ArticleGoals source={open} onChanged={setOpen} /></section>
      <section className="panel stack"><b>이 글의 지식</b><ArticleKnowledge source={open} /></section>
    </div>
  );
  return (
    <div className="stack ws-narrow">
      {error ? <p className="ws-err">{error}</p> : null}
      {list && !list.length ? (
        <section className="panel ws-empty">
          <b>아직 읽은 웹 글이 없어요</b>
          <p className="small muted">칼럼이나 블로그 글을 읽으면서 크롬 확장(Recaller 사이드바)을 켜면 여기에 쌓여요. 확장이 없으면 글을 붙여 넣어 시작할 수도 있어요.</p>
          <button className="btn primary small" onClick={() => go("start", { kind: "web" })}>글 붙여 넣기</button>
        </section>
      ) : null}
      <ul className="cs-list">
        {(list ?? []).map((s) => {
          const done = (Object.values(s.goals) as Array<{ done: boolean }>).filter((g) => g.done).length;
          return (
            <li key={s.id}><button className="cs-row" onClick={() => void show(s.id)}>
              <span className="ws-dots" aria-label={`목표 ${done}/4`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < done ? "on" : ""} />)}</span>
              <span className="cs-title">{s.title}</span>
              {s.againIds.length ? <span className="chip read">예전 지식 {s.againIds.length}</span> : null}
              <span className="small muted">지식 {s.knowledgeIds.length} · {new Date(s.readAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</span>
            </button></li>
          );
        })}
      </ul>
    </div>
  );
}
