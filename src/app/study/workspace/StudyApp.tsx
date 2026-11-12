"use client";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";
import MaterialList from "./MaterialList";
import PracticeSession from "./PracticeSession";
import OnePageSummary from "./OnePageSummary";
import StudyRecords from "./StudyRecords";
import ArchiveView from "./ArchiveView";
import NewMaterial from "./NewMaterial";
import ReaderView from "./reader/ReaderView";
import ReaderOverlays from "./reader/ReaderOverlays";
import type { FlowApi } from "../FlowBench";

/* 공부 화면 전체 (11/11 사용자 "리액트로 다 싹 다"). 상태·채점·기록·복습 날짜는 앱(dejipgi-app.js)이 들고, 이 화면은 그 값을 그린다.
   한 번 연 큰 화면(알고리즘·실습·웹 글·기억·기록·오늘·작업대)은 다른 화면에 갔다 와도 그대로 남게 숨겨 둔다(예전 viewHost와 같은 뜻). */
const TodayBoard = lazy(() => import("./TodayBoard"));
const Library = lazy(() => import("./Library")); // 11/11 기억 탭 → 기억 도서관(사용자 "완전히 바꿈")
const CodeStudy = lazy(() => import("./CodeStudy"));
const ProjectStudy = lazy(() => import("./ProjectStudy"));
const WebStudy = lazy(() => import("./WebStudy"));
const PlanView = lazy(() => import("./PlanView"));
const FlowBench = lazy(() => import("../FlowBench"));

type Api<T> = T extends (p: { ui: Bridge; api: infer A }) => unknown ? A : never;
type KnowledgeLegacy = {
  subjects: Array<{ key: string; label: string; dday: string; n: number | null }> | null; cur: string; subject: string; total: number; filter: string;
  counts: { weak: number; new: number; good: number; mastered: number }; states: Record<string, { label: string; cls: string }>; sel: string | null;
  detail: { key: string; state: string; title: string; section: string; essentials: string[]; items: number; spans: Array<{ deckId: string; page: number; mat: string; n: number; quote: string }> } | null;
  groups: Array<{ name: string; points: Array<{ key: string; title: string; state: string; items: number }> }>;
};
type Snap = {
  view: string; group: string; session: boolean; overlay: boolean; legacy: boolean;
  suggest: { n: number; from: string; list: string[] } | null; account: { ready: boolean; message: string } | null;
  create: { engineReady: boolean; devEngines: boolean; noteSeed: string; key: number }; store: string; toast: string;
  tablet: { open: false } | { open: true; urls: string[]; live: boolean; code: string; hadCode: boolean; left: string; devices: number; err: string } | null;
  prompts: boolean; knowledgeLegacy: KnowledgeLegacy | null; flow: boolean;
};
type ShellApi = {
  snapshot(): Snap; tab(v: string): void; go(v: string): void; leaveToPractice(): void; legacy(on: boolean): void; suggestAll(): void; suggestKeep(): void;
  connect(): void; disconnect(): void; loadPdfjs: ComponentProps<typeof NewMaterial>["loadPdfjs"]; startMaterial: ComponentProps<typeof NewMaterial>["onStart"];
  prompts(): void; toast(m: string): void; tablet: { toggle(force?: boolean): void; code(): void; revoke(): void };
  kp: { subject(k: string): void; filter(k: string): void; pick(k: string): void; practice(k: string): void; read(id: string, page: number): void; summary(): void };
  flowApi: FlowApi;
  apis: {
    materials: Api<typeof MaterialList>; session: Api<typeof PracticeSession>; summary: Api<typeof OnePageSummary>; records: Api<typeof StudyRecords>;
    archive: Api<typeof ArchiveView>; reader: Api<typeof ReaderView>; overlays: Api<typeof ReaderOverlays>;
  };
};

const TABS: Array<[string, string]> = [["home", "오늘"], ["practice", "공부"], ["knowledge", "기억"], ["plan", "기록"]];
const KEEP = ["home", "knowledge", "code", "project", "web", "plan", "bench"] as const;
type Keep = (typeof KEEP)[number];

