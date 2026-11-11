"use client";
// 기억 도서관 (2026-11-11 사용자 "기억 탭을 없애자 … 왼쪽에는 뭐 했는지 있는 목록, 메인 화면은 그 목록 누르면 보여줘야 되는 것들, 밑에다가 채팅창 하나.
// 기억을 다시 보는 도서관 같은 걸"): 예전 기억 탭(KnowledgeTabs · 폴더 기억 창)을 통째로 바꾼다(사용자 "완전히 바꿈").
//   위: 갈래 셋(자료 · 알고리즘 · 실습) / 왼쪽: 그 갈래에서 한 것 목록 / 가운데: 고른 것의 내용 / 아래: 이 내용을 두고 AI에게 묻는 채팅.
//   실습은 "실습 한 판 정리"(지나온 목표 · 기억 카드 · 막힌 순간 · 받아 쓴 것, 실습 서버 lib/library.ts) — 사용자 고름.
//   채팅은 기존 /api/knowledge/ask(내 기억 전체 요약 + 지금 화면 글 + 관련 기억)를 쓴다. 묻는 만큼 AI 사용량이 든다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText, go, handoff, later, type ItemLite, type Tree } from "./api";
import { MaterialArticle, StateChip, tidyLine, type MaterialRow } from "./KnowledgeWindow";
import LearnerNote from "./LearnerNote";
import { Inline } from "./Rich";
import "./library.css";

type Branch = "material" | "code" | "project";
const BRANCHES: Array<[Branch, string]> = [["material", "자료"], ["code", "알고리즘"], ["project", "실습"]];
const KEY = "recaller:lib-branch";
type Entry = { key: string; branch: Branch; icon: string; title: string; sub: string; lastAt: string; itemIds: string[]; row?: MaterialRow; runId?: string; pages?: number };
type RunRow = { id: string; title: string; createdAt: string; lastAt: string; ended: boolean; goals: number; cards: number; moments: number; gaps: number };
type Msg = { role: "me" | "ai"; text: string };

const ago = (iso: string) => { if (!iso) return ""; const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };

