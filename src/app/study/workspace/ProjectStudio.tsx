"use client";
// 앱 안 편집기 화면 (2026-11-11 사용자 "새 창 말고 앱 안의 창이 바뀌면서 vscode 나오면", "적당히 감싸진 느낌 나게", "좌우 사이드에 UI 넣을 수 있게"):
// 공부 › 실습의 [앱 안에서 이어 하기]를 누르면 앱 머리(메뉴 탭)는 그대로 두고 그 아래가 바뀐다.
// 11/11 저녁 사용자 "자료/알고리즘/실습 사라지게 · 왼쪽 사이드바는 없애고 · 위에 살짝 남은 공간에 장기 목표 단기 목표":
//   위 띠: ← 실습 · 장기 목표 · 지금 목표(완료 조건, 이해 · 적용) · 로드맵 몇 번째 · 내 VS Code로 열기 (자료/알고리즘/실습 줄을 덮는다)
//   아래: 편집기(VSCodium 웹 서버판, 실습 서버가 4103에 켬) | 튜터(실습 서버 화면 ?embed, 끌어서 너비 조절 · 접기)
// 편집기를 처음 쓰면 받기 안내(파일 · 받는 곳 · 크기)를 가운데 칸에 보이고, 학습자가 [받기]를 눌러야 받는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { call, errorText, later } from "./api";

type EdStatus = { installed: boolean; running: boolean; asset: string; source: string; size: number | null; job: { phase: string; got: number; total: number; error?: string } | null };
type Run = { id: string; courseTitle: string; workspace: string | null };
type Brief = { long: string | null; current: { title: string; done: string; understood: boolean; applied: boolean } | null; support: { title: string; target: string } | null; map: Array<{ title: string; status: string }> };

const mb = (n: number | null | undefined) => (n ? `${Math.round(n / 1048576)}MB` : "크기 확인 못 함");
// 11/11 저녁 사용자 "내장 VS Code 창 크기는 딱 적당 · 왼쪽으로 옮기고 오른쪽 대화창은 그만큼 비중을 키워": 왼쪽 칸을 뺀 만큼 튜터가 넓어진다(기본 폭 약 31%)
const W_KEY = "recaller.studio.tutorWidth.v2";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