export default function StudyApp({ ui, api }: { ui: Bridge; api: ShellApi }) {
  useBridge(ui);
  const s = api.snapshot();
  const A = api.apis;
  // 한 번 연 큰 화면은 남겨 둔다
  const [seen, setSeen] = useState<Set<Keep>>(() => new Set());
  const wanted: Keep | null = s.view === "practice" && !s.session ? "web" : (KEEP as readonly string[]).includes(s.view) && !(s.view === "knowledge" && s.legacy) ? (s.view as Keep) : null;
  if (wanted && !seen.has(wanted)) setSeen(new Set([...seen, wanted]));
  const shown = (k: Keep) => (k === "web" ? s.view === "web" || (s.view === "practice" && !s.session) : s.view === k && !(k === "knowledge" && s.legacy));
  const keep = (k: Keep, node: ReactNode) => seen.has(k) || wanted === k ? <div key={k} className={`view-host view-${k}`} hidden={!shown(k)}>{node}</div> : null;

  const studyNav = s.view === "code" || s.view === "project" || s.view === "web" || s.view === "start" || (s.view === "practice" && !s.session);
  const navActive = s.view === "web" || s.view === "start" ? "practice" : s.view;
  return (
    <>
      <Header s={s} api={api} />
      {s.suggest ? (
        <section className="panel suggest">
          <p><b>비슷한 목표 {s.suggest.n}개도 뺄까요?</b><span className="small muted"> ‘{s.suggest.from}’를 뺐어요.</span></p>
          <ul className="small">{s.suggest.list.map((t, i) => <li key={i}><RichInline text={t} /></li>)}</ul>
          <div className="row"><button className="btn small primary" onClick={api.suggestAll}>모두 빼기</button><button className="btn small ghost" onClick={api.suggestKeep}>그대로 두기</button></div>
        </section>
      ) : null}
      {studyNav ? (
        <div className="study-nav">
          <div className="seg study-seg" role="tablist" aria-label="공부 종류">
            {/* 11/9 사용자 "웹글 PDF 그냥 하나로 합치는 거지 UI를": PDF 자료·웹 글 갈래를 "자료" 하나로(웹 글은 자료 목록 아래에). */}
            {[["practice", "자료"], ["code", "알고리즘"], ["project", "실습"]].map(([v, label]) => (
              <button key={v} role="tab" aria-selected={navActive === v} className={navActive === v ? "on" : ""} onClick={() => (v === "practice" ? api.leaveToPractice() : api.tab(v))}>{label}</button>
            ))}
          </div>
          {navActive === "practice" ? <button className="btn primary small" onClick={() => api.go("create")}>+ 새 자료</button> : null}
        </div>
      ) : null}
      <Suspense fallback={<p className="small muted">불러오는 중…</p>}>
        {s.view === "home" ? <HomeHead /> : null}
        {keep("home", <TodayBoard />)}
        {s.view === "knowledge" && s.legacy && s.knowledgeLegacy ? <LegacyKnowledge k={s.knowledgeLegacy} api={api} /> : null}
        {keep("knowledge", <Library />)}
        {keep("code", <CodeStudy />)}
        {keep("project", <ProjectStudy />)}
        {(s.view === "practice" && !s.session) || s.view === "start" ? <MaterialList ui={ui} api={A.materials} /> : null}
        {s.view === "practice" && !s.session ? <h3 className="study-sub">웹 글</h3> : null}
        {keep("web", <WebStudy />)}
        {s.view === "practice" && s.session ? <PracticeSession ui={ui} api={A.session} /> : null}
        {keep("plan", <PlanView />)}
        {keep("bench", s.flow ? <FlowBench api={api.flowApi} /> : <div className="panel small muted">작업대 흐름은 로컬 실험 모드(ChatGPT 로그인)에서 쓸 수 있어요.</div>)}
        {s.view === "archive" ? <ArchiveView ui={ui} api={A.archive} /> : null}
        {s.view === "create" ? (
          <>
            <div className="study-nav"><button className="btn ghost small" onClick={() => api.go("practice")}>← PDF 자료</button><span className="small muted">PDF · 강의 자료 넣기</span></div>
            {/* 11/12 점검 17번: 연결돼 있으면 안내를 띄우지 않는다(연결 해제는 위 "ChatGPT 연결됨" 칩 안에 있다) — 연결이 안 됐을 때만 알린다 */}
            {s.account && !s.account.ready ? (
              <div className="note row warn" role="status"><span style={{ flex: 1, minWidth: 0 }}>{s.account.message}</span>
                <button className="btn small" onClick={api.connect}>ChatGPT 연결</button></div>
            ) : null}
            <div className="view-host view-create">
              <NewMaterial key={s.create.key} engineReady={s.create.engineReady} devEngines={s.create.devEngines} noteSeed={s.create.noteSeed} loadPdfjs={api.loadPdfjs} onStart={api.startMaterial} />
            </div>
          </>
        ) : null}
        {s.view === "read" ? (
          <>
            <div className="view-host view-reader"><ReaderView ui={ui} api={A.reader} /></div>
            {s.overlay ? (
              <div className="checklayer" role="dialog" aria-modal="true" aria-label="확인 문제" onClick={(e) => { if (e.target === e.currentTarget) A.session.close(); }}>
                <div className="checkbox"><div className="view-host view-session"><PracticeSession ui={ui} api={A.session} /></div></div>
              </div>
            ) : null}
          </>
        ) : null}
        {s.view === "summary" ? <div className="view-host view-summary"><OnePageSummary ui={ui} api={A.summary} /></div> : null}
        {s.view === "records" ? <div className="view-host view-records"><StudyRecords ui={ui} api={A.records} /></div> : null}
      </Suspense>
      <div className="view-host view-overlays"><ReaderOverlays ui={ui} api={A.overlays} /></div>
      {s.toast ? <div id="toast" role="status" className="toast-msg">{s.toast}</div> : null}
    </>
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

/* 메뉴 탭과 머리 단추(전체화면·태블릿·프롬프트·저장 표시): 바깥 틀(DejipgiStudy)이 비워 둔 자리에 그린다. */
function Header({ s, api }: { s: Snap; api: ShellApi }) {
  // 바깥 틀은 이 화면보다 먼저 그려져 있다(이 화면은 그 안의 #app에 붙는다).
  const slots = { tabs: document.getElementById("tabs"), tools: document.getElementById("shellTools") };
  return (
    <>
      {slots.tabs ? createPortal(TABS.map(([v, label]) => <button key={v} role="tab" data-view={v} aria-selected={s.group === v} onClick={() => api.tab(v)}>{label}</button>), slots.tabs) : null}
      {slots.tools ? createPortal(
        <>
          <FullscreenButton onFail={() => api.toast("이 브라우저에서는 전체화면을 쓸 수 없어요.")} />
          {s.tablet ? <button className="tablet-btn" id="tabletBtn" title="같은 와이파이의 태블릿에서 열기" onClick={() => api.tablet.toggle()}>📱 태블릿</button> : null}
          {s.prompts ? <button className="tablet-btn" id="promptBtn" title="설명·답변·용어 풀이를 어떻게 해 줄지 정해요" onClick={api.prompts}>⚙ 프롬프트</button> : null}
          <span className="store" id="store" data-mode={s.store}><i></i><span id="storeText">{s.store === "local" ? "이 브라우저에만 저장" : "저장 안 됨 · 새로고침하면 사라짐"}</span></span>
        </>, slots.tools) : null}
      {s.tablet && s.tablet.open ? <TabletCard t={s.tablet} api={api} /> : null}
    </>
  );
}

/* 전체화면 (touch screens): hides the browser's address and tab bars. */
function FullscreenButton({ onFail }: { onFail(): void }) {
  type Doc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
  const doc = typeof document !== "undefined" ? (document as Doc) : null;
  const [fs, setFs] = useState(false);
  const can = useRef(false);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!doc) return;
    let touch = false; try { touch = matchMedia("(pointer: coarse)").matches; } catch { /* 모르면 단추를 안 보인다 */ }
    can.current = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && touch;
    const on = () => setFs(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", on); document.addEventListener("webkitfullscreenchange", on);
    const t = setTimeout(() => setOk(can.current), 0);
    return () => { clearTimeout(t); document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
  }, [doc]);
  if (!ok || !doc) return null;
  return (
    <button className="tablet-btn" id="fsBtn" title="주소창과 탭을 숨기고 화면을 꽉 채워요" onClick={async () => {
      const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) await (doc.exitFullscreen || doc.webkitExitFullscreen)!.call(doc);
        else await (de.requestFullscreen || de.webkitRequestFullscreen)!.call(de, { navigationUI: "hide" });
      } catch { onFail(); }
    }}>{fs ? "전체화면 끝내기" : "⛶ 전체화면"}</button>
  );
}

