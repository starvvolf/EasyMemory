"use client";
// 공부 · 실습 (2026-10-30, D 스레드; 11/6 세로 목록으로 바꿈, 사용자): 직접 만들며 배우는 프로젝트 코스(experiments/project-course)를 공부 탭에서 잇는다.
// 만들기는 VS Code에서(오른쪽 Recaller 튜터 탭), 여기서는 이어 하기 · 노트 · 배운 것을 지식에 넣기.
// 배운 것은 이 화면이 열려 있는 동안 저절로 지식에 들어간다(/api/project-course/sync, 1분마다).
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, go, later } from "./api";

type RunLite = { id: string; courseTitle: string; stageTitle: string; current: number; done: number; workspace: string | null; createdAt: string };
type Status = { online: boolean; url: string; runs: RunLite[]; active?: string | null; starting?: boolean; error?: string };
type Synced = { online: boolean; runs: Array<{ runId: string; items: number; created: number; events: number; error?: string }> };

export default function ProjectStudy() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [synced, setSynced] = useState<{ at: Date; items: number; created: number; events: number } | null>(null);
  const syncing = useRef(false);

  const load = useCallback(async () => {
    try { setStatus(await call<Status>("/api/project-course/status")); } catch (e) { setMsg(errorText(e)); }
  }, []);
  const sync = useCallback(async (quiet: boolean) => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const out = await call<Synced>("/api/project-course/sync", {});
      if (!out.online) return;
      const sum = out.runs.reduce((a, r) => ({ items: a.items + r.items, created: a.created + r.created, events: a.events + r.events }), { items: 0, created: 0, events: 0 });
      const bad = out.runs.find((r) => r.error);
      if (bad) setMsg(`기억에 넣지 못했어요: ${bad.error}`);
      if (!bad || out.runs.some((r) => !r.error)) setSynced({ at: new Date(), ...sum });
      if (sum.items) window.dispatchEvent(new Event("recaller:knowledge-changed"));
    } catch (e) { if (!quiet) setMsg(errorText(e)); }
    finally { syncing.current = false; }
  }, []);
  useEffect(() => later(() => { void load().then(() => sync(true)); }), [load, sync]);
  useEffect(() => { const t = setInterval(() => { void load(); void sync(true); }, 60_000); return () => clearInterval(t); }, [load, sync]);
  // 꺼져 있어서 앱이 코스 서버를 켜는 중이면, 켜질 때까지 2초마다 다시 본다
  const starting = !!status && !status.online && !!status.starting;
  useEffect(() => {
    if (!starting) return;
    const t = setInterval(() => { void load().then(() => sync(true)); }, 2_000);
    return () => clearInterval(t);
  }, [starting, load, sync]);

  const openEditor = async (r: RunLite) => {
    setBusy(r.id); setMsg(null);
    try { await call(`/api/project-course/runs/${r.id}/activate`, {}); await call(`/api/project-course/runs/${r.id}/editor`, {}); setMsg("VS Code를 열었어요. 오른쪽 Recaller 튜터 탭에서 이어 하면 돼요."); }
    catch (e) { setMsg(errorText(e)); }
    finally { setBusy(null); }
  };
  const courseUrl = status?.url ?? "http://127.0.0.1:4100";
  // 2026-11-06 사용자: 가로·세로 박스 배열 말고 알고리즘처럼 세로로. 맨 위에 가장 마지막에 하던 실습 하나, 그 밑은 대화방처럼 긴 줄 목록,
  // 줄을 누르면 세부 내용과 "VS Code에서 이어 하기".
  const runs = status?.runs ?? [];
  const newest = (a: RunLite, b: RunLite) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const sorted = [...runs].sort(newest);
  const top = sorted.find((r) => r.id === status?.active) ?? sorted[0] ?? null;
  const rest = sorted.filter((r) => r !== top);
  const day = (r: RunLite) => { const d = new Date(r.createdAt); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
  const where = (r: RunLite) => `${r.current}단계 · ${r.stageTitle}`;
  const resume = (r: RunLite, primary = true) => (
    <button className={`btn ${primary ? "primary" : "ghost"} small`} disabled={busy === r.id} onClick={() => void openEditor(r)}>{busy === r.id ? "여는 중…" : "VS Code에서 이어 하기"}</button>
  );
  const notes = (r: RunLite) => <a className="btn ghost small" href={`${courseUrl}/#/run/${r.id}/notes`} target="_blank" rel="noreferrer">노트</a>;

  return (
    <div className="pj stack">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>실습</h2><p className="small muted">VS Code에서 직접 만들고, 튜터 탭이 한 걸음씩 알려 줘요. 배운 개념은 기억에 저절로 들어가요.</p></div>
        {status?.online ? <a className="btn ghost small" href={courseUrl} target="_blank" rel="noreferrer">+ 새 실습</a> : null}
      </header>

      {msg ? <p className="small" role="status">{msg}</p> : null}

      {!status ? <p className="small muted">불러오는 중…</p> : starting ? (
        <section className="panel" role="status"><b>실습 서버 켜는 중<span className="ps-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></b><p className="small muted" style={{ margin: "4px 0 0" }}>몇 초면 돼요. 켜지면 바로 바뀌어요.</p></section>
      ) : !status.online ? (
        <section className="panel stack">
          <b>실습 서버가 꺼져 있어요</b>
          <p className="small muted" style={{ margin: 0 }}>{status.error ? `저절로 켜지 못했어요(${status.error}). ` : ""}실습 서버는 Recaller 앱을 켤 때 같이 켜져요. 잠시 뒤 다시 확인하거나 앱을 껐다 켜 주세요.</p>
          <div><button className="btn primary small" onClick={() => { setMsg(null); void load().then(() => sync(true)); }}>다시 확인</button></div>
        </section>
      ) : !top ? (
        <section className="panel stack">
          <b>아직 시작한 실습이 없어요</b>
          <p className="small muted" style={{ margin: 0 }}>무엇을 만들지, 어디서부터 할지 몇 가지 물어보고 계획을 짜 줘요.</p>
          <div><a className="btn primary small" href={courseUrl} target="_blank" rel="noreferrer">새 실습 시작</a></div>
        </section>
      ) : (
        <>
          <section className="panel pj-top">
            <p className="eyebrow">{status.active === top.id ? "하던 실습" : "가장 최근 실습"}</p>
            <h3>{top.courseTitle}</h3>
            <p className="small muted num">{where(top)}{top.done ? ` · ${top.done}단계 끝냄` : ""}{day(top) ? ` · ${day(top)} 시작` : ""}</p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{resume(top)}{notes(top)}</div>
          </section>

          {rest.length ? (
            <section className="panel stack">
              <b>실습 기록 {rest.length}</b>
              <ul className="cs-list">
                {rest.map((r) => (
                  <li key={r.id}>
                    <details className="pj-row">
                      <summary className="cs-row">
                        <span className="cs-title">{r.courseTitle}</span>
                        <span className="small muted">{where(r)}</span>
                        <span className="small muted num">{day(r)}</span>
                      </summary>
                      <div className="pj-more stack">
                        <p className="small" style={{ margin: 0 }}>{r.current}단계 「{r.stageTitle}」 하는 중{r.done ? ` · ${r.done}단계 끝냄` : ""}{day(r) ? ` · ${day(r)} 시작` : ""}</p>
                        {r.workspace ? <p className="small muted" style={{ margin: 0 }}>폴더 <code>{r.workspace}</code></p> : null}
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{resume(r)}{notes(r)}</div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="small muted pj-sync">
            {synced ? (synced.items ? `${synced.at.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}에 ${synced.items}개를 기억에 넣었어요${synced.created ? ` (새 기억 ${synced.created}개)` : ""}.` : "기억에 새로 넣을 것은 없어요.") : msg ? "아직 기억에 못 넣었어요." : "기억과 맞추는 중…"}
            {" "}<button className="linkish" onClick={() => { setMsg(null); void sync(false); }}>지금 넣기</button>
            {" · "}<button className="linkish" onClick={() => go("knowledge")}>기억 보기</button>
          </p>
        </>
      )}
    </div>
  );
}
