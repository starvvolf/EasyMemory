"use client";
// 일정: 이번 주 시간표(공부한 시간, 할 일, 기한), 할 일, 기한. 기한을 넣을 때는 먼저 "시험이나 기한이 있나요?"를 묻고,
// 있으면 그날까지 날짜별로 나눠 할 일을 만든다. 없으면 복습 간격대로 간다.
// 2026-10-28 "4개 축": 시험·마감은 목표의 날짜다. 목표를 고르면 그 목표에 날짜가 붙고 그 목표의 지식으로 나눈다.
import { useCallback, useEffect, useState } from "react";
import { call, errorText, folderPaths, later, type GoalView, type Tree } from "./api";

type Session = { id: string; start: string; end: string; minutes: number; label: string };
type Todo = { id: string; text: string; date: string | null; done: boolean; origin: "user" | "schedule" | "agent"; deadlineId: string | null };
type Deadline = { id: string; title: string; date: string; folderId: string | null; goalId?: string | null; amount: number; unit: string };
type Week = { start: string; today: string; days: Array<{ date: string; minutes: number; sessions: Session[]; todos: Todo[]; deadlines: Deadline[] }>; undated: Todo[]; upcoming: Deadline[] };
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hm = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const dleft = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
const minutes = (m: number) => m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;

export default function PlanView() {
  const [week, setWeek] = useState<Week | null>(null);
  const [start, setStart] = useState<string | undefined>(undefined);
  const [tree, setTree] = useState<Tree>({ folders: [], items: [] });
  const [error, setError] = useState("");
  const [todo, setTodo] = useState({ text: "", date: "" });
  const load = useCallback(async () => {
    try { setWeek(await call<Week>(`/api/schedule/week${start ? `?start=${start}` : ""}`)); setTree(await call<Tree>("/api/knowledge")); } catch (e) { setError(errorText(e)); }
  }, [start]);
  useEffect(() => later(() => void load()), [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener("recaller:timer-changed", on); window.addEventListener("recaller:timer-changed-plan", on);
    return () => { window.removeEventListener("recaller:timer-changed", on); window.removeEventListener("recaller:timer-changed-plan", on); };
  }, [load]);
  const act = async (run: () => Promise<unknown>) => { setError(""); try { await run(); await load(); } catch (e) { setError(errorText(e)); } };
  if (!week) return <div className="panel small muted">{error || "일정을 읽는 중…"}</div>;
  const max = Math.max(60, ...week.days.map((d) => d.minutes));
  const total = week.days.reduce((s, d) => s + d.minutes, 0);
  return (
    <div className="pl stack">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>일정</h2><p className="small muted num">이번 주 공부 {minutes(total)}</p></div>
        <div className="row"><button className="btn ghost small" onClick={() => setStart(addDays(week.start, -7))}>← 지난주</button><button className="btn ghost small" onClick={() => setStart(undefined)}>이번 주</button><button className="btn ghost small" onClick={() => setStart(addDays(week.start, 7))}>다음 주 →</button></div>
      </header>
      {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}
      {week.upcoming.length ? <div className="row">{week.upcoming.slice(0, 4).map((d) => { const n = dleft(d.date, week.today); return <span key={d.id} className={`chip ${n <= 3 ? "bad" : "help"}`}>{d.title} {n === 0 ? "오늘" : `D-${n}`}</span>; })}</div> : null}

      <section className="pl-week" aria-label="주간 시간표">
        {week.days.map((d, i) => (
          <div key={d.date} className={`pl-day${d.date === week.today ? " today" : ""}`}>
            <div className="pl-day-head"><b>{DOW[i]}</b><span className="small muted num">{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}</span></div>
            <div className="pl-bar" title={`${d.minutes}분`}><i style={{ height: `${Math.round((d.minutes / max) * 100)}%` }} /></div>
            <span className="small num pl-min">{d.minutes ? minutes(d.minutes) : "–"}</span>
            {d.deadlines.map((x) => <span key={x.id} className="chip bad pl-dl">{x.title}</span>)}
            <ul className="pl-sessions">{d.sessions.map((s) => <li key={s.id} className="small">{hm(s.start)}–{hm(s.end)} {s.label}</li>)}</ul>
            <ul className="pl-todos">{d.todos.map((t) => <li key={t.id}><label className="small"><input type="checkbox" checked={t.done} onChange={() => void act(() => call(`/api/schedule/todos/${t.id}`, { done: !t.done }, "PATCH"))} /> <span className={t.done ? "pl-done" : ""}>{t.text}</span></label></li>)}</ul>
          </div>
        ))}
      </section>

      <div className="pl-grid">
        <section className="panel stack">
          <b>할 일</b>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (todo.text.trim()) void act(() => call("/api/schedule/todos", { text: todo.text, date: todo.date || null })).then(() => setTodo({ text: "", date: "" })); }}>
            <input className="ws-input" value={todo.text} onChange={(e) => setTodo({ ...todo, text: e.target.value })} placeholder="할 일 (예: 바킹독 0x12 읽기)" />
            <input className="ws-input pl-date" type="date" value={todo.date} onChange={(e) => setTodo({ ...todo, date: e.target.value })} aria-label="날짜" />
            <button className="btn small" disabled={!todo.text.trim()}>추가</button>
          </form>
          {week.undated.length ? <ul className="pl-todos">{week.undated.map((t) => <li key={t.id} className="row"><label className="small"><input type="checkbox" checked={t.done} onChange={() => void act(() => call(`/api/schedule/todos/${t.id}`, { done: !t.done }, "PATCH"))} /> {t.text}</label>
            <button className="kw-x" aria-label="지우기" onClick={() => void act(() => call(`/api/schedule/todos/${t.id}`, undefined, "DELETE"))}>×</button></li>)}</ul> : <p className="small muted">날짜 없는 할 일이 없어요. 날짜가 있는 할 일은 위 시간표에 보여요.</p>}
          <ManualSession onDone={load} />
        </section>
        <Deadlines tree={tree} week={week} onAct={act} />
      </div>
    </div>
  );
}

