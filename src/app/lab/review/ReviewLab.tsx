"use client";
// 총정리 실험실 (11/12 사용자): 풀이 하나를 골라, 대화 범위를 작게 잘라서, 지시문·모델·강도를 바꿔 가며 총정리가 어떻게 나오는지 본다.
// 돌릴 때마다 AI 1번(데이터 폴더 code/tutor/review-lab.jsonl에 남음). 제품 총정리(풀이 노트)는 건드리지 않는다.
import { useEffect, useMemo, useState } from "react";
import "./review-lab.css";
import "../../study/dejipgi.css";
import "../../study/workspace/library.css";
import { MdReviewView } from "../../study/workspace/ReviewView";

type Weak = { size: "small" | "big"; title: string; state: string; lesson: string };
type Review = { situation: string; solve: string; story: Array<{ text: string; weak?: Weak }>; next: string };
type Talk = { i: number; at: string; kind: string; q: string; a: string; verdict: string };
type Run = { id: string; at: string; problemId: string; title: string; range: { from: number; to: number } | null; model: string; effort: string; note: string;
  system: string; ms: number; tokens?: { in?: number; cached?: number; out?: number }; review: Review | null; raw: unknown; error?: string; cost: number | null; format?: "json" | "text" };
type Preset = { id: string; label: string; system: string; format: string; output: "json" | "text" };
type Problem = { id: string; title: string; talks: number };

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`/api/code/review-lab${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { error?: string }).error) throw new Error((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? `오류 ${res.status}`);
  return data as T;
};
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 없음 */ } } };
const k = (n?: number) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function ReviewLab() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [product, setProduct] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [efforts, setEfforts] = useState<string[]>([]);
  const [pid, setPid] = useState(() => store.get("rlab-pid") ?? "");
  const [talks, setTalks] = useState<Talk[]>([]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [whole, setWhole] = useState(false);
  const [system, setSystem] = useState("");
  const [model, setModel] = useState(() => store.get("rlab-model") ?? "gpt-6.1-terra");
  const [effort, setEffort] = useState(() => store.get("rlab-effort") ?? "low");
  const [note, setNote] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(0);
  const [error, setError] = useState("");
  const [userText, setUserText] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [output, setOutput] = useState<"json" | "text">(() => (store.get("rlab-output") as "json" | "text") || "json");
  const [textFormat, setTextFormat] = useState("");
  const [tab, setTab] = useState<"lab" | "history">(() => (store.get("rlab-tab") === "history" ? "history" : "lab"));

  useEffect(() => {
    void api<{ problems: Problem[]; system: string; models: string[]; efforts: string[]; presets: Preset[] }>("").then((d) => {
      setProblems(d.problems); setProduct(d.system); setModels(d.models); setEfforts(d.efforts); setPresets(d.presets);
      setTextFormat(store.get("rlab-format")?.trim() || d.presets.find((x) => x.id === "product")?.format || "");
      setSystem(store.get("rlab-system")?.trim() || d.system);
      setPid((cur) => cur && d.problems.some((x) => x.id === cur) ? cur : d.problems[0]?.id ?? "");
    }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!pid) return;
    store.set("rlab-pid", pid);
    void api<{ talks: Talk[] }>(`/${pid}`).then((d) => { setTalks(d.talks); setFrom(0); setTo(Math.min(4, d.talks.length - 1)); }).catch((e: Error) => setError(e.message));
    void api<{ runs: Run[] }>(`/${pid}/runs`).then((d) => setRuns(d.runs)).catch(() => undefined);
  }, [pid]);
  useEffect(() => { if (system.trim()) store.set("rlab-system", system); }, [system]);
  useEffect(() => { store.set("rlab-model", model); store.set("rlab-effort", effort); store.set("rlab-output", output); }, [model, effort, output]);
  useEffect(() => { if (textFormat.trim()) store.set("rlab-format", textFormat); }, [textFormat]);
  const applyPreset = (p: Preset) => { setSystem(p.system); setTextFormat(p.format); setOutput(p.output); };
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setElapsed(Math.round((Date.now() - running) / 1000)), 1000); return () => clearInterval(t); }, [running]);

  const lo = Math.min(from, to), hi = Math.max(from, to);
  const range = whole ? undefined : { from: lo, to: hi };
  const changed = product && system.trim() !== product.trim();
  const clickTalk = (i: number, shift: boolean) => { setWhole(false); if (shift) setTo(i); else { setFrom(i); setTo(i); } setUserText(null); };
  const showUser = async () => { setUserText((await api<{ user: string }>(`/${pid}${range ? `?range=${range.from}-${range.to}` : ""}`)).user); };
  const run = async () => {
    setError(""); setElapsed(0); setRunning(Date.now());
    try { const d = await api<{ run: Run }>(`/${pid}`, { system, model, effort, note, format: output, ...(output === "text" ? { textFormat } : {}), ...(range ? { range } : {}) }); setRuns((r) => [d.run, ...r]); }
    catch (e) { setError((e as Error).message); }
    finally { setRunning(0); }
  };
  const shown = useMemo(() => pick.length === 2 ? runs.filter((r) => pick.includes(r.id)) : runs, [pick, runs]);

  return <div className="rlab">
    <header className="rlab-top">
      <div><h1>총정리 실험실</h1><p>대화 범위를 작게 잘라, 지시문·모델·강도를 바꿔 가며 총정리가 어떻게 나오는지 봐요. 돌릴 때마다 AI 1번. 풀이 노트의 실제 총정리는 바뀌지 않아요.</p></div>
      <div className="rlab-quick"><button className={tab === "lab" ? "on" : ""} onClick={() => { setTab("lab"); store.set("rlab-tab", "lab"); }}>실험</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => { setTab("history"); store.set("rlab-tab", "history"); }}>지난 기록 전부(개발자용)</button></div>
      <label className="rlab-field">풀이<select value={pid} onChange={(e) => { setPid(e.target.value); setUserText(null); setPick([]); }}>{problems.map((p) => <option key={p.id} value={p.id}>{p.title} · 주고받은 것 {p.talks}개</option>)}</select></label>
    </header>
    {error ? <p className="rlab-err">{error}</p> : null}
    {tab === "history" ? <History product={product} titles={Object.fromEntries(problems.map((p) => [p.id, p.title]))} /> : null}
    <div className="rlab-body" hidden={tab !== "lab"}>
      <aside className="rlab-side">
        <section className="rlab-box">
          <div className="rlab-boxhead"><b>범위</b><span>{whole ? `전체 ${talks.length}개` : `${lo + 1}~${hi + 1}번 (${hi - lo + 1}개)`}</span></div>
          <div className="rlab-quick">
            <button onClick={() => { setWhole(true); setUserText(null); }} className={whole ? "on" : ""}>전체</button>
            <button onClick={() => { setWhole(false); setFrom(0); setTo(Math.min(4, talks.length - 1)); setUserText(null); }}>앞 5개</button>
            <button onClick={() => { setWhole(false); setFrom(Math.max(0, talks.length - 5)); setTo(talks.length - 1); setUserText(null); }}>뒤 5개</button>
            <span className="rlab-hint">누르면 시작, Shift+누르면 끝</span>
          </div>
          <ol className="rlab-talks">{talks.map((t) => {
            const inside = whole || (t.i >= lo && t.i <= hi);
            return <li key={t.i} className={inside ? "in" : ""} onClick={(e) => clickTalk(t.i, e.shiftKey)} title={`AI: ${t.a}`}>
              <span className="n">{t.i + 1}</span><span className="kind">{t.kind}{t.verdict ? ` · ${t.verdict}` : ""}</span><span className="q">{t.q}</span>
            </li>;
          })}</ol>
        </section>
        <section className="rlab-box">
          <div className="rlab-row">
            <label className="rlab-field">모델<select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="rlab-field">강도<select value={effort} onChange={(e) => setEffort(e.target.value)}>{efforts.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
          <div className="rlab-row">
            <label className="rlab-field">출력<select value={output} onChange={(e) => setOutput(e.target.value as "json" | "text")}><option value="json">JSON</option><option value="text">글(표시 있는 마크다운)</option></select></label>
            <div className="rlab-field">지시문 묶음<div className="rlab-quick">{presets.map((p) => <button key={p.id} onClick={() => applyPreset(p)}>{p.label}</button>)}</div></div>
          </div>
          <label className="rlab-field">메모<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="이번에 바꾼 것 (예: 핵심 기준 좁힘)" /></label>
        </section>
        <section className="rlab-box grow">
          <div className="rlab-boxhead"><b>지시문</b>{changed ? <span className="tag">제품과 다름</span> : <span>제품과 같음</span>}<button className="link" onClick={() => setSystem(product)}>제품 지시문으로</button></div>
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} spellCheck={false} />
          <button className="link" onClick={() => (userText === null ? void showUser() : setUserText(null))}>{userText === null ? "AI에 보낼 기록 보기" : "기록 접기"}</button>
          {userText !== null ? <pre className="rlab-user">{userText}</pre> : null}
        </section>
        {output === "text" ? <section className="rlab-box">
          <div className="rlab-boxhead"><b>출력 틀(글)</b><span>지시문 뒤에 붙어요</span></div>
          <textarea className="short" value={textFormat} onChange={(e) => setTextFormat(e.target.value)} spellCheck={false} />
        </section> : null}
        <button className="rlab-run" disabled={!!running || !pid || !system.trim()} onClick={() => void run()}>
          {running ? `만드는 중… ${elapsed}초` : `돌려 보기 (AI 1번 · ${model.replace("gpt-", "")} ${effort})`}
        </button>
      </aside>
      <main className="rlab-main">
        <div className="rlab-boxhead"><b>결과 {runs.length}개</b><span>{pick.length === 2 ? "두 개 나란히 보는 중" : "두 개를 고르면 나란히 봐요"}</span>{pick.length ? <button className="link" onClick={() => setPick([])}>고른 것 풀기</button> : null}</div>
        <div className={pick.length === 2 ? "rlab-pair" : "rlab-list"}>
          {shown.map((r) => <RunCard key={r.id} r={r} total={talks.length} picked={pick.includes(r.id)} product={product}
            onPick={() => setPick((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id].slice(-2))}
            onUse={() => { setSystem(r.system); setModel(r.model); setEffort(r.effort); if (r.range) { setWhole(false); setFrom(r.range.from); setTo(r.range.to); } else setWhole(true); }} />)}
          {!runs.length ? <p className="rlab-empty">아직 돌린 것이 없어요. 왼쪽에서 범위를 고르고 돌려 보세요.</p> : null}
        </div>
      </main>
    </div>
  </div>;
}

function RunCard({ r, total, picked, product, onPick, onUse }: { r: Run; total: number; picked: boolean; product: string; onPick: () => void; onUse: () => void }) {
  const [raw, setRaw] = useState(false);
  const [sys, setSys] = useState(false);
  const weak = r.review?.story.filter((x) => x.weak) ?? [];
  const big = weak.filter((x) => x.weak!.size === "big").length;
  return <article className={`rlab-run-card${picked ? " picked" : ""}`}>
    <header>
      <div className="meta">
        <span className="chip m">{r.model.replace("gpt-", "")} · {r.effort}</span>
        <span className="chip">{r.range ? `${r.range.from + 1}~${r.range.to + 1} / ${total}` : `전체 ${total}`}</span>
        <span className="chip">{(r.ms / 1000).toFixed(0)}초</span>
        <span className="chip">입력 {k(r.tokens?.in)}{r.tokens?.cached ? ` (캐시 ${k(r.tokens.cached)})` : ""} · 출력 {k(r.tokens?.out)}</span>
        <span className="chip">{r.cost == null ? "$—" : `$${r.cost.toFixed(4)}`}</span>
        {r.review ? <span className="chip w">약점 {weak.length} · 핵심 {big} · 작은 {weak.length - big}</span> : null}
        {r.format === "text" ? <span className="chip d">글</span> : null}
        {r.format === "text" && typeof r.raw === "string" && !r.review ? <span className="chip w">주제 {(r.raw.match(/^##\s/gm) ?? []).length} · 핵심 {(r.raw.match(/^##.*\[핵심\]/gm) ?? []).length} · 작은 {(r.raw.match(/^##.*\[작은\]/gm) ?? []).length} · {r.raw.length}자</span> : null}
        {!r.system.trim().startsWith(product.trim().slice(0, 200)) ? <span className="chip d">지시문 바꿈</span> : null}
      </div>
      <div className="acts">
        <span className="when">{new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <button className="link" onClick={onUse}>이 설정 쓰기</button>
        <label className="pick"><input type="checkbox" checked={picked} onChange={onPick} /> 비교</label>
      </div>
      {r.note ? <p className="note">{r.note}</p> : null}
    </header>
    {r.error ? <p className="rlab-err">{r.error}</p> : null}
    {r.review ? <div className="rv">
      <div className="intro"><div><b>문제 상황</b><p>{r.review.situation}</p></div><div><b>이렇게 해야 풀려요</b><p>{r.review.solve}</p></div></div>
      <ol className="story">{r.review.story.map((s, i) => <li key={i}>
        <p className="tell"><Ic text={s.text} /></p>
        {s.weak ? <div className={`weak ${s.weak.size}`}>
          <div className="wh"><span className="sz">{s.weak.size === "big" ? "핵심" : "작은"}</span><b>{s.weak.title}</b><span className="len">{s.weak.lesson.length}자</span></div>
          {s.weak.state ? <p className="state"><Ic text={s.weak.state} /></p> : null}
          <Rich text={s.weak.lesson} />
        </div> : null}
      </li>)}</ol>
      {r.review.next ? <p className="next"><b>다음에 떠올릴 것</b> {r.review.next}</p> : null}
    </div> : r.format === "text" && typeof r.raw === "string" ? <Pretty text={r.raw} /> : null}
    <div className="foot">
      <button className="link" onClick={() => setSys((x) => !x)}>{sys ? "지시문 접기" : "이때 지시문"}</button>
      <button className="link" onClick={() => setRaw((x) => !x)}>{raw ? "원본 접기" : r.format === "text" ? "AI 원본(글)" : "AI 원본(JSON)"}</button>
    </div>
    {sys ? <pre className="raw">{r.system}</pre> : null}
    {raw ? <pre className="raw">{typeof r.raw === "string" ? r.raw : JSON.stringify(r.raw, null, 1)}</pre> : null}
  </article>;
}
function Ic({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((x, i) => (x.startsWith("`") && x.endsWith("`") && x.length > 2 ? <code key={i}>{x.slice(1, -1)}</code> : <span key={i}>{x}</span>))}</>;
}
function Rich({ text }: { text: string }) {
  return <div className="rich">{text.split(/```/).map((x, i) => i % 2 === 1
    ? <pre key={i}>{x.replace(/^[\w+-]*\n/, "").replace(/\n$/, "")}</pre>
    : x.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, j) => <p key={`${i}-${j}`}><Ic text={p} /></p>))}</div>;
}
/** 글 결과 보기: # 큰 머리 · ## 주제(끝의 [핵심]/[작은]은 표시로) · **굵은 머리말** · - 목록 · ``` 코드. 받은 글을 그대로 보여 준다. */
function Md({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let buf: string[] = [], list: string[] = [], code: string[] | null = null, key = 0;
  const flush = () => {
    if (buf.length) { out.push(<p key={key++}><Inline text={buf.join(" ")} /></p>); buf = []; }
    if (list.length) { out.push(<ul key={key++}>{list.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>); list = []; }
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (code) { out.push(<pre key={key++}>{code.join("\n")}</pre>); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    const h1 = /^#\s+(.+)/.exec(line), h2 = /^##\s+(.+)/.exec(line);
    if (h1) { flush(); out.push(<h3 key={key++} className="md-h1">{h1[1]}</h3>); continue; }
    if (h2) { flush(); const sz = /\[(핵심|작은)\]\s*$/.exec(h2[1]); out.push(<h4 key={key++} className={`md-h2 ${sz ? (sz[1] === "핵심" ? "big" : "small") : ""}`}>{sz ? <span className="sz">{sz[1]}</span> : null}{h2[1].replace(/\[(핵심|작은)\]\s*$/, "")}</h4>); continue; }
    const li = /^\s*[-•]\s+(.*)/.exec(line);
    if (li) { if (buf.length) { const b = buf; buf = []; out.push(<p key={key++}><Inline text={b.join(" ")} /></p>); } list.push(li[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    buf.push(line);
  }
  if (code) out.push(<pre key={key++}>{(code as string[]).join("\n")}</pre>);
  flush();
  return <div className="md">{out}</div>;
}
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((x, i) => x.startsWith("**") && x.endsWith("**") && x.length > 4 ? <b key={i} className="md-b">{x.slice(2, -2)}</b>
    : x.startsWith("`") && x.endsWith("`") && x.length > 2 ? <code key={i}>{x.slice(1, -1)}</code> : <span key={i}>{x}</span>)}</>;
}

/* ---------- 지난 기록 전부(개발자용, 11/12 사용자 "우리 테스트 존나 했잖아, 지시문 바꿔 가면서… 그것도 다 볼 수 있게") ----------
 * 호출 기록(/api/lab/ai/calls)에 남은 총정리 호출(제품 code:review-sheet + 실험실 code:review-lab)을 모두. 지시문이 같은 것끼리 "판"으로 묶고,
 * 앞 판과 달라진 줄을 보여 준다. 출력은 JSON이면 칸별로, 글이면 머리글 카드로. */
type CallRow = { id: string; at: string; purpose: string; model: string; effort?: string; ms?: number; ok: boolean; error?: string; tokens?: { in?: number; cached?: number; out?: number }; cost?: number | null; trace?: { ref?: string } };
type CallFull = CallRow & { system: string; user: string; reply: string };
function History({ product, titles }: { product: string; titles: Record<string, string> }) {
  const [rows, setRows] = useState<CallFull[] | null>(null);
  const [err, setErr] = useState("");
  const [only, setOnly] = useState<"all" | "product" | "lab">("all");
  const [pidF, setPidF] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const j = await fetch("/api/lab/ai/calls?limit=3000&since=2026-11-01T00:00:00.000Z", { cache: "no-store" }).then((r) => r.json()) as { calls: CallRow[] };
        const list = j.calls.filter((c) => c.purpose === "code:review-sheet" || c.purpose === "code:review-lab");
        const full: CallFull[] = [];
        for (let i = 0; i < list.length; i += 6) {
          const part = await Promise.all(list.slice(i, i + 6).map((c) => fetch(`/api/lab/ai/calls/${c.id}`, { cache: "no-store" }).then((r) => r.json()).then((d: { call: CallFull }) => ({ ...c, ...d.call })).catch(() => ({ ...c, system: "", user: "", reply: "" }))));
          full.push(...part);
        }
        setRows(full);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, []);
  // 지시문 판: 처음 나온 순서대로 번호(오래된 것이 1).
  const versions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of [...(rows ?? [])].sort((a, b) => a.at.localeCompare(b.at))) if (r.system && !m.has(r.system)) m.set(r.system, m.size + 1);
    return m;
  }, [rows]);
  const prevSystem = useMemo(() => { const arr = [...versions.keys()]; return (sys: string) => arr[(versions.get(sys) ?? 1) - 2] ?? ""; }, [versions]);
  if (err) return <p className="rlab-err">{err}</p>;
  if (!rows) return <p className="rlab-empty">호출 기록을 모으는 중이에요…</p>;
  const shown = rows.filter((r) => (only === "all" || (only === "product") === (r.purpose === "code:review-sheet")) && (!pidF || r.trace?.ref === pidF));
  const pids = [...new Set(rows.map((r) => r.trace?.ref).filter(Boolean) as string[])];
  const totalCost = shown.reduce((a, r) => a + (r.cost ?? 0), 0);
  return <section className="rlab-hist">
    <div className="rlab-boxhead">
      <b>총정리 호출 {shown.length}번</b><span>지시문 판 {versions.size}개 · 합계 ${totalCost.toFixed(3)}</span>
      <div className="rlab-quick">{(["all", "product", "lab"] as const).map((x) => <button key={x} className={only === x ? "on" : ""} onClick={() => setOnly(x)}>{x === "all" ? "전부" : x === "product" ? "제품(풀이 노트)" : "실험실"}</button>)}</div>
      <select value={pidF} onChange={(e) => setPidF(e.target.value)}><option value="">모든 풀이</option>{pids.map((p) => <option key={p} value={p}>{titles[p] ?? p}</option>)}</select>
    </div>
    <div className="rlab-list">{shown.map((r) => <HistCard key={r.id} r={r} ver={versions.get(r.system) ?? 0} prev={prevSystem(r.system)} isProduct={r.system.trim().startsWith(product.trim().slice(0, 200)) && !!product} title={titles[r.trace?.ref ?? ""] ?? r.trace?.ref ?? ""} />)}</div>
  </section>;
}
function HistCard({ r, ver, prev, title }: { r: CallFull; ver: number; prev: string; isProduct: boolean; title: string }) {
  const [open, setOpen] = useState(false);
  const [sys, setSys] = useState<"" | "diff" | "all">("");
  const [user, setUser] = useState(false);
  const reply = r.reply ?? "";
  const json = reply.trim().startsWith("{");
  let parsed: unknown = null;
  if (json) { try { parsed = JSON.parse(reply); } catch { parsed = null; } }
  const topics = !json ? (reply.match(/^##\s/gm) ?? []).length : 0;
  return <article className="rlab-run-card">
    <header>
      <div className="meta">
        <span className="chip m">판 {ver}</span>
        <span className="chip">{r.purpose === "code:review-sheet" ? "제품" : "실험실"}</span>
        <span className="chip">{title}</span>
        <span className="chip">{r.model.replace("gpt-", "")}{r.effort ? ` · ${r.effort}` : ""}</span>
        <span className="chip">{r.ms ? `${Math.round(r.ms / 1000)}초` : "—"}</span>
        <span className="chip">입력 {k(r.tokens?.in)} · 출력 {k(r.tokens?.out)}</span>
        <span className="chip">{r.cost == null ? "$—" : `$${r.cost.toFixed(4)}`}</span>
        <span className="chip d">{json ? "JSON" : `글${topics ? ` · 주제 ${topics}` : ""}`}</span>
        {!r.ok ? <span className="chip w">실패: {r.error}</span> : null}
      </div>
      <div className="acts">
        <span className="when">{new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <button className="link" onClick={() => setOpen((x) => !x)}>{open ? "결과 접기" : "결과 보기"}</button>
        <button className="link" onClick={() => setSys((x) => (x === "diff" ? "" : "diff"))}>{prev ? "앞 판과 달라진 줄" : "지시문(첫 판)"}</button>
        <button className="link" onClick={() => setSys((x) => (x === "all" ? "" : "all"))}>지시문 전체</button>
        <button className="link" onClick={() => setUser((x) => !x)}>보낸 기록</button>
      </div>
    </header>
    {sys === "diff" ? <Diff a={prev} b={r.system} /> : sys === "all" ? <pre className="raw">{r.system}</pre> : null}
    {user ? <pre className="raw">{r.user}</pre> : null}
    {open ? (json ? (parsed ? <div className="jv"><JsonView v={parsed} /></div> : <pre className="raw">{reply}</pre>) : <Pretty text={reply} />) : null}
  </article>;
}
/** 줄 단위 차이: 앞 판에 없던 줄은 +, 사라진 줄은 −. (순서는 새 판 기준) */
function Diff({ a, b }: { a: string; b: string }) {
  if (!a) return <pre className="raw">{b}</pre>;
  const A = new Set(a.split("\n").map((x) => x.trim()).filter(Boolean)), B = new Set(b.split("\n").map((x) => x.trim()).filter(Boolean));
  const added = b.split("\n").filter((x) => x.trim() && !A.has(x.trim()));
  const removed = a.split("\n").filter((x) => x.trim() && !B.has(x.trim()));
  return <div className="diff">{added.map((x, i) => <div key={`a${i}`} className="add">+ {x}</div>)}{removed.map((x, i) => <div key={`r${i}`} className="del">− {x}</div>)}{!added.length && !removed.length ? <div className="muted">달라진 줄 없음(같은 지시문)</div> : null}</div>;
}
/** JSON 결과를 칸별로(예전 판들은 모양이 제각각이라 이름 그대로 보여 준다). */
function JsonView({ v, name }: { v: unknown; name?: string }) {
  if (typeof v === "string") return <div className="jv-s">{name ? <b className="jv-k">{name}</b> : null}<Rich text={v} /></div>;
  if (typeof v === "number" || typeof v === "boolean" || v == null) return <div className="jv-s">{name ? <b className="jv-k">{name}</b> : null}<code>{String(v)}</code></div>;
  if (Array.isArray(v)) return <div className="jv-a">{name ? <b className="jv-k">{name} ({v.length})</b> : null}<ol>{v.map((x, i) => <li key={i}><JsonView v={x} /></li>)}</ol></div>;
  return <div className="jv-o">{name ? <b className="jv-k">{name}</b> : null}{Object.entries(v as Record<string, unknown>).map(([key, x]) => <JsonView key={key} v={x} name={key} />)}</div>;
}
/** 글 결과를 풀이 노트와 같은 모양으로(11/12 사용자 "2606 바이러스에 있는 것처럼 이쁘게 정리된 형식으로"). 리뷰어 틀이 아니면 그냥 글로. */
function Pretty({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);
  if (!/^#\s+학습 총평/m.test(text)) return <Md text={text} />;
  return <div className="rlab-prettywrap">
    <div className="rlab-quick"><button className={raw ? "" : "on"} onClick={() => setRaw(false)}>풀이 노트 모양</button><button className={raw ? "on" : ""} onClick={() => setRaw(true)}>글 그대로</button></div>
    {raw ? <Md text={text} /> : <div className="dejipgi rlab-pretty"><section className="rp-review2"><MdReviewView md={text} /></section></div>}
  </div>;
}
