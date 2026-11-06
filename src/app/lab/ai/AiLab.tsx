"use client";
// AI 호출 실험실 (2026-11-06 사용자): 세 곳의 AI 호출을 같은 틀로 본다 — 호출마다 모델 · 시간 · 토큰 · 비용, 넣은 것 · 나온 것을
// 사람이 읽게, 지시문이 대충 뭐라고 하는지(대장 catalog.ts). PDF 엔진은 저장된 실행을 시간 다이어그램으로, 알고리즘·실습은
// 화면을 통째로 붙이고 옆에서 호출이 실시간으로 쌓인다. 모델·강도를 바꾸면 다음 호출부터 그 값으로 간다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../lab.css";
import "./ai.css";
import { CallView, modelClass, num, sec, short, usd, type Entry, type Tok } from "./view";

type Catalog = { assist: Record<string, Entry>; gen: Record<string, Entry>; genLabels: Record<string, string>; tutor: Entry;
  prices: Array<{ model: string; in: number; cached: number; out: number }>; models: string[]; efforts: string[]; settings: { assist: Record<string, { model?: string; effort?: string }> } };
const api = async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
  const res = await fetch(`/api/lab/ai/${path}`, { method: init?.method ?? "GET", cache: "no-store", headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `오류 ${res.status}`);
  return data as T;
};
const entryOf = (cat: Catalog | null, purpose: string): Entry | null => {
  if (!cat) return null;
  if (cat.assist[purpose]) return cat.assist[purpose];
  const k = Object.keys(cat.assist).find((x) => x.endsWith("*") && purpose.startsWith(x.slice(0, -1)));
  return k ? cat.assist[k] : null;
};
type Tab = "pdf" | "code" | "practice" | "settings";

export default function AiLab() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("ai-lab-tab") as Tab) || "pdf"; } catch { return "pdf"; } });
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const loadCat = useCallback(() => api<Catalog>("catalog").then(setCat, (e) => setError(String(e.message ?? e))), []);
  useEffect(() => { void loadCat(); }, [loadCat]);
  useEffect(() => { try { localStorage.setItem("ai-lab-tab", tab); } catch { /* */ } }, [tab]);
  return <div className="lab ai-lab">
    <header className="top"><h1>AI 호출 실험실</h1>
      <div className="seg">{([["pdf", "PDF 엔진"], ["code", "알고리즘"], ["practice", "실습"], ["settings", "모델 설정"]] as const).map(([k, l]) =>
        <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <span className="sp" /><small>비용은 API였다면의 값 (ChatGPT 구독이라 실제로 나가지 않음)</small></header>
    {error ? <p className="warnline errline" style={{ margin: 12 }}>{error}</p> : null}
    {tab === "pdf" ? <PdfTab cat={cat} /> : tab === "code" ? <CodeTab cat={cat} reloadCat={loadCat} /> : tab === "practice" ? <PracticeTab cat={cat} /> : <SettingsTab cat={cat} reloadCat={loadCat} />}
  </div>;
}

/* ───────────── PDF 엔진: 실행 하나를 시간 다이어그램으로 ───────────── */
type GenCallLite = { n: number; step: string; sectionId: string | null; attempt: number; model: string; effort: string; startedAt: string; ms: number; firstTextMs?: number; ok: boolean; error: string | null;
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }; cost: number | null; userChars: number; replyChars: number; systemChars: number };
type GenDetail = { gen: { id: string; createdAt: string; updatedAt: string; status: string; fileName: string; pages: number[] }; prep: { pages: Array<{ page: number; route: string; title: string; reasons: string[] }>; ms: number | null } | null; calls: GenCallLite[] };
type GenRun = { id: string; createdAt: string; status: string; fileName: string; pages: number; calls: number; origin: string };
const tokOf = (u?: GenCallLite["usage"]): Tok | undefined => (u ? { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } : undefined);
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function PdfTab({ cat }: { cat: Catalog | null }) {
  const [runs, setRuns] = useState<GenRun[]>([]);
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem("ai-lab-pdf") ?? ""; } catch { return ""; } });
  const [d, setD] = useState<GenDetail | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<{ runs: GenRun[] }>("pdf").then((r) => { setRuns(r.runs); if (!id && r.runs[0]) setId(r.runs[0].id); }, (e) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!id) return; try { localStorage.setItem("ai-lab-pdf", id); } catch { /* */ }
    let stop = false;
    const load = () => api<GenDetail>(`pdf/${id}`).then((x) => { if (!stop) setD(x); }, (e) => setErr(e.message));
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000); // 도는 중인 실행이면 새 호출이 붙는다
    return () => { stop = true; clearInterval(t); };
  }, [id]);
  return <div className="layout">
    <aside className="side"><b>PDF 실행</b><small className="muted"> · Recaller 엔진</small>
      <div className="runs">{runs.map((r) => <button key={r.id} className="run" aria-current={r.id === id} onClick={() => setId(r.id)}>
        <b title={r.fileName}>{r.fileName}</b><span className="m"><span>{when(r.createdAt)}</span><span>{r.pages}쪽</span><span>호출 {r.calls}</span><span>{r.status === "done" ? "완료" : r.status}</span></span></button>)}</div>
    </aside>
    <main className="main">{err ? <p className="warnline errline">{err}</p> : null}{d && d.gen.id === id ? <PdfRun key={id} d={d} cat={cat} /> : <p className="muted">{id ? "읽는 중…" : "실행을 고르세요."}</p>}</main>
  </div>;
}

