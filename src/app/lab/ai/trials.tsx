"use client";
// "이 호출만 다시" (11/7 사용자): 저장된 호출의 넣은 것을 그대로 두고 지시문·넣은 것·모델·강도를 바꿔 AI 한 번. 제품은 그대로이고,
// 시도는 데이터로 남아(<data>/lab/trials/) 원래 답과 나란히 비교한다.
import { useEffect, useMemo, useRef, useState } from "react";
import { Facts, Marked, PromptViewer, Readable, colorMap, hasMarks, parseMaybe, sec, short, usd, type NamedPrompt, type Tok } from "./view";

export type TrialBase = { kind: "gen"; genId: string; n: number } | { kind: "call"; id: string };
type Trial = { id: string; at: string; step: string; note: string; system: string; user: string; model: string; effort: string; json: boolean;
  ok: boolean; error?: string; reply: string; ms: number; firstTextMs?: number; usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }; cost: number | null };
export type Original = { system: string; user: string; reply: string; model: string; effort: string; ms?: number; first?: number; tokens?: Tok; cost?: number | null };

const q = (b: TrialBase) => (b.kind === "gen" ? `gen=${b.genId}&n=${b.n}` : `call=${b.id}`);
const toTok = (u?: Trial["usage"]): Tok | undefined => (u ? { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } : undefined);

/** 줄 단위 차이(LCS). 줄이 너무 많으면 앞뒤 같은 줄만 걷어 내고 가운데를 통째로 바뀐 것으로. */
function lineDiff(a: string, b: string): Array<{ t: " " | "-" | "+"; s: string }> {
  const A = a.split("\n"), B = b.split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const out: Array<{ t: " " | "-" | "+"; s: string }> = [];
  if (a2.length * b2.length > 250_000) { a2.forEach((x) => out.push({ t: "-", s: x })); b2.forEach((x) => out.push({ t: "+", s: x })); }
  else {
    const L = Array.from({ length: a2.length + 1 }, () => new Uint16Array(b2.length + 1));
    for (let i = a2.length - 1; i >= 0; i--) for (let j = b2.length - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < a2.length || j < b2.length) {
      if (i < a2.length && j < b2.length && a2[i] === b2[j]) { out.push({ t: " ", s: a2[i] }); i++; j++; }
      else if (j < b2.length && (i >= a2.length || L[i][j + 1] >= L[i + 1][j])) { out.push({ t: "+", s: b2[j++] }); }
      else out.push({ t: "-", s: a2[i++] });
    }
  }
  return out.filter((x) => x.t !== " ");
}

function Diff({ label, a, b }: { label: string; a: string; b: string }) {
  const d = useMemo(() => (a === b ? [] : lineDiff(a, b)), [a, b]);
  if (!d.length) return null;
  return <details className="block" open><summary><span>{label} 바뀐 줄</span><small className="num">−{d.filter((x) => x.t === "-").length} +{d.filter((x) => x.t === "+").length}</small></summary>
    <pre className="ai-diff">{d.slice(0, 200).map((x, i) => <span key={i} className={x.t === "+" ? "add" : "del"}>{x.t} {x.s}{"\n"}</span>)}{d.length > 200 ? `…${d.length - 200}줄 더` : ""}</pre></details>;
}

