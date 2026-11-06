"use client";
// 일정 = 공부 기록 (2026-11-06 사용자 "할 일이랑 기한 빼고 그냥 뭐 했는지 기록만 남기고, 위에는 이번 주에 뭐 했는지,
// 밑에는 GitHub 잔디처럼 바둑알 붙여서"): 할 일·기한 화면은 뺐다(API와 데이터는 그대로 둔다). 위는 이번 주 요일별 시간과
// 한 일(맞힘·틀림·새 지식·도움, 공부한 자료), 아래는 지난 20주 날마다 공부한 시간을 칸 색으로.
import { useCallback, useEffect, useState } from "react";
import { call, errorText, later } from "./api";

type Session = { id: string; start: string; end: string; minutes: number; label: string };
type Studied = { kind: string; title: string; n: number; last: string };
type Week = {
  start: string; today: string;
  days: Array<{ date: string; minutes: number; auto?: number; sessions: Session[] }>;
  did?: { correct: number; wrong: number; met: number; help: number };
  studied?: Studied[];
  grass?: Array<{ date: string; minutes: number }>;
};
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const KIND: Record<string, string> = { pdf: "PDF", web: "웹 글", code: "알고리즘", project: "실습", manual: "직접", review: "복습" };
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minutes = (m: number) => m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;
const level = (m: number) => (m <= 0 ? 0 : m < 15 ? 1 : m < 40 ? 2 : m < 90 ? 3 : 4);

export default function PlanView() {
  const [week, setWeek] = useState<Week | null>(null);
  const [start, setStart] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setWeek(await call<Week>(`/api/schedule/week${start ? `?start=${start}` : ""}`)); } catch (e) { setError(errorText(e)); }
  }, [start]);
  useEffect(() => later(() => void load()), [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener("recaller:timer-changed", on); window.addEventListener("recaller:timer-changed-plan", on);
    return () => { window.removeEventListener("recaller:timer-changed", on); window.removeEventListener("recaller:timer-changed-plan", on); };
  }, [load]);
  if (!week) return <div className="panel small muted">{error || "기록을 읽는 중…"}</div>;
  // 직접 넣은·타이머 시간과 기록으로 센 시간 중 큰 쪽 (겹칠 수 있어서 더하지 않는다)
  const shownOf = (d: { minutes: number; auto?: number }) => Math.max(d.minutes, d.auto ?? 0);
  const max = Math.max(60, ...week.days.map(shownOf));
  const total = week.days.reduce((s, d) => s + shownOf(d), 0);
  const thisWeek = !start;
  const did = week.did ?? { correct: 0, wrong: 0, met: 0, help: 0 };
  const grass = week.grass ?? [];
  return (
    <div className="pl stack">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>공부 기록</h2><p className="small muted num">{thisWeek ? "이번 주" : `${Number(week.start.slice(5, 7))}/${Number(week.start.slice(8))} 주`} 공부 {minutes(total)}</p></div>
        <div className="row"><button className="btn ghost small" onClick={() => setStart(addDays(week.start, -7))}>← 지난주</button>{!thisWeek ? <button className="btn ghost small" onClick={() => setStart(undefined)}>이번 주</button> : null}
          {!thisWeek ? <button className="btn ghost small" onClick={() => setStart(addDays(week.start, 7))}>다음 주 →</button> : null}</div>
      </header>
      {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}

      <section className="pl-week" aria-label="요일별 공부 시간">
        {week.days.map((d, i) => (
          <div key={d.date} className={`pl-day${d.date === week.today ? " pl-now" : ""}`}>
            <div className="pl-day-head"><b>{DOW[i]}</b><span className="small muted num">{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}</span></div>
            <div className="pl-bar" title={`기록으로 센 시간 ${d.auto ?? 0}분 · 타이머·직접 넣은 시간 ${d.minutes}분`}><i style={{ height: `${Math.round((shownOf(d) / max) * 100)}%` }} /></div>
            <span className="small num pl-min">{shownOf(d) ? minutes(shownOf(d)) : "–"}</span>
          </div>
        ))}
      </section>

      <section className="panel stack pl-did" aria-label="이번 주 한 일">
        <div className="pl-stats">
          <span><b className="num">{did.correct}</b><small>맞힘</small></span>
          <span><b className="num">{did.wrong}</b><small>틀림</small></span>
          <span><b className="num">{did.met}</b><small>새 기억</small></span>
          <span><b className="num">{did.help}</b><small>힌트·질문</small></span>
        </div>
        {week.studied?.length ? (
          <ul className="pl-studied">{week.studied.map((s) => (
            <li key={`${s.kind}:${s.title}`}><span className="chip">{KIND[s.kind] ?? s.kind}</span><span className="pl-st-title">{s.kind === "review" ? "기억 복습" : s.title}</span><span className="small muted num">{s.n}번 · {Number(s.last.slice(5, 7))}/{Number(s.last.slice(8, 10))}</span></li>))}
          </ul>
        ) : <p className="small muted">이 주에는 기록이 없어요.</p>}
      </section>

      <Board grass={grass} today={week.today} />
    </div>
  );
}