type Seg = { label: string; t0: number; t1: number; rows: Array<{ step: string; calls: GenCallLite[] }> };
function segments(d: GenDetail): Seg[] {
  const base = Date.parse(d.gen.createdAt);
  const calls = [...d.calls].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const segs: Array<{ calls: GenCallLite[]; end: number }> = [];
  for (const c of calls) {
    const s = Date.parse(c.startedAt), e = s + c.ms;
    const last = segs.at(-1);
    if (last && s - last.end < 60_000) { last.calls.push(c); last.end = Math.max(last.end, e); } else segs.push({ calls: [c], end: e });
  }
  return segs.map((sg, i) => {
    const t0 = i === 0 ? base : Date.parse(sg.calls[0].startedAt);
    const rows: Seg["rows"] = [];
    for (const c of sg.calls) { let r = rows.find((x) => x.step === c.step); if (!r) rows.push(r = { step: c.step, calls: [] }); r.calls.push(c); }
    const isQuiz = sg.calls.every((c) => c.step.startsWith("rc-q-") || c.step === "rc-solve" || c.step === "rc-check" || c.step === "rc-author");
    return { label: i === 0 ? "지식 만들기" : isQuiz ? `문제 만들기 (${when(sg.calls[0].startedAt)}에 누름)` : `이어서 (${when(sg.calls[0].startedAt)})`, t0, t1: sg.end, rows };
  });
}
const sum = (cs: GenCallLite[], f: (c: GenCallLite) => number | undefined | null) => cs.reduce((n, c) => n + (f(c) ?? 0), 0);

function PdfRun({ d, cat }: { d: GenDetail; cat: Catalog | null }) {
  const [sel, setSel] = useState<{ step: string; n?: number } | null>(null);
  const segs = useMemo(() => segments(d), [d]);
  const total = { calls: d.calls.length, in: sum(d.calls, (c) => c.usage?.inputTokens), cached: sum(d.calls, (c) => c.usage?.cachedInputTokens), out: sum(d.calls, (c) => c.usage?.outputTokens), cost: sum(d.calls, (c) => c.cost) };
  const routes = d.prep?.pages.reduce<Record<string, number>>((m, p) => { m[p.route] = (m[p.route] ?? 0) + 1; return m; }, {}) ?? {};
  const images = (routes.page ?? 0) + (routes.figures ?? 0);
  const label = (step: string) => cat?.gen[step]?.title ?? cat?.genLabels[step] ?? step;
  return <>
    <div className="head"><h2>{d.gen.fileName}</h2><div className="facts"><span>{d.gen.pages.length}쪽</span><span>호출 {total.calls}번</span>
      <span>입력 {num(total.in)} (캐시 {num(total.cached)})</span><span>출력 {num(total.out)}</span><span>비용 <b>{usd(total.cost)}</b></span><span>{d.gen.status}</span></div></div>
    {d.prep ? <p className="purpose">전처리(코드): 쪽마다 읽는 길 — 글자만 {routes.layer ?? 0} · 그림 잘라 붙임 {routes.figures ?? 0} · 쪽 전체 이미지 {routes.page ?? 0}{routes.empty ? ` · 빈 쪽 ${routes.empty}` : ""}. 이미지는 1024px로 그림 쪽에만 보낸다.</p> : null}
    {segs.map((s, si) => <Gantt key={si} seg={s} first={si === 0} label={label} sel={sel} setSel={setSel} />)}
    <p className="muted ai-legend"><span className="ai-model m-terra">terra</span><span className="ai-model m-sol">sol</span><span className="ai-model m-luna">luna</span> 막대 하나 = 호출 하나(길이 = 걸린 시간, 진한 앞부분 = 첫 글자까지). 줄을 누르면 그 단계, 막대를 누르면 그 호출.</p>
    {sel ? <StepDetail genId={d.gen.id} step={sel.step} n={sel.n} calls={d.calls.filter((c) => c.step === sel.step)} entry={cat?.gen[sel.step] ?? null} title={label(sel.step)} images={sel.step === "rc-digest-plan" ? images : 0} onPick={(n) => setSel({ step: sel.step, n })} /> : null}
  </>;
}

