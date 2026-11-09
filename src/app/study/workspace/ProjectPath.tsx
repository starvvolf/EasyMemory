"use client";
// 지나온 목표 길 (2026-11-09 사용자 "어떤 거에서 어떤 목표들을 거쳤는지 타임라인이 보이게"):
// 기억 탭 › 실습 한 줄을 펼치면, 그 실습(대화 실습 한 번)에서 거친 현재 목표를 차례로 보인다.
// 목표마다 결과(마침 · 건너뜀 · 너무 쉬움 · 멈춤 · 진행 중), 그 안의 일(판정 · 막힘 · 보충), 드러난 부족함과 그 뒤(다시 확인), 남긴 기억.
// runs: 실습 진행 id들(쉼표로). 자료는 코스 서버의 세션 노트(/api/project-course/runs/<id>/note). 코스 서버가 꺼져 있으면 그렇다고만 말한다.
import { useEffect, useState } from "react";
import { call, errorText, later } from "./api";

type Ev = { at: string; kind: string; text: string };
type PGoal = { title: string; at: string; endAt: string | null; result: string; events: Ev[]; gaps: Array<{ id: string; name: string; wrong: string; status: string }>; learned: string[] };
type Note = { online: boolean; missing?: boolean; runId?: string; title?: string; at?: string | null; path?: PGoal[] };

const RESULT_CLASS: Record<string, string> = { 마침: "ok", "너무 쉬움": "ok", 건너뜀: "skip", 멈춤: "skip", "진행 중": "now" };
const GAP_CLASS: Record<string, string> = { "다시 확인 맞음": "ok", "세션에서 채움": "ok", "다시 틀림": "bad", 열림: "bad", "채우는 중": "now" };
// 시각: 실습을 시작한 날과 같은 날이면 시:분만
// 부족했던 것 옆 표시: 그 뒤 어떻게 됐나
const GAP_LABEL: Record<string, string> = { "다시 확인 맞음": "채움 ✓", "세션에서 채움": "채움", "다시 틀림": "다시 틀림", 열림: "부족", "채우는 중": "채우는 중" };
const hm = (iso: string, base?: string | null) => { const d = new Date(iso), b = base ? new Date(base) : null; const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return b && b.toDateString() === d.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`; };
const mins = (a: string, b: string | null) => { if (!b) return ""; const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 1 ? "" : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };

// 맨 위 한 줄: 목표 몇 개를 거쳐 어떻게 됐고, 부족함이 몇 개 남았나
function summary(path: PGoal[]) {
  const n = (r: string) => path.filter((g) => g.result === r).length;
  const gaps = path.flatMap((g) => g.gaps), open = gaps.filter((x) => GAP_CLASS[x.status] === "bad" || GAP_CLASS[x.status] === "now").length;
  return [`목표 ${path.length}개`, n("마침") ? `마침 ${n("마침")}` : "", n("너무 쉬움") ? `쉬워서 넘김 ${n("너무 쉬움")}` : "", n("건너뜀") + n("멈춤") ? `덜 함 ${n("건너뜀") + n("멈춤")}` : "",
    gaps.length ? `부족함 ${gaps.length}${open ? `(아직 ${open})` : ""}` : ""].filter(Boolean).join(" · ");
}
// 목표 안에서 있었던 일: 막힘 · 보충 낱말만(무엇이었는지는 마우스를 올리면)
function Marks({ events }: { events: Ev[] }) {
  const has = (k: string) => events.filter((e) => e.kind === k);
  const xs = [["stuck", "막힘"], ["support", "보충"]].flatMap(([k, label]) => has(k).length ? [{ label, tip: has(k).map((e) => `${label}: ${e.text}`).join("\n") }] : []);
  return xs.length ? <span className="pp-marks">{xs.map((x) => <span key={x.label} title={x.tip}>{x.label}</span>)}</span> : null;
}

export default function ProjectPath({ runs }: { runs: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => {
    Promise.all(runs.split(",").filter(Boolean).map((id) => call<Note>(`/api/project-course/runs/${encodeURIComponent(id)}/note`).catch(() => ({ online: true, missing: true, runId: id, path: [] }) as Note)))
      .then(setNotes).catch((e) => setError(errorText(e)));
  }), [runs]);
  if (error) return <p className="ws-err">{error}</p>;
  if (!notes) return <p className="small muted">지나온 목표를 불러오는 중…</p>;
  if (notes.some((n) => !n.online)) return <p className="small muted">실습 서버가 꺼져 있어 지나온 목표를 못 불러왔어요. 실습 탭을 열면 켜져요.</p>;
  const shown = notes.filter((n) => n.path?.length);
  // 실습 진행 기록은 그 실습을 한 컴퓨터의 실습 서버에만 있다(기억은 데이터 동기화로 옮겨 와도)
  if (!shown.length) return <p className="small muted">{notes.every((n) => n.missing) ? "이 실습의 진행 기록이 이 컴퓨터에 없어요. 다른 컴퓨터에서 한 실습이면 그 컴퓨터에서 보여요." : "이 실습에는 목표 기록이 없어요(목표를 정하기 전에 끝났거나 예전 방식의 실습)."}</p>;
  return (
    <div className="pp">{shown.map((n) => (
      <section key={n.runId} className="pp-run">
        {shown.length > 1 || n.title ? <p className="eyebrow">{n.at ? `${hm(n.at)} · ` : ""}{n.title}</p> : null}
        <p className="pp-sum small muted">{summary(n.path!)}</p>
        <ol className="pp-goals">{n.path!.map((g, i) => {
          // 딱 보이게(11/10 사용자 "주절주절 붙이지 말고 어떤 흐름으로 공부했는데 뭐가 부족했구나"):
          // 한 줄 = 목표 · 결과 · 시간, 그 아래는 부족했던 것 이름만. 그 안의 일(이해 · 맞음 · 막힘 · 보충)은 작은 표시로, 글은 마우스를 올리면.
          const weak = g.gaps.length ? g.gaps.map((x) => ({ key: x.id, name: x.name, cls: GAP_CLASS[x.status] ?? "", label: GAP_LABEL[x.status] ?? "부족", tip: `${x.status}${x.wrong ? ` — ${x.wrong}` : ""}` }))
            : g.events.filter((e) => e.kind === "check" && / · 빠진 곳: /.test(e.text)).slice(-1).map((e, k) => ({ key: `c${k}`, name: e.text.split(" · 빠진 곳: ")[1], cls: "bad", label: "부족", tip: e.text }));
          return <li key={i} className={`pp-goal ${RESULT_CLASS[g.result] ?? ""}`}>
            <div className="pp-head">
              <span className="pp-dot" aria-hidden>{i + 1}</span>
              <span className="pp-title" title={g.title}>{g.title || "(이름 없는 목표)"}</span>
              <span className={`pp-res ${RESULT_CLASS[g.result] ?? ""}`}>{g.result}</span>
              <Marks events={g.events} />
              <span className="pp-when">{mins(g.at, g.endAt)}</span>
            </div>
            {weak.map((w) => <p key={w.key} className="pp-weak" title={w.tip}><span className={`pp-gap ${w.cls}`}>{w.label}</span> {w.name}</p>)}
          </li>;
        })}</ol>
      </section>
    ))}</div>
  );
}
