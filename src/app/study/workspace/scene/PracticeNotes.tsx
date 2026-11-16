"use client";
// 실습 정리(11/16): 그 실습에서 배운 개념과 원리를 강의하듯 담백하게 다시 들려주는 복습 글(코드 조각은 없음).
import { useEffect, useState } from "react";
import { call, errorText } from "../api";
import "./scene.css";

type Lesson = { title: string; concept: string; principle: string; inPractice: string; remember: string };
type Notes = { made: string; lessons: Lesson[] };

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
  return <section className="sc-gaps">
    <header className="sc-gapshead"><span className="rv-eyebrow">실습 다시 보기</span><h3 className="rv-title">{notes?.made || "배운 것 정리"}</h3><span className="cs-gap" />
      {n !== undefined && !busy ? <button className="btn small" onClick={() => void make()}>{notes ? "다시 정리 (AI 1번)" : "배운 것 정리하기 (AI 1번)"}</button> : null}</header>
    {busy ? <div className="sc-card sc-making"><p><span className="sc-dots" aria-hidden="true"><i /><i /><i /></span> 실습 기록을 처음부터 따라가며 배운 개념을 정리하는 중</p>
      <p className="small muted">{sec}초째 · 보통 1분 안팎이에요.</p></div> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {notes && !busy ? <>
      {/* 11/16 사용자: 어렵게 가지 말고 배운 개념 · 원리를 강의식으로 담백하게 — 코드 조각은 앞뒤 없이 보면 알기 어려워 뺌 */}
      <ol className="sc-steps">{notes.lessons.map((x, i) => <li key={i} className="sc-card">
        <p className="rv-eyebrow">{i + 1}강</p>
        <h4>{x.title}</h4>
        {x.concept ? <p>{x.concept}</p> : null}
        {x.principle ? <p>{x.principle}</p> : null}
        {x.inPractice ? <p className="small"><b>이 실습에서는</b> {x.inPractice}</p> : null}
        {x.remember ? <p className="small"><b>기억할 것</b> {x.remember}</p> : null}
      </li>)}</ol>
      <p className="small muted">정리한 때 {new Date(n!.at).toLocaleString("ko-KR")}</p></> : null}
  </section>;
}