export function TrialPanel({ base, step, orig, models, efforts, images, prompts = [], draft, openSignal = 0, onOpenPrompts }: { base: TrialBase; step: string; orig: Original; models: string[]; efforts: string[]; images?: boolean; prompts?: NamedPrompt[];
  /** 지시문 초안을 바깥(지시문 상자)과 같이 쓸 때 (11/7) */ draft?: { system: string; user: string; set: (system: string, user: string) => void }; openSignal?: number; onOpenPrompts?: () => void }) {
  const [trials, setTrials] = useState<Trial[]>([]);
  // 지시문 상자의 [다시 돌려 보기]가 openSignal을 올리면 열린다. 그 뒤로는 사람이 접고 편다.
  const [toggle, setToggle] = useState({ open: false, at: 0 });
  const open = openSignal > toggle.at ? true : toggle.open;
  const setOpen = (f: (x: boolean) => boolean) => setToggle({ open: f(open), at: openSignal });
  const [ownSystem, setOwnSystem] = useState(orig.system);
  const [ownUser, setOwnUser] = useState(orig.user);
  const system = draft?.system ?? ownSystem, user = draft?.user ?? ownUser;
  const setSystem = (v: string) => (draft ? draft.set(v, user) : setOwnSystem(v));
  const setUser = (v: string) => (draft ? draft.set(system, v) : setOwnUser(v));
  const setBoth = (sv: string, uv: string) => (draft ? draft.set(sv, uv) : (setOwnSystem(sv), setOwnUser(uv)));
  const [model, setModel] = useState(orig.model);
  const [effort, setEffort] = useState(orig.effort || "low");
  const [json, setJson] = useState(parseMaybe(orig.reply) !== null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const key = q(base);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => { if (openSignal) setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }, [openSignal]);
  useEffect(() => { fetch(`/api/lab/ai/trials?${key}`, { cache: "no-store" }).then((r) => r.json()).then((d: { trials?: Trial[] }) => setTrials(d.trials ?? [])).catch(() => undefined); }, [key]);
  const run = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/lab/ai/trial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base, step, note, system, user, model, effort, json }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? `오류 ${res.status}`);
      setTrials((x) => [...x, d.trial]); setPick(d.trial.id); setNote("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const sel = trials.find((t) => t.id === pick) ?? trials.at(-1);
  const changed = [system !== orig.system ? "지시문" : "", user !== orig.user ? "넣은 것" : "", model !== orig.model ? "모델" : "", effort !== (orig.effort || "low") ? "강도" : ""].filter(Boolean);
  return <section className="ai-trial" ref={sectionRef}>
    <div className="ai-trial-head"><b>이 호출만 다시</b><small className="muted">제품 지시문은 그대로 · 시도는 데이터로 남아요 · 한 번에 AI 1번</small><span className="sp" />
      <button className="btn small" onClick={() => setOpen((x) => !x)}>{open ? "접기" : "새 시도"}</button></div>
    {images ? <p className="warnline">이 단계는 원래 그림 쪽 이미지가 같이 갔어요. 다시 돌리기는 글만 보내서 결과가 다를 수 있어요.</p> : null}
    {open ? <div className="ai-trial-form">
      <div className="row">{onOpenPrompts ? <button className="btn small" onClick={onOpenPrompts}>지시문 상자에서 조각별로 고치기</button> : null}<button className="btn small ghost" onClick={() => setBig(true)}>지금 고친 지시문 크게 보기</button></div>
      {big ? <PromptViewer title={`${step} · 고치는 중`} system={system} user={user} prompts={prompts} onClose={() => setBig(false)} /> : null}
      <label className="field">지시문 (system) <small className="num">{system.length.toLocaleString()}자</small>
        <textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={12} spellCheck={false} /></label>
      {hasMarks(user, prompts) ? <p className="ai-warn-mark">이 단계는 지시문이 넣은 것(user) 쪽에도 들어 있어요 — 아래 [나뉜 모양 보기]에서 색칠된 부분.</p> : null}
      {hasMarks(system, prompts) || hasMarks(user, prompts) ? <details className="block"><summary><span>나뉜 모양 보기 (지금 고친 글 기준)</span></summary>
        <div className="pad ai-split2"><div><h4>지시문 (system)</h4><Marked text={system} prompts={prompts} colors={colorMap([system, user], prompts)} dataLabel="지시문 · 코드가 붙인 것" readable={false} /></div>
          <div><h4>넣은 것 (user)</h4><Marked text={user} prompts={prompts} colors={colorMap([system, user], prompts)} dataLabel="자료 · 앞 단계 결과" /></div></div></details> : null}
      <details className="block" open={hasMarks(user, prompts)}><summary><span>넣은 것 (user)도 고치기</span><small className="num">{user.length.toLocaleString()}자</small></summary>
        <textarea value={user} onChange={(e) => setUser(e.target.value)} rows={10} spellCheck={false} style={{ width: "100%" }} /></details>
      <div className="row">
        <label className="field">모델<select value={model} onChange={(e) => setModel(e.target.value)}>{[...new Set([orig.model, ...models])].map((m) => <option key={m} value={m}>{short(m)}</option>)}</select></label>
        <label className="field">강도<select value={effort} onChange={(e) => setEffort(e.target.value)}>{efforts.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="chip"><input type="checkbox" checked={json} onChange={(e) => setJson(e.target.checked)} /> JSON으로 받기</label>
        <input className="ai-note" placeholder="메모 (무엇을 바꿨나)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy || !changed.length} onClick={() => void run()}>{busy ? "부르는 중…" : "AI 1번 돌리기"}</button>
        <small className="muted">{changed.length ? `바꾼 것: ${changed.join(" · ")}` : "아직 바꾼 게 없어요"} · 원래 호출 기준 약 {usd(orig.cost)} · {sec(orig.ms)}</small>
        <button className="btn small ghost" onClick={() => { setBoth(orig.system, orig.user); setModel(orig.model); setEffort(orig.effort || "low"); }}>원래대로</button>
        {sel ? <button className="btn small ghost" onClick={() => { setBoth(sel.system, sel.user); setModel(sel.model); setEffort(sel.effort); }}>고른 시도에서 이어 고치기</button> : null}
      </div>
      {err ? <p className="warnline errline">{err}</p> : null}
    </div> : null}
    {trials.length ? <>
      <div className="calls">{trials.map((t, i) => <button key={t.id} aria-pressed={t.id === sel?.id} onClick={() => setPick(t.id)}>시도 {i + 1}{t.note ? ` · ${t.note.slice(0, 18)}` : ""} <small className="num">{sec(t.ms)}</small>{t.ok ? null : " ⚠"}</button>)}</div>
      {sel ? <div className="ai-compare">
        <Diff label="지시문" a={orig.system} b={sel.system} />
        <Diff label="넣은 것" a={orig.user} b={sel.user} />
        <div className="ai-io">
          <section><h4>원래</h4><Facts model={orig.model} effort={orig.effort} ms={orig.ms} first={orig.first} tokens={orig.tokens} cost={orig.cost} /><Readable text={orig.reply} /></section>
          <section><h4>시도 {trials.indexOf(sel) + 1} <small>{new Date(sel.at).toLocaleString("ko-KR", { hour12: false })}{sel.note ? ` · ${sel.note}` : ""}</small></h4>
            <Facts model={sel.model} effort={sel.effort} ms={sel.ms} first={sel.firstTextMs} tokens={toTok(sel.usage)} cost={sel.cost} />
            {sel.ok ? <Readable text={sel.reply} /> : <p className="warnline errline">{sel.error}</p>}</section>
        </div>
      </div> : null}
    </> : <p className="muted">아직 시도가 없어요.</p>}
  </section>;
}
