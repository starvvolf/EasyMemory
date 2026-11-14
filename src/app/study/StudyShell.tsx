"use client";
// 공부 화면 전체 틀 (2026-11-15 리팩토링). 예전에는 바닐라 앱(dejipgi-app.js, 약 3천 줄)이 상태를 들고 React 화면(StudyApp)을 끼웠다.
// 이제 화면이 쓰는 것만 남겨 React 한 덩어리로: 머리(로그인 · 밝기 · 더보기), 탭(오늘 · 공부 · 기억 · 기록), 화면 전환, 알림, 원문 보기.
// 다른 화면은 api.ts의 go(view)로 바꾼다(recaller:go 이벤트). 상태는 각 화면이 서버에서 직접 읽는다.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./dejipgi.css";
import "./workspace/workspace.css";
import AccountChip from "./workspace/AccountChip";
import MoreMenu from "./workspace/MoreMenu";
import MaterialList from "./workspace/MaterialList";
import NewMaterial from "./workspace/NewMaterial";
import SourcePeek, { loadPdfjs, openPeek } from "./workspace/SourcePeek";
import { setBranch, shelfSel } from "./workspace/shelf";
import { refreshMaterials, startMaterial } from "./workspace/materials";

const TodayBoard = lazy(() => import("./workspace/TodayBoard"));
const Library = lazy(() => import("./workspace/Library"));
const CodeStudy = lazy(() => import("./workspace/CodeStudy"));
const ProjectStudy = lazy(() => import("./workspace/ProjectStudy"));
const WebStudy = lazy(() => import("./workspace/WebStudy"));
const PlanView = lazy(() => import("./workspace/PlanView"));

type View = "home" | "practice" | "create" | "code" | "project" | "web" | "knowledge" | "plan";
const VIEWS: readonly View[] = ["home", "practice", "create", "code", "project", "web", "knowledge", "plan"];
const TABS: Array<[View, string]> = [["home", "오늘"], ["practice", "공부"], ["knowledge", "기억"], ["plan", "기록"]];
const TAB_OF: Record<View, View> = { home: "home", practice: "practice", create: "practice", code: "practice", project: "practice", web: "practice", knowledge: "knowledge", plan: "plan" };
/** 예전 이름 → 지금 화면 (오래된 단추 · 링크가 보내는 이름) */
const ALIAS: Record<string, View> = { start: "practice", read: "practice", records: "plan", summary: "knowledge", archive: "practice", bench: "practice", "knowledge-legacy": "knowledge" };
const toView = (v: string): View => (VIEWS as readonly string[]).includes(v) ? v as View : ALIAS[v] ?? "practice";

// 밝게·어둡게 (11/8 사용자: "다크모드 PC 설정 따라가지 말고 내가 누를 수 있게"). 처음(고른 적 없음)에는 PC 설정을 따른다.
const THEME_KEY = "recaller:theme";
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage off */ }
    const isDark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved) document.documentElement.dataset.theme = saved;
    const t = setTimeout(() => setDark(isDark), 0);
    return () => clearTimeout(t);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage off */ }
    setDark(!dark);
  };
  return <button type="button" className="theme-toggle" onClick={flip} aria-label={dark ? "밝게 보기" : "어둡게 보기"} title={dark ? "밝게 보기" : "어둡게 보기"}>{dark ? "☀" : "☾"}</button>;
}

