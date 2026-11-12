"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";
import { call, errorText, go, later } from "./api";
import type { MaterialRow } from "./knowledgeParts";
import { BRANCH_KEY, loadShelfRows, materialEntries, projectOpen, setBranch, shelfSel, type ShelfEntry } from "./shelf";
import "./library.css";
import MaterialMap from "./MaterialMap";
type MapProps = Omit<Parameters<typeof MaterialMap>[0], "embedded" | "extra">;

/* 공부 › 자료 (11/11 바닐라 renderHome을 React로, 11/12 "같은 틀, 두 얼굴"): 왼쪽은 기억 탭과 같은 자료 목록, 오른쪽은 고른 자료로 할 것.
   값과 동작은 앱(dejipgi-app.js)의 materialsApi가 준다. */
type Goal = { id: string; section: string; part: string; statement: string; support: boolean; recall: string };
type Note = {
  goals: { chosen: string[]; confirming: boolean; objectives: Goal[] } | null; headline: string; text: string; failed: boolean; making: boolean;
  canQuestions: boolean; canConnect: boolean; canResume: boolean; canRestart: boolean; canRemove: boolean;
};
export type Pending = { id: string; title: string; sourceName: string; status: string; label: string; map: boolean; readPage: number; lastPage: number; note: Note };
type Counts = { due: number; fresh: number; good: number; review: number; help: number; read: number; total: number };
type DeckV = { id: string; title: string; pastExam: boolean; objectives: number; items: number; counts: Counts; skipped: string[]; map: boolean; lastPage: number; firstPage: number; growing: Pending | null };
type Mat = { key: string; name: string; open: boolean; count: number; due: number; fresh: number; extra: Pending[]; decks: DeckV[] };
type LooseGroup = { key: string; open: boolean; first: Pending; more: Pending[] };
type Snap = { todayLeft: number; due: number; fresh: number; chunk: number; pendings: number; decks: number; loose: Pending[]; looseGroups?: LooseGroup[]; mats: Mat[]; lib: { status: string; error: string } };
type Api = {
  snapshot(): Snap; startToday(): void; startAll(): void; practice(id: string): void; records(id: string): void; map(id: string): void; read(id: string, page: number): void;
  /** 공부 › 자료 칸에 바로 그리는 자료 지도의 동작(원문 보기 · 문제 풀기 · 문제 만들기, 11/12) */
  mapProps(genId: string): MapProps;
  fold(key: string): void; toggleGoal(id: string, gid: string): void; confirmGoals(id: string): void; makeQuestions(id: string): void; connect(): void;
  resume(id: string): void; restart(id: string): void; remove(id: string): void;
};

