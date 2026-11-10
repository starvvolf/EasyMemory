"use client";
// 앱 안 편집기 화면 (2026-11-11 사용자 "새 창 말고 앱 안의 창이 바뀌면서 vscode 나오면", "적당히 감싸진 느낌 나게", "좌우 사이드에 UI 넣을 수 있게"):
// 공부 › 실습의 [앱 안에서 이어 하기]를 누르면 앱 머리(탭)는 그대로 두고 그 아래가 세 칸으로 바뀐다.
//   왼쪽: Recaller 칸(돌아가기 · 이 실습 · 나의 학습 노트 — 앞으로 여기에 실습 도구를 더 넣는다, 접기)
//   가운데: 편집기(VSCodium 웹 서버판, 실습 서버가 4103에 켬)   오른쪽: 튜터(실습 서버 화면 ?embed, 끌어서 너비 조절 · 접기)
// 편집기를 처음 쓰면 받기 안내(파일 · 받는 곳 · 크기)를 가운데 칸에 보이고, 학습자가 [받기]를 눌러야 받는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { call, errorText, later } from "./api";
import LearnerNote from "./LearnerNote";

type EdStatus = { installed: boolean; running: boolean; asset: string; source: string; size: number | null; job: { phase: string; got: number; total: number; error?: string } | null };
type Run = { id: string; courseTitle: string; workspace: string | null };

const mb = (n: number | null | undefined) => (n ? `${Math.round(n / 1048576)}MB` : "크기 확인 못 함");
const W_KEY = "recaller.studio.tutorWidth";
const L_KEY = "recaller.studio.leftOpen";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

export default function ProjectStudio({ run, courseUrl, onClose, left }: { run: Run; courseUrl: string; onClose: () => void; left?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, right: 10 });
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [url, setUrl] = useState<string | null>(null);
  const [ed, setEd] = useState<EdStatus | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [leftOpen, setLeftOpen] = useState(() => store.get(L_KEY) !== "0");
  const [rightOpen, setRightOpen] = useState(true);
  const [tutorW, setTutorW] = useState(() => Math.max(300, Number(store.get(W_KEY)) || 380));
  const [drag, setDrag] = useState(false);

  // 앱 머리 아래부터 화면 끝까지: 자리 잡은 높이를 재서 그 아래를 고정 칸으로 덮는다(가운데 좁은 글 칸에 갇히지 않게)
  // 오른쪽에 앱의 기억 칸(aside.sb)이 열려 있으면 그 앞까지만 — 앱 양옆 칸은 그대로 두고 그 사이를 쓴다
  useLayoutEffect(() => {
    const measure = () => {
      const sb = document.querySelector("aside.sb");
      const r = sb?.getBoundingClientRect();
      setBox({ top: Math.max(0, Math.round(host.current?.getBoundingClientRect().top ?? 0) + window.scrollY), right: r && r.width > 0 ? Math.round(window.innerWidth - r.left) + 8 : 10 });
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

  const install = async () => { try { await call("/api/project-course/editor-web/install", {}); setEd(await call<EdStatus>("/api/project-course/editor-web")); } catch (e) { setErr(errorText(e)); } };
  const mine = async () => {
    setMsg("");
    try { const r = await call<{ ok?: boolean; message?: string }>(`/api/project-course/runs/${run.id}/editor`, {}); setMsg(r.ok === false ? r.message ?? "" : "내 VS Code에서 열었어요."); }
    catch (e) { setMsg(errorText(e)); }
  };

  // 튜터 칸 너비: 경계를 끌어서(이 PC에 기억)
  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId); setDrag(true);
    const move = (ev: PointerEvent) => setTutorW(Math.min(Math.max(window.innerWidth - ev.clientX - 12, 280), window.innerWidth * 0.6));
    const up = () => { setDrag(false); el.removeEventListener("pointermove", move as EventListener); setTutorW((w) => { store.set(W_KEY, String(Math.round(w))); return w; }); };
    el.addEventListener("pointermove", move as EventListener); el.addEventListener("pointerup", up, { once: true });
  };
  const toggleLeft = () => setLeftOpen((v) => { store.set(L_KEY, v ? "0" : "1"); return !v; });

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
      <div className="pst" style={{ top: box.top + 8, right: box.right }}>
        {leftOpen ? (
          <aside className="pst-side pst-left">
            <div className="pst-row"><button className="btn ghost small" onClick={onClose} title="실습 목록으로(편집기는 켜 둔 채)">← 실습</button><span className="grow" /><button className="btn ghost small" onClick={toggleLeft} title="왼쪽 칸 접기" aria-label="왼쪽 칸 접기">⟨</button></div>
            <div className="pst-block"><p className="eyebrow">지금 실습</p><b className="pst-title">{run.courseTitle}</b>
              {run.workspace ? <p className="small muted pst-path" title={run.workspace}>{run.workspace}</p> : null}
              <button className="btn ghost small" onClick={() => void mine()} title="내 PC의 VS Code(내 확장 · 설정 그대로)로 이 폴더를 열어요">내 VS Code로 열기</button>
              {msg ? <p className="small muted">{msg}</p> : null}</div>
            {/* 왼쪽 칸에 넣을 실습 도구 자리(앞으로 더 넣는다). 지금은 나의 학습 노트 */}
            {left ?? <div className="pst-block pst-note"><LearnerNote /></div>}
          </aside>
        ) : <button className="pst-rail" onClick={toggleLeft} title="왼쪽 칸 열기" aria-label="왼쪽 칸 열기">⟩</button>}
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
  );
}
