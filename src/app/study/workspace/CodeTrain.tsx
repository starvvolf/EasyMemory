"use client";
// 훈련 모드 · 지켜보기 (2026-10-31, PS 루트 실험; 서버 src/lib/code/train.ts). Shown only on a server that switched them on
// (scripts/run-lab.mjs ps → RECALLER_PS_TRAIN / RECALLER_PS_WATCH); the main app's code screen stays as it is.
// 훈련 모드: seven steps under the problem, each a short answer the app checks (most by code, a few by the model).
// 지켜보기: when the learner stops typing, gets stuck or keeps tinkering, the code so far is run on the examples and the
// largest hidden test, then looked at by the model; only a problem is said, in one line above the editor.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, later } from "./api";

type Lang = "python" | "javascript" | "cpp" | "csharp";
export type Lab = { train: boolean; watch: boolean };
export function useLab() {
  const [lab, setLab] = useState<Lab>({ train: false, watch: false });
  useEffect(() => later(() => void call<Lab>("/api/code/lab").then(setLab).catch(() => undefined)), []);
  return lab;
}

/* ---------- 모드 ---------- */
type Step = "understand" | "model" | "approach" | "correct" | "complexity" | "implement" | "review";
type StepRecord = { answer: Record<string, unknown>; result?: unknown; skipped?: boolean; at: string };
type TrainState = { mode: "base" | "train"; steps: Partial<Record<Step, StepRecord>> };
const STEPS: Array<[Step, string]> = [["understand", "이해"], ["model", "추상화"], ["approach", "탐색"], ["correct", "정당성"], ["complexity", "복잡도"], ["implement", "구현"], ["review", "복기"]];
export function useTrain(id: string, on: boolean) {
  const [state, setState] = useState<TrainState | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [complexities, setComplexities] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (!on) return;
    try { const r = await call<{ train: TrainState; size: number | null; complexities: string[] }>(`/api/code/problem/${id}/train`); setState(r.train); setSize(r.size); setComplexities(r.complexities); } catch { /* off */ }
  }, [id, on]);
  useEffect(() => later(() => void load()), [load]);
  const setMode = async (mode: "base" | "train") => { try { setState((await call<{ train: TrainState }>(`/api/code/problem/${id}/train/mode`, { mode })).train); } catch { /* stays */ } };
  return { state, size, complexities, setMode, reload: load, setSize };
}
export function ModeSwitch({ mode, onMode }: { mode: "base" | "train"; onMode: (m: "base" | "train") => void }) {
  return (
    <div className="row small" role="group" aria-label="풀이 모드">
      <span className="muted">모드</span>
      <button className="chip-btn" aria-pressed={mode === "base"} onClick={() => onMode("base")} title="바로 코드를 쓰고, 막히면 힌트를 받아요">기본</button>
      <button className="chip-btn" aria-pressed={mode === "train"} onClick={() => onMode("train")} title="이해 → 추상화 → 탐색 → 정당성 → 복잡도 → 구현 → 복기를 한 칸씩">훈련</button>
    </div>
  );
}

type Verdictish = { ok?: boolean | null; note?: string };
const Mark = ({ v }: { v?: Verdictish | null }) => !v ? null : <p className={`small cs-tr-note ${v.ok === true ? "good" : v.ok === false ? "bad" : ""}`}>{v.ok === true ? "✓ " : v.ok === false ? "✗ " : ""}{v.note}</p>;
const Coach = ({ r }: { r?: { state: string; say: string } | null }) => !r ? null
  : <p className={`small cs-tr-note ${r.state === "맞는 길" || r.state === "다른 길" ? "good" : r.state === "더 생각" ? "help" : ""}`}><b>{r.state}</b> · {r.say}</p>;