function TabletCard({ t, api }: { t: Extract<NonNullable<Snap["tablet"]>, { open: true }>; api: ShellApi }) {
  return (
    <aside className="tablet-card" id="tabletCard" role="dialog" aria-label="태블릿 연결">
      <div className="row" style={{ justifyContent: "space-between" }}><strong>태블릿에서 열기</strong><button className="dclose" aria-label="닫기" onClick={() => api.tablet.toggle(false)}>✕</button></div>
      <ol className="tablet-steps">
        <li>태블릿을 이 컴퓨터와 <b>같은 와이파이</b>에 연결해요.</li>
        <li>태블릿 브라우저 주소창에 이렇게 쳐요:
          {t.urls.length ? t.urls.map((u, i) => <div key={u} className={"tablet-url" + (i ? " alt" : "")}>{u}</div>) : <div className="small muted">이 컴퓨터의 와이파이 주소를 찾지 못했어요. 와이파이 연결을 확인해 주세요.</div>}
          {t.urls.length > 1 ? <div className="small muted">첫 번째 주소가 안 열리면 아래 주소를 써 보세요.</div> : null}</li>
        <li>태블릿에 나온 칸에 이 코드를 넣어요:
          {t.live ? <div className="tablet-code"><b>{t.code}</b><span className="small muted"> {t.left} 남음</span></div>
            : <button className="btn primary small" style={{ marginTop: 6 }} onClick={api.tablet.code}>{t.hadCode ? "새 코드 받기" : "연결 코드 받기"}</button>}</li>
      </ol>
      <p className="small muted">한 번 연결한 태블릿은 다음부터 코드 없이 열려요. 기록은 이 컴퓨터에 저장돼서, 컴퓨터가 켜져 있고 앱이 떠 있어야 해요. 처음 한 번 Windows가 네트워크 허용을 물으면 ‘개인 네트워크’를 허용해 주세요.</p>
      {t.devices ? <div className="row small" style={{ justifyContent: "space-between" }}><span className="muted">연결된 기기 {t.devices}대</span><button className="linkish" onClick={api.tablet.revoke}>모두 끊기</button></div> : null}
      {t.err ? <p className="check">{t.err}</p> : null}
    </aside>
  );
}