export default function ProjectStudio({ run, courseUrl, onClose }: { run: Run; courseUrl: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, right: 10 });
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [url, setUrl] = useState<string | null>(null);
  const [ed, setEd] = useState<EdStatus | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [tutorW, setTutorW] = useState(() => Math.max(320, Number(store.get(W_KEY)) || Math.round(Math.max(440, (typeof window === "undefined" ? 1400 : window.innerWidth) * 0.31))));
  const [drag, setDrag] = useState(false);

  // 앱 머리 아래부터 화면 끝까지: 자리 잡은 높이를 재서 그 아래를 고정 칸으로 덮는다(가운데 좁은 글 칸에 갇히지 않게)
  // 오른쪽에 앱의 기억 칸(aside.sb)이 열려 있으면 그 앞까지만 — 앱 양옆 칸은 그대로 두고 그 사이를 쓴다
  useLayoutEffect(() => {
    const measure = () => {
      const sb = document.querySelector("aside.sb");
      const r = sb?.getBoundingClientRect();
      // 위쪽: 공부 종류 줄(자료 · 알고리즘 · 실습)이 있으면 그 줄부터 덮는다
      const nav = document.querySelector(".study-nav");
      const nr = nav?.getBoundingClientRect();
      const top = nr && nr.height > 0 ? nr.top : (host.current?.getBoundingClientRect().top ?? 0);
      setBox({ top: Math.max(0, Math.round(top)), right: r && r.width > 0 ? Math.round(window.innerWidth - r.left) + 8 : 10 });
      const t = document.documentElement.dataset.theme;
      setTheme(t === "light" || t === "dark" ? t : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    const sb = document.querySelector("aside.sb"); if (sb) ro.observe(sb);
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mo.observe(document.body, { childList: true, subtree: false });
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); mo.disconnect(); };
  }, []);

  const open = useCallback(async () => {
    setErr("");
    try {
      const st = await call<EdStatus>("/api/project-course/editor-web");
      setEd(st);
      if (!st.installed) return;
      const r = await call<{ url: string; folder: string }>(`/api/project-course/runs/${run.id}/editor-web`, {});
      setUrl(r.url);
    } catch (e) { setErr(errorText(e)); }
  }, [run.id]);
  useEffect(() => later(() => { void open(); }), [open]);

  // 받는 중이면 1초마다 진행을 본다
  const busy = !!ed?.job && !["끝", "실패"].includes(ed.job.phase);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      try { const st = await call<EdStatus>("/api/project-course/editor-web"); setEd(st); if (st.installed && st.job?.phase === "끝") void open(); } catch { /* 다음에 */ }
    }, 1000);
    return () => clearInterval(t);
  }, [busy, open]);

  // 위 띠의 목표: 5초마다(AI 없음)
  useEffect(() => {
    let alive = true;
    const pull = async () => { try { const b = await call<Brief>(`/api/project-course/runs/${run.id}/goals-brief`); if (alive) setBrief(b); } catch { /* 다음에 */ } };
    const first = later(() => { void pull(); });
    const t = setInterval(pull, 5000);
    return () => { alive = false; first(); clearInterval(t); };
  }, [run.id]);

  const install = async () => { try { await call("/api/project-course/editor-web/install", {}); setEd(await call<EdStatus>("/api/project-course/editor-web")); } catch (e) { setErr(errorText(e)); } };
  const mine = async () => {
    setMsg("");
    try { const r = await call<{ ok?: boolean; message?: string }>(`/api/project-course/runs/${run.id}/editor`, { float: false }); setMsg(r.ok === false ? r.message ?? "" : "내 VS Code에서 열었어요."); }
    catch (e) { setMsg(errorText(e)); }
  };

  // 튜터 칸 너비: 경계를 끌어서(이 PC에 기억)
  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId); setDrag(true);
    const move = (ev: PointerEvent) => setTutorW(Math.min(Math.max(window.innerWidth - ev.clientX - 12, 280), window.innerWidth * 0.6));
    const up = () => { setDrag(false); el.removeEventListener("pointermove", move as EventListener); setTutorW((w) => { store.set(W_KEY, String(Math.round(w))); return w; }); };
    el.addEventListener("pointermove", move as EventListener); el.addEventListener("pointerup", up, { once: true });
  };

  const center = err ? (
    <div className="pst-card"><b>편집기를 켜지 못했어요</b><p className="small muted">{err}</p>
      <div className="row" style={{ gap: 8 }}><button className="btn primary small" onClick={() => void open()}>다시 켜기</button><button className="btn ghost small" onClick={() => void mine()}>내 VS Code로 열기</button></div></div>
  ) : ed && !ed.installed && !busy ? (
    <div className="pst-card">
      <b>앱 안 편집기를 처음 한 번 받아요</b>
      <p className="small muted">VS Code와 같은 편집기(VSCodium, 오픈소스)를 이 PC에 받아 두고 여기에 띄워요. 내 VS Code의 설정 · 확장과는 따로예요.</p>
      <p className="small">파일 <code>{ed.asset}</code> · {mb(ed.size)}<br />받는 곳 <code style={{ wordBreak: "break-all" }}>{ed.source}</code></p>
      <p className="small muted">받은 뒤 Python 확장(실행 · 디버그)과 코드 찾기 확장도 Open VSX에서 같이 깔아요.</p>
      {ed.job?.phase === "실패" ? <p className="small" style={{ color: "var(--bad, #e07070)" }}>지난번에 못 받았어요: {ed.job.error}</p> : null}
      <div className="row" style={{ gap: 8 }}><button className="btn primary small" onClick={() => void install()}>받기</button><button className="btn ghost small" onClick={() => void mine()}>대신 내 VS Code로 열기</button></div>
    </div>
  ) : busy ? (
    <div className="pst-card"><b>편집기 받는 중</b><p className="small muted">{ed!.job!.phase}{ed!.job!.phase === "받는 중" && ed!.job!.total ? ` · ${mb(ed!.job!.got)} / ${mb(ed!.job!.total)}` : ""}</p>
      <div className="pst-prog"><i style={{ width: `${ed!.job!.phase === "받는 중" && ed!.job!.total ? Math.round((ed!.job!.got / ed!.job!.total) * 100) : 100}%` }} /></div></div>
  ) : url ? (
    <iframe title="편집기" src={url} allow="clipboard-read; clipboard-write" className={drag ? "nopt" : ""} />
  ) : <div className="pst-card"><p className="small muted">편집기를 켜는 중… (처음엔 10초쯤 걸려요)</p></div>;

  return (
    <div ref={host} className="pst-host">
      <div className="pst" style={{ top: box.top, right: box.right }}>
        <header className="pst-top">
          <button className="btn ghost small" onClick={onClose} title="실습 목록으로(편집기는 켜 둔 채)">← 실습</button>
          <Goals brief={brief} fallback={run.courseTitle} />
          <span className="grow" />
          {msg ? <span className="small muted pst-msg">{msg}</span> : null}
          <button className="btn ghost small" onClick={() => void mine()} title="내 PC의 VS Code(내 확장 · 설정 그대로)로 이 폴더를 열어요">내 VS Code로 열기</button>
        </header>
        <div className="pst-body">
        <main className="pst-main">{center}</main>
        {rightOpen ? <>
          <div className={`pst-grip ${drag ? "on" : ""}`} onPointerDown={startDrag} role="separator" aria-label="편집기와 튜터 사이 크기 바꾸기" />
          <aside className={`pst-side pst-right ${theme}`} style={{ width: tutorW }}>
            <button className="pst-fold" onClick={() => setRightOpen(false)} title="튜터 칸 접기" aria-label="튜터 칸 접기">⟩</button>
            <iframe title="튜터" src={`${courseUrl}/?embed=1&theme=${theme}#/run/${run.id}`} allow="clipboard-read; clipboard-write" className={drag ? "nopt" : ""} />
          </aside>
        </> : <button className="pst-rail" onClick={() => setRightOpen(true)} title="튜터 칸 열기" aria-label="튜터 칸 열기">⟨ 튜터</button>}
        </div>
      </div>
    </div>
  );
}