/** The seven steps under the problem. `code`/`lang` are the editor's, for step 6's own inputs. */
export function TrainPanel({ id, train, timeLimitMs, lang, code, solved }: { id: string; train: ReturnType<typeof useTrain>; timeLimitMs: number; lang: Lang; code: () => string; solved: boolean }) {
  const steps = train.state?.steps ?? {};
  const firstOpen = STEPS.find(([s]) => !steps[s])?.[0] ?? "review";
  const [open, setOpen] = useState<Step>(firstOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(""); try { await f(); await train.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const next = (s: Step) => { const i = STEPS.findIndex(([k]) => k === s); setOpen(STEPS[Math.min(i + 1, STEPS.length - 1)][0]); };
  const skip = (s: Step) => void run(async () => { await call(`/api/code/problem/${id}/train/step`, { step: s, skipped: true }); next(s); });
  const done = (s: Step) => Boolean(steps[s]);
  const prev = <T,>(s: Step, k: string, d: T) => ((steps[s]?.answer?.[k] as T | undefined) ?? d);
  return (
    <section className="cs-train">
      <div className="cs-tr-steps">{STEPS.map(([s, label], i) => (
        <button key={s} className={`cs-tr-step ${open === s ? "cur" : done(s) ? (steps[s]!.skipped ? "skip" : "done") : ""}`} onClick={() => setOpen(s)}>{i + 1} {label}</button>
      ))}</div>
      {open === "understand" ? <Understand key="u" id={id} busy={busy} run={run} prev={(k, d) => prev("understand", k, d)} result={steps.understand?.result as UResult | undefined} timeLimitMs={timeLimitMs} onNext={() => next("understand")} onSkip={() => skip("understand")} onSize={train.setSize} /> : null}
      {open === "model" ? <Coached key="m" id={id} step="model" busy={busy} run={run} result={steps.model?.result as CoachR} onNext={() => next("model")} onSkip={() => skip("model")}
        fields={[["line", "이 문제를 무엇으로 볼까요? 한 줄로 (예: 건물 = 정점, 먼저 지어야 함 = 간선)", prev("model", "line", "")]]} /> : null}
      {open === "approach" ? <Approach key="a" id={id} busy={busy} run={run} complexities={train.complexities} size={train.size} result={steps.approach?.result as CoachR}
        prev={(k, d) => prev("approach", k, d)} onNext={() => next("approach")} onSkip={() => skip("approach")} /> : null}
      {open === "correct" ? <Correct key="c" id={id} busy={busy} run={run} result={steps.correct?.result as CoachR} prev={(k, d) => prev("correct", k, d)} onNext={() => next("correct")} onSkip={() => skip("correct")} /> : null}
      {open === "complexity" ? <Complexity key="x" id={id} busy={busy} run={run} complexities={train.complexities} size={train.size} result={steps.complexity?.result as XResult | undefined}
        prev={(k, d) => prev("complexity", k, d)} onNext={() => next("complexity")} onSkip={() => skip("complexity")} /> : null}
      {open === "implement" ? <Implement key="i" id={id} lang={lang} code={code} mine={[prev<string>("understand", "input", ""), ...prev<string[]>("correct", "inputs", [])].filter((x) => x.trim())}
        onNext={() => void run(async () => { await call(`/api/code/problem/${id}/train/step`, { step: "implement", answer: {} }); next("implement"); })} /> : null}
      {open === "review" ? <Review key="r" id={id} solved={solved} saved={steps.review?.answer as Review3 | undefined} /> : null}
      {error ? <p className="ws-err small">{error}</p> : null}
    </section>
  );
}
type Run = (f: () => Promise<void>) => Promise<void>;
type Prev = <T>(k: string, d: T) => T;
type CoachR = { state: string; say: string } | undefined;
const Buttons = ({ busy, onCheck, onNext, onSkip, checkLabel = "확인", canNext }: { busy: boolean; onCheck?: () => void; onNext: () => void; onSkip: () => void; checkLabel?: string; canNext: boolean }) => (
  <div className="row">{onCheck ? <button className="btn primary small" disabled={busy} onClick={onCheck}>{busy ? "보는 중…" : checkLabel}</button> : null}
    <button className="btn small" disabled={!canNext} onClick={onNext}>다음 단계</button><button className="btn ghost small" onClick={onSkip}>건너뛰기</button></div>
);

type UResult = { n: Verdictish | null; time: Verdictish | null; mine: (Verdictish & { expected?: string }) | null };
function Understand({ id, busy, run, prev, result, timeLimitMs, onNext, onSkip, onSize }: { id: string; busy: boolean; run: Run; prev: Prev; result?: UResult; timeLimitMs: number; onNext: () => void; onSkip: () => void; onSize: (n: number | null) => void }) {
  const [maxN, setMaxN] = useState(String(prev("maxN", "")));
  const [timeSec, setTimeSec] = useState(String(prev("timeSec", "")));
  const [output, setOutput] = useState(prev("output", ""));
  const [input, setInput] = useState(prev("input", ""));
  const [mine, setMine] = useState(prev("myAnswer", ""));
  const num = (s: string) => { const t = s.replace(/,/g, "").trim(); if (!t) return undefined; const m = /^(\d+(?:\.\d+)?)\s*(?:\*|×|x)?\s*(?:10\^(\d+)|e(\d+))?$/i.exec(t); return m ? Number(m[1]) * 10 ** Number(m[2] ?? m[3] ?? 0) : Number(t); };
  const check = () => void run(async () => {
    const r = await call<{ result: UResult; size: number | null }>(`/api/code/problem/${id}/train/understand`, { ...(num(maxN) !== undefined ? { maxN: num(maxN) } : {}), ...(num(timeSec) !== undefined ? { timeSec: num(timeSec) } : {}),
      ...(output.trim() ? { output } : {}), ...(input.trim() ? { input } : {}), ...(mine.trim() ? { myAnswer: mine } : {}) });
    onSize(r.size);
  });
  void timeLimitMs;
  return (
    <div className="cs-tr-body">
      <p className="small muted">입력·출력·조건을 내 말로 적어요. 특히 입력 크기와 시간 제한.</p>
      <div className="row small"><label>N의 최대 <input className="ws-input cs-tr-num" value={maxN} onChange={(e) => setMaxN(e.target.value)} placeholder="예: 100000" /></label>
        <label>시간 제한 <input className="ws-input cs-tr-num" value={timeSec} onChange={(e) => setTimeSec(e.target.value)} placeholder="초" />초</label></div>
      <Mark v={result?.n} /><Mark v={result?.time} />
      <input className="ws-input" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="무엇을 출력하나요? 한 줄로" />
      <p className="small muted">작은 입력을 하나 만들고, 답을 손으로 구해 보세요. 앱이 모범 풀이로 정답을 알려 줘요.</p>
      <div className="cs-io"><textarea className="ws-input mono" rows={4} value={input} onChange={(e) => setInput(e.target.value)} placeholder="내가 만든 입력" />
        <textarea className="ws-input mono" rows={4} value={mine} onChange={(e) => setMine(e.target.value)} placeholder="내가 구한 답" /></div>
      {result?.mine ? <><Mark v={result.mine} />{result.mine.expected !== undefined && result.mine.ok === false ? <pre className="cs-out">정답: {result.mine.expected}</pre> : null}</> : null}
      <Buttons busy={busy} onCheck={check} onNext={onNext} onSkip={onSkip} canNext={Boolean(result)} />
    </div>
  );
}
function Coached({ id, step, busy, run, result, fields, onNext, onSkip }: { id: string; step: "model" | "approach" | "correct"; busy: boolean; run: Run; result: CoachR; fields: Array<[string, string, string]>; onNext: () => void; onSkip: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k, , v]) => [k, v])));
  const check = () => void run(async () => { await call(`/api/code/problem/${id}/train/check`, { step, answer: values }); });
  return (
    <div className="cs-tr-body">
      {fields.map(([k, label]) => <textarea key={k} className="ws-input" rows={2} value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} placeholder={label} />)}
      <Coach r={result} />
      <Buttons busy={busy} onCheck={Object.values(values).some((v) => v.trim()) ? check : undefined} onNext={onNext} onSkip={onSkip} canNext={Boolean(result)} checkLabel="AI에게 확인받기" />
    </div>
  );
}
type XResult = { expr: string; n: number; level: string; note: string };
function Approach({ id, busy, run, complexities, size, result, prev, onNext, onSkip }: { id: string; busy: boolean; run: Run; complexities: string[]; size: number | null; result: CoachR; prev: Prev; onNext: () => void; onSkip: () => void }) {
  const [brute, setBrute] = useState(prev("brute", ""));
  const [count, setCount] = useState(prev("count", "2ⁿ"));
  const [slow, setSlow] = useState(prev("slow", ""));
  const [better, setBetter] = useState(prev("better", ""));
  const [ops, setOps] = useState<XResult | null>(null);
  const [opsErr, setOpsErr] = useState("");
  const countOps = async (expr: string) => { setCount(expr); setOpsErr(""); try { setOps((await call<{ result: XResult }>(`/api/code/problem/${id}/train/complexity`, { time: expr, save: false })).result); } catch (e) { setOps(null); setOpsErr(errorText(e)); } };
  const check = () => void run(async () => { await call(`/api/code/problem/${id}/train/check`, { step: "approach", answer: { brute, count, slow, better } }); });
  return (
    <div className="cs-tr-body">
      <p className="small muted">완전탐색부터 생각하고, 왜 느린지 찾아서 줄여요.</p>
      <textarea className="ws-input" rows={2} value={brute} onChange={(e) => setBrute(e.target.value)} placeholder="① 다 해 보면? (예: 모든 경로를 따라간다)" />
      <div className="row small"><span className="muted">그러면 몇 번?</span><select className="ws-select" value={count} onChange={(e) => void countOps(e.target.value)}>{complexities.map((c) => <option key={c} value={c}>O({c})</option>)}</select>
        {size ? null : <span className="muted">(1단계에서 N을 적으면 계산해 줘요)</span>}</div>
      {ops ? <p className={`small cs-tr-note ${ops.level === "안 됨" ? "bad" : ops.level === "아슬" ? "help" : "good"}`}>{ops.note}</p> : opsErr ? <p className="small muted">{opsErr}</p> : null}
      <textarea className="ws-input" rows={2} value={slow} onChange={(e) => setSlow(e.target.value)} placeholder="② 왜 느린가? (예: 같은 칸을 여러 번 계산)" />
      <textarea className="ws-input" rows={2} value={better} onChange={(e) => setBetter(e.target.value)} placeholder="③ 어떻게 줄이나?" />
      <Coach r={result} />
      <Buttons busy={busy} onCheck={brute.trim() || better.trim() ? check : undefined} onNext={onNext} onSkip={onSkip} canNext={Boolean(result)} checkLabel="AI에게 확인받기" />
    </div>
  );
}
type Row = { input: string; expected?: string; got?: string; verdict?: string; note?: string };
function Correct({ id, busy, run, result, prev, onNext, onSkip }: { id: string; busy: boolean; run: Run; result: CoachR; prev: Prev; onNext: () => void; onSkip: () => void }) {
  const [why, setWhy] = useState(prev("why", ""));
  const [inputs, setInputs] = useState<string[]>(() => { const p = prev<string[]>("inputs", []); return [...p, "", "", ""].slice(0, 3); });
  const [rows, setRows] = useState<Row[]>([]);
  const answers = async () => { setRows((await call<{ rows: Row[] }>(`/api/code/problem/${id}/train/inputs`, { inputs: inputs.filter((x) => x.trim()) })).rows); };
  const check = () => void run(async () => {
    if (inputs.some((x) => x.trim())) await answers();
    if (why.trim()) await call(`/api/code/problem/${id}/train/check`, { step: "correct", answer: { why, inputs: inputs.filter((x) => x.trim()).join("\n---\n") } });
    else await call(`/api/code/problem/${id}/train/step`, { step: "correct", answer: { inputs: inputs.filter((x) => x.trim()) } });
  });
  return (
    <div className="cs-tr-body">
      <textarea className="ws-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="왜 항상 맞을까요? 한 줄로" />
      <p className="small muted">이 방법이 틀릴 것 같은 입력을 넣어 보세요. 정답은 모범 풀이로 보여 줘요. 내 방법이면 뭐가 나올지 먼저 생각해 보고 비교해요.</p>
      <div className="cs-tr-inputs">{inputs.map((v, i) => <textarea key={i} className="ws-input mono" rows={3} value={v} onChange={(e) => setInputs((xs) => xs.map((x, j) => j === i ? e.target.value : x))} placeholder={`입력 ${i + 1}`} />)}</div>
      {rows.length ? <ul className="cs-tr-rows">{rows.map((r, i) => <li key={i} className="small"><span className="muted">입력 {i + 1}</span> {r.note ? r.note : <>정답 <code>{r.expected}</code></>}</li>)}</ul> : null}
      <Coach r={result} />
      <Buttons busy={busy} onCheck={why.trim() || inputs.some((x) => x.trim()) ? check : undefined} onNext={onNext} onSkip={onSkip} canNext={Boolean(result) || rows.length > 0} />
    </div>
  );
}
function Complexity({ id, busy, run, complexities, size, result, prev, onNext, onSkip }: { id: string; busy: boolean; run: Run; complexities: string[]; size: number | null; result?: XResult; prev: Prev; onNext: () => void; onSkip: () => void }) {
  const [time, setTime] = useState(prev("time", "n log n"));
  const [space, setSpace] = useState(prev("space", "n"));
  const check = () => void run(async () => { await call(`/api/code/problem/${id}/train/complexity`, { time, space }); });
  return (
    <div className="cs-tr-body">
      <p className="small muted">생각한 방법의 시간·공간 복잡도를 골라요. 앱이 N{size ? ` = ${size.toLocaleString()}` : ""}을 넣어 제한 안에 드는지 계산해요.</p>
      <div className="row small"><label>시간 O(<select className="ws-select" value={time} onChange={(e) => setTime(e.target.value)}>{complexities.map((c) => <option key={c}>{c}</option>)}</select>)</label>
        <label>공간 O(<select className="ws-select" value={space} onChange={(e) => setSpace(e.target.value)}>{complexities.slice(0, 7).map((c) => <option key={c}>{c}</option>)}</select>)</label></div>
      {result ? <p className={`small cs-tr-note ${result.level === "안 됨" ? "bad" : result.level === "아슬" ? "help" : "good"}`}>{result.note}</p> : null}
      <Buttons busy={busy} onCheck={check} onNext={onNext} onSkip={onSkip} canNext={Boolean(result)} checkLabel="계산" />
    </div>
  );
}
const EDGES = ["가장 작은 입력 (N = 1 등)", "가장 큰 값 (값의 최대·최소)", "모두 같은 값", "0이나 음수가 들어갈 수 있으면"];
function Implement({ id, lang, code, mine, onNext }: { id: string; lang: Lang; code: () => string; mine: string[]; onNext: () => void }) {
  const [edges, setEdges] = useState<string[]>(EDGES.map(() => ""));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [compile, setCompile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const all = [...mine, ...edges.filter((x) => x.trim())];
  const go = async () => {
    setBusy(true); setError(""); setCompile("");
    try { const r = await call<{ rows: Row[]; compile?: string }>(`/api/code/problem/${id}/train/inputs`, { inputs: all, lang, code: code(), step: "implement" }); setRows(r.rows); setCompile(r.compile ?? ""); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="cs-tr-body">
      <p className="small muted">코드는 가운데 편집기에 써요. 아래 경계 입력을 채워 내 코드와 모범 풀이를 비교해요. 숨은 테스트는 보여 주지 않아요.{mine.length ? ` 앞 단계에서 만든 입력 ${mine.length}개도 같이 돌려요.` : ""}</p>
      {EDGES.map((label, i) => <label key={label} className="small cs-tr-edge"><span>{label}</span><textarea className="ws-input mono" rows={2} value={edges[i]} onChange={(e) => setEdges((xs) => xs.map((x, j) => j === i ? e.target.value : x))} /></label>)}
      <div className="row"><button className="btn primary small" disabled={busy || !all.length} onClick={() => void go()}>{busy ? "도는 중…" : `내 코드로 돌려 보기 (${all.length}개)`}</button>
        <button className="btn small" onClick={onNext}>다음 단계</button></div>
      {compile ? <pre className="cs-out bad">{compile}</pre> : null}
      {rows ? <ul className="cs-tr-rows">{rows.map((r, i) => <li key={i} className="small"><span className={`chip ${r.verdict === "AC" ? "good" : r.verdict ? "bad" : ""}`}>{r.verdict === "AC" ? "같음" : r.verdict ? "다름" : "—"}</span> <code>{r.input.trim().split("\n")[0].slice(0, 40)}</code>
        {r.note ? ` ${r.note}` : r.verdict && r.verdict !== "AC" ? <> 정답 <code>{r.expected}</code> · 내 출력 <code>{r.got || "(없음)"}</code></> : null}</li>)}</ul> : null}
      {error ? <p className="ws-err small">{error}</p> : null}
    </div>
  );
}
type Review3 = { idea?: string; stuck?: string; transfer?: string };
function Review({ id, solved, saved }: { id: string; solved: boolean; saved?: Review3 }) {
  const [v, setV] = useState<Review3>(saved ?? {});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const draft = async () => { setBusy("draft"); setMsg(""); try { setV((await call<{ draft: Review3 }>(`/api/code/problem/${id}/train/review-draft`, {})).draft); } catch (e) { setMsg(errorText(e)); } finally { setBusy(""); } };
  const save = async () => { setBusy("save"); setMsg(""); try { const r = await call<{ recorded: number }>(`/api/code/problem/${id}/train/review`, v); setMsg(r.recorded ? "지식에 남겼어요. 지식 창의 '겪은 일'에서 볼 수 있어요." : "빈칸이라 남기지 않았어요."); window.dispatchEvent(new Event("recaller:knowledge-changed-sidebar")); } catch (e) { setMsg(errorText(e)); } finally { setBusy(""); } };
  const field = (k: keyof Review3, label: string) => <label className="small cs-tr-edge"><span>{label}</span><textarea className="ws-input" rows={2} value={v[k] ?? ""} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /></label>;
  return (
    <div className="cs-tr-body">
      <p className="small muted">{solved ? "맞혔어요. 무엇을 배웠는지 세 줄로 남겨요." : "맞힌 뒤에 쓰면 좋아요. 포기할 때 써도 돼요."} 초안은 AI가 이번 풀이로 만들어요. 고쳐서 저장해요.</p>
      <div className="row"><button className="btn small" disabled={Boolean(busy)} onClick={() => void draft()}>{busy === "draft" ? "만드는 중…" : "초안 만들기"}</button></div>
      {field("idea", "핵심 발상")}{field("stuck", "막힌 이유")}{field("transfer", "다른 문제에도 쓸 원리")}
      <div className="row"><button className="btn primary small" disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "남기는 중…" : "지식에 남기기"}</button></div>
      {msg ? <p className="small muted">{msg}</p> : null}
    </div>
  );
}

/* ---------- 지켜보기 ---------- */
type Look = { state: "ok" | "warn" | "think" | "quiet"; say?: string; what?: string; line?: number; by: "run" | "ai" | "rule"; at: number };
const IDLE_MS = 20_000, STUCK_MS = 180_000, AFTER_FAIL_MS = 60_000, GAP_MS = 180_000, MAX_LOOKS = 6, MIN_LINES = 5;
const changed = (a: string, b: string) => { const x = a.split("\n"), y = b.split("\n"); let n = Math.abs(x.length - y.length); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i].trim() !== y[i].trim()) n++; return n; };
/**
 * When to look (설계 W1, 프로젝트 루트와 같은 신호): stopped typing after a chunk (20 s, 5+ lines changed), stuck (3 min,
 * nothing changed), an example run failed and nothing changed for a minute, the same failing verdict twice, or tinkering
 * (3+ runs in 2 minutes, ≤ 2 lines changed each, same result) — at most once per 3 minutes and 6 times a problem.
 */
