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
type BaseItem = { name: string; kind?: "개념" | "도구"; needs?: string[]; check: string; result: "됨" | "비어 있음" | null; by: "확인" | "노트" | "명령" | "학습자" | null; quote: string; now?: boolean; debts?: string[] };
type Brief = { long: string | null; current: { title: string; done: string; understood: boolean; applied: boolean } | null; support: { title: string; target: string } | null; map: Array<{ title: string; status: string }>; prereqs?: BaseItem[] };

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
  const [baseOpen, setBaseOpen] = useState(false);

  // 앱 머리 아래부터 화면 끝까지: 자리 잡은 높이를 재서 그 아래를 고정 칸으로 덮는다(가운데 좁은 글 칸에 갇히지 않게)
  // 오른쪽에 앱의 기억 칸(aside.sb)이 열려 있으면 그 앞까지만 — 앱 양옆 칸은 그대로 두고 그 사이를 쓴다
  useLayoutEffect(() => {
    const measure = () => {
      const sb = document.querySelector("aside.sb");
      const r = sb?.getBoundingClientRect();
      // 위쪽: 공부 종류 줄(자료 · 알고리즘 · 실습)이 있으면 그 줄부터 덮는다
      const nav = document.querySelector(".study-nav");
      const nr = nav?.getBoundingClientRect();
      // 11/11 사용자 "어쩔 때는 위에 Recaller 줄이 안 뜨고 어쩔 때는 뜬다": 실습 목록을 내려 둔 채 들어오면 공부 종류 줄이 화면 위로 올라가 있어
      // 앱 창의 고정 머리(.masthead)까지 덮었다 → 고정 머리가 있으면 그 아래부터
      const mh = document.querySelector(".masthead");
      const mhb = mh && getComputedStyle(mh).position === "fixed" ? mh.getBoundingClientRect().bottom : 0;
      const top = nr && nr.height > 0 ? nr.top : (host.current?.getBoundingClientRect().top ?? 0);
      setBox({ top: Math.max(0, Math.round(mhb), Math.round(top)), right: r && r.width > 0 ? Math.round(window.innerWidth - r.left) + 8 : 10 });
      const t = document.documentElement.dataset.theme;
      setTheme(t === "light" || t === "dark" ? t : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    const sb = document.querySelector("aside.sb"); if (sb) ro.observe(sb);
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mo.observe(document.body, { childList: true, subtree: false });
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); ro.disconnect(); mo.disconnect(); };
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
          {brief?.prereqs?.length ? (() => {
            // 11/11 사용자 "현재 목표의 선행 개념을": 숫자는 지금 목표의 선행 덩어리
            const xs = brief.prereqs!;
            return <button className={`pst-basebtn ${baseOpen ? "on" : ""}`} onClick={() => setBaseOpen((o) => !o)} aria-expanded={baseOpen}
              title="지금 목표를 하기 전에 알고 있어야 할 것. 눌러서 보고 안다 · 모른다를 표시해요">
              먼저 알 것 <b>{xs.filter((x) => x.result === "됨").length}/{xs.length}</b>{xs.some((x) => x.result === "비어 있음") ? <i className="pst-dot" /> : null}
            </button>;
          })() : null}
          {msg ? <span className="small muted pst-msg">{msg}</span> : null}
          <button className="btn ghost small" onClick={() => void mine()} title="내 PC의 VS Code(내 확장 · 설정 그대로)로 이 폴더를 열어요">내 VS Code로 열기</button>
        </header>
        {baseOpen && brief?.prereqs?.length ? <BaseTab runId={run.id} goal={brief.current?.title ?? ""} map={brief.map} prereqs={brief.prereqs ?? []} onClose={() => setBaseOpen(false)}
          onChange={(next) => setBrief((b) => (b ? { ...b, ...next } : b))} /> : null}
        <div className="pst-body">
        <main className="pst-main">{center}</main>
        {rightOpen ? <>
          <div className={`pst-grip ${drag ? "on" : ""}`} onPointerDown={startDrag} role="separator" aria-label="편집기와 튜터 사이 크기 바꾸기" />
          <aside className={`pst-side pst-right ${theme}`} style={{ width: tutorW }}>
            <button className="pst-fold" onClick={() => setRightOpen(false)} title="튜터 칸 접기" aria-label="튜터 칸 접기">⟩</button>
            <iframe title="튜터" src={`${courseUrl}/?embed=1&studio=1&theme=${theme}#/run/${run.id}`} allow="clipboard-read; clipboard-write" className={drag ? "nopt" : ""} />
          </aside>
        </> : <button className="pst-rail" onClick={() => setRightOpen(true)} title="튜터 칸 열기" aria-label="튜터 칸 열기">⟨ 튜터</button>}
        </div>
      </div>
    </div>
  );
}