export default function Library() {
  const [branch, setBranch] = useState<Branch>(() => { try { const t = localStorage.getItem(KEY); return t === "code" || t === "project" ? t : "material"; } catch { return "material"; } });
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [runsOnline, setRunsOnline] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [v, t, g, lib] = await Promise.all([call<{ materials: MaterialRow[] }>("/api/knowledge/material-view"), call<Tree>("/api/knowledge"),
        call<{ runs: Array<{ id: string; createdAt: string; status: string; fileName: string; pages: number[]; sectionCount?: number }> }>("/api/lab/gen?origin=study").catch(() => ({ runs: [] })),
        call<{ online: boolean; runs: RunRow[] }>("/api/project-course/library").catch(() => ({ online: false, runs: [] as RunRow[] }))]);
      // 자료(PDF)는 실제로 만든 자료(study-gen) 기준, 기억은 같은 자료 줄(genId)에서 가져온다
      const pdfRows = v.materials.filter((r) => r.group === "material" && r.kind === "pdf");
      const pdfs: MaterialRow[] = g.runs.filter((r) => r.status === "done" || r.status === "cards").map((r) => {
        const same = pdfRows.find((x) => x.genId === r.id);
        return { key: `gen:${r.id}`, group: "material", kind: "pdf", title: r.fileName.replace(/\.pdf$/i, ""), items: same?.items ?? r.sectionCount ?? 0, itemIds: same?.itemIds ?? [],
          lastAt: same?.lastAt && same.lastAt > r.createdAt ? same.lastAt : r.createdAt, keys: same?.keys ?? [], folderId: null, genId: r.id, pages: r.pages.length } as MaterialRow & { pages: number };
      });
      setRows([...pdfs, ...v.materials.filter((r) => !(r.group === "material" && r.kind === "pdf"))]); setItems(t.items);
      setRuns(lib.runs); setRunsOnline(lib.online);
    } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => later(() => void load()), [load]);
  // 다른 화면에서 "이 기억 보기"로 왔을 때(go("knowledge", { id }))
  useEffect(() => {
    const open = (id?: string) => { if (id) { setItemId(id); handoff.knowledgeId = undefined; } };
    open(handoff.knowledgeId);
    const on = (e: Event) => open((e as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener("recaller:knowledge-focus", on);
    return () => window.removeEventListener("recaller:knowledge-focus", on);
  }, []);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const entries = useMemo<Entry[]>(() => {
    const mat: Entry[] = (rows ?? []).filter((r) => r.group !== "project").map((r) => ({ key: r.key, branch: r.group as Branch, row: r, itemIds: r.itemIds, lastAt: r.lastAt, title: r.title,
      icon: r.kind === "web" ? "🌐" : r.group === "code" ? "⌨" : "📄", pages: (r as MaterialRow & { pages?: number }).pages,
      sub: r.key.startsWith("gen:") ? `${(r as MaterialRow & { pages?: number }).pages ?? "?"}쪽 · 기억 ${r.items}` : `기억 ${r.items}` }));
    // 실습: 실습 서버의 대화 실습 한 줄씩 + 그 실습에서 앱 기억으로 넘어간 것(ref project:<runId>)
    const projRows = (rows ?? []).filter((r) => r.group === "project");
    const proj: Entry[] = (runs ?? []).map((r) => {
      const mine = projRows.filter((x) => x.keys.includes(`code:project:${r.id}`)).flatMap((x) => x.itemIds);
      return { key: `run:${r.id}`, branch: "project", runId: r.id, icon: "🛠", title: r.title || "(목표를 정하기 전)", lastAt: r.lastAt, itemIds: mine,
        sub: [r.goals ? `목표 ${r.goals}` : "", r.cards ? `카드 ${r.cards}` : "", r.moments ? `막힘 ${r.moments}` : ""].filter(Boolean).join(" · ") || "기록 없음" };
    });
    return [...mat, ...proj].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [rows, runs]);
  const list = entries.filter((e) => e.branch === branch && (!q.trim() || e.title.toLowerCase().includes(q.trim().toLowerCase())));
  const cur = entries.find((e) => e.key === sel) ?? null;
  const pick = (b: Branch) => { setBranch(b); setSel(null); setItemId(null); try { localStorage.setItem(KEY, b); } catch { /* storage off */ } };
  const choose = (k: string | null) => { setSel(k); setItemId(null); };

  // 화면 높이에 맞춰 세 칸이 각자 스크롤되게(앱 머리 아래부터 창 끝까지)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => { const el = box.current; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; setH(Math.max(420, window.innerHeight - Math.max(0, top - window.scrollY) - 14)); };
    fit(); const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); };
  }, []);

  const main = useRef<HTMLDivElement>(null);
  const counts = (b: Branch) => entries.filter((e) => e.branch === b).length;
  const empty = !rows ? "불러오는 중…" : branch === "material" ? "아직 자료가 없어요. 공부 › 자료에서 PDF나 웹 글로 자료를 만들면 여기 꽂혀요."
    : branch === "code" ? "아직 알고리즘 기억이 없어요. 문제를 풀면 여기 꽂혀요." : !runsOnline ? "실습 서버가 꺼져 있어 실습 목록을 못 불러왔어요. 실습 탭을 열면 켜져요." : "아직 실습 기록이 없어요.";

  return (
    <div className="lib" ref={box} style={h ? { height: h } : undefined}>
      <aside className="lib-side" aria-label="기억 목록">
        <div className="lib-seg" role="tablist" aria-label="기억 갈래">{BRANCHES.map(([b, label]) => (
          <button key={b} role="tab" aria-selected={branch === b} className={branch === b ? "on" : ""} onClick={() => pick(b)}>{label}{rows ? <small>{counts(b)}</small> : null}</button>
        ))}</div>
        <input className="lib-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" aria-label="목록에서 찾기" />
        <nav className="lib-list">
          {branch === "project" ? <button className={`lib-row pin${sel === "note" ? " on" : ""}`} onClick={() => choose("note")}>
            <span className="lib-ic" aria-hidden>📒</span><span className="lib-rt"><b>나의 학습 노트</b><small>모든 실습을 모은 한 장</small></span></button> : null}
          {list.map((e) => (
            <button key={e.key} className={`lib-row${sel === e.key ? " on" : ""}`} onClick={() => choose(e.key)} title={e.title}>
              <span className="lib-ic" aria-hidden>{e.icon}</span>
              <span className="lib-rt"><b>{e.title}</b><small>{e.sub}{e.lastAt ? ` · ${ago(e.lastAt)}` : ""}</small></span>
            </button>
          ))}
          {!list.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : empty}</p> : null}
        </nav>
      </aside>
      <section className="lib-main">
        <div className="lib-page" ref={main}>
          {error ? <p className="ws-err">{error}</p> : null}
          {itemId ? <ItemView id={itemId} onBack={() => setItemId(null)} backLabel={cur ? `← ${cur.title}` : "← 목록으로"} onPick={setItemId} />
            : sel === "note" ? <><Head icon="📒" title="나의 학습 노트" sub="여러 실습에서 드러난 아직 모르는 것 · 자꾸 틀리는 것 · 이제 되는 것 · 내 환경" /><LearnerNote /></>
            : cur ? <EntryView e={cur} byId={byId} onItem={setItemId} />
            : <Welcome branch={branch} n={list.length} />}
        </div>
        <Chat key={sel ?? branch} pageRef={main} focusIds={itemId ? [itemId] : (cur?.itemIds ?? []).slice(0, 6)}
          where={itemId ? `기억 하나: ${byId.get(itemId)?.title ?? ""}` : sel === "note" ? "나의 학습 노트" : cur ? `${BRANCHES.find((b) => b[0] === cur.branch)?.[1]} · ${cur.title}` : `${BRANCHES.find((b) => b[0] === branch)?.[1]} 목록`} />
      </section>
    </div>
  );
}

