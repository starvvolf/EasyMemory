"use client";
// 타이머: a chip in the header that counts from the start time saved on the server — so a refresh, a sleeping tab or
// another device shows the same time. Stopwatch or 뽀모도로 (25 / 50분); at the end of a 뽀모도로 it chimes and says so.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, later } from "./api";

type Timer = { running: boolean; startedAt: string | null; carriedMs: number; label: string; mode: "stopwatch" | "pomodoro"; targetMin: number; elapsedMs: number; now: string };
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`; };

function chime() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2); o.start(); o.stop(ctx.currentTime + 1.3);
  } catch { /* no sound */ }
}

export default function TimerChip() {
  const [t, setT] = useState<Timer | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"stopwatch" | "pomodoro">("stopwatch");
  const [target, setTarget] = useState(25);
  const [note, setNote] = useState("");
  const rung = useRef<string | null>(null);
  const load = useCallback(async () => {
    try { const x = await call<Timer>("/api/schedule/timer"); const at = Date.now(); setSkew(at - Date.parse(x.now)); setNow(at); setT(x); } catch { /* local only */ }
  }, []);
  useEffect(() => { const first = later(() => void load()); const on = () => void load(); window.addEventListener("recaller:timer-changed", on); window.addEventListener("focus", on); const poll = setInterval(on, 30_000);
    return () => { first(); window.removeEventListener("recaller:timer-changed", on); window.removeEventListener("focus", on); clearInterval(poll); }; }, [load]);
  useEffect(() => { if (!t?.running) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [t?.running]);
  const elapsed = t ? t.carriedMs + (t.running && t.startedAt && now ? Math.max(0, now - skew - Date.parse(t.startedAt)) : 0) : 0;
  const left = t?.mode === "pomodoro" ? t.targetMin * 60_000 - elapsed : null;
  useEffect(() => {
    if (left !== null && left <= 0 && t?.running && rung.current !== t.startedAt) {
      rung.current = t.startedAt; chime();
      setNote(`뽀모도로 ${t.targetMin}분이 끝났어요. 멈추면 공부 시간으로 저장돼요.`); setOpen(true);
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("Recaller", { body: `${t.label || "공부"} ${t.targetMin}분 끝` }); } catch { /* none */ }
    }
  }, [left, t]);
  const act = async (path: string, body: unknown = {}) => {
    setNote("");
    try { const r = await call<Timer & { saved?: { minutes: number } | null; minutes?: number }>(`/api/schedule/timer/${path}`, body);
      if (path === "stop") setNote(r.saved ? `${r.saved.minutes}분을 공부 시간으로 저장했어요.` : "1분이 안 돼서 저장하지 않았어요.");
      await load(); window.dispatchEvent(new Event("recaller:timer-changed-plan"));
    } catch (e) { setNote(errorText(e)); }
  };
  const running = Boolean(t?.running), paused = Boolean(t && !t.running && t.carriedMs > 0);
  return (
    <div className="tm">
      <button className={`tablet-btn tm-chip${running ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} title="타이머">
        ⏱ {running || paused ? <span className="num">{left !== null ? (left > 0 ? clock(left) : `+${clock(-left)}`) : clock(elapsed)}</span> : "타이머"}
      </button>
      {open ? (
        <div className="tm-card" role="dialog" aria-label="타이머">
          {running || paused ? (
            <>
              <p className="tm-big num">{left !== null ? (left > 0 ? clock(left) : `+${clock(-left)}`) : clock(elapsed)}</p>
              <p className="small muted">{t?.label || "공부"} · {t?.mode === "pomodoro" ? `뽀모도로 ${t.targetMin}분` : "스톱워치"}{paused ? " · 멈춤" : ""}</p>
              <div className="row">{running ? <button className="btn small" onClick={() => void act("pause")}>잠깐 멈춤</button> : <button className="btn small" onClick={() => void act("start")}>이어서</button>}
                <button className="btn primary small" onClick={() => void act("stop")}>끝내고 저장</button></div>
            </>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void act("start", { label, mode, targetMin: target }); if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined); }}>
              <input className="ws-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="무엇을 공부하나요? (선택)" />
              <div className="ws-seg">{(["stopwatch", "pomodoro"] as const).map((m) => <button type="button" key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "stopwatch" ? "스톱워치" : "뽀모도로"}</button>)}</div>
              {mode === "pomodoro" ? <div className="ws-seg">{[25, 50].map((n) => <button type="button" key={n} className={target === n ? "on" : ""} onClick={() => setTarget(n)}>{n}분</button>)}</div> : null}
              <button className="btn primary small">시작</button>
            </form>
          )}
          {note ? <p className="small">{note}</p> : null}
          <p className="small muted">새로 고침해도, 다른 기기에서 열어도 시간이 이어져요.</p>
        </div>
      ) : null}
    </div>
  );
}
