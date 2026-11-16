"use client";
// 실습 정리(11/16): 배운 것을 층(기본기 → A → B)으로 담백하게. 어렵거나 애매했던 개념만 플래시카드(기억 탭 카드 복습으로).
import { useEffect, useState } from "react";
import { call, errorText } from "../api";
import "./scene.css";

type Item = { name: string; learned: string; code: string; state: "확실" | "애매"; moments: number[]; card: { q: string; a: string; knowledgeId?: string } };
type Trace = { title: string; blocks: Array<{ file: string; code: string }>; cases: Array<{ situation: string; result: string }>; why: string };
type Notes = { made: string; traces?: Trace[]; layers: Array<{ name: string; items: Item[] }> };

export function PracticeNotes({ runId }: { runId: string }) {
  const [n, setN] = useState<{ at: string; notes: Notes } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  // 실습 뒤 복습(11/16 사용자 "갖다 붙여"): 열었는데 정리가 없으면 저절로 만든다(AI 1번). 한 번만.
  const [tried, setTried] = useState(false);
  useEffect(() => { let alive = true; void call<{ notes: { at: string; notes: Notes } | null }>(`/api/practice-notes?run=${encodeURIComponent(runId)}`).then((r) => alive && setN(r.notes)).catch((e) => alive && setErr(errorText(e))); return () => { alive = false; }; }, [runId]);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setSec(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t); }, [busy]);
  const make = async () => {
    setBusy(true); setSec(0); setErr("");
    try { setN((await call<{ notes: { at: string; notes: Notes } }>("/api/practice-notes", { runId })).notes); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (n !== null || tried || busy) return; const t = setTimeout(() => { setTried(true); void make(); }, 0); return () => clearTimeout(t); });
  const notes = n?.notes;
  const cards = (notes?.layers.reduce((k, l) => k + l.items.filter((x) => x.card?.q).length, 0) ?? 0) + (notes?.traces?.length ?? 0);
  return <section className="sc-gaps">
    <header className="sc-gapshead"><span className="rv-eyebrow">실습에서 배운 것</span><h3 className="rv-title">{notes?.made || "배운 것 정리"}</h3><span className="cs-gap" />
      {n !== undefined && !busy ? <button className="btn small" onClick={() => void make()}>{notes ? "다시 정리 (AI 1번)" : "배운 것 정리하기 (AI 1번)"}</button> : null}</header>
    {busy ? <div className="sc-card sc-making"><p><span className="sc-dots" aria-hidden="true"><i /><i /><i /></span> 실습 기록을 처음부터 따라가며 배운 것을 층으로 정리하는 중</p>
      <p className="small muted">{sec}초째 · 보통 1분 안팎이에요. 어렵거나 애매했던 개념은 플래시카드로 만들어 기억 탭 카드 복습에 넣어요.</p></div> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {notes && !busy ? <>
      {/* 11/16 사용자: 실습 복습은 세 칸 — 기본기 / 실습에서 쓴 개념(층) / 실습에서 만든 코드 읽고 따라가기. 코드를 쓰게 하지 않는다. */}
      <p className="small"><b>목차</b> {notes.layers.map((l) => `${l.name} (${l.items.length})`).join(" → ")}{cards ? <span className="muted"> · 복습 카드 {cards}장</span> : null}</p>
      {(() => { const basic = notes.layers.filter((l) => /기본기/.test(l.name)), rest = notes.layers.filter((l) => !/기본기/.test(l.name));
        const items = (x: Item, k: number) => <li key={k}>
          <div className="sc-gapline"><b>{x.name}</b>{x.state === "애매" ? <span className="sc-chip">애매</span> : null}</div>
          <p className="small">{x.learned}</p>
          {x.code ? <pre className="sc-code small">{x.code}</pre> : null}
          {x.card?.q ? <p className="small muted">🃏 {x.card.q}</p> : null}
        </li>;
        return <>
          {basic.length ? <div className="sc-layer"><p className="rv-eyebrow">① 기본기</p><ul className="sc-gaplist">{basic.flatMap((l) => l.items).map(items)}</ul></div> : null}
          {rest.length ? <div className="sc-layer"><p className="rv-eyebrow">② 실습에서 쓴 개념</p>
            {rest.map((l, i) => <div key={i}><p className="small"><b>{l.name}</b></p><ul className="sc-gaplist">{l.items.map(items)}</ul></div>)}</div> : null}
        </>; })()}
      {notes.traces?.length ? <div className="sc-layer"><p className="rv-eyebrow">③ 만든 코드 읽고 따라가기 · 이 상황이면 무엇이 나올까</p>
        {notes.traces.map((t, i) => <div key={i} className="sc-card">
          <p><b>{t.title}</b></p>
          {t.blocks.map((b, k) => <div key={k}><p className="small muted">{b.file}</p><pre className="sc-code small">{b.code}</pre></div>)}
          {t.cases.map((c, k) => <details key={k}><summary className="small">{c.situation} → ?</summary><p className="small"><b>{c.result}</b></p></details>)}
          <details><summary className="small muted">왜 그렇게 나오나</summary><p className="small">{t.why}</p></details>
        </div>)}</div> : null}
      <p className="small muted">카드는 기억 탭의 카드 복습에서 날짜에 맞춰 다시 나와요. </p>
      <p className="small muted">정리한 때 {new Date(n!.at).toLocaleString("ko-KR")}</p></> : null}
  </section>;
}
