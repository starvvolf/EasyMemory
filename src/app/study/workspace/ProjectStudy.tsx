"use client";
// 공부 · 프로젝트 (2026-10-30, D 스레드): 직접 만들며 배우는 프로젝트 코스(experiments/project-course)를 공부 탭에서 잇는다.
// 만들기는 VS Code에서(오른쪽 Recaller 튜터 탭), 여기서는 이어 하기 · 노트 · 배운 것을 지식에 넣기.
// 배운 것은 이 화면이 열려 있는 동안 저절로 지식에 들어간다(/api/project-course/sync, 1분마다).
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, go, later } from "./api";

type RunLite = { id: string; courseTitle: string; stageTitle: string; current: number; done: number; workspace: string | null; createdAt: string };
type Status = { online: boolean; url: string; runs: RunLite[]; active?: string | null };
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
      setSynced({ at: new Date(), ...sum });
      if (sum.items) window.dispatchEvent(new Event("recaller:knowledge-changed"));
      const bad = out.runs.find((r) => r.error);
      if (bad && !quiet) setMsg(`지식에 넣다가 멈췄어요: ${bad.error}`);
    } catch (e) { if (!quiet) setMsg(errorText(e)); }
    finally { syncing.current = false; }
  }, []);
  useEffect(() => later(() => { void load().then(() => sync(true)); }), [load, sync]);
  useEffect(() => { const t = setInterval(() => { void load(); void sync(true); }, 60_000); return () => clearInterval(t); }, [load, sync]);

  const openEditor = async (r: RunLite) => {
    setBusy(r.id); setMsg(null);
    try { await call(`/api/project-course/runs/${r.id}/activate`, {}); await call(`/api/project-course/runs/${r.id}/editor`, {}); setMsg("VS Code를 열었어요. 오른쪽 Recaller 튜터 탭에서 이어 하면 돼요."); }
    catch (e) { setMsg(errorText(e)); }
    finally { setBusy(null); }
  };
  const courseUrl = status?.url ?? "http://127.0.0.1:4100";

  return (
    <div className="pj">
      <div className="pj-head">
        <div>
          <p className="eyebrow">프로젝트 · 직접 만들기</p>
          <h2 style={{ margin: "4px 0 6px" }}>만들면서 배워요</h2>
          <p className="small muted" style={{ margin: 0 }}>코드는 VS Code에서 직접 고치고, 오른쪽 튜터 탭이 한 걸음씩 알려 줘요. 물어본 말·배운 개념은 지식에 저절로 들어가요.</p>
        </div>
      </div>

      {msg ? <p className="small" role="status" style={{ margin: "12px 0" }}>{msg}</p> : null}

      {!status ? <p className="small muted">불러오는 중…</p> : !status.online ? (
        <section className="td-card" style={{ marginTop: 16 }}>
          <p className="eyebrow">프로젝트 코스가 꺼져 있어요</p>
          <p className="small" style={{ margin: "6px 0 12px" }}><b>프로젝트코스 실험</b> 파일을 두 번 눌러 켠 다음, 아래 버튼을 눌러 주세요.</p>
          <button className="btn primary small" onClick={() => { setMsg(null); void load().then(() => sync(true)); }}>다시 확인</button>
        </section>
      ) : (
        <>
          <div className="td-grid" style={{ marginTop: 16 }}>
            {status.runs.map((r) => (
              <section key={r.id} className="td-card">
                <p className="eyebrow">{status.active === r.id ? "하던 프로젝트" : "프로젝트"}</p>
                <h3 style={{ margin: "4px 0" }}>{r.courseTitle}</h3>
                <p className="small muted" style={{ margin: "0 0 10px" }}>{r.current}단계 · {r.stageTitle}{r.done ? ` · ${r.done}단계 끝냄` : ""}</p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn primary small" disabled={busy === r.id} onClick={() => void openEditor(r)}>{busy === r.id ? "여는 중…" : "VS Code에서 이어 하기"}</button>
                  <a className="btn ghost small" href={`${courseUrl}/#/run/${r.id}/notes`} target="_blank" rel="noreferrer">📒 노트</a>
                </div>
              </section>
            ))}
            <section className="td-card">
              <p className="eyebrow">새로 시작</p>
              <p className="small" style={{ margin: "6px 0 12px" }}>무엇을 만들지, 어디서부터 할지 몇 가지 물어보고 계획을 짜 줘요.</p>
              <a className="btn ghost small" href={courseUrl} target="_blank" rel="noreferrer">새 프로젝트 시작</a>
            </section>
          </div>

          <section className="td-card" style={{ marginTop: 16 }}>
            <p className="eyebrow">지식과 연결</p>
            <p className="small" style={{ margin: "6px 0 10px" }}>
              {synced ? (synced.items ? `${synced.at.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}에 ${synced.items}개를 지식에 넣었어요${synced.created ? ` (새 지식 ${synced.created}개)` : ""}.` : "새로 넣을 것은 없어요. 프로젝트에서 물어보거나 단계를 통과하면 여기로 들어와요.") : "확인하는 중…"}
            </p>
            <p className="small muted" style={{ margin: "0 0 10px" }}>코스 개념(상태 코드, 라우팅…)은 <b>개념</b>으로, 물어본 문법·도구(await, JSON.parse…)는 <b>어휘</b>로 들어가요. 이 프로젝트에서만 쓰는 이름은 넣지 않아요.</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost small" onClick={() => { setMsg(null); void sync(false); }}>지금 넣기</button>
              <button className="btn ghost small" onClick={() => go("knowledge")}>지식 보기</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