function Gantt({ seg, first, label, sel, setSel }: { seg: Seg; first: boolean; label: (s: string) => string; sel: { step: string; n?: number } | null; setSel: (s: { step: string; n?: number }) => void }) {
  const span = Math.max(1, seg.t1 - seg.t0);
  const pct = (t: number) => `${((t - seg.t0) / span) * 100}%`;
  const w = (ms: number) => `${Math.max(0.4, (ms / span) * 100)}%`;
  const firstStart = Math.min(...seg.rows.flatMap((r) => r.calls.map((c) => Date.parse(c.startedAt))));
  const ticks = Array.from({ length: 6 }, (_, i) => (span * i) / 5);
  return <section className="ai-gantt">
    <div className="ai-gantt-title"><b>{seg.label}</b><small className="num">{sec(span)}</small></div>
    <div className="ai-axis"><span />{ticks.map((t, i) => <i key={i} style={{ left: `${(t / span) * 100}%` }}>{sec(t)}</i>)}</div>
    {first && firstStart > seg.t0 ? <div className="ai-row code"><div className="ai-row-label"><b>전처리</b><small>코드 · AI 없음</small></div>
      <div className="ai-track"><i className="ai-bar code" style={{ left: 0, width: pct(firstStart) }} title={`전처리 ${sec(firstStart - seg.t0)}`} /></div>
      <div className="ai-row-sum"><span className="num">{sec(firstStart - seg.t0)}</span></div></div> : null}
    {seg.rows.map((r) => {
      const slow = Math.max(...r.calls.map((c) => c.ms));
      const models = [...new Set(r.calls.map((c) => short(c.model)))].join(", ");
      const fails = r.calls.filter((c) => !c.ok).length;
      return <div key={r.step} className={`ai-row ${sel?.step === r.step ? "on" : ""}`} onClick={() => setSel({ step: r.step })}>
        <div className="ai-row-label"><b>{label(r.step)}</b><small>{r.calls.length > 1 ? `${r.calls.length}번` : "1번"} · {models}{fails ? ` · 실패 ${fails}` : ""}</small></div>
        <div className="ai-track">{r.calls.map((c) => { const s = Date.parse(c.startedAt); return <button key={c.n} className={`ai-bar ${modelClass(c.model)} ${c.ok ? "" : "bad"} ${sel?.n === c.n ? "on" : ""}`}
          style={{ left: pct(s), width: w(c.ms) }} onClick={(e) => { e.stopPropagation(); setSel({ step: r.step, n: c.n }); }}
          title={`#${c.n} ${c.sectionId ?? ""} · ${short(c.model)} ${c.effort} · ${sec(c.ms)} (첫 글자 ${sec(c.firstTextMs)}) · 입력 ${num(c.usage?.inputTokens)} 출력 ${num(c.usage?.outputTokens)} · ${usd(c.cost)}`}>
          {c.firstTextMs ? <em style={{ width: `${Math.min(100, (c.firstTextMs / c.ms) * 100)}%` }} /> : null}</button>; })}</div>
        <div className="ai-row-sum"><span className="num">{r.calls.length > 1 ? `최장 ${sec(slow)}` : sec(slow)}</span><span className="num">{num(sum(r.calls, (c) => c.usage?.inputTokens))}→{num(sum(r.calls, (c) => c.usage?.outputTokens))}</span><b className="num">{usd(sum(r.calls, (c) => c.cost))}</b></div>
      </div>;
    })}
  </section>;
}

