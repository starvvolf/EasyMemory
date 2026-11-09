"use client";
// 지나온 목표 길 (2026-11-09 사용자 "어떤 거에서 어떤 목표들을 거쳤는지 타임라인이 보이게"):
// 기억 탭 › 실습 한 줄을 펼치면, 그 실습(대화 실습 한 번)에서 거친 현재 목표를 차례로 보인다.
// 목표마다 결과(마침 · 건너뜀 · 너무 쉬움 · 멈춤 · 진행 중), 그 안의 일(판정 · 막힘 · 보충), 드러난 부족함과 그 뒤(다시 확인), 남긴 기억.
// runs: 실습 진행 id들(쉼표로). 자료는 코스 서버의 세션 노트(/api/project-course/runs/<id>/note). 코스 서버가 꺼져 있으면 그렇다고만 말한다.
import { useEffect, useState } from "react";
import { call, errorText, later, type ItemLite } from "./api";

type Ev = { at: string; kind: string; text: string };
type PGoal = { title: string; at: string; endAt: string | null; result: string; events: Ev[]; gaps: Array<{ id: string; name: string; wrong: string; status: string }>; learned: string[] };
type Note = { online: boolean; missing?: boolean; runId?: string; title?: string; at?: string | null; path?: PGoal[] };

const EV: Record<string, string> = { understood: "💡", check: "🧪", applied: "✅", stuck: "🧱", easy: "⏭", support: "🪜", "support-done": "·", back: "↩", refine: "✎" };
const RESULT_CLASS: Record<string, string> = { 마침: "ok", "너무 쉬움": "ok", 건너뜀: "skip", 멈춤: "skip", "진행 중": "now" };
const GAP_CLASS: Record<string, string> = { "다시 확인 맞음": "ok", "세션에서 채움": "ok", "다시 틀림": "bad", 열림: "bad", "채우는 중": "now" };
const hm = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const mins = (a: string, b: string | null) => { if (!b) return ""; const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 1 ? "" : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };

export default function ProjectPath({ runs, items, onPick }: { runs: string; items: ItemLite[]; onPick: (id: string) => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => {
    Promise.all(runs.split(",").filter(Boolean).map((id) => call<Note>(`/api/project-course/runs/${encodeURIComponent(id)}/note`).catch(() => ({ online: true, missing: true, runId: id, path: [] }) as Note)))
      .then(setNotes).catch((e) => setError(errorText(e)));
  }), [runs]);
  if (error) return <p className="ws-err">{error}</p>;
  if (!notes) return <p className="small muted">지나온 목표를 불러오는 중…</p>;
  if (notes.some((n) => !n.online)) return <p className="small muted">실습 서버가 꺼져 있어 지나온 목표를 못 불러왔어요. 실습 탭을 열면 켜져요.</p>;
  const byTitle = new Map(items.map((i) => [i.title, i.id]));
  const shown = notes.filter((n) => n.path?.length);
  // 실습 진행 기록은 그 실습을 한 컴퓨터의 실습 서버에만 있다(기억은 데이터 동기화로 옮겨 와도)
  if (!shown.length) return <p className="small muted">{notes.every((n) => n.missing) ? "이 실습의 진행 기록이 이 컴퓨터에 없어요. 다른 컴퓨터에서 한 실습이면 그 컴퓨터에서 보여요." : "이 실습에는 목표 기록이 없어요(목표를 정하기 전에 끝났거나 예전 방식의 실습)."}</p>;
  return (
    <div className="pp">{shown.map((n) => (
      <section key={n.runId} className="pp-run">
        {shown.length > 1 || n.title ? <p className="eyebrow">{n.at ? `${hm(n.at)} · ` : ""}{n.title}</p> : null}
        <ol className="pp-goals">{n.path!.map((g, i) => (
          <li key={i} className={`pp-goal ${RESULT_CLASS[g.result] ?? ""}`}>
            <div className="pp-head">
              <span className="pp-dot" aria-hidden>{i + 1}</span>
              <span className="pp-title">{g.title || "(이름 없는 목표)"}</span>
              <span className={`pp-res ${RESULT_CLASS[g.result] ?? ""}`}>{g.result}</span>
            </div>
            <p className="pp-when small muted">{hm(g.at)}{mins(g.at, g.endAt) ? ` · ${mins(g.at, g.endAt)}` : ""}</p>
            {g.events.length ? <ul className="pp-evs">{g.events.map((e, k) => (
              <li key={k} className={`pp-ev ${e.kind}`}><span aria-hidden>{EV[e.kind] ?? "·"}</span> {e.kind === "stuck" ? `막힘: ${e.text}` : e.kind === "support" ? `보충: ${e.text}` : e.kind === "check" ? `판정: ${e.text}` : e.text}</li>
            ))}</ul> : null}
            {g.gaps.length ? <ul className="pp-gaps">{g.gaps.map((x) => (
              <li key={x.id}><span className={`pp-gap ${GAP_CLASS[x.status] ?? ""}`}>{x.status}</span> <b>{x.name}</b>{x.wrong ? <span className="muted"> — {x.wrong}</span> : null}</li>
            ))}</ul> : null}
            {g.learned.length ? <p className="pp-learned small">남긴 기억: {g.learned.map((c, k) => {
              const id = byTitle.get(c);
              return <span key={k}>{k ? " · " : ""}{id ? <button className="linkish small" onClick={() => onPick(id)}>{c}</button> : c}</span>;
            })}</p> : null}
          </li>
        ))}</ol>
      </section>
    ))}</div>
  );
}
