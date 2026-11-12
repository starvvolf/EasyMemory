"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";
import { call, errorText, go, later } from "./api";
import type { MaterialRow } from "./KnowledgeWindow";
import { loadShelfRows, materialEntries, setBranch, shelfSel, type ShelfEntry } from "./shelf";
import "./library.css";

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
  const reloadKey = `${s.decks}:${s.pendings}:${s.loose.map((p) => p.status).join(",")}`; // 새 자료가 생기거나 다 만들어지면 목록을 다시
  useEffect(() => { let alive = true; loadShelfRows().then((r) => { if (alive) { setRows(r); setError(""); } }).catch((e) => { if (alive) setError(errorText(e)); }); return () => { alive = false; }; }, [reloadKey]);
  useEffect(() => shelfSel.on((k) => setSel(k)), []);
  const pick = (k: string | null) => { setSel(k); if (k && k !== TODAY) shelfSel.set(k); };

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
          <button className={`lib-row pin${sel === TODAY ? " on" : ""}`} onClick={() => pick(TODAY)}>
            <span className="lib-ic" aria-hidden>📝</span><span className="lib-rt"><b>오늘 풀 PDF 문제</b><small>{s.todayLeft ? `${s.todayLeft}개 · 다시 풀 차례 ${s.due}` : "오늘 몫은 끝"}</small></span></button>
          {list.map((e) => (
            <button key={e.key} className={`lib-row${curTop?.key === e.key && sel !== TODAY ? " on" : ""}`} onClick={() => pick(e.key)} title={e.title}>
              <span className="lib-ic" aria-hidden>{e.icon}</span>
              <span className="lib-rt"><b>{e.title}</b><small>{e.sub}{e.lastAt && !e.key.startsWith("deck:") && !"⏳⚠".includes(e.icon) ? ` · ${ago(e.lastAt)}` : ""}</small></span>
            </button>
          ))}
          {!rows && !error ? <p className="lib-empty small muted">불러오는 중…</p> : null}
          {rows && !list.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 자료가 없어요. 위의 + 새 자료로 PDF를 넣어 보세요."}</p> : null}
        </nav>
      </aside>
      <section className="lib-main">
        <div className="lib-page">
          {error ? <p className="ws-err">{error}</p> : null}
          {sel === TODAY ? <TodayFace s={s} api={api} />
            : curTop ? <StudyFace key={curTop.key} top={curTop} pickedKey={sel} onPick={pick} deckOf={deckOf} pendingOf={pendingOf} api={api} />
            : <TodayFace s={s} api={api} />}
        </div>
      </section>
    </div>
  );
}

const TODAY = "today";
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
    return <><Head icon="🗂" title={e.title} sub="예전 방식으로 만든 문제 묶음" />{d ? <DeckActions d={d} api={api} /> : null}</>;
  }
  const genId = e.row.genId ?? "";
  const d = deckOf(genId), p = pendingOf(genId);
  const openMap = () => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId } }));
  return <>
    <Head icon={e.icon} title={e.title} sub={[e.pages ? `${e.pages}쪽` : "", day(e.lastAt)].filter(Boolean).join(" · ")}>
      {runs}{e.row.lastAt ? <button className="btn small" onClick={() => toMemory(e.key)}>기억 보기 →</button> : null}
    </Head>
    <div className="row sf-acts">
      <button className="btn primary" onClick={openMap}>자료 지도 열기</button>
      {d ? <DeckActions d={d} api={api} inline /> : p?.note.canQuestions ? <button className="btn" disabled={p.note.making} onClick={() => api.makeQuestions(p.id)}>{p.note.making ? "시작하는 중…" : "문제 만들기"}</button> : null}
    </div>
    {p && !(p.status === "cards" && p.note.canQuestions) ? <PendingNote p={p} api={api} /> : null}
    {d?.growing ? <PendingNote p={d.growing} api={api} /> : null}
    {p && !d && p.status === "cards" ? <p className="small muted">기억 정리는 끝났어요. 문제는 [문제 만들기]로 만들거나, 지도에서 기억마다 플래시카드로 바로 확인할 수 있어요.</p> : null}
    <AreaOverview genId={genId} onOpen={openMap} />
  </>;
}
const bareId = (id: string) => id.replace(/^pending:/, "");

