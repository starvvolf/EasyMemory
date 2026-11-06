"use client";
// AI 호출 실험실의 공통 조각: 숫자 모양, 사람이 읽는 입력·출력, 호출 하나 자세히.
import { useState, type ReactNode } from "react";

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
export function CallView({ entry, label, facts, system, user, reply, error, extra }: { entry?: Entry | null; label: string; facts: Parameters<typeof Facts>[0];
  system: string; user: string; reply: string; error?: string | null; extra?: ReactNode }) {
  const [raw, setRaw] = useState(false);
  return <div className="ai-call">
    <div className="ai-call-head"><h3>{entry?.title ?? label}</h3><code className="muted">{label}</code></div>
    {entry ? <p className="ai-does"><b>지시문 요약</b> {entry.does}</p> : null}
    <Facts {...facts} />
    {extra}
    {error ? <p className="warnline errline">{error}</p> : null}
    <div className="ai-io">
      <section><h4>넣은 것 {entry?.input ? <small>· {entry.input}</small> : null} <small className="num">{user.length.toLocaleString()}자</small></h4>{raw ? <pre>{user}</pre> : <Readable text={user} />}</section>
      <section><h4>나온 것 {entry?.output ? <small>· {entry.output}</small> : null} <small className="num">{reply.length.toLocaleString()}자</small></h4>{raw ? <pre>{reply}</pre> : reply ? <Readable text={reply} /> : <p className="muted">(답 없음)</p>}</section>
    </div>
    <div className="row"><label className="chip"><input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> 원문 그대로</label></div>
    <details className="block"><summary><span>지시문 원문 (system)</span><small className="num">{system.length.toLocaleString()}자</small></summary><pre>{system || "(이 기록에는 없음)"}</pre></details>
  </div>;
}