export default function MaterialList({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  // 왼쪽 목록은 기억 탭과 같은 목록(shelf.ts): 같은 자료 · 같은 순서 · 같은 묶음
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(() => shelfSel.get());
  // 갈래(자료 · 알고리즘 · 실습)는 위 단추 줄이 바꾼다 — 사이드바 목록만 바뀌고, 알고리즘 문제 · 실습을 누르면 그 화면으로 들어간다(11/12 사용자)
  const [branch, setBr] = useState<Branch>(() => { try { const t = localStorage.getItem(BRANCH_KEY); return t === "code" || t === "project" ? t : "material"; } catch { return "material"; } });
  useEffect(() => { const on = (e: Event) => { const b = (e as CustomEvent<Branch>).detail; if (b) setBr(b); }; window.addEventListener("recaller:branch", on); return () => window.removeEventListener("recaller:branch", on); }, []);
  const reloadKey = `${s.decks}:${s.pendings}:${s.loose.map((p) => p.status).join(",")}`; // 새 자료가 생기거나 다 만들어지면 목록을 다시
  useEffect(() => { let alive = true; loadShelfRows().then((r) => { if (alive) { setRows(r); setError(""); } }).catch((e) => { if (alive) setError(errorText(e)); }); return () => { alive = false; }; }, [reloadKey]);
  useEffect(() => shelfSel.on((k) => setSel(k)), []);
  const pick = (k: string | null) => { setSel(k); if (k) shelfSel.set(k); };

  // 자료 id → 앱이 아는 연습 상태(문제 · 복습 · 만드는 중)
  const decks = s.mats.flatMap((m) => m.decks);
  const pendings = [...s.loose, ...s.mats.flatMap((m) => m.extra), ...decks.flatMap((d) => (d.growing ? [d.growing] : []))];
  const bare = (id: string) => id.replace(/^pending:/, "");
  const deckOf = (genId: string) => decks.find((d) => bare(d.id) === genId) ?? null;
  const pendingOf = (genId: string) => pendings.find((p) => bare(p.id) === genId) ?? null;

  const entries = useMemo<Entry[]>(() => {
    const shelf: Entry[] = materialEntries(rows ?? []);
    const known = new Set(shelf.flatMap((e) => [e.key, ...(e.older ?? []).map((o) => o.key)]));
    // 아직 만드는 중 · 멈춤 · 실패한 자료는 기억 탭에 없지만 공부 탭에는 맨 위에(지도를 보며 기다리거나 이어 만들기)
    const making: Entry[] = s.loose.filter((p) => p.status !== "cards" && !known.has(`gen:${bare(p.id)}`)).map((p) => ({ key: `gen:${bare(p.id)}`, branch: "material", icon: p.status === "failed" ? "⚠" : "⏳",
      title: p.title, sub: p.label, lastAt: new Date().toISOString(), itemIds: [], row: { key: `gen:${bare(p.id)}`, group: "material", kind: "pdf", title: p.title, items: 0, itemIds: [], lastAt: "", keys: [], folderId: null, genId: bare(p.id) } }));
    // 예전 방식으로 만든 문제 묶음(자료 지도 없음)은 맨 아래
    const old: Entry[] = decks.filter((d) => !d.map).map((d) => ({ key: `deck:${d.id}`, branch: "material", icon: "🗂", title: d.title, sub: `문제 ${d.items}`, lastAt: "", itemIds: [],
      row: { key: `deck:${d.id}`, group: "material", kind: "deck", title: d.title, items: d.items, itemIds: [], lastAt: "", keys: [], folderId: null } }));
    return [...making, ...shelf, ...old];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, reloadKey]);
  const list = entries.filter((e) => !q.trim() || e.title.toLowerCase().includes(q.trim().toLowerCase()));
  const curTop = entries.find((e) => e.key === sel || e.older?.some((o) => o.key === sel)) ?? null;
  // 처음엔 고른 것이 없으면 가장 최근 자료
  useEffect(() => { if (!sel && entries.length && rows) later(() => setSel(entries[0].key)); }, [sel, entries, rows]);

  // 화면 높이에 맞춰 두 칸이 각자 스크롤(기억 탭과 같은 높이 계산)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => { const el = box.current; if (!el) return; const top = el.getBoundingClientRect().top; setH(Math.max(420, window.innerHeight - Math.max(0, top) - 14)); };
    fit(); const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); };
  }, []);

  return (
    <div className="lib study-shelf" ref={box} style={h ? { height: h } : undefined}>
      <aside className="lib-side" aria-label="공부할 자료">
        <input className="lib-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" aria-label="목록에서 찾기" />
        <nav className="lib-list">
          {branch !== "material" ? <OtherList branch={branch} q={q} /> : list.map((e) => (
            <button key={e.key} className={`lib-row${curTop?.key === e.key ? " on" : ""}`} onClick={() => pick(e.key)} title={e.title}>
              <span className="lib-ic" aria-hidden>{e.icon}</span>
              <span className="lib-rt"><b>{e.title}</b><small>{e.sub}{e.lastAt && !e.key.startsWith("deck:") && !"⏳⚠".includes(e.icon) ? ` · ${ago(e.lastAt)}` : ""}</small></span>
            </button>
          ))}
          {branch === "material" && !rows && !error ? <p className="lib-empty small muted">불러오는 중…</p> : null}
          {branch === "material" && rows && !list.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 자료가 없어요. 위의 + 새 자료로 PDF를 넣어 보세요."}</p> : null}
        </nav>
      </aside>
      <section className="lib-main">
        <div className="lib-page">
          {error ? <p className="ws-err">{error}</p> : null}
          {branch === "code" ? <CodeLanding /> : branch === "project" ? <ProjectLanding />
            : curTop ? <StudyFace key={curTop.key} top={curTop} pickedKey={sel} onPick={pick} deckOf={deckOf} pendingOf={pendingOf} api={api} />
            : <TodayFace s={s} api={api} />}
        </div>
      </section>
    </div>
  );
}

