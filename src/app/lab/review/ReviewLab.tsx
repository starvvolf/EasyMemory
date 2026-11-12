"use client";
// 총정리 실험실 (11/12 사용자): 풀이 하나를 골라, 대화 범위를 작게 잘라서, 지시문·모델·강도를 바꿔 가며 총정리가 어떻게 나오는지 본다.
// 돌릴 때마다 AI 1번(데이터 폴더 code/tutor/review-lab.jsonl에 남음). 제품 총정리(풀이 노트)는 건드리지 않는다.
import { useEffect, useMemo, useState } from "react";
import "./review-lab.css";

type Weak = { size: "small" | "big"; title: string; state: string; lesson: string };
type Review = { situation: string; solve: string; story: Array<{ text: string; weak?: Weak }>; next: string };
type Talk = { i: number; at: string; kind: string; q: string; a: string; verdict: string };
type Run = { id: string; at: string; problemId: string; title: string; range: { from: number; to: number } | null; model: string; effort: string; note: string;
  system: string; ms: number; tokens?: { in?: number; cached?: number; out?: number }; review: Review | null; raw: unknown; error?: string; cost: number | null };
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

  useEffect(() => {
    void api<{ problems: Problem[]; system: string; models: string[]; efforts: string[] }>("").then((d) => {
      setProblems(d.problems); setProduct(d.system); setModels(d.models); setEfforts(d.efforts);
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
  useEffect(() => { store.set("rlab-model", model); store.set("rlab-effort", effort); }, [model, effort]);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setElapsed(Math.round((Date.now() - running) / 1000)), 1000); return () => clearInterval(t); }, [running]);

  const lo = Math.min(from, to), hi = Math.max(from, to);
  const range = whole ? undefined : { from: lo, to: hi };
  const changed = product && system.trim() !== product.trim();
  const clickTalk = (i: number, shift: boolean) => { setWhole(false); if (shift) setTo(i); else { setFrom(i); setTo(i); } setUserText(null); };
  const showUser = async () => { setUserText((await api<{ user: string }>(`/${pid}${range ? `?range=${range.from}-${range.to}` : ""}`)).user); };
  const run = async () => {
    setError(""); setElapsed(0); setRunning(Date.now());
    try { const d = await api<{ run: Run }>(`/${pid}`, { system, model, effort, note, ...(range ? { range } : {}) }); setRuns((r) => [d.run, ...r]); }
    catch (e) { setError((e as Error).message); }
    finally { setRunning(0); }
  };
  const shown = useMemo(() => pick.length === 2 ? runs.filter((r) => pick.includes(r.id)) : runs, [pick, runs]);

  return <div className="rlab">
    <header className="rlab-top">
      <div><h1>총정리 실험실</h1><p>대화 범위를 작게 잘라, 지시문·모델·강도를 바꿔 가며 총정리가 어떻게 나오는지 봐요. 돌릴 때마다 AI 1번. 풀이 노트의 실제 총정리는 바뀌지 않아요.</p></div>
      <label className="rlab-field">풀이<select value={pid} onChange={(e) => { setPid(e.target.value); setUserText(null); setPick([]); }}>{problems.map((p) => <option key={p.id} value={p.id}>{p.title} · 주고받은 것 {p.talks}개</option>)}</select></label>
    </header>
    {error ? <p className="rlab-err">{error}</p> : null}
    <div className="rlab-body">
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
          <label className="rlab-field">메모<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="이번에 바꾼 것 (예: 핵심 기준 좁힘)" /></label>
        </section>
        <section className="rlab-box grow">
          <div className="rlab-boxhead"><b>지시문</b>{changed ? <span className="tag">제품과 다름</span> : <span>제품과 같음</span>}<button className="link" onClick={() => setSystem(product)}>제품 지시문으로</button></div>
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} spellCheck={false} />
          <button className="link" onClick={() => (userText === null ? void showUser() : setUserText(null))}>{userText === null ? "AI에 보낼 기록 보기" : "기록 접기"}</button>
          {userText !== null ? <pre className="rlab-user">{userText}</pre> : null}
        </section>
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
        {r.system.trim() !== product.trim() ? <span className="chip d">지시문 바꿈</span> : null}
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
    </div> : null}
    <div className="foot">
      <button className="link" onClick={() => setSys((x) => !x)}>{sys ? "지시문 접기" : "이때 지시문"}</button>
      <button className="link" onClick={() => setRaw((x) => !x)}>{raw ? "원본 접기" : "AI 원본(JSON)"}</button>
    </div>
    {sys ? <pre className="raw">{r.system}</pre> : null}
    {raw ? <pre className="raw">{JSON.stringify(r.raw, null, 1)}</pre> : null}
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