function Head({ icon, title, sub, children }: { icon: string; title: string; sub?: string; children?: ReactNode }) {
  return <header className="lib-head"><span className="lib-hic" aria-hidden>{icon}</span><div className="lib-ht"><h2>{title}</h2>{sub ? <p className="small muted">{sub}</p> : null}</div>{children ? <div className="lib-hact">{children}</div> : null}</header>;
}
function Welcome({ branch, n }: { branch: Branch; n: number }) {
  const what = branch === "material" ? "읽은 자료" : branch === "code" ? "푼 문제" : "해 본 실습";
  return <div className="lib-welcome"><p className="lib-big">📚</p><h2>기억 도서관</h2><p className="muted">왼쪽에서 {what}{n ? ` ${n}개` : ""} 중 하나를 고르면, 그때 남은 기억이 여기 펼쳐져요.<br />아래 채팅에 물으면 내 기억을 보고 답해요.</p></div>;
}

function ItemList({ ids, byId, onItem }: { ids: string[]; byId: Map<string, ItemLite>; onItem: (id: string) => void }) {
  const xs = ids.map((id) => byId.get(id)).filter((i): i is ItemLite => Boolean(i));
  if (!xs.length) return <p className="small muted">아직 여기서 넘어온 기억이 없어요.</p>;
  return <ul className="lib-items">{xs.map((i) => <li key={i.id}><button className="lib-item" onClick={() => onItem(i.id)}>
    <span className="lib-it"><StateChip state={i.state} graduated={i.graduated} /><b><Inline text={i.title} /></b></span>
    {i.line ? <span className="lib-il"><Inline text={tidyLine(i.line)} /></span> : null}</button></li>)}</ul>;
}

function EntryView({ e, byId, onItem }: { e: Entry; byId: Map<string, ItemLite>; onItem: (id: string) => void }) {
  if (e.branch === "project" && e.runId) return <RunView e={e} byId={byId} onItem={onItem} />;
  if (e.branch === "material" && e.row?.kind === "web" && e.row.sourceId) return <><Head icon="🌐" title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`} /><MaterialArticle id={e.row.sourceId} onChanged={() => {}} /></>;
  return <>
    <Head icon={e.icon} title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`}>
      {e.row?.genId ? <button className="btn small" onClick={() => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: e.row!.genId } }))}>자료 지도 열기 ↗</button> : null}
      {e.branch === "code" ? <button className="btn ghost small" onClick={() => go("code")}>알고리즘 탭에서 보기</button> : null}
    </Head>
    <p className="eyebrow">여기서 생긴 기억</p>
    <ItemList ids={e.itemIds} byId={byId} onItem={onItem} />
  </>;
}