/** 위 띠: 장기 목표 · 지금 목표(보충 중이면 보충) · 로드맵 몇 번째. 길면 한 줄로 자르고 마우스를 올리면 전부 */
function Goals({ brief, fallback }: { brief: Brief | null; fallback: string }) {
  if (!brief?.long) return <span className="pst-goal"><span className="pst-k">실습</span><b className="pst-v">{brief ? "튜터와 장기 목표를 정하는 중" : fallback}</b></span>;
  const c = brief.current, steps = brief.map;
  const idx = steps.findIndex((x) => x.status === "doing");
  const doneN = steps.filter((x) => x.status === "done" || x.status === "skipped").length;
  const now = brief.support ? `보충: ${brief.support.title}` : c?.title ?? "다음 목표를 정하는 중";
  const phase = c ? (c.applied ? "적용 ✓" : c.understood ? "① 이해 ✓ → ② 적용" : "① 이해 → ② 적용") : "";
  return <>
    <span className="pst-goal" title={brief.long}><span className="pst-k">장기 목표</span><span className="pst-v">{brief.long}</span></span>
    <span className="pst-goal now" title={c ? `${now}\n완료 조건: ${c.done}` : now}><span className="pst-k">지금</span><b className="pst-v">{now}</b>{phase ? <span className="pst-phase">{phase}</span> : null}</span>
    {steps.length ? <span className="pst-steps" title={steps.map((x, i) => `${i + 1}. ${x.title}${x.status === "done" ? " ✓" : x.status === "skipped" ? " (건너뜀)" : x.status === "doing" ? " ← 지금" : ""}`).join("\n")}>{idx >= 0 ? `${idx + 1}/${steps.length}단계` : `${doneN}/${steps.length}`}</span> : null}
  </>;
}
