"use client";
// AI 호출 실험실의 공통 조각: 숫자 모양, 사람이 읽는 입력·출력, 호출 하나 자세히.
import { useEffect, useMemo, useState, type ReactNode } from "react";

export type Entry = { title: string; does: string; input?: string; output?: string };
export type Tok = { in?: number; cached?: number; out?: number; reasoning?: number };

export const sec = (ms?: number | null) => (ms == null ? "–" : ms === 0 ? "0" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}초`);
export const num = (n?: number | null) => (n == null ? "–" : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString());
export const usd = (n?: number | null) => (n == null ? "–" : n < 0.001 ? "<$0.001" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
export const short = (model?: string) => String(model ?? "").replace(/^gpt-/, "");
export const modelClass = (model?: string) => { const m = String(model ?? ""); return m.includes("luna") ? "m-luna" : m.includes("sol") ? "m-sol" : m.includes("terra") ? "m-terra" : "m-other"; };

/** 코드 블록 ```json … ``` 을 벗기고 JSON이면 값, 아니면 null */
export function parseMaybe(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!/^[[{]/.test(t)) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** JSON 값을 사람이 읽게: 객체는 이름 · 값 줄, 배열은 번호 붙은 카드, 긴 글은 그대로 */
export function Value({ v, depth = 0 }: { v: unknown; depth?: number }): ReactNode {
  if (v == null || v === "") return <span className="muted">(없음)</span>;
  if (typeof v === "string") return v.length > 120 || v.includes("\n") ? <div className="ai-text">{v}</div> : <span>{v}</span>;
  if (typeof v === "number" || typeof v === "boolean") return <span className="num">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">(빈 목록)</span>;
    if (v.every((x) => typeof x !== "object" || x === null)) return <ul className="ai-list">{v.map((x, i) => <li key={i}><Value v={x} depth={depth + 1} /></li>)}</ul>;
    return <ol className="ai-cards">{v.slice(0, 60).map((x, i) => <li key={i} className="ai-card"><Value v={x} depth={depth + 1} /></li>)}{v.length > 60 ? <li className="muted">…{v.length - 60}개 더</li> : null}</ol>;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (depth > 5) return <code>{JSON.stringify(o).slice(0, 300)}</code>;
  return <dl className="ai-kv">{keys.map((k) => <div key={k}><dt>{k}</dt><dd><Value v={o[k]} depth={depth + 1} /></dd></div>)}</dl>;
}

/** 글 하나를 보기 좋게: JSON이면 Value, | 로 나뉜 줄이 많으면 표, [p.N] 쪽 표시가 있으면 쪽마다 접기 */
export function Readable({ text, max = 60000 }: { text: string; max?: number }) {
  const t = text.length > max ? text.slice(0, max) : text;
  const j = parseMaybe(t);
  if (j !== null) return <Value v={j} />;
  const lines = t.split("\n");
  const piped = lines.filter((l) => (l.match(/\|/g)?.length ?? 0) >= 2);
  if (piped.length >= 3 && piped.length >= lines.filter((l) => l.trim()).length * 0.5) {
    return <div className="table-scroll"><table className="ai-pipe"><tbody>{lines.filter((l) => l.trim()).map((l, i) => (l.includes("|")
      ? <tr key={i}>{l.split("|").map((c, k) => <td key={k}>{c.trim()}</td>)}</tr>
      : <tr key={i}><td colSpan={8} className="muted">{l}</td></tr>))}</tbody></table></div>;
  }
  const parts = t.split(/(?=^\[p\.\d+\])/m);
  if (parts.length >= 3) {
    return <div className="ai-pages">{parts.map((p, i) => { const head = p.match(/^\[p\.(\d+)\][^\n]*/)?.[0]; return head
      ? <details key={i} className="block"><summary><span>{head.slice(0, 80)}</span><small className="num">{p.length.toLocaleString()}자</small></summary><div className="ai-text pad">{p.slice(head.length).trim()}</div></details>
      : <div key={i} className="ai-text">{p}</div>; })}</div>;
  }
  return <div className="ai-text">{t}{text.length > max ? `\n…(${(text.length - max).toLocaleString()}자 더)` : ""}</div>;
}

export function Facts({ model, effort, ms, first, tokens, cost }: { model?: string; effort?: string; ms?: number; first?: number; tokens?: Tok; cost?: number | null }) {
  const fresh = tokens?.in != null ? Math.max(0, (tokens.in ?? 0) - (tokens.cached ?? 0)) : null;
  return <div className="ai-facts">
    <span className={`ai-model ${modelClass(model)}`}>{short(model)}{effort ? ` · ${effort}` : ""}</span>
    <span title="완성까지">⏱ <b className="num">{sec(ms)}</b>{first != null ? <small> (첫 글자 {sec(first)})</small> : null}</span>
    <span title="입력 토큰 (캐시 아닌 것 + 캐시)">입력 <b className="num">{num(tokens?.in)}</b>{tokens?.cached ? <small> (캐시 {num(tokens.cached)} · 새로 {num(fresh)})</small> : null}</span>
    <span>출력 <b className="num">{num(tokens?.out)}</b>{tokens?.reasoning ? <small> (생각 {num(tokens.reasoning)})</small> : null}</span>
    <span title="API였다면 (ChatGPT 구독이라 실제로 나가지는 않음)">비용 <b className="num">{usd(cost)}</b></span>
  </div>;
}

/** 호출 하나: 무엇을 하는 호출인지(대장 요약) → 숫자 → 입력 → 출력 → 지시문 원문 */
export function CallView({ entry, label, facts, system, user, reply, error, extra, prompts = [] }: { entry?: Entry | null; label: string; facts: Parameters<typeof Facts>[0];
  system: string; user: string; reply: string; error?: string | null; extra?: ReactNode; prompts?: NamedPrompt[] }) {
  const [raw, setRaw] = useState(false);
  const userMarked = !raw && hasMarks(user, prompts), sysMarked = !raw && hasMarks(system, prompts);
  const [big, setBig] = useState(false);
  const colors = useMemo(() => colorMap([system, user], prompts), [system, user, prompts]);
  return <div className="ai-call">
    <div className="ai-call-head"><h3>{entry?.title ?? label}</h3><code className="muted">{label}</code></div>
    {entry ? <p className="ai-does"><b>지시문 요약</b> {entry.does}</p> : null}
    <Facts {...facts} />
    {extra}
    {error ? <p className="warnline errline">{error}</p> : null}
    <div className="ai-io">
      <section><h4>넣은 것 {entry?.input ? <small>· {entry.input}</small> : null} <small className="num">{user.length.toLocaleString()}자</small>{userMarked ? <small className="ai-warn-mark"> · 지시문이 섞여 있음(색칠)</small> : null}</h4>
        {raw ? <pre>{user}</pre> : userMarked ? <Marked text={user} prompts={prompts} colors={colors} dataLabel="자료 · 앞 단계 결과" /> : <Readable text={user} />}</section>
      <section><h4>나온 것 {entry?.output ? <small>· {entry.output}</small> : null} <small className="num">{reply.length.toLocaleString()}자</small></h4>{raw ? <pre>{reply}</pre> : reply ? <Readable text={reply} /> : <p className="muted">(답 없음)</p>}</section>
    </div>
    <div className="row"><button className="btn small" onClick={() => setBig(true)}>지시문 크게 보기</button><label className="chip"><input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> 원문 그대로</label></div>
    {big ? <PromptViewer title={entry?.title ?? label} system={system} user={user} prompts={prompts} onClose={() => setBig(false)} /> : null}
    <details className="block" open={userMarked}><summary><span>지시문 (system){sysMarked ? " · 이름 붙은 지시문마다 색" : ""}</span><small className="num">{system.length.toLocaleString()}자</small></summary>
      {sysMarked ? <div className="pad"><Marked text={system} prompts={prompts} colors={colors} dataLabel="지시문 · 코드가 붙인 것" readable={false} /></div> : <pre>{system || "(이 기록에는 없음)"}</pre>}</details>
  </div>;
}

/* ── 지시문이 나뉜 모양 (11/7 사용자 "지시문이 나뉜 경우는 색깔로 나뉜 거 보여 줘") ──
   엔진의 이름 붙은 지시문(prompt-registry) 원문의 줄과 같은 줄을 찾아 그 지시문 색으로 칠한다. 지시문에 없는 줄은 자료(데이터).
   [정리 기준] … 은 출제기준 폴더에서 오는 글이라 원문이 없으니 머리말로 찾는다. */
export type NamedPrompt = { name: string; label: string; step: string; text: string };
type Seg = { tag: string | null; label: string; lines: string[] };
const PALETTE = ["p0", "p1", "p2", "p3", "p4", "p5"];
// 색은 한 화면 안에서 나오는 순서대로 정한다(system → user). 그래서 한 호출 안의 지시문끼리는 늘 다른 색이다.
export function colorMap(texts: string[], prompts: NamedPrompt[]): Record<string, string> {
  const names: string[] = [];
  for (const t of texts) for (const s of splitByPrompt(t, prompts)) if (s.tag && !names.includes(s.tag)) names.push(s.tag);
  return Object.fromEntries(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
}
export function splitByPrompt(text: string, prompts: NamedPrompt[]): Seg[] {
  // 같은 줄이 여러 지시문에 있으면(공통 머리말, 작업 지시의 변형들) 이 글과 가장 많이 겹치는 지시문에 준다.
  const keys = new Set(text.split("\n").map((l) => l.trim()).filter((k) => k.length >= 8));
  const lineSets = prompts.map((p) => new Set(p.text.split("\n").map((l) => l.trim()).filter((k) => k.length >= 8)));
  const score = lineSets.map((set) => [...set].filter((k) => keys.has(k)).length);
  const owner = new Map<string, NamedPrompt>();
  for (const k of keys) {
    let best = -1;
    lineSets.forEach((set, i) => { if (set.has(k) && (best < 0 || score[i] > score[best] || (score[i] === score[best] && prompts[i].text.length < prompts[best].text.length))) best = i; });
    if (best >= 0) owner.set(k, prompts[best]);
  }
  const segs: Seg[] = [];
  let guide = false;
  for (const line of text.split("\n")) {
    const k = line.trim();
    if (k === "[정리 기준]") guide = true; else if (guide && /^\[[^\]]{2,20}\]$/.test(k) && k !== "[정리 기준]") guide = false;
    const p = guide ? { name: "GUIDE_ORGANIZE", label: "정리 기준(출제기준 폴더)" } : owner.get(k);
    const last = segs.at(-1);
    const tag = p?.name ?? (k === "" && last ? last.tag : null);
    if (last && last.tag === tag) last.lines.push(line); else segs.push({ tag, label: p?.label ?? (tag ? last?.label ?? "" : ""), lines: [line] });
  }
  return segs.filter((s) => s.lines.join("").trim());
}
/** 색으로 나눈 글. data = 지시문이 아닌 부분을 어떻게 보일지(넣은 것은 Readable, 지시문 칸은 그대로). */
export function Marked({ text, prompts, dataLabel, readable = true, colors }: { text: string; prompts: NamedPrompt[]; dataLabel: string; readable?: boolean; colors?: Record<string, string> }) {
  const segs = useMemo(() => splitByPrompt(text, prompts), [text, prompts]);
  const own = useMemo(() => colors ?? colorMap([text], prompts), [colors, text, prompts]);
  const colorOf = (n: string) => own[n] ?? "p0";
  return <div className="ai-marked">{segs.map((s, i) => s.tag
    ? <div key={i} className={`ai-seg ${colorOf(s.tag)}`}><span className="ai-seg-tag">지시문 · {s.label} <code>{s.tag}</code></span><div className="ai-text">{s.lines.join("\n").trim()}</div></div>
    : <div key={i} className="ai-seg data"><span className="ai-seg-tag">{dataLabel}</span>{readable ? <Readable text={s.lines.join("\n").trim()} /> : <div className="ai-text">{s.lines.join("\n").trim()}</div>}</div>)}</div>;
}
export const hasMarks = (text: string, prompts: NamedPrompt[]) => prompts.length > 0 && splitByPrompt(text, prompts).some((s) => s.tag);

/** 지시문 크게 보기 (11/7 사용자 "지시문 보기 편하게 화면 새로 띄우고"): 화면 전체에 system · user를 나란히, 왼쪽에 칸 목록(색). */
export function PromptViewer({ title, system, user, prompts, onClose }: { title: string; system: string; user: string; prompts: NamedPrompt[]; onClose: () => void }) {
  const [tab, setTab] = useState<"both" | "system" | "user">("both");
  const sys = useMemo(() => splitByPrompt(system, prompts), [system, prompts]);
  const usr = useMemo(() => splitByPrompt(user, prompts), [user, prompts]);
  const colors = useMemo(() => colorMap([system, user], prompts), [system, user, prompts]);
  const colorOf = (n: string) => colors[n] ?? "p0";
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const toc = [...sys.map((s, i) => ({ s, id: `pv-s-${i}`, where: "system" })), ...usr.map((s, i) => ({ s, id: `pv-u-${i}`, where: "user" }))];
  const col = (segs: Seg[], prefix: string, dataLabel: string, readable: boolean) => segs.map((s, i) => <div key={i} id={`${prefix}-${i}`} className={`ai-seg ${s.tag ? colorOf(s.tag) : "data"}`}>
    <span className="ai-seg-tag">{s.tag ? <>지시문 · {s.label} <code>{s.tag}</code></> : dataLabel}<small className="num"> {s.lines.join("\n").trim().length.toLocaleString()}자</small></span>
    {!s.tag && readable ? <Readable text={s.lines.join("\n").trim()} /> : <div className="ai-text">{s.lines.join("\n").trim()}</div>}</div>);
  return <div className="ai-pv" role="dialog" aria-label="지시문 크게 보기">
    <div className="ai-pv-top"><b>{title}</b><div className="seg">{([["both", "나란히"], ["system", "지시문(system)"], ["user", "넣은 것(user)"]] as const).map(([k, l]) =>
      <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div><span className="sp" /><small className="muted">Esc로 닫기</small><button className="btn small" onClick={onClose}>닫기</button></div>
    <div className="ai-pv-body">
      <nav className="ai-pv-toc">{toc.map(({ s, id, where }) => <a key={id} href={`#${id}`} className={s.tag ? colorOf(s.tag) : "data"} onClick={(e) => { e.preventDefault(); if (tab !== "both" && tab !== where) setTab(where as "system" | "user"); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }}>
        <small>{where}</small>{s.tag ? s.label : where === "user" ? "자료 · 앞 단계 결과" : "코드가 붙인 지시문"}</a>)}</nav>
      <div className={`ai-pv-cols ${tab}`}>
        {tab !== "user" ? <section><h3>지시문 (system) <small className="num">{system.length.toLocaleString()}자</small></h3>{col(sys, "pv-s", "지시문 · 코드가 붙인 것", false)}</section> : null}
        {tab !== "system" ? <section><h3>넣은 것 (user) <small className="num">{user.length.toLocaleString()}자</small></h3>{col(usr, "pv-u", "자료 · 앞 단계 결과", true)}</section> : null}
      </div>
    </div>
  </div>;
}