/* ---------- 실습 한 판 정리 ---------- */
type Card = { name: string; situation: string; did: string; quote: string; learned: string; next: string; how: string; recheck: string };
type GoalRec = { goal: string; status: string; summary: string; steps: string[]; from: string; to: string; cards: Card[] };
type PGoal = { title: string; at: string; endAt: string | null; result: string; gaps: Array<{ id: string; name: string; wrong: string; status: string }> };
type Moment = { id: string; goal: string; by: string; command?: string; error?: string; gap?: string; reasons?: string; said: string[]; tries: number; how?: string; seconds: number; changed: Array<{ file: string; diff: string[] }> };
type RunLib = { online: boolean; title?: string; map?: string[]; current?: string | null; goals?: GoalRec[]; path?: PGoal[]; moments?: Moment[]; chunks?: Array<{ name: string; result: string | null; debts: string[] }> };
const RES: Record<string, string> = { 마침: "ok", "너무 쉬움": "ok", 건너뜀: "skip", 멈춤: "skip", "진행 중": "now" };
const mins = (a: string, b: string | null) => { if (!b) return ""; const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 1 ? "1분 안" : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const secs = (s: number) => s < 60 ? `${s}초` : s < 3600 ? `${Math.round(s / 60)}분` : `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분`;

function RunView({ e, byId, onItem }: { e: Entry; byId: Map<string, ItemLite>; onItem: (id: string) => void }) {
  const [d, setD] = useState<RunLib | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => { setD(null); call<RunLib>(`/api/project-course/runs/${encodeURIComponent(e.runId!)}/library`).then(setD).catch((x) => setError(errorText(x))); }), [e.runId]);
  const head = <Head icon="🛠" title={e.title} sub={`${day(e.lastAt)} · ${e.sub}`}><button className="btn ghost small" onClick={() => go("project")}>실습 탭 열기</button></Head>;
  if (error) return <>{head}<p className="ws-err">{error}</p></>;
  if (!d) return <>{head}<p className="small muted">실습 기록을 불러오는 중…</p></>;
  if (!d.online) return <>{head}<p className="small muted">실습 서버가 꺼져 있어요. 실습 탭을 열면 켜져요.</p></>;
  const recs = d.goals ?? [], ms = d.moments ?? [], chunks = d.chunks ?? [];
  // 지나온 목표: 타임라인 길(세션 노트)에 목표 정리를 합친다(정리만 있고 길에 없는 목표도, 이름 없는 빈 칸은 정리가 있으면 뺀다)
  const seen = new Set((d.path ?? []).map((g) => g.title));
  const path = [...(d.path ?? []).filter((g) => g.title || !recs.length),
    ...recs.filter((r) => !seen.has(r.goal)).map((r) => ({ title: r.goal, at: r.from, endAt: r.to, result: r.status, gaps: [] }) as PGoal)].sort((a, b) => a.at.localeCompare(b.at));
  const cards = recs.flatMap((r) => r.cards.map((c) => ({ ...c, goal: r.goal })));
  const gaps = path.flatMap((g) => g.gaps);
  const done = path.filter((g) => g.result === "마침" || g.result === "너무 쉬움").length;
  return <>
    {head}
    <div className="lib-stats">
      <span><b>{path.length}</b>목표</span><span><b>{done}</b>마침</span><span><b>{cards.length}</b>기억 카드</span><span><b>{ms.length}</b>막힌 순간</span><span><b>{gaps.length}</b>부족했던 것</span>
    </div>
    {path.length ? <section className="lib-sec"><h3>지나온 목표</h3>
      <ol className="lib-path">{path.map((g, i) => {
        const rec = recs.find((r) => r.goal === g.title);
        return <li key={i} className={RES[g.result] ?? ""}>
          <div className="lib-pg"><span className="lib-dot">{i + 1}</span><b>{g.title || "(이름 없는 목표)"}</b><span className={`lib-res ${RES[g.result] ?? ""}`}>{g.result}</span><span className="small muted">{mins(g.at, g.endAt)}</span></div>
          {rec?.summary ? <p className="lib-sum">{rec.summary}</p> : null}
          {g.gaps.length ? <p className="small">{g.gaps.map((x) => <span key={x.id} className="lib-tag bad" title={x.wrong}>부족 · {x.name}</span>)}</p> : null}
        </li>;
      })}</ol></section> : null}
    {cards.length ? <section className="lib-sec"><h3>기억 카드</h3><div className="lib-cards">{cards.map((c, i) => (
      <article key={i} className="lib-card">
        <header><b>{c.name}</b><span className={`lib-how ${/혼자/.test(c.how) ? "ok" : /아직/.test(c.how) ? "bad" : ""}`}>{c.how}</span></header>
        {c.situation ? <p className="small muted">{c.situation}</p> : null}
        {c.did ? <p>{c.did}</p> : null}
        {c.quote ? <blockquote>“{c.quote}”</blockquote> : null}
        {c.learned ? <p><span className="lib-k">배운 것</span>{c.learned}</p> : null}
        {c.next ? <p><span className="lib-k">다음엔</span>{c.next}</p> : null}
        {c.recheck ? <p className="small muted"><span className="lib-k">다시 물을 것</span>{c.recheck}</p> : null}
      </article>))}</div></section> : null}
    {ms.length ? <section className="lib-sec"><h3>막힌 순간</h3><ul className="lib-moments">{ms.map((m) => (
      <li key={m.id}>
        <div className="lib-pg"><span className="lib-tag">{m.by}</span><b>{m.command ? <code>{m.command}</code> : m.gap || m.reasons || m.goal}</b><span className={`lib-res ${m.how === "안 풀고 넘어감" ? "skip" : m.how ? "ok" : "now"}`}>{m.how ?? "아직 막힘"}</span><span className="small muted">{secs(m.seconds)}{m.tries > 1 ? ` · ${m.tries}번 해 봄` : ""}</span></div>
        {m.error ? <p className="lib-err">{m.error}</p> : null}
        {m.said.length ? <p className="small muted">내가 한 말: {m.said.map((s) => `“${s}”`).join(" ")}</p> : null}
        {m.changed.map((c) => <pre key={c.file} className="lib-diff"><span className="small muted">{c.file}</span>{"\n"}{c.diff.join("\n")}</pre>)}
      </li>))}</ul></section> : null}
    {chunks.length ? <section className="lib-sec"><h3>먼저 알아야 했던 것</h3><ul className="lib-chunks">{chunks.map((c) => (
      <li key={c.name}><b>{c.name}</b>{c.result ? <span className={`lib-res ${c.result === "됨" ? "ok" : "bad"}`}>{c.result === "됨" ? "알아요" : "몰라요"}</span> : null}
        {c.debts.length ? <span className="small muted"> 받아 쓴 것: {c.debts.join(", ")}</span> : null}</li>))}</ul></section> : null}
    {e.itemIds.length ? <section className="lib-sec"><h3>기억으로 넘어간 것</h3><ItemList ids={e.itemIds} byId={byId} onItem={onItem} /></section> : null}
    {!path.length && !cards.length && !ms.length ? <p className="small muted">이 실습에는 아직 남은 기록이 없어요. 목표를 끝까지 하거나 [다음으로]를 누르면 정리가 생겨요.</p> : null}
  </>;
}