type Branch = "material" | "code" | "project";
type Entry = ShelfEntry | (Omit<ShelfEntry, "branch"> & { branch: "material" });
const ago = (iso: string) => { if (!iso) return ""; const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
const toMemory = (key: string) => { shelfSel.set(key); setBranch("material"); go("knowledge"); };

function Head({ icon, title, sub, children }: { icon: string; title: string; sub?: string; children?: ReactNode }) {
  return <header className="lib-head"><span className="lib-hic" aria-hidden>{icon}</span><div className="lib-ht"><h2>{title}</h2>{sub ? <p className="small muted">{sub}</p> : null}</div>{children ? <div className="lib-hact">{children}</div> : null}</header>;
}

/* 오늘 풀 PDF 문제 (예전 위 칸) */
function TodayFace({ s, api }: { s: Snap; api: Api }) {
  const head = s.due ? "다시 풀 문제가 기다리고 있어요" : s.fresh ? "새 문제로 시작해 볼까요" : s.pendings ? "자료를 만드는 동안 자료 지도가 채워져요" : s.decks ? "오늘 할 문제를 모두 마쳤어요" : "새 자료로 시작해 볼까요";
  return <>
    <Head icon="📝" title="오늘 풀 PDF 문제" sub={head} />
    <div className="counts sf-counts">
      <div><b className="num">{s.todayLeft}</b><span>오늘 풀 PDF 문제</span></div>
      <div><b className="num">{s.due}</b><span>다시 풀 차례</span></div>
      <div><b className="num">{s.fresh}</b><span>아직 안 푼 문제 (자료당 10개까지)</span></div>
    </div>
    <div className="row">
      {s.todayLeft ? <button className="btn primary" onClick={api.startToday}>오늘 할 것<span className="btn-sub num">{Math.min(s.todayLeft, s.chunk)}문제</span></button> : null}
      <button className={s.todayLeft ? "btn" : "btn primary"} disabled={!(s.due || s.fresh)} onClick={api.startAll}>전체 연습</button>
    </div>
    <p className="small muted">정답을 보기 전에 스스로 떠올려 맞힌 것만 ‘혼자 맞힘’으로 셉니다. 한 번 맞혔다고 끝내지 않고, 간격을 늘려 가며 다시 물어봅니다.</p>
    {s.lib.status === "loading" ? <p className="small muted">Recaller 문제를 불러오는 중…</p> : s.lib.status === "error" ? <div className="note err">{s.lib.error}</div> : null}
  </>;
}

/* 고른 자료의 공부 얼굴 (11/12 "같은 틀, 두 얼굴"): 기억 탭은 그 자료에 남은 것(기억 카드), 여기는 그 자료로 할 것(지도 · 문제 · 이어 하기). */
function StudyFace({ top, pickedKey, onPick, deckOf, pendingOf, api }: { top: Entry; pickedKey: string | null; onPick: (k: string) => void;
  deckOf: (genId: string) => DeckV | null; pendingOf: (genId: string) => Pending | null; api: Api }) {
  const e = top.older?.find((x) => x.key === pickedKey) ?? top;
  const runs = top.older?.length ? <select className="lib-runs" value={e.key} onChange={(x) => onPick(x.target.value)} aria-label="만든 때 고르기">
    {[top, ...top.older].map((x, i) => <option key={x.key} value={x.key}>{i ? "예전 · " : "최신 · "}{day(x.lastAt)}</option>)}</select> : null;
  // 웹 글: 이어서 읽기
  if (e.row.kind === "web") return <>
    <Head icon="🌐" title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`}><button className="btn small" onClick={() => toMemory(e.key)}>기억 보기 →</button></Head>
    <div className="row"><button className="btn primary" onClick={() => go("web", e.row.sourceId ? { id: e.row.sourceId } : undefined)}>이어서 읽기</button></div>
  </>;
  // 예전 문제 묶음(지도 없음)
  if (e.key.startsWith("deck:")) {
    const d = deckOf(e.key.slice(5)) ?? deckOf(bareId(e.key.slice(5)));
    return <><Head icon="🗂" title={e.title} sub="예전 방식으로 만든 문제 묶음" />{d ? <><div className="row sf-acts"><DeckButtons d={d} api={api} primary /></div><DeckMeta d={d} /></> : null}</>;
  }
  const genId = e.row.genId ?? "";
  const d = deckOf(genId), p = pendingOf(genId);
  // 자료 지도를 덮는 화면 대신 여기 오른쪽 칸에 바로 (11/12 사용자 "자료 지도 화면을 버리자"). 줄기 · 구조 · 강의 탭과 문제 풀기는 지도가, 기억 카드는 기억 탭이.
  const extra = <>{runs}{d ? <button className="btn ghost small" onClick={() => api.records(d.id)}>푼 기록</button> : null}
    {e.row.lastAt ? <button className="btn small" onClick={() => toMemory(e.key)}>기억 보기 →</button> : null}</>;
  return <>
    {p && (p.status === "paused" || p.status === "failed" || p.note.goals) ? <PendingNote p={p} api={api} /> : null}
    {d?.growing && (d.growing.status === "paused" || d.growing.status === "failed") ? <PendingNote p={d.growing} api={api} /> : null}
    <MaterialMap key={genId} {...api.mapProps(genId)} embedded extra={extra} />
  </>;
}
const bareId = (id: string) => id.replace(/^pending:/, "");

function DeckButtons({ d, api, primary }: { d: DeckV; api: Api; primary?: boolean }) {
  const c = d.counts;
  return <>
    <button className={primary ? "btn primary" : "btn"} onClick={() => api.practice(d.id)}>{c.due || c.fresh ? `문제 풀기 (${Math.min(c.total, c.due + Math.min(c.fresh, 10))})` : "더 풀기"}</button>
    <button className="btn" onClick={() => api.records(d.id)}>푼 기록</button>
  </>;
}
function DeckMeta({ d }: { d: DeckV }) {
  const c = d.counts, pct = (n: number) => (c.total ? (n / c.total * 100) : 0) + "%";
  return <div className="sf-deck">
    <div className="meta">
      <span className="num">문제 {d.items}</span>
      {c.due ? <span className="chip bad num">다시 풀 차례 {c.due}</span> : null}
      {c.fresh ? <span className="chip num">안 푼 문제 {c.fresh}</span> : null}
      {d.skipped.length ? <span className="chip help num" title={d.skipped.join("\n")}>빠진 문항 {d.skipped.length}</span> : null}
    </div>
    <div className="bar" aria-hidden="true">
      <i className="g" style={{ width: pct(c.good) }} /><i className="r" style={{ width: pct(c.review) }} /><i className="h" style={{ width: pct(c.help + c.read) }} />
    </div>
  </div>;
}

/* 알고리즘 · 실습 갈래 (11/12 사용자 "실습은 실습으로, 알고리즘은 알고리즘으로 자연스럽게, 들어가면 왼쪽 사이드바가 빠지는 느낌"):
   사이드바에는 그 갈래에서 할 것(문제 · 실습), 누르면 그 화면으로 바로 들어간다(넓은 작업 화면, 위 단추 줄의 ← 목록으로 돌아옴). */
type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt?: string };
type RunLite = { id: string; title: string; lastAt: string; ended: boolean; goals: number; cards: number };
const P_STATE: Record<ProblemLite["status"], [string, string]> = { solved: ["풂", "good"], wrong: ["틀림", "bad"], tried: ["푸는 중", "help"], new: ["안 풂", ""] };
function useOther<T>(url: string, pick: (r: unknown) => T[]) {
  const [xs, setXs] = useState<T[] | null>(null);
  useEffect(() => { if (!url) return; let alive = true; call<unknown>(url).then((r) => { if (alive) setXs(pick(r)); }).catch(() => { if (alive) setXs([]); }); return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return xs;
}
const problemsOf = (r: unknown) => ((r as { problems?: ProblemLite[] }).problems ?? []).slice().sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
const runsOf = (r: unknown) => ((r as { runs?: RunLite[] }).runs ?? []).slice().sort((a, b) => b.lastAt.localeCompare(a.lastAt));
export const enterCode = (id?: string) => { setBranch("code"); go("code", id ? { id } : {}); };
export const enterProject = (id?: string) => { setBranch("project"); if (id) projectOpen.id = id; go("project"); if (id) window.dispatchEvent(new CustomEvent("recaller:project-open", { detail: id })); };
function OtherList({ branch, q }: { branch: "code" | "project"; q: string }) {
  const probs = useOther<ProblemLite>(branch === "code" ? "/api/code/problems" : "", problemsOf);
  const runs = useOther<RunLite>(branch === "project" ? "/api/project-course/library" : "", runsOf);
  const f = (t: string) => !q.trim() || t.toLowerCase().includes(q.trim().toLowerCase());
  if (branch === "code") {
    if (!probs) return <p className="lib-empty small muted">불러오는 중…</p>;
    const xs = probs.filter((p) => f(p.title));
    return <>{xs.map((p) => <button key={p.id} className="lib-row" onClick={() => enterCode(p.id)} title={`${p.title} — 풀이 화면으로`}>
      <span className="lib-ic" aria-hidden>⌨</span><span className="lib-rt"><b>{p.title.replace(/^BOJ (\d+)번: /, "$1 · ")}</b><small><span className={`sf-st ${P_STATE[p.status][1]}`}>{P_STATE[p.status][0]}</span>{p.lastAt ? ` · ${ago(p.lastAt)}` : ""}</small></span>
      <span className="lib-go" aria-hidden>→</span></button>)}
      {!xs.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 넣은 문제가 없어요."}</p> : null}</>;
  }
  if (!runs) return <p className="lib-empty small muted">불러오는 중…</p>;
  const xs = runs.filter((r) => f(r.title));
  return <>{xs.map((r) => <button key={r.id} className="lib-row" onClick={() => enterProject(r.id)} title={`${r.title} — 실습 화면으로`}>
    <span className="lib-ic" aria-hidden>🛠</span><span className="lib-rt"><b>{r.title || "(목표를 정하기 전)"}</b><small>{r.ended ? "끝남" : "하는 중"}{r.goals ? ` · 목표 ${r.goals}` : ""} · {ago(r.lastAt)}</small></span>
    <span className="lib-go" aria-hidden>→</span></button>)}
    {!xs.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 실습 기록이 없어요."}</p> : null}</>;
}
function CodeLanding() {
  const probs = useOther<ProblemLite>("/api/code/problems", problemsOf);
  const n = (st: ProblemLite["status"]) => probs?.filter((p) => p.status === st).length ?? 0;
  const wrong = probs?.filter((p) => p.status === "wrong") ?? [];
  return <>
    <Head icon="⌨" title="알고리즘" sub="왼쪽에서 문제를 누르면 풀이 화면으로 바로 들어가요." />
    {probs ? <div className="counts sf-counts">
      <div><b className="num">{n("solved")}</b><span>푼 문제</span></div><div><b className="num">{n("wrong")}</b><span>틀린 문제</span></div><div><b className="num">{n("new") + n("tried")}</b><span>아직 못 푼 문제</span></div>
    </div> : <p className="small muted">불러오는 중…</p>}
    <div className="row sf-acts">
      <button className="btn primary" onClick={() => enterCode()}>새 문제 고르기 →</button>
      {wrong[0] ? <button className="btn" onClick={() => enterCode(wrong[0].id)}>틀린 문제 다시: {wrong[0].title.replace(/^BOJ /, "")}</button> : null}
    </div>
  </>;
}
function ProjectLanding() {
  const runs = useOther<RunLite>("/api/project-course/library", runsOf);
  const going = runs?.find((r) => !r.ended);
  return <>
    <Head icon="🛠" title="실습" sub="왼쪽에서 실습을 누르면 그 실습 화면으로 바로 들어가요." />
    <div className="row sf-acts">
      <button className="btn primary" onClick={() => enterProject()}>실습 화면 열기 →</button>
      {going ? <button className="btn" onClick={() => enterProject(going.id)}>이어 하기: {going.title.slice(0, 30)}</button> : null}
    </div>
  </>;
}

export function PendingNote({ p, api }: { p: Pending; api: Pick<Api, "toggleGoal" | "confirmGoals" | "makeQuestions" | "connect" | "resume" | "restart" | "remove"> }) {
  const n = p.note;
  if (n.goals) {
    const chosen = new Set(n.goals.chosen);
    const groups: Array<{ title: string; list: Goal[] }> = [];
    for (const o of n.goals.objectives) { let g = groups.find(x => x.title === o.section); if (!g) { g = { title: o.section, list: [] }; groups.push(g); } g.list.push(o); }
    return (
      <div className="note row" role="status">
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{n.headline}</strong>
          <div className="goals">
            <p className="small muted">이 목표들로 문제를 만들어요. 필요 없는 건 빼고, 보조 목표 중 필요한 건 더하세요.</p>
            {groups.map(g => (
              <section key={g.title}><h4>{g.title}</h4>
                <ul>{g.list.map(o => (
                  <li key={o.id}><label>
                    <input type="checkbox" checked={chosen.has(o.id)} onChange={() => api.toggleGoal(p.id, o.id)} />
                    <span>{o.part ? <small className="muted part">{o.part}</small> : null}<span><RichInline text={o.statement} /></span>
                      {o.support ? <span className="chip">보조</span> : null}<small className="muted">떠올릴 것: {o.recall}</small></span>
                  </label></li>
                ))}</ul>
              </section>
            ))}
            <div className="row">
              <button className="btn primary" disabled={n.goals.confirming} onClick={() => api.confirmGoals(p.id)}>{n.goals.confirming ? "확정하는 중…" : `이 목표 ${chosen.size}개로 문제 만들기`}</button>
              <span className="small muted">전체 {n.goals.objectives.length}개 중</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`note row${n.failed ? " err" : ""}`} role="status">
      <span style={{ flex: 1, minWidth: 0 }}>{n.text}</span>
      {n.canQuestions ? <button className="btn small" disabled={n.making} onClick={() => api.makeQuestions(p.id)}>{n.making ? "시작하는 중…" : "문제 만들기"}</button> : null}
      {n.canConnect ? <button className="btn small" onClick={api.connect}>ChatGPT 연결</button> : null}
      {n.canResume ? <button className="btn small" onClick={() => api.resume(p.id)}>이어 만들기</button> : null}
      {n.canRestart ? <button className="btn small" onClick={() => api.restart(p.id)}>다시 요청</button> : null}
      {n.canRemove ? <button className="btn small ghost" onClick={() => api.remove(p.id)}>지우기</button> : null}
    </div>
  );
}