type FullGenCall = GenCallLite & { system: string; user: string; reply: string | null };
function StepDetail({ genId, step, n, calls, entry, title, images, onPick }: { genId: string; step: string; n?: number; calls: GenCallLite[]; entry: Entry | null; title: string; images: number; onPick: (n: number) => void }) {
  const pick = n ?? calls[0]?.n;
  const [full, setFull] = useState<FullGenCall | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (pick == null) return; api<{ call: FullGenCall }>(`pdf/${genId}/calls/${pick}`).then((r) => setFull(r.call), (e) => setErr(e.message)); }, [genId, pick]);
  const one = calls.find((c) => c.n === pick);
  return <section className="detail ai-detail">
    <div className="dhead"><h3>{title}</h3><code className="muted">{step}</code><span className="sp" />
      <small className="num">{calls.length}번 · {usd(sum(calls, (c) => c.cost))} · 입력 {num(sum(calls, (c) => c.usage?.inputTokens))} · 출력 {num(sum(calls, (c) => c.usage?.outputTokens))}</small></div>
    {calls.length > 1 ? <div className="calls" style={{ padding: "10px 16px 0" }}>{calls.map((c) => <button key={c.n} aria-pressed={c.n === pick} onClick={() => onPick(c.n)}>
      {c.sectionId ?? `#${c.n}`} <small className="num">{sec(c.ms)}</small>{c.ok ? null : " ⚠"}</button>)}</div> : null}
    <div className="pane">{err ? <p className="warnline errline">{err}</p> : null}
      {full && one && full.n === pick ? <CallView entry={entry} label={`${step}${full.sectionId ? ` · ${full.sectionId}` : ""} · #${full.n}${full.attempt > 1 ? ` (다시 ${full.attempt})` : ""}`}
        facts={{ model: one.model, effort: one.effort, ms: one.ms, first: one.firstTextMs, tokens: tokOf(one.usage), cost: one.cost }}
        system={full.system} user={full.user} reply={full.reply ?? ""} error={full.error}
        extra={images ? <p className="purpose">이 호출에는 그림 쪽 이미지 {images}장이 같이 갔다(넣은 것의 글에는 안 보임).</p> : null} /> : <p className="muted">읽는 중…</p>}
    </div>
  </section>;
}

/* ───────────── 알고리즘: 화면 통째 + 실시간 호출 ───────────── */
type Rec = { id: string; at: string; purpose: string; model: string; effort: string; ms: number; firstTextMs?: number; ok: boolean; error?: string; tokens?: Tok;
  trace?: { area: string; action?: string; ref?: string }; system: string; user: string; reply: string; cost: number | null };

function useLiveCalls(area: string) {
  const [calls, setCalls] = useState<Rec[]>([]);
  const last = useRef("");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ calls: Rec[] }>(`calls?area=${area}${last.current ? `&since=${encodeURIComponent(last.current)}` : "&limit=40"}`);
        if (stop || !r.calls.length) return;
        last.current = r.calls[0].at;
        setCalls((old) => { const seen = new Set(old.map((c) => c.id)); return [...r.calls.filter((c) => !seen.has(c.id)), ...old].slice(0, 300); });
      } catch { /* 다음 차례에 */ }
    };
    void tick();
    const t = setInterval(() => { if (document.visibilityState === "visible") void tick(); }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [area]);
  return calls;
}