function ManualSession({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ start: "", minutes: 60, label: "" });
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>공부한 시간 직접 넣기</button>;
  return (
    <form className="row small" onSubmit={async (e) => { e.preventDefault(); await call("/api/schedule/sessions", { start: new Date(v.start).toISOString(), minutes: v.minutes, label: v.label }); setOpen(false); await onDone(); }}>
      <input className="ws-input" type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required aria-label="시작" />
      <input className="ws-input pl-num" type="number" min={1} max={1440} value={v.minutes} onChange={(e) => setV({ ...v, minutes: Number(e.target.value) })} aria-label="분" /> 분
      <input className="ws-input" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="무엇을" />
      <button className="btn small" disabled={!v.start}>넣기</button><button type="button" className="btn ghost small" onClick={() => setOpen(false)}>취소</button>
    </form>
  );
}

function Deadlines({ tree, week, onAct }: { tree: Tree; week: Week; onAct: (run: () => Promise<unknown>) => Promise<void> }) {
  const [step, setStep] = useState<"" | "ask" | "form" | "none">("");
  const blank = { title: "", date: "", scope: "", amount: 0, unit: "쪽" };
  const [f, setF] = useState(blank);
  const [list, setList] = useState<Deadline[]>([]);
  const [goals, setGoals] = useState<GoalView[]>([]);
  const load = useCallback(async () => {
    try { setList((await call<{ deadlines: Deadline[] }>("/api/schedule/deadlines")).deadlines); } catch { setList([]); }
    try { setGoals((await call<{ goals: GoalView[] }>("/api/knowledge/goals")).goals.filter((g) => !g.closed)); } catch { setGoals([]); }
  }, []);
  useEffect(() => later(() => void load()), [load, week]);
  const paths = folderPaths(tree.folders);
  const goal = f.scope.startsWith("goal:") ? goals.find((g) => g.id === f.scope.slice(5)) : undefined;
  const folderId = f.scope.startsWith("folder:") ? f.scope.slice(7) : "";
  const scoped = Boolean(goal || folderId);
  const send = () => call("/api/schedule/deadlines", goal ? { goalId: goal.id, date: f.date, plan: true }
    : { title: f.title, date: f.date, folderId: folderId || null, amount: folderId ? 0 : f.amount, unit: f.unit, plan: true });
  return (
    <section className="panel stack">
      <b>기한</b>
      {step === "" ? <button className="btn small" onClick={() => setStep("ask")}>+ 공부 목표 넣기</button> : null}
      {step === "ask" ? (
        <div className="stack"><p>시험이나 기한이 있나요?</p>
          <div className="row"><button className="btn primary small" onClick={() => setStep("form")}>있어요</button><button className="btn small" onClick={() => setStep("none")}>없어요</button></div></div>
      ) : null}
      {step === "none" ? <div className="stack"><p className="small">기한이 없으면 따로 나누지 않고, 복습 간격대로 ‘오늘 할 것’과 지식창의 복습에서 나와요.</p><button className="btn ghost small" onClick={() => setStep("")}>알겠어요</button></div> : null}
      {step === "form" ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void onAct(send).then(() => { setStep(""); setF(blank); void load(); }); }}>
          <label className="row small">무엇의 기한인가요
            <select className="ws-select" value={f.scope} onChange={(e) => { const g = goals.find((x) => `goal:${x.id}` === e.target.value); setF({ ...f, scope: e.target.value, date: g?.date ?? f.date }); }}>
              <option value="">목표 없이 분량으로 적기</option>
              {goals.length ? <optgroup label="목표 (그 목표의 지식으로 나눠요)">{goals.map((g) => <option key={g.id} value={`goal:${g.id}`}>{g.name} · 지식 {g.counts.total}개{g.date ? ` · ${g.date}` : ""}</option>)}</optgroup> : null}
              {paths.length ? <optgroup label="주제">{paths.map((p) => <option key={p.id} value={`folder:${p.id}`}>{p.path}</option>)}</optgroup> : null}
            </select></label>
          {!goal ? <input className="ws-input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="이름 (예: 한국사 중간고사)" required /> : null}
          <label className="row small">날짜 <input className="ws-input pl-date" type="date" value={f.date} min={week.today} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          {goal ? <p className="small muted">‘{goal.name}’ 목표의 날짜가 {f.date || "이 날"}로 바뀌어요. 지식창의 목표 카드에도 D-day가 떠요.</p> : null}
          {!scoped ? <label className="row small">분량 <input className="ws-input pl-num" type="number" min={1} max={1000} value={f.amount || ""} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} required />
            <select className="ws-select" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{["쪽", "강", "장", "문제", "단원"].map((u) => <option key={u}>{u}</option>)}</select></label> : null}
          <p className="small muted">기한 전날까지 날짜별로 나눠 할 일로 넣고, 마지막 날은 전체 훑기와 약한 것 몰아 보기로 잡아요.</p>
          <div className="row"><button className="btn primary small">날짜별로 나누기</button><button type="button" className="btn ghost small" onClick={() => setStep("")}>취소</button></div>
        </form>
      ) : null}
      <ul className="pl-dls">{list.map((d) => { const n = dleft(d.date, week.today); return (
        <li key={d.id} className="row"><span className={`chip ${n < 0 ? "" : n <= 3 ? "bad" : "help"}`}>{n < 0 ? "지남" : n === 0 ? "오늘" : `D-${n}`}</span><b>{d.title}</b><span className="small muted">{d.date}{d.goalId ? " · 목표" : d.folderId ? ` · ${paths.find((p) => p.id === d.folderId)?.path ?? "폴더"}` : d.amount ? ` · ${d.amount}${d.unit}` : ""}</span>
          {n > 0 ? <button className="btn ghost small" onClick={() => void onAct(() => call(`/api/schedule/deadlines/${d.id}/schedule`, {}))}>다시 나누기</button> : null}
          <button className="kw-x" aria-label={d.goalId ? "목표에서 날짜 빼기" : "기한 지우기"} title={d.goalId ? "목표와 지식은 남고 날짜만 빠져요" : undefined} onClick={() => void onAct(async () => { await call(`/api/schedule/deadlines/${d.id}`, undefined, "DELETE"); await load(); })}>×</button></li>); })}</ul>
    </section>
  );
}
