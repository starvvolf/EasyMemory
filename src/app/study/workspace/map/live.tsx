"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): 자료를 만드는 동안 보이는 것: 실시간 카드 판 · 요약 스트리밍 · 단계 표시.
import { useEffect, useMemo, useRef, useState } from "react";
import { Rich as RichBlock } from "../Rich";
import { Body, Shape } from "./shape";

// ---------- 실시간 카드 (사용자 10/30): while the material is being made, the pages in their order (from 전처리) with each page's
// cards written in as the engine streams them; pages run at once, the board keeps page order. Then the map takes over.
export type LiveCard = { title: string; kind: string; weight: string; shape: Record<string, unknown> };
export type LivePage = { page: number; done: boolean; cards: LiveCard[] };
export type Summary = { status: "writing" | "done" | "failed"; text: string; firstMs?: number; ms?: number; error?: string };
export type LiveData = { now: number; status: string; live: boolean; outline: Array<{ page: number; title: string }>; pages: LivePage[]; summary?: Summary | null; digest?: DigestLite | null };

// [요약] 탭 (11/6 사용자 "요약을 스트리밍으로, 넓은 채팅창처럼"): 엔진이 쓰는 정리 글(summary.json)을 쓰는 대로 보여 준다.
// 목차 (11/6 사용자 "1의 목차로 바꾸고, 목차가 나오면서 그 목차에 지식이 하나씩 붙고 누르면 확인 가능하게"): the engine's own
// outline (rc-digest-plan, streamed: topics and what each teaches), with each topic's cards attached to the item they cover
// as they are made. Replaces the separate 정리 글 (summary.ts) for new runs.
export type DigestLite = {
  skeleton?: { status: string; text: string; topics: Array<{ id: string; title: string; pages: number[] }> };
  topics?: Record<string, { body?: Array<{ id: string; name: string; pages: number[] }> }>;
  notes?: Record<string, { covers?: string[] }>;
  objectives?: Array<{ id: string; verb: string; text: string; core: boolean }>;
};
export type OutlineItem = { key: string; name: string; pages: number[] };
export function SummaryPane({ summary, making }: { summary: Summary | null | undefined; making: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const writing = summary?.status === "writing";
  // 글을 읽는 중에 화면이 밀리지 않게, 맨 아래를 보고 있을 때만 따라 내려간다.
  useEffect(() => { const el = end.current; if (!el || !writing) return; const r = el.getBoundingClientRect(); if (r.top < window.innerHeight + 120) el.scrollIntoView({ block: "end" }); }, [summary?.text, writing]);
  if (!summary || (!summary.text && writing)) return <div className="mm5-chat"><p className="mm5-wait">{making || writing ? "자료를 읽고 요약을 쓰기 시작하는 중이에요…" : "이 자료는 요약 없이 만들었어요. [기억] 탭에서 보세요."}</p></div>;
  // 소제목 다음 줄이 바로 붙어 와도 소제목으로 보이게 문단을 나눈다.
  const text = summary.text.replace(/^(#{1,4} .+)$/gm, "\n$1\n").replace(/\n{3,}/g, "\n\n");
  return (
    <div className="mm5-chat" aria-live="polite">
      <RichBlock text={text} className="mm5-text" />
      {writing ? <span className="mm5-caret" aria-label="쓰는 중" /> : null}
      {summary.status === "failed" ? <p className="small muted">요약을 끝까지 쓰지 못했어요{summary.error ? ` (${summary.error})` : ""}. 기억은 따로 만들어져요.</p> : null}
      <div ref={end} />
    </div>
  );
}

// 지금 무엇을 하는지 (11/6 사용자 "오래 걸리는데 뭐 하는지 모르겠다"): 단계마다 끝남·하는 중·기다림.
export type Step = { label: string; state: "done" | "now" | "wait"; note?: string };
export function Steps({ steps }: { steps: Step[] }) {
  return <ol className="mm5-steps" aria-label="만드는 단계">{steps.map((st) => (
    <li key={st.label} className={`mm5-step ${st.state}`}><span className="mm5-dot" aria-hidden />{st.label}{st.note ? <span className="mm5-note num"> {st.note}</span> : null}
      <span className="sr-only">{st.state === "done" ? " 끝남" : st.state === "now" ? " 하는 중" : " 기다림"}</span></li>))}</ol>;
}

// A shape the engine is still writing: every field the drawing reads, present (empty until it comes).
export function filled(raw: Record<string, unknown>): Shape | null {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const arr = <T,>(k: string, f: (x: unknown) => T | null) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).map(f).filter((x): x is T => x !== null) : []);
  const text = (x: unknown) => (typeof x === "string" ? x : null);
  switch (raw.form) {
    case "term": return { form: "term", name: str("name"), symbol: str("symbol"), definition: str("definition"), neighbors: arr("neighbors", text) };
    case "fact": return { form: "fact", subject: str("subject"), value: str("value") };
    case "list": return { form: "list", name: str("name"), items: arr("items", text), ordered: raw.ordered === true };
    case "rule": return { form: "rule", premise: str("premise"), condition: str("condition"), result: str("result"), boundary: str("boundary") };
    case "procedure": return { form: "procedure", steps: arr("steps", (x) => x && typeof x === "object" ? { action: String((x as Record<string, unknown>).action ?? ""), input: String((x as Record<string, unknown>).input ?? ""), output: String((x as Record<string, unknown>).output ?? "") } : null) };
    case "formula": return { form: "formula", expr: str("expr"), when: str("when"), vars: arr("vars", (x) => x && typeof x === "object" ? { symbol: String((x as Record<string, unknown>).symbol ?? ""), meaning: String((x as Record<string, unknown>).meaning ?? "") } : null) };
    case "compare": return { form: "compare", targets: arr("targets", text), criteria: arr("criteria", (x) => x && typeof x === "object" ? { name: String((x as Record<string, unknown>).name ?? ""), values: Array.isArray((x as Record<string, unknown>).values) ? ((x as Record<string, unknown>).values as unknown[]).map(String) : [] } : null) };
    case "concept": return { form: "concept", claim: str("claim"), reason: str("reason"), limit: str("limit") };
    case "pattern": return { form: "pattern", frame: str("frame"), slots: arr("slots", text), example: str("example") };
    default: return null;
  }
}
// The text a card being written shows, field by field in the order the engine writes them (no math drawing until it is done).
export function liveLines(s: Shape): Array<[string, string]> {
  switch (s.form) {
    case "term": return [["", s.definition], ["표기", s.symbol], ["헷갈리는 말", s.neighbors.join(", ")]];
    case "fact": return [["", s.value]];
    case "list": return s.items.map((it, i) => [s.ordered ? String(i + 1) : "·", it]);
    case "rule": return [["전제", s.premise], ["조건", s.condition], ["결과", s.result], ["경계", s.boundary]];
    case "procedure": return s.steps.map((st, i) => [String(i + 1), st.output ? `${st.action} → ${st.output}` : st.action]);
    case "formula": return [["식", s.expr], ["쓸 때", s.when], ...s.vars.map((v): [string, string] => [v.symbol, v.meaning])];
    case "compare": return [["비교", s.targets.join(" · ")], ...s.criteria.map((c): [string, string] => [c.name, c.values.join(" · ")])];
    case "concept": return [["", s.claim], ["왜", s.reason], ["한계", s.limit]];
    case "pattern": return [["틀", s.frame], ["예", s.example]];
  }
}
// Text typed out toward what has arrived: replies come in bursts every few hundred ms, the letters come one by one.
export function Typed({ text, caret }: { text: string; caret?: boolean }) {
  const [n, setN] = useState(0);
  const shown = useRef(0);
  const target = useRef(text);
  const reduce = useMemo(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), []);
  useEffect(() => {
    target.current = text;
    let raf = 0, last = performance.now();
    if (reduce) { shown.current = text.length; raf = requestAnimationFrame(() => setN(text.length)); return () => cancelAnimationFrame(raf); }
    const step = (t: number) => {
      const left = target.current.length - shown.current;
      if (left <= 0) return;
      // Catch up on what has arrived within about a quarter second, at least a letter a frame.
      shown.current = Math.min(target.current.length, shown.current + Math.max(1, Math.round(left * Math.min(1, (t - last) / 240))));
      last = t;
      setN(shown.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, reduce]);
  return <>{text.slice(0, n).replace(/\$/g, "")}{caret ? <span className="mm4-caret" aria-hidden /> : null}</>;
}
export function LiveCardView({ c, writing, index }: { c: LiveCard; writing: boolean; index: number }) {
  const shape = filled(c.shape);
  const lines = shape ? liveLines(shape).filter(([, v]) => v) : [];
  // The field still being written is the last one with text: the caret sits there.
  return (
    <article className={`mm4-card${writing ? " writing" : " done"}${c.weight === "핵심" ? " core" : ""}`} style={{ animationDelay: `${Math.min(index, 3) * 60}ms` }}>
      <header className="mm4-chead">
        {c.kind ? <span className="mm3-kind">{c.kind}</span> : null}
        {c.weight === "핵심" ? <span className="mm3-kind core">핵심</span> : null}
        <b className="mm4-ctitle"><Typed text={c.title} caret={writing && !lines.length} /></b>
      </header>
      {!writing && shape ? <div className="mm4-settled"><Body s={shape} /></div>
        : lines.length ? <div className="mm4-lines">{lines.map(([k, v], i) => <p key={i} className="mm4-line">{k ? <span className="mm3-tag">{k}</span> : null}<span><Typed text={v} caret={writing && i === lines.length - 1} /></span></p>)}</div> : null}
    </article>
  );
}
export function LiveBoard({ data }: { data: LiveData }) {
  const byPage = new Map(data.pages.map((p) => [p.page, p]));
  const done = data.outline.filter((o) => byPage.get(o.page)?.done).length;
  const writing = data.outline.filter((o) => byPage.has(o.page) && !byPage.get(o.page)!.done).length;
  const cards = data.pages.reduce((n, p) => n + p.cards.length, 0);
  return (
    <section className="mm4" aria-label="기억 카드를 쓰는 중">
      <div className="mm4-progress">
        <div className="mm4-bar"><span style={{ width: `${data.outline.length ? (done / data.outline.length) * 100 : 0}%` }} /><i style={{ width: `${data.outline.length ? ((done + writing) / data.outline.length) * 100 : 0}%` }} /></div>
        <span className="small"><b>{done}</b>/{data.outline.length}쪽 · 쓰는 중 {writing} · 카드 {cards}장</span>
      </div>
      <ol className="mm4-pages">
        {data.outline.map((o) => {
          const p = byPage.get(o.page);
          const state = !p ? "wait" : p.done ? "done" : "writing";
          return (
            <li key={o.page} className={`mm4-page ${state}`}>
              <div className="mm4-phead"><span className="mm4-pn">p.{o.page}</span><span className="mm4-ptitle">{o.title || " "}</span>
                <span className="mm4-state">{state === "wait" ? "" : state === "writing" ? "쓰는 중" : p!.cards.length ? `${p!.cards.length}장` : "카드 없음"}</span></div>
              {state === "wait" ? <div className="mm4-skel"><i /><i /></div>
                : p!.cards.length ? <div className="mm4-cards">{p!.cards.map((c, i) => <LiveCardView key={i} c={c} index={i} writing={state === "writing" && i === p!.cards.length - 1} />)}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