function CodeTab({ cat, reloadCat }: { cat: Catalog | null; reloadCat: () => void }) {
  const calls = useLiveCalls("code");
  const [open, setOpen] = useState<Rec | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [showSet, setShowSet] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { fetch("/api/code/problems", { cache: "no-store" }).then((r) => r.json()).then((x: { problems?: Array<{ id: string; title: string }> }) => setTitles(Object.fromEntries((x.problems ?? []).map((p) => [p.id, p.title])))).catch(() => undefined); }, [calls.length]);
  const toCode = () => { try { frame.current?.contentWindow?.dispatchEvent(new CustomEvent("recaller:go", { detail: { view: "code" } })); } catch { /* */ } };
  const groups = useMemo(() => {
    const g: Array<{ key: string; calls: Rec[] }> = [];
    for (const c of calls) { const key = c.trace?.ref ?? "(문제 없이)"; let x = g.find((y) => y.key === key); if (!x) g.push(x = { key, calls: [] }); x.calls.push(c); }
    return g;
  }, [calls]);
  return <div className="ai-split">
    <div className="ai-frame"><iframe ref={frame} src="/study" title="알고리즘 화면" onLoad={() => { setTimeout(toCode, 600); setTimeout(toCode, 2000); }} /></div>
    <aside className="ai-live">
      <div className="ai-live-head"><b>실시간 호출</b><small className="muted">알고리즘 · 2초마다</small><span className="sp" /><button className="btn small" onClick={() => setShowSet((x) => !x)}>모델 바꾸기</button></div>
      {showSet ? <PurposeSettings cat={cat} reloadCat={reloadCat} filter="code:" /> : null}
      {!calls.length ? <p className="muted pad">아직 호출이 없어요. 왼쪽에서 문제를 만들거나 힌트·반례를 눌러 보세요.</p> : null}
      {groups.map((g) => <div key={g.key} className="ai-group">
        <div className="ai-group-head"><b>{titles[g.key] ?? g.key}</b><small className="num">{g.calls.length}번 · {usd(g.calls.reduce((n, c) => n + (c.cost ?? 0), 0))}</small></div>
        {g.calls.map((c) => <CallRow key={c.id} c={c} entry={entryOf(cat, c.purpose)} onOpen={() => setOpen(c)} />)}
      </div>)}
    </aside>
    {open ? <RecDialog rec={open} entry={entryOf(cat, open.purpose)} onClose={() => setOpen(null)} /> : null}
  </div>;
}

function CallRow({ c, entry, onOpen }: { c: Rec; entry: Entry | null; onOpen: () => void }) {
  return <button className={`ai-callrow ${c.ok ? "" : "bad"}`} onClick={onOpen}>
    <span className="ai-callrow-top"><b>{entry?.title ?? c.purpose}</b><small className="muted">{new Date(c.at).toLocaleTimeString("ko-KR", { hour12: false })}</small></span>
    <span className="ai-callrow-io"><small>넣음</small> {c.user.slice(0, 90).replace(/\s+/g, " ")}</span>
    <span className="ai-callrow-io"><small>나옴</small> {c.ok ? c.reply.slice(0, 90).replace(/\s+/g, " ") : c.error}</span>
    <span className="ai-callrow-facts"><span className={`ai-model ${modelClass(c.model)}`}>{short(c.model)} {c.effort}</span><span className="num">{sec(c.ms)}</span><span className="num">{num(c.tokens?.in)}→{num(c.tokens?.out)}</span><b className="num">{usd(c.cost)}</b></span>
  </button>;
}

function RecDialog({ rec, entry, onClose }: { rec: Rec; entry: Entry | null; onClose: () => void }) {
  const [full, setFull] = useState<Rec | null>(null);
  useEffect(() => { api<{ call: Rec }>(`calls/${rec.id}`).then((r) => setFull(r.call), () => setFull(rec)); }, [rec]);
  const c = full ?? rec;
  return <div className="scrim" onClick={onClose}><div className="dialog ai-dialog" onClick={(e) => e.stopPropagation()}>
    <div className="dh"><h3>{entry?.title ?? rec.purpose}</h3><button className="btn small" onClick={onClose}>닫기</button></div>
    <div className="db">{full ? <CallView entry={entry} label={`${c.purpose}${c.trace?.action ? ` · ${c.trace.action}` : ""}`} facts={{ model: c.model, effort: c.effort, ms: c.ms, first: c.firstTextMs, tokens: c.tokens, cost: c.cost }}
      system={c.system} user={c.user} reply={c.reply} error={c.error} /> : <p className="muted">읽는 중…</p>}</div>
  </div></div>;
}

/* ───────────── 실습: 화면 통째 + 튜터 차례 ───────────── */
type Chat = { runId: string; engine: string; title: string; at: string; count: number; busy: boolean };
type Turn = { at: string; turn?: number; q?: string; input?: string; inputChars?: number; model?: string; fresh?: boolean; sandbox?: string; tools?: Array<{ label: string; status?: string }>;
  reply?: string; usage?: { input: number; cached: number; output: number; ms: number }; ms?: number; firstTextMs?: number; error?: string; cost?: number | null };
type Practice = { runId: string; engine: string; chatId: string; model: string; models: Array<{ id: string; label: string }>; busy: boolean; turns: Turn[]; live: Array<{ id: number; role: string; text: string }> };