/* 자료별 기억 포인트 (예전 화면, 새 기억창에서 한 번 눌러 온다) */
function LegacyKnowledge({ k, api }: { k: KnowledgeLegacy; api: ShellApi }) {
  const a = api.kp, d = k.detail;
  return (
    <div className="stack">
      <div className="row"><button className="btn small ghost" onClick={() => api.legacy(false)}>← 새 기억창으로</button></div>
      {k.subjects ? (
        <div className="row subj-chips" role="group" aria-label="과목">
          {k.subjects.map(x => <button key={x.key || "-"} className="subj-chip" aria-pressed={k.cur === x.key} onClick={() => a.subject(x.key)}><b>{x.label}</b>{x.n != null ? <span className={`dday${x.n >= 0 && x.n <= 3 ? " soon" : ""}${x.n < 0 ? " past" : ""}`}>{x.dday}</span> : null}</button>)}
        </div>
      ) : null}
      {!k.total ? <div className="panel small muted">이 과목에는 아직 기억 포인트가 없어요. 자료를 넣고 문제를 만들면 생겨요.</div> : (
        <div className="kp-split">
          <section className="panel kp-list">
            <div className="row" style={{ justifyContent: "space-between" }}><h2>{k.subject || "전체"} · 기억 포인트 {k.total}</h2><button className="btn small ghost" onClick={a.summary}>한 장 정리</button></div>
            <div className="chat-sugs">{[["all", `전체 ${k.total}`], ["weak", `약점 ${k.counts.weak}`], ["new", `안 풀어봄 ${k.counts.new}`], ["good", `혼자 맞힘 ${k.counts.good + k.counts.mastered}`]].map(([key, label]) =>
              <button key={key} className="chip-btn" aria-pressed={k.filter === key} onClick={() => a.filter(key)}>{label}</button>)}</div>
            {k.groups.map(g => (
              <div key={g.name} className="kp-group"><p className="eyebrow">{g.name}</p>
                <ul>{g.points.map(p => (
                  <li key={p.key}><button className={`kp-row${k.sel === p.key ? " on" : ""}`} onClick={() => a.pick(p.key)}>
                    <span className={`chip ${k.states[p.state]?.cls ?? ""}`}>{k.states[p.state]?.label}</span><span className="kp-title"><RichInline text={p.title} /></span>
                    <span className="small muted num">{p.items ? `문제 ${p.items}` : ""}</span></button></li>
                ))}</ul></div>
            ))}
          </section>
          <section className="panel kp-detail">
            {!d ? <p className="muted">왼쪽에서 기억 포인트를 고르면 원문 근거와 문제가 보여요.</p> : (
              <>
                <div className="row" style={{ gap: 8 }}><span className={`chip ${k.states[d.state]?.cls ?? ""}`}>{k.states[d.state]?.label}</span>{d.section ? <span className="small muted">{d.section}</span> : null}</div>
                <h2 className="kp-name"><RichInline text={d.title} /></h2>
                {d.essentials.length ? <ul className="kp-ess">{d.essentials.map((e, i) => <li key={i}><RichInline text={e} /></li>)}</ul> : null}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn primary" disabled={!d.items} onClick={() => a.practice(d.key)}>{d.items ? `이 기억 문제 풀기 · ${d.items}` : "묶인 문제 없음"}</button>
                  {d.spans.length ? <button className="btn" onClick={() => a.read(d.spans[0].deckId, d.spans[0].page)}>원문 읽기 p.{d.spans[0].page}</button> : null}
                </div>
                <p className="eyebrow" style={{ marginTop: 16 }}>원문 근거 {d.spans.length}</p>
                <ul className="kp-spans">{d.spans.map((x, i) => (
                  <li key={i}><button className="linkish" onClick={() => a.read(x.deckId, x.page)}>{x.mat} p.{x.page}</button>
                    {x.n > 1 ? <span className="small muted"> (문제 세트 {x.n}개)</span> : null}{x.quote ? <div className="small muted">{x.quote}</div> : null}</li>
                ))}</ul>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