export default function StudyShell() {
  const [view, setViewState] = useState<View>("home");
  const [seen, setSeen] = useState<Set<View>>(() => new Set(["home"]));
  const [toast, setToast] = useState("");
  const [createKey, setCreateKey] = useState(0);
  const stack = useRef<View[]>([]);
  const viewRef = useRef<View>("home");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3800);
  }, []);
  const setView = useCallback((v: View, back = false) => {
    const prev = viewRef.current;
    if (prev !== v && !back) { stack.current.push(prev); if (stack.current.length > 30) stack.current.shift(); }
    // 공부 탭의 갈래는 기억 탭과 같이 (11/12 "같은 틀, 두 얼굴")
    if (v === "code" || v === "project") setBranch(v);
    viewRef.current = v;
    setViewState(v);
    setSeen((s) => (s.has(v) ? s : new Set([...s, v])));
  }, []);

  // 다른 화면이 부르는 길: go(view) → recaller:go, 자료 지도 열기 → recaller:map-open
  useEffect(() => {
    const onGo = (e: Event) => { const v = (e as CustomEvent<{ view?: string }>).detail?.view; if (!v) return; setView(toView(v)); window.scrollTo({ top: 0 }); };
    const onMap = (e: Event) => {
      const d = (e as CustomEvent<{ genId?: string; page?: number }>).detail ?? {};
      const id = String(d.genId || "");
      setBranch("material");
      if (id) shelfSel.set(`gen:${id}`);
      setView("practice");
      window.scrollTo({ top: 0 });
      if (id && Number(d.page) > 0) openPeek(id, Number(d.page));
    };
    window.addEventListener("recaller:go", onGo);
    window.addEventListener("recaller:map-open", onMap);
    return () => { window.removeEventListener("recaller:go", onGo); window.removeEventListener("recaller:map-open", onMap); };
  }, [setView]);

  // 뒤로 한 칸 (11/11 사용자): Esc는 자료 지도 안에서 열린 것을, 마우스 뒤로 버튼 · Alt+←는 앞 화면으로. 원문 보기는 자기 Esc가 먼저.
  useEffect(() => {
    const backOne = () => {
      if (viewRef.current === "practice" && document.querySelector(".study-shelf .mm2")) {
        const ev = new CustomEvent("recaller:back", { cancelable: true });
        window.dispatchEvent(ev);
        if (ev.defaultPrevented) return true;
      }
      if (viewRef.current === "create") { setView("practice", true); return true; }
      const prev = stack.current.pop();
      if (prev && prev !== viewRef.current) { setView(prev, true); window.scrollTo({ top: 0 }); return true; }
      return false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape" && !typing && viewRef.current === "practice" && document.querySelector(".study-shelf .mm2")) {
        const ev = new CustomEvent("recaller:back", { cancelable: true }); window.dispatchEvent(ev); if (ev.defaultPrevented) e.preventDefault();
      } else if (e.altKey && e.key === "ArrowLeft" && backOne()) e.preventDefault();
    };
    const mouse = (e: MouseEvent) => { if (e.button === 3 && backOne()) e.preventDefault(); };
    document.addEventListener("keydown", key); document.addEventListener("mouseup", mouse);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mouseup", mouse); };
  }, [setView]);

  // 남겨 둔 화면이 다시 보일 때 알린다(Library · TodayBoard가 듣고 다시 불러옴)
  useEffect(() => { window.dispatchEvent(new CustomEvent("recaller:shown", { detail: view })); document.querySelector(".dejipgi")?.setAttribute("data-view", view); }, [view]);

  // 유튜브 정리 패널에서 보낸 자료로 바로 (?gen=gen_…, 11/15)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const gen = params.get("gen");
    if (!gen || !/^gen_[a-f0-9]{32}$/.test(gen)) return;
    params.delete("gen");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
    void refreshMaterials();
    // 듣는 쪽(위의 recaller:map-open)은 앞 효과에서 이미 붙었다. 바로 보낸다(개발 모드의 두 번 실행에도 한 번만: 주소에서 이미 뺐다).
    window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: gen } }));
  }, []);

  // ChatGPT 로그인에서 돌아왔을 때 (?chatgpt=connected)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get("chatgpt");
    if (!outcome) return;
    params.delete("chatgpt");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
    const t = setTimeout(() => { say(outcome === "connected" ? "ChatGPT 계정을 연결했어요." : "ChatGPT 연결에 실패했어요. 다시 시도해 주세요."); setView("create"); }, 0);
    return () => clearTimeout(t);
  }, [say, setView]);

  const keep = (k: View, node: ReactNode) => (seen.has(k) || view === k ? <div key={k} className={`view-host view-${k}`} hidden={view !== k}>{node}</div> : null);
  const inside = view === "code" || view === "project";
  const studyNav = view === "practice" || view === "web" || inside;
  const [br, setBr] = useState<string>(() => { try { return localStorage.getItem("recaller:lib-branch") || "material"; } catch { return "material"; } });
  useEffect(() => { const on = (e: Event) => setBr((e as CustomEvent<string>).detail || "material"); window.addEventListener("recaller:branch", on); return () => window.removeEventListener("recaller:branch", on); }, []);
  const navActive = inside ? view : br === "code" || br === "project" ? br : "practice";

  return (
    <div className="dejipgi" data-view="home">
      {/* Plain link (no precedence) so a blocked font request never suspends or errors the page. */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      <div className="wrap">
        <div className="masthead">
          <header className="top">
            <div className="brand">
              <h1>Recaller</h1>
              <p>공부한 것이 기억으로 쌓이고, 잊을 때쯤 다시 물어봐요</p>
            </div>
            <div className="ws-tools"><AccountChip /><ThemeToggle /><MoreMenu /></div>
          </header>
          <nav className="tabs" role="tablist">
            {TABS.map(([v, label]) => <button key={v} role="tab" data-view={v} aria-selected={TAB_OF[view] === v} onClick={() => setView(v)}>{label}</button>)}
          </nav>
        </div>
        <main id="app">
          {studyNav ? (
            <div className="study-nav">
              <div className="seg study-seg" role="tablist" aria-label="공부 종류">
                {([["practice", "자료"], ["code", "알고리즘"], ["project", "실습"]] as const).map(([v, label]) => (
                  <button key={v} role="tab" aria-selected={navActive === v} className={navActive === v ? "on" : ""}
                    onClick={() => { setBranch(v === "practice" ? "material" : v); if (view !== "practice") setView("practice"); }}>{label}</button>
                ))}
              </div>
              {inside ? <button className="btn small study-back" onClick={() => { setBranch(view as "code" | "project"); setView("practice"); }} title="왼쪽 목록이 있는 공부 화면으로">← {view === "code" ? "알고리즘" : "실습"} 목록</button>
                : navActive === "practice" ? <button className="btn primary small" onClick={() => setView("create")}>+ 새 자료</button> : null}
            </div>
          ) : null}
          <Suspense fallback={<p className="small muted">불러오는 중…</p>}>
            {view === "home" ? <HomeHead /> : null}
            {keep("home", <TodayBoard />)}
            {keep("knowledge", <Library />)}
            {keep("code", <CodeStudy />)}
            {keep("project", <ProjectStudy />)}
            {view === "practice" ? <MaterialList /> : null}
            {keep("web", <WebStudy />)}
            {keep("plan", <PlanView />)}
            {view === "create" ? (
              <>
                <div className="study-nav"><button className="btn ghost small" onClick={() => setView("practice")}>← PDF 자료</button><span className="small muted">PDF · 강의 자료 넣기</span></div>
                <div className="view-host view-create">
                  <NewMaterial key={createKey} loadPdfjs={loadPdfjs as never} onStart={async (o) => {
                    const genId = await startMaterial(o);
                    setCreateKey((k) => k + 1);
                    say("기억 정리를 시작했어요. 정리되는 대로 자료 지도에 채워져요.");
                    setBranch("material"); shelfSel.set(`gen:${genId}`); setView("practice");
                  }} />
                </div>
              </>
            ) : null}
          </Suspense>
        </main>
      </div>
      <SourcePeek />
      {toast ? <div id="toast" role="status" className="toast-msg">{toast}</div> : null}
    </div>
  );
}

/* 오늘: 날짜·시계 (11/9 사용자 "날짜·시계만") */
function HomeHead() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);
  return (
    <section className="panel hero home-head">
      <div className="home-when">
        <span className="home-date">{now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}</span>
        <span className="home-clock num">{now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
      </div>
    </section>
  );
}