/* ---------- 기억 하나 ---------- */
type ItemFull = { item: { id: string; title: string; body: string; state: ItemLite["state"]; graduated: boolean; example?: string; explain?: string; aliases: string[];
  sources: Array<{ kind: string; title: string; page?: number; quote?: string; at: string }>; mistakes?: Array<{ file: string; from: number; to: number; code: string; note: string }>;
  checks?: Array<{ q: string; a: string }>; review?: { dueAt?: string } }; path: string; links: Array<{ to: string; relation: string; item: { title: string } }>; backlinks: Array<{ relation: string; item: { id: string; title: string } }>;
  events: Array<{ id: string; at: string; kind: string; detail: string }>; ps?: { flow: string[]; wrong?: string; remember?: string; where?: string } };
const EV: Record<string, string> = { met: "만남", asked: "물어봄", wrong: "틀림", hint: "힌트", correct: "맞힘", note: "메모" };
function ItemView({ id, onBack, backLabel, onPick }: { id: string; onBack: () => void; backLabel: string; onPick: (id: string) => void }) {
  const [d, setD] = useState<ItemFull | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => { setD(null); setError(""); call<ItemFull>(`/api/knowledge/item/${id}`).then(setD).catch((x) => setError(errorText(x))); }), [id]);
  const back = <button className="linkish small lib-back" onClick={onBack}>{backLabel}</button>;
  if (error) return <>{back}<p className="ws-err">{error}</p></>;
  if (!d) return <>{back}<p className="small muted">불러오는 중…</p></>;
  const it = d.item;
  return <>
    {back}
    <Head icon="🔖" title={it.title} sub={[d.path, it.aliases.length ? `다른 이름 ${it.aliases.join(", ")}` : "", it.review?.dueAt ? `다음 복습 ${day(it.review.dueAt)}` : ""].filter(Boolean).join(" · ")}><StateChip state={it.state} graduated={it.graduated} /></Head>
    {it.body ? <section className="lib-sec"><h3>뜻</h3><p className="lib-body"><Inline text={it.body} /></p></section> : null}
    {it.example ? <section className="lib-sec"><h3>만난 곳에서는</h3><p><Inline text={it.example} /></p></section> : null}
    {d.ps ? <section className="lib-sec"><h3>문제 풀 때</h3>{d.ps.where ? <p className="small muted">{d.ps.where}</p> : null}
      {d.ps.flow.length ? <ol className="lib-steps">{d.ps.flow.map((f, i) => <li key={i}>{f}</li>)}</ol> : null}
      {d.ps.wrong ? <p><span className="lib-k">그때 내 생각</span>{d.ps.wrong}</p> : null}{d.ps.remember ? <p><span className="lib-k">기억할 것</span>{d.ps.remember}</p> : null}</section> : null}
    {it.mistakes?.length ? <section className="lib-sec"><h3>틀렸던 코드</h3>{it.mistakes.map((m, i) => <div key={i}><p className="small muted">{m.file} {m.from}~{m.to}줄 · {m.note}</p><pre className="lib-diff">{m.code}</pre></div>)}</section> : null}
    {it.checks?.length ? <section className="lib-sec"><h3>다시 물을 것</h3><ul className="lib-plain">{it.checks.map((c, i) => <li key={i}>{c.q}</li>)}</ul></section> : null}
    {d.links.length || d.backlinks.length ? <section className="lib-sec"><h3>이어진 기억</h3><p>{d.links.map((l) => <button key={`o${l.to}`} className="lib-tag link" onClick={() => onPick(l.to)}>{l.relation} → {l.item.title}</button>)}{d.backlinks.map((l) => <button key={`i${l.item.id}`} className="lib-tag link" onClick={() => onPick(l.item.id)}>{l.item.title} → {l.relation}</button>)}</p></section> : null}
    {it.sources.length ? <section className="lib-sec"><h3>어디서 만났나</h3><ul className="lib-plain">{it.sources.slice(-6).reverse().map((s, i) => <li key={i}>{s.title}{s.page ? ` ${s.page}쪽` : ""} <span className="small muted">{day(s.at)}</span>{s.quote ? <span className="small muted"> — “{s.quote}”</span> : null}</li>)}</ul></section> : null}
    {d.events.length ? <section className="lib-sec"><h3>지나온 일</h3><ul className="lib-plain">{d.events.slice(0, 10).map((ev) => <li key={ev.id}><span className={`lib-tag ${ev.kind === "wrong" ? "bad" : ev.kind === "correct" ? "ok" : ""}`}>{EV[ev.kind] ?? ev.kind}</span> {ev.detail} <span className="small muted">{day(ev.at)}</span></li>)}</ul></section> : null}
  </>;
}