export function useWatch({ id, lang, code, enabled, examples }: { id: string; lang: Lang; code: string; enabled: boolean; examples: Array<{ output: string }> }) {
  const key = `code:watch:${id}`;
  const [on, setOn] = useState(() => { try { return localStorage.getItem(key) !== "off"; } catch { return true; } });
  const [look, setLook] = useState<Look | null>(null);
  const [advice, setAdvice] = useState(0);
  const s = useRef({ lastEdit: 0, lookedCode: "", lookedAt: 0, looks: 0, busy: false, failAt: 0, runs: [] as Array<{ at: number; code: string; verdict: string }>, lastSubmit: "", ignored: new Set<string>() });
  const codeRef = useRef(code);
  // The code the problem opened with (starter or saved draft) is the baseline, not a change to look at.
  useEffect(() => { if (code !== codeRef.current) { codeRef.current = code; s.current.lastEdit = Date.now(); if (!s.current.lookedCode) s.current.lookedCode = code; } }, [code]);
  const show = useCallback((l: Look) => {
    if (l.what && s.current.ignored.has(l.what)) return;
    setLook(l);
    if (l.state === "warn" || l.state === "think") setAdvice((n) => n + 1);
  }, []);
  const doLook = useCallback(async (why: string) => {
    const st = s.current;
    if (st.busy || st.looks >= MAX_LOOKS || Date.now() - st.lookedAt < GAP_MS) return;
    st.busy = true; st.looks++; st.lookedAt = Date.now(); st.lookedCode = codeRef.current;
    try {
      const c = await call<{ state: string; what?: string; say?: string; facts: Record<string, string> }>(`/api/code/problem/${id}/watch/check`, { lang, code: codeRef.current });
      if (c.state === "quiet") { st.looks--; return; }
      if (c.state === "warn") { show({ state: "warn", say: c.say, what: c.what, by: "run", at: Date.now() }); return; }
      const a = await call<{ state: string; what: string; say: string; line: number }>(`/api/code/problem/${id}/watch/advice`, { lang, code: codeRef.current, facts: { ...c.facts, why } });
      if (a.state === "더 생각") show({ state: "think", say: a.say, what: a.what, line: a.line > 0 ? a.line : undefined, by: "ai", at: Date.now() });
      else if (a.state === "맞는 길" || a.state === "다른 길") setLook({ state: "ok", say: a.state === "다른 길" ? "모범 풀이와 다른 방법이지만 괜찮아 보여요." : "방향 좋아 보여요.", by: "ai", at: Date.now() });
    } catch { st.looks--; } finally { st.busy = false; }
  }, [id, lang, show]);
  useEffect(() => {
    if (!enabled || !on) return;
    const t = setInterval(() => {
      const st = s.current, now = Date.now(), idle = now - st.lastEdit;
      if (idle >= IDLE_MS && changed(st.lookedCode, codeRef.current) >= MIN_LINES) void doLook("멈춤 뒤 한 덩어리");
      else if (idle >= STUCK_MS && st.lookedAt < st.lastEdit) void doLook("3분째 그대로");
      else if (st.failAt && st.failAt > st.lastEdit - 1000 && now - st.failAt >= AFTER_FAIL_MS) { st.failAt = 0; void doLook("예제 실패 뒤 1분"); }
    }, 5000);
    return () => clearInterval(t);
  }, [enabled, on, doLook]);
  /** Every 예제 실행 and 제출 passes through here: tinkering and repeated verdicts are noticed without the model. */
  const noteRun = useCallback((mode: "example" | "submit", verdict: string) => {
    if (!enabled || !on) return;
    const st = s.current, now = Date.now(), c = codeRef.current;
    st.runs = [...st.runs.filter((r) => now - r.at < 120_000), { at: now, code: c, verdict }];
    if (verdict === "AC") { st.failAt = 0; return; }
    if (mode === "example") st.failAt = now;
    const outs = examples.map((e) => e.output.trim()).filter((o) => o.length >= 3);
    if (outs.some((o) => c.includes(o))) { show({ state: "warn", what: "끼워 맞추기", say: "예제 출력을 코드에 그대로 넣으면 숨은 테스트에서 틀려요. 일반적인 방법을 찾아봐요.", by: "rule", at: now }); return; }
    const r = st.runs;
    if (r.length >= 3 && r.slice(-3).every((x) => x.verdict === verdict) && r.slice(-3).every((x, i, xs) => i === 0 || changed(xs[i - 1].code, x.code) <= 2)) {
      st.runs = [];
      show({ state: "warn", what: "땜질", say: "조금씩 바꿔 돌리는 중이에요. 고치기 전에, 틀린 예제에서 변수 값이 어떻게 바뀌어야 하는지 먼저 적어 볼까요?", by: "rule", at: now }); return;
    }
    if (mode === "submit") { if (st.lastSubmit === verdict) void doLook(`같은 결과(${verdict}) 두 번`); st.lastSubmit = verdict; }
  }, [enabled, on, examples, show, doLook]);
  const toggle = () => { const next = !on; setOn(next); try { localStorage.setItem(key, next ? "on" : "off"); } catch { /* storage off */ } if (!next) setLook(null); };
  const ignore = () => { if (look?.what) s.current.ignored.add(look.what); setLook(null); };
  return { on, toggle, look, advice, noteRun, ignore, dismiss: () => setLook(null), resetAdvice: () => setAdvice(0) };
}
export function WatchStrip({ watch, onHint }: { watch: ReturnType<typeof useWatch>; onHint: () => void }) {
  const l = watch.look;
  const tone = !l ? "" : l.state === "ok" ? "good" : l.state === "think" ? "bad" : "help";
  return (
    <div className={`cs-watch ${tone}`}>
      <span className="cs-watch-dot" aria-hidden />
      <span className="small">{!watch.on ? "지켜보기 꺼짐" : !l ? "지켜보는 중 · 손을 멈추면 한 번 봐요" : l.say}</span>
      {l && l.state !== "ok" ? <>
        {l.line ? <span className="small muted">줄 {l.line}</span> : null}
        {l.state === "think" ? <button className="btn small" onClick={() => { watch.dismiss(); onHint(); }}>힌트 1 받기</button> : null}
        <button className="btn ghost small" onClick={watch.ignore} title="이 이야기는 이번 풀이에서 다시 하지 않아요">{l.state === "think" ? "내 방식 계속" : "괜찮아요"}</button>
      </> : null}
      <span className="cs-gap" />
      <button className="btn ghost small" onClick={watch.toggle}>{watch.on ? "끄기" : "켜기"}</button>
    </div>
  );
}
