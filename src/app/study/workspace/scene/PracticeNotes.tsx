"use client";
// 실습 정리(11/16, 11/20 교과서처럼): 장 도입 · 개념마다(정의 · 왜 · 어떻게 · 이 실습의 코드 · 이 실습에서는 · 기억할 것) · 한눈에 정리.
import { useEffect, useState } from "react";
import { call, errorText } from "../api";
import "./scene.css";

type Lesson = { title: string; concept: string; why?: string; how?: string; code?: string; codeNote?: string; principle?: string; inPractice: string; remember: string };
type Notes = { made: string; intro?: string; lessons: Lesson[]; summary?: { title: string; line: string }[] };

// 글 속 `이름`은 코드 글씨로, 코드 칸은 공통 들여쓰기를 걷어서(11/20 스샷 검수)
const inl = (t: string) => t.split(/(`[^`]+`)/g).map((x, i) => x.startsWith("`") && x.endsWith("`") && x.length > 2 ? <code key={i} className="pn-inl">{x.slice(1, -1)}</code> : x);
const dedent = (c: string) => { const ls = c.replace(/\t/g, "    ").split("\n"); const pad = Math.min(...ls.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length)); return ls.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join("\n"); };

export function PracticeNotes({ runId }: { runId: string }) {
  const [n, setN] = useState<{ at: string; notes: Notes } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  const make = async () => {
    setBusy(true); setSec(0); setErr("");
    try { setN((await call<{ notes: { at: string; notes: Notes } }>("/api/practice-notes", { runId })).notes); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  // 실습 뒤 복습(11/16 사용자 "갖다 붙여"): 열었는데 정리가 없으면 저절로 만든다(AI 1번). 한 번만.
  const [tried, setTried] = useState(false);
  // 만드는 중이면(다른 화면에 갔다 왔을 때) 새로 시작하지 않고 같은 작업을 기다린다
  useEffect(() => { let alive = true; void call<{ notes: { at: string; notes: Notes } | null; pending?: boolean }>(`/api/practice-notes?run=${encodeURIComponent(runId)}`)
    .then((r) => { if (!alive) return; if (r.pending && !r.notes) { setTried(true); void make(); } else setN(r.notes); }).catch((e) => alive && setErr(errorText(e))); return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setSec(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t); }, [busy]);
  useEffect(() => { if (n !== null || tried || busy) return; const t = setTimeout(() => { setTried(true); void make(); }, 0); return () => clearTimeout(t); });
  const notes = n?.notes;
  const go = (i: number) => document.getElementById(`pn-${runId}-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // 11/16 사용자: 가독성 좋게, 깔끔하게, 구분감 있게 — 목차 카드 하나 + 개념마다 카드 하나(무엇인가 → 원리 → 이 실습에서는 → 기억할 것)
  return <section className="pn">
    <header className="pn-head">
      <div><span className="rv-eyebrow">실습 다시 보기</span><h3 className="pn-made">{notes?.made || "배운 것 정리"}</h3></div>
      {n !== undefined && !busy ? <button className="btn small" onClick={() => void make()}>{notes ? "다시 정리 (AI 1번)" : "배운 것 정리하기 (AI 1번)"}</button> : null}
    </header>
    {busy ? <div className="pn-card pn-wait"><p><span className="sc-dots" aria-hidden="true"><i /><i /><i /></span> 실습 기록을 처음부터 따라가며 배운 개념을 정리하는 중</p>
      <p className="small muted">{sec}초째 · 보통 1분 안팎이에요. 다른 화면에 다녀와도 이어서 만들어요.</p></div> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {notes && !busy ? <>
      {notes.intro ? <p className="pn-card pn-intro">{inl(notes.intro)}</p> : null}
      <nav className="pn-card pn-toc" aria-label="배운 것 목차">
        <p className="pn-toclab">이번 실습에서 배운 것 {notes.lessons.length}가지</p>
        <ol>{notes.lessons.map((x, i) => <li key={i}><button type="button" onClick={() => go(i)}><span className="pn-num sm">{i + 1}</span>{x.title}</button></li>)}</ol>
      </nav>
      {notes.lessons.map((x, i) => <article key={i} id={`pn-${runId}-${i}`} className="pn-card pn-lesson">
        <header className="pn-lhead"><span className="pn-num">{i + 1}</span><h4>{x.title}</h4></header>
        {x.concept ? <div className="pn-box pn-def"><p className="pn-lab">정의</p><p className="pn-concept">{inl(x.concept)}</p></div> : null}
        {x.why ? <div className="pn-box pn-why"><p className="pn-lab">왜 필요한가</p><p className="pn-body">{inl(x.why)}</p></div> : null}
        {x.how ? <div className="pn-box pn-how"><p className="pn-lab">어떻게 동작하나</p><p className="pn-body pn-pre">{inl(x.how)}</p></div> : null}
        {x.principle ? <div className="pn-part"><p className="pn-lab">원리</p><p className="pn-body">{inl(x.principle)}</p></div> : null}
        {x.code ? <div className="pn-box pn-code"><p className="pn-lab">이 실습의 코드</p><pre><code>{dedent(x.code)}</code></pre>{x.codeNote ? <p className="pn-body pn-codenote">{inl(x.codeNote)}</p> : null}</div> : null}
        {x.inPractice ? <div className="pn-here"><p className="pn-lab">이 실습에서는</p><p className="pn-body">{inl(x.inPractice)}</p></div> : null}
        {x.remember ? <div className="pn-keep"><p className="pn-lab">기억할 것</p><p>{inl(x.remember)}</p></div> : null}
      </article>)}
      {notes.summary?.length ? <section className="pn-card pn-sum"><p className="pn-toclab">한눈에 정리</p>
        <table><tbody>{notes.summary.map((x, i) => <tr key={i}><th>{x.title}</th><td>{inl(x.line)}</td></tr>)}</tbody></table></section> : null}
      <p className="small muted pn-at">정리한 때 {new Date(n!.at).toLocaleString("ko-KR")}</p></> : null}
  </section>;
}