/** 20주 기록판 (2026-11-06 사용자 "잔디 중앙정렬하고 까리하게"): 바둑판 위의 돌. 칸 = 하루, 진할수록 오래. 위는 달, 왼쪽은 요일. */
function Board({ grass, today }: { grass: Array<{ date: string; minutes: number }>; today: string }) {
  const weeks: Array<typeof grass> = [];
  for (let i = 0; i < grass.length; i += 7) weeks.push(grass.slice(i, i + 7));
  const active = grass.filter((g) => g.minutes > 0 && g.date <= today);
  const totalMin = active.reduce((n, g) => n + g.minutes, 0);
  const best = active.reduce<{ date: string; minutes: number } | null>((b, g) => (!b || g.minutes > b.minutes ? g : b), null);
  let streak = 0;
  for (let i = grass.findIndex((g) => g.date === today); i >= 0; i--) { if (grass[i].minutes > 0) streak++; else if (grass[i].date !== today) break; }
  const mon = (d: string) => Number(d.slice(5, 7));
  const month = (w: typeof grass, i: number) => (i === 0 || mon(w[0].date) !== mon(weeks[i - 1][0].date) ? `${mon(w[0].date)}월` : "");
  return (
    <section className="panel pl-board-card" aria-label="20주 공부 기록">
      <div className="pl-board-head">
        <div><b>20주 기록</b><p className="small muted">하루에 돌 하나 · 오래 공부한 날일수록 진해요</p></div>
        <div className="pl-board-stats">
          <span><b className="num">{active.length}</b><small>공부한 날</small></span>
          <span><b className="num">{streak}</b><small>연속</small></span>
          <span><b className="num">{minutes(totalMin)}</b><small>모두</small></span>
        </div>
      </div>
      <div className="pl-board-wrap">
        <div className="pl-board" role="img" aria-label={`지난 20주 중 공부한 날 ${active.length}일, 연속 ${streak}일`}>
          <div className="pl-board-months" aria-hidden="true">{weeks.map((w, i) => <span key={w[0].date}>{month(w, i)}</span>)}</div>
          <div className="pl-board-days" aria-hidden="true">{["월", "", "수", "", "금", "", ""].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="pl-board-grid">
            {grass.map((g) => <i key={g.date} className={`s${g.date > today ? " future" : ` g${level(g.minutes)}`}${g.date === today ? " now" : ""}`}
              title={g.date > today ? g.date : `${Number(g.date.slice(5, 7))}월 ${Number(g.date.slice(8))}일 · ${g.minutes ? minutes(g.minutes) : "쉼"}`} />)}
          </div>
        </div>
      </div>
      <div className="pl-board-foot small muted">
        <span>{best ? `가장 오래 한 날 ${Number(best.date.slice(5, 7))}/${Number(best.date.slice(8))} · ${minutes(best.minutes)}` : "아직 기록이 없어요"}</span>
        <span className="pl-board-key"><span>적게</span>{[1, 2, 3, 4].map((n) => <i key={n} className={`s g${n}`} />)}<span>많이</span></span>
      </div>
    </section>
  );
}