function DeckActions({ d, api, inline }: { d: DeckV; api: Api; inline?: boolean }) {
  const c = d.counts, pct = (n: number) => (c.total ? (n / c.total * 100) : 0) + "%";
  const btns = <>
    <button className={inline ? "btn" : "btn primary"} onClick={() => api.practice(d.id)}>{c.due || c.fresh ? `문제 풀기 (${Math.min(c.total, c.due + Math.min(c.fresh, 10))})` : "더 풀기"}</button>
    <button className="btn ghost small" onClick={() => api.records(d.id)}>푼 기록</button>
  </>;
  return <>
    {inline ? btns : <div className="row sf-acts">{btns}</div>}
    <div className="sf-deck">
      <div className="meta">
        <span className="num">문제 {d.items}</span>
        {c.due ? <span className="chip bad num">다시 풀 차례 {c.due}</span> : null}
        {c.fresh ? <span className="chip num">안 푼 문제 {c.fresh}</span> : null}
        {d.skipped.length ? <span className="chip help num" title={d.skipped.join("\n")}>빠진 문항 {d.skipped.length}</span> : null}
      </div>
      <div className="bar" aria-hidden="true">
        <i className="g" style={{ width: pct(c.good) }} /><i className="r" style={{ width: pct(c.review) }} /><i className="h" style={{ width: pct(c.help + c.read) }} />
      </div>
    </div>
  </>;
}

/* 이 자료에서 배울 차례: 줄기 영역마다 기억 수 · 몰랐던 것 · 복습 차례. 누르면 자료 지도 (기억 카드 자체는 기억 탭에서). */
type AreaLite = { id: string; title: string; pages: number[]; cards: Array<{ state: string; dueAt?: string | null }> };
function AreaOverview({ genId, onOpen }: { genId: string; onOpen: () => void }) {
  const [areas, setAreas] = useState<AreaLite[] | null | undefined>(undefined);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    call<{ map: { sections: AreaLite[] } }>(`/api/study-map/${genId}`).then((r) => { if (alive) { setAreas(r.map.sections); setNow(Date.now()); } }).catch(() => { if (alive) setAreas(null); });
    return () => { alive = false; };
  }, [genId]);
  if (areas === undefined) return <p className="small muted">불러오는 중…</p>;
  if (!areas?.length) return null;
  const range = (ps: number[]) => ps.length ? (ps[0] === ps.at(-1) ? `p.${ps[0]}` : `p.${ps[0]}–${ps.at(-1)}`) : "";
  return <section className="sf-areas">
    <p className="eyebrow">배울 차례</p>
    <ol>{areas.map((a, i) => {
      const unknown = a.cards.filter((c) => c.state === "unknown").length, due = a.cards.filter((c) => c.dueAt && Date.parse(c.dueAt) <= now).length;
      const fresh = a.cards.filter((c) => c.state === "new" || c.state === "met").length;
      return <li key={a.id}><button className="sf-area" onClick={onOpen}>
        <span className="sf-n num">{i + 1}</span><b>{a.title}</b><span className="small muted">{range(a.pages)}</span><span className="cs-gap" />
        <span className="small muted num">기억 {a.cards.length}</span>
        {unknown ? <span className="chip bad num">몰랐음 {unknown}</span> : null}
        {due ? <span className="chip num">복습 {due}</span> : null}
        {!unknown && !due && fresh === a.cards.length ? <span className="chip num">처음</span> : null}
      </button></li>;
    })}</ol>
  </section>;
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