/** 위 띠: 장기 목표 · 지금 목표(보충 중이면 보충) · 로드맵 몇 번째. 길면 한 줄로 자르고 마우스를 올리면 전부 */
function Goals({ brief, fallback }: { brief: Brief | null; fallback: string }) {
  if (!brief?.long) return <div className="pst-goals"><div className="pst-row"><span className="pst-k">실습</span><b className="pst-v">{brief ? "튜터와 장기 목표를 정하는 중" : fallback}</b></div></div>;
  const c = brief.current, steps = brief.map;
  const doneN = steps.filter((x) => x.status === "done" || x.status === "skipped").length;
  const phase = c ? (c.applied ? "적용 ✓" : c.understood ? "이해 ✓ → 적용" : "이해 → 적용") : "";
  // 11/11 사용자 "장기 로드맵, 지금 하는 거는 위 장기 목표 줄에 이쁘게": 윗줄 장기 목표 · 아랫줄 로드맵(지금 단계에 이해 · 적용, 보충이면 그 옆에)
  return <div className="pst-goals">
    <div className="pst-row" title={brief.long}>
      <span className="pst-k">장기 목표</span><span className="pst-v pst-long">{brief.long}</span>
      {steps.length ? <span className="pst-count">{doneN}/{steps.length} 끝남</span> : null}
    </div>
    <ol className="pst-map">
      {steps.map((x, i) => {
        const now = x.status === "doing";
        return <li key={i} className={`pst-st ${x.status}`} title={`${i + 1}. ${x.title}${now && c ? `\n완료 조건: ${c.done}` : x.status === "skipped" ? " (건너뜀)" : ""}`}>
          <span className="pst-n">{x.status === "done" ? "✓" : x.status === "skipped" ? "↷" : i + 1}</span>
          <span className="pst-t">{x.title}</span>
          {now && phase && !brief.support ? <span className="pst-phase">{phase}</span> : null}
          {now && brief.support ? <span className="pst-sup" title={`보충: ${brief.support.title}`}>보충: {brief.support.title}</span> : null}
        </li>;
      })}
      {!steps.length && c ? <li className="pst-st doing" title={`완료 조건: ${c.done}`}><span className="pst-t">{c.title}</span>{phase ? <span className="pst-phase">{phase}</span> : null}</li> : null}
    </ol>
  </div>;
}

/** 먼저 알 것 미니 창(11/11 사용자 "선행 개념 버튼 → 미니 탭에 잘 정리된 선행 개념 · 안다 모른다 체크", "현재 목표의 선행 개념을"):
 *  맨 위에 지금 목표의 선행, 그 아래 장기 목표 전체 지도(접힘). 항목마다 그 전에 알 것 · 확인 문항 · 누가 확인했는지, [알아요] · [몰라요](한 번 더 누르면 지움) */