/* ---------- 아래 채팅: 지금 펼친 것을 두고 묻기 ---------- */
function Chat({ pageRef, focusIds, where }: { pageRef: React.RefObject<HTMLDivElement | null>; focusIds: string[]; where: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy]);
  const send = async () => {
    const question = text.trim(); if (!question || busy) return;
    setText(""); setMsgs((m) => [...m, { role: "me", text: question }]); setBusy(true);
    const page = (pageRef.current?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 3800);
    const before = msgs.slice(-6).map((m) => `${m.role === "me" ? "학습자" : "답"}: ${m.text}`).join("\n").slice(0, 1600);
    try {
      const r = await call<{ answer: string }>("/api/knowledge/ask", { question, focusIds, context: `기억 도서관 · ${where}\n${page}${before ? `\n[앞서 나눈 말]\n${before}` : ""}`.slice(0, 5900) });
      setMsgs((m) => [...m, { role: "ai", text: r.answer || "답을 못 받았어요." }]);
    } catch (e) { setMsgs((m) => [...m, { role: "ai", text: `못 물어봤어요: ${errorText(e)}` }]); }
    finally { setBusy(false); }
  };
  return (
    <div className={`lib-chat${msgs.length || busy ? " has" : ""}`}>
      {msgs.length || busy ? <div className="lib-log" ref={log}>{msgs.map((m, i) => <div key={i} className={`lib-msg ${m.role}`}>{m.role === "ai" ? <Inline text={m.text} /> : m.text}</div>)}
        {busy ? <div className="lib-msg ai wait"><span className="lib-dots"><i /><i /><i /></span></div> : null}</div> : null}
      <form className="lib-in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea value={text} rows={1} onChange={(e) => setText(e.target.value)} placeholder={`${where} — 내 기억에 대해 물어보세요`} aria-label="기억에 대해 묻기"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button className="lib-send" type="submit" disabled={busy || !text.trim()} aria-label="보내기">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
        </button>
      </form>
    </div>
  );
}
