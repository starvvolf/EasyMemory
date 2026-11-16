"use client";
// 실습 정리(11/16): 그 실습의 메인 빌드를 단계마다 "무엇을 위해 → 어떻게"로 친절하게 다시 들려주는 복습 글.
import { useEffect, useState } from "react";
import { call, errorText } from "../api";
import "./scene.css";

type Step = { title: string; why: string; how: string; code: Array<{ file: string; code: string }>; remember: string };
type Notes = { made: string; steps: Step[] };

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
    {busy ? <div className="sc-card sc-making"><p><span className="sc-dots" aria-hidden="true"><i /><i /><i /></span> 실습 기록을 처음부터 따라가며 만든 과정을 단계별로 정리하는 중</p>
      <p className="small muted">{sec}초째 · 보통 1분 안팎이에요.</p></div> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {notes && !busy ? <>
      {/* 11/16 사용자: 메인 빌드만, 무엇을 위해 어떻게 했는지 친절하게 — 실습 내용을 다시 따라가는 복습 */}
      <ol className="sc-steps">{notes.steps.map((x, i) => <li key={i} className="sc-card">
        <p className="rv-eyebrow">{i + 1}단계</p>
        <h4>{x.title}</h4>
        {x.why ? <p className="small"><b>무엇을 위해</b> {x.why}</p> : null}
        {x.how ? <p><b>어떻게</b> {x.how}</p> : null}
        {x.code.map((c, k) => <div key={k}>{c.file ? <p className="small muted">{c.file}</p> : null}<pre className="sc-code small">{c.code}</pre></div>)}
        {x.remember ? <p className="small"><b>기억할 것</b> {x.remember}</p> : null}
      </li>)}</ol>
      <p className="small muted">정리한 때 {new Date(n!.at).toLocaleString("ko-KR")}</p></> : null}
  </section>;
}