function BaseTab({ runId, goal, map, prereqs, onClose, onChange }: { runId: string; goal: string; map: Brief["map"]; prereqs: BaseItem[]; onClose: () => void; onChange: (b: { prereqs?: BaseItem[] }) => void }) {
  const [err, setErr] = useState("");
  // 11/11 사용자 "현재 목표가 오른쪽으로 한 칸씩 가면서 로드맵이 완성 · 현재 목표 밑으로 선행 개념을 붙이는 느낌 · 현재 목표조차 오른쪽 다음 목표의 선행":
  // 위는 로드맵 가로줄, 지금 단계 칩 아래로 줄기를 내려 선행을 매단다. 맨 위 가지는 바로 앞 단계(그것도 선행)
  const road = useRef<HTMLOListElement>(null);
  const [stemX, setStemX] = useState(24);
  const cur = map.findIndex((x) => x.status === "doing");
  useLayoutEffect(() => {
    const ol = road.current, li = ol?.children[cur] as HTMLElement | undefined;
    if (!ol || !li) return;
    li.scrollIntoView({ block: "nearest", inline: "nearest" });
    setStemX(Math.min(220, Math.max(14, li.offsetLeft - ol.scrollLeft + 4)));
  }, [cur, map.length]);
  const prev = cur > 0 ? map[cur - 1] : null;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const mark = async (it: BaseItem, want: "됨" | "비어 있음") => {
    const result = it.result === want && it.by === "학습자" ? null : want;
    const set = (xs: BaseItem[]) => xs.map((x) => (x.name.trim().toLowerCase() === it.name.trim().toLowerCase() ? { ...x, result, by: result ? "학습자" as const : null } : x));
    setErr("");
    onChange({ prereqs: set(prereqs) });
    try { onChange(await call<{ prereqs: BaseItem[] }>(`/api/project-course/runs/${runId}/base`, { name: it.name, result })); }
    catch (e) { setErr(errorText(e)); onChange({ prereqs }); }
  };
  const byText = (it: BaseItem) => !it.result ? "아직 표시 전" : it.by === "학습자" ? "내가 표시" : it.by === "노트" ? "지난 실습에서 확인" : it.by === "명령" ? `명령으로 확인${it.quote ? ` · ${it.quote}` : ""}` : `막혔을 때 드러남${it.quote ? ` · "${it.quote}"` : ""}`;
  const head = prereqs;
  const known = head.filter((x) => x.result === "됨").length, gap = head.filter((x) => x.result === "비어 있음").length;
  const row = (it: BaseItem) => (
    <li key={it.name} className={`pbt-item ${it.result === "됨" ? "ok" : it.result === "비어 있음" ? "gap" : ""}`}>
      <span className="pbt-mark" aria-hidden>{it.result === "됨" ? "✓" : it.result === "비어 있음" ? "!" : ""}</span>
      <div className="pbt-main">
        <div className="pbt-name">{it.name}{it.kind === "도구" ? <span className="pbt-tag">도구</span> : null}</div>
        {it.needs?.length ? <div className="pbt-sub">그 전에: {it.needs.join(", ")}</div> : null}
        {it.check ? <div className="pbt-sub">{it.check}</div> : null}
        {it.debts?.length ? <div className="pbt-debt" title="이 덩어리에서 온 것 중 튜터가 바로 알려 줘서 쓴 것. 자꾸 쌓이면 튜터가 이것들만 정리하자고 한 번 물어봐요">받아 쓴 것 {it.debts.length} · {it.debts.join(", ")}</div> : null}
        <div className="pbt-by">{byText(it)}</div>
      </div>
      <div className="pbt-acts">
        <button className={`pbt-b yes ${it.result === "됨" ? "on" : ""}`} onClick={() => void mark(it, "됨")} title={it.result === "됨" && it.by === "학습자" ? "표시 지우기" : "알아요 — 써 본 적 있어요"}>알아요</button>
        <button className={`pbt-b no ${it.result === "비어 있음" ? "on" : ""}`} onClick={() => void mark(it, "비어 있음")} title={it.result === "비어 있음" && it.by === "학습자" ? "표시 지우기" : "몰라요 — 처음이에요. 여기서 온 문법 · 이름은 튜터가 바로 알려 줘요"}>몰라요</button>
      </div>
    </li>
  );
  return <>
    <div className="pbt-scrim" onClick={onClose} />
    <section className="pbt" role="dialog" aria-label="먼저 알 것">
      <header className="pbt-head"><b>먼저 알 것</b><span className="pbt-sum">알아요 {known} · 몰라요 {gap} · 표시 전 {head.length - known - gap}</span><span className="grow" />
        <button className="pbt-x" onClick={onClose} aria-label="닫기">×</button></header>
      <p className="pbt-note">지금 목표 <b>{goal}</b>를 하려면 먼저 알고 있어야 하는 큰 덩어리예요. 튜터는 미리 묻지 않아요. 스스로 <b>알아요</b> · <b>몰라요</b>를 표시해 두면, 모르는 덩어리에서 나오는 문법 · 이름은 걸린 만큼만 바로 알려 주고 <b>받아 쓴 것</b>으로 쌓아 둬요. 표시는 다음 목표에도 이어져요.</p>
      {err ? <p className="pbt-err">{err}</p> : null}
      {map.length ? <ol className="pbt-road" ref={road}>
        {map.map((x, i) => <li key={i} className={`pbt-rs ${x.status}`} title={x.title}><span className="pbt-rn">{x.status === "done" ? "✓" : x.status === "skipped" ? "↷" : i + 1}</span><span className="pbt-rt">{x.title}</span></li>)}
      </ol> : null}
      <div className="pbt-list">
        <div className="pbt-tree" style={{ ["--stem" as string]: `${stemX}px` }}>
          <div className="pbt-k">{goal ? <><b>{goal}</b> 아래에 붙은 선행</> : "지금 목표에 필요한 것"}</div>
          <ul>
            {prev ? <li className={`pbt-item prev ${prev.status === "done" ? "ok" : ""}`}><span className="pbt-mark" aria-hidden>{prev.status === "done" ? "✓" : ""}</span>
              <div className="pbt-main"><div className="pbt-name">{prev.title}<span className="pbt-tag">앞 단계</span></div><div className="pbt-by">로드맵의 바로 앞 단계도 이 목표의 선행이에요{prev.status === "skipped" ? " · 건너뜀" : ""}</div></div></li> : null}
            {prereqs.map(row)}
          </ul>
        </div>

      </div>
    </section>
  </>;
}