function PracticeTab({ cat }: { cat: Catalog | null }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [run, setRun] = useState<string>(() => { try { return localStorage.getItem("ai-lab-practice") ?? ""; } catch { return ""; } });
  const [d, setD] = useState<Practice | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Turn | null>(null);
  const loadChats = useCallback(() => api<{ chats: Chat[] }>("practice").then((r) => { setChats(r.chats); setErr(""); if (!run && r.chats[0]) setRun(r.chats[0].runId); }, (e) => setErr(e.message)), [run]);
  useEffect(() => { void loadChats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run) return; try { localStorage.setItem("ai-lab-practice", run); } catch { /* */ }
    let stop = false;
    const load = () => api<Practice>(`practice/${run}`).then((x) => { if (!stop) { setD(x); setErr(""); } }, (e) => !stop && setErr(e.message));
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [run]);
  const setModel = async (model: string) => { try { await api(`practice/${run}/model`, { method: "POST", body: { model } }); setD((x) => (x ? { ...x, model } : x)); } catch (e) { setErr((e as Error).message); } };
  const turns = [...(d?.turns ?? [])].reverse();
  const tot = (d?.turns ?? []).reduce((a, t) => ({ in: a.in + (t.usage?.input ?? 0), out: a.out + (t.usage?.output ?? 0), cost: a.cost + (t.cost ?? 0) }), { in: 0, out: 0, cost: 0 });
  return <div className="ai-split">
    <div className="ai-frame">{run ? <iframe key={run} src={`http://127.0.0.1:4100/#/run/${run}`} title="실습 화면" /> : <p className="muted pad">실습을 고르세요.</p>}</div>
    <aside className="ai-live">
      <div className="ai-live-head"><select value={run} onChange={(e) => setRun(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
        {chats.map((c) => <option key={c.runId} value={c.runId}>{c.engine === "codex" ? "[Codex] " : "[기본] "}{c.title}</option>)}</select>
        <button className="btn small" onClick={() => void loadChats()}>목록</button></div>
      {err ? <p className="warnline errline">{err}</p> : null}
      {d ? <div className="ai-live-sub">
        <label className="field">튜터 모델 (다음 질문부터)<select value={d.model} onChange={(e) => void setModel(e.target.value)}>{d.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <small className="num">차례 {d.turns.length} · 입력 {num(tot.in)} · 출력 {num(tot.out)} · {usd(tot.cost)}</small>
        <p className="ai-does"><b>{cat?.tutor.title ?? "튜터 한 차례"}</b> {cat?.tutor.does}</p>
      </div> : null}
      {d?.busy ? <div className="ai-group"><div className="ai-group-head"><b>답하는 중…</b></div>{d.live.filter((m) => m.role !== "user").slice(-4).map((m) => <p key={m.id} className="ai-livemsg"><small>{m.role === "tool" ? "도구" : "튜터"}</small> {m.text.slice(0, 240)}</p>)}</div> : null}
      {d && d.engine !== "codex" ? <p className="muted pad">이 대화는 기본(OpenCode) 엔진이라 차례별 토큰 기록이 아직 없어요. Codex 대화를 고르세요.</p> : null}
      {d && d.engine === "codex" && !turns.length ? <p className="muted pad">아직 기록된 차례가 없어요. 이 기능을 켠 뒤 질문한 차례부터 보여요.</p> : null}
      {turns.map((t, i) => <button key={i} className={`ai-callrow ${t.error ? "bad" : ""}`} onClick={() => setOpen(t)}>
        <span className="ai-callrow-top"><b>{t.turn ? `${t.turn}번째 질문` : "차례"}{t.fresh ? " · 새 대화" : ""}</b><small className="muted">{new Date(t.at).toLocaleTimeString("ko-KR", { hour12: false })}</small></span>
        <span className="ai-callrow-io"><small>학습자</small> {(t.q ?? "(기록 전 차례)").slice(0, 100)}</span>
        {t.tools?.length ? <span className="ai-callrow-io"><small>도구</small> {t.tools.map((x) => x.label.split("\n")[0].slice(0, 40)).join(" · ")}</span> : null}
        <span className="ai-callrow-io"><small>튜터</small> {(t.error ?? t.reply ?? "").slice(0, 100).replace(/\s+/g, " ")}</span>
        <span className="ai-callrow-facts"><span className={`ai-model ${modelClass(t.model)}`}>{short(t.model)} low</span><span className="num">{sec(t.ms)}</span>
          <span className="num">{num(t.usage?.input)}{t.usage?.cached ? `(캐시 ${num(t.usage.cached)})` : ""}→{num(t.usage?.output)}</span><b className="num">{usd(t.cost)}</b></span>
      </button>)}
    </aside>
    {open ? <div className="scrim" onClick={() => setOpen(null)}><div className="dialog ai-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="dh"><h3>{open.turn ? `${open.turn}번째 질문` : "튜터 차례"}</h3><button className="btn small" onClick={() => setOpen(null)}>닫기</button></div>
      <div className="db"><CallView entry={cat?.tutor ?? null} label={`codex · ${open.sandbox ?? ""}${open.fresh ? " · 새 대화" : " · 이어 감"}`}
        facts={{ model: open.model, effort: "low", ms: open.ms, first: open.firstTextMs, tokens: open.usage ? { in: open.usage.input, cached: open.usage.cached, out: open.usage.output } : undefined, cost: open.cost }}
        system="(Codex 자체 지시문 — 바꿀 수 없고 기록되지 않음)" user={open.input ?? open.q ?? ""} reply={open.reply ?? ""} error={open.error}
        extra={open.tools?.length ? <details className="block" open><summary><span>도구 호출 {open.tools.length}번</span></summary><ol className="ai-list pad">{open.tools.map((x, k) => <li key={k}><code>{x.label}</code> <small className="muted">{x.status}</small></li>)}</ol></details> : null} /></div>
    </div></div> : null}
  </div>;
}

/* ───────────── 모델 설정 ───────────── */
function PurposeSettings({ cat, reloadCat, filter }: { cat: Catalog | null; reloadCat: () => void; filter?: string }) {
  const [busy, setBusy] = useState("");
  if (!cat) return <p className="muted pad">읽는 중…</p>;
  const keys = Object.keys(cat.assist).filter((k) => !filter || k.startsWith(filter));
  const save = async (purpose: string, model: string, effort: string) => { setBusy(purpose); try { await api("settings", { method: "POST", body: { purpose, model, effort } }); reloadCat(); } finally { setBusy(""); } };
  return <div className="table-scroll"><table className="ai-settings"><thead><tr><th>호출</th><th>모델</th><th>강도</th></tr></thead><tbody>{keys.map((k) => {
    const s = cat.settings.assist[k] ?? {};
    return <tr key={k} className={s.model || s.effort ? "changed" : ""}><td><b>{cat.assist[k].title}</b><br /><code className="muted">{k}</code></td>
      <td><select disabled={busy === k} value={s.model ?? ""} onChange={(e) => void save(k, e.target.value, s.effort ?? "")}><option value="">기본</option>{cat.models.map((m) => <option key={m} value={m}>{short(m)}</option>)}</select></td>
      <td><select disabled={busy === k} value={s.effort ?? ""} onChange={(e) => void save(k, s.model ?? "", e.target.value)}><option value="">기본</option>{cat.efforts.map((m) => <option key={m} value={m}>{m}</option>)}</select></td></tr>;
  })}</tbody></table><small className="muted pad">&ldquo;기본&rdquo; = 코드에 정해 둔 값. 바꾸면 다음 호출부터 그 값으로 간다(이 PC의 데이터 폴더 lab/ai-settings.json).</small></div>;
}

function SettingsTab({ cat, reloadCat }: { cat: Catalog | null; reloadCat: () => void }) {
  return <div className="main" style={{ maxWidth: 980 }}>
    <h2>호출 종류별 모델·강도</h2>
    <p className="purpose">알고리즘·지식 도우미 호출(askText/askJson)에 적용된다. PDF 엔진은 엔진 실험실(/lab/gen)에서 실행마다, 실습 튜터는 실습 탭에서 대화마다 바꾼다.</p>
    <PurposeSettings cat={cat} reloadCat={reloadCat} />
    <h2 style={{ marginTop: 20 }}>가격표 <small className="muted">100만 토큰당, API 기준</small></h2>
    {cat ? <table><thead><tr><th>모델</th><th>입력</th><th>캐시된 입력</th><th>출력</th></tr></thead><tbody>{cat.prices.map((p) =>
      <tr key={p.model}><td><span className={`ai-model ${modelClass(p.model)}`}>{p.model}</span></td><td className="num">${p.in}</td><td className="num">${p.cached}</td><td className="num">${p.out}</td></tr>)}</tbody></table> : null}
  </div>;
}
