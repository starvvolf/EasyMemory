"use client";
// 자료 지도 (2026-10-29): one material on one screen — the outline, under each section its knowledge in its own shape,
// and the learner's state on each. Page reading is for the first pass; this is for the second pass and the night before.
// Data: GET /api/study-map/<material> (src/lib/study/material-map.ts). Opened from the PDF reader's bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { call, errorText } from "./api";
import { RichInline as Rich } from "./Rich";

type Shape =
  | { form: "term"; name: string; symbol: string; definition: string; neighbors: string[] }
  | { form: "fact"; subject: string; value: string }
  | { form: "list"; name: string; items: string[]; ordered: boolean }
  | { form: "rule"; premise: string; condition: string; result: string; boundary: string }
  | { form: "procedure"; steps: Array<{ action: string; input: string; output: string }> }
  | { form: "formula"; expr: string; vars: Array<{ symbol: string; meaning: string }>; when: string }
  | { form: "compare"; targets: string[]; criteria: Array<{ name: string; values: string[] }> }
  | { form: "concept"; claim: string; reason: string; limit: string }
  | { form: "pattern"; frame: string; slots: string[]; example: string };
type MapState = "new" | "met" | "unknown" | "known" | "graduated";
type Card = { id: string; ref: string; kind: string; title: string; core: boolean; shape: Shape; pages: number[]; quotes: string[]; mistakes: string[];
  takes: string[]; gives: string[]; questions: number; same: Array<{ id: string; pages: number[] }>; state: MapState; knowledgeId?: string; dueAt?: string; topic?: string };
type Section = { id: string; title: string; pages: number[]; cards: Card[] };
type MatMap = { id: string; title: string; status: string; pages: number; sections: Section[]; chains: Array<{ from: string; to: string; what: string; by?: string }>;
  topics?: string[]; topicNotes?: Record<string, string>; principles?: Array<{ title: string; line: string; cardIds: string[] }>; counts: Record<MapState, number> & { cards: number; questions: number; core?: number };
  questionsLater?: boolean };

const STATE: Record<MapState, [string, string]> = { unknown: ["몰랐음", "bad"], met: ["만남", "read"], known: ["앎", "good"], graduated: ["졸업", "good"], new: ["아직", ""] };
const range = (pages: number[]) => !pages.length ? "" : pages.length === 1 ? `p.${pages[0]}` : `p.${Math.min(...pages)}–${Math.max(...pages)}`;

// A formula with its matrices drawn as grids (MathML's matrices came out cramped and misaligned): the text between them stays math.
function splitMatrices(expr: string): Array<{ text: string } | { rows: string[][] }> {
  const parts: Array<{ text: string } | { rows: string[][] }> = [];
  let i = 0, plain = "";
  while (i < expr.length) {
    if (expr.startsWith("[[", i)) {
      let depth = 0, j = i;
      for (; j < expr.length; j++) { if (expr[j] === "[") depth++; else if (expr[j] === "]" && --depth === 0) break; }
      if (j < expr.length) {
        const rows = expr.slice(i + 2, j - 1).split(/\]\s*,\s*\[/).map((row) => {
          const cells: string[] = []; let d = 0, cur = "";
          for (const ch of row) { if ("([{".includes(ch)) d++; if (")]}".includes(ch)) d--; if (ch === "," && d === 0) { cells.push(cur.trim()); cur = ""; } else cur += ch; }
          cells.push(cur.trim());
          return cells;
        });
        if (plain.trim()) parts.push({ text: plain });
        plain = "";
        parts.push({ rows });
        i = j + 1;
        continue;
      }
    }
    plain += expr[i++];
  }
  if (plain.trim()) parts.push({ text: plain });
  return parts;
}
// Rich draws $…$ only when it looks like TeX (a letter, or _ ^ \\ { } =); plain words and Greek letters stay text.
const tex = (x: string) => (/[_^\\{}=]/.test(x) || /^[A-Za-z]$/.test(x.trim()) ? `$${x}$` : x);
function Formula({ expr }: { expr: string }) {
  if (expr.includes("$")) return <div className="mm3-formula"><Rich text={expr} /></div>;
  // "a; b; c": one equation per line.
  const lines = expr.split(/\s*;\s*/).filter(Boolean);
  return <div className="mm3-formula">{lines.map((line, k) => <div key={k} className="mm3-eq">{splitMatrices(line).map((part, i) => "rows" in part
    ? <span key={i} className="mm3-matrix" style={{ gridTemplateColumns: `repeat(${Math.max(...part.rows.map((r) => r.length))}, auto)` }}>
        {part.rows.flatMap((r, ri) => r.map((cell, ci) => <span key={`${ri}-${ci}`}><Rich text={tex(cell)} /></span>))}</span>
    : <Rich key={i} text={tex(part.text.trim())} />)}</div>)}</div>;
}

function Body({ s }: { s: Shape }) {
  switch (s.form) {
    case "procedure": return <ol className="mm3-steps">{s.steps.map((st, i) => <li key={i}><span className="mm3-stepn">{i + 1}</span><div><Rich text={st.action} />{st.output ? <div className="mm3-stepio"><Rich text={`→ ${st.output}`} /></div> : null}</div></li>)}</ol>;
    case "rule": return <div className="mm3-body"><p className="mm3-rule"><span className="mm3-tag">조건</span><Rich text={s.condition} /></p><p className="mm3-rule"><span className="mm3-tag">결과</span><b><Rich text={s.result} /></b></p>
      {s.premise ? <p className="mm3-when"><span className="mm3-tag">전제</span><Rich text={s.premise} /></p> : null}{s.boundary ? <p className="mm3-when"><span className="mm3-tag">경계</span><Rich text={s.boundary} /></p> : null}</div>;
    case "formula": return <div className="mm3-body"><Formula expr={s.expr} />
      {s.when ? <p className="mm3-when"><span className="mm3-tag">쓸 때</span><Rich text={s.when} /></p> : null}
      {s.vars.length ? <dl className="mm3-vars">{s.vars.map((v, i) => <div key={i}><dt><Rich text={v.symbol.includes("$") ? v.symbol : tex(v.symbol)} /></dt><dd><Rich text={v.meaning} /></dd></div>)}</dl> : null}</div>;
    case "compare": return <div className="mm2-tablewrap"><table className="mm2-table"><thead><tr><th />{s.targets.map((t) => <th key={t}><Rich text={t} /></th>)}</tr></thead>
      <tbody>{s.criteria.map((c) => <tr key={c.name}><th><Rich text={c.name} /></th>{s.targets.map((_, i) => <td key={i}><Rich text={c.values[i] ?? ""} /></td>)}</tr>)}</tbody></table></div>;
    case "list": return s.ordered ? <ol className="mm3-steps">{s.items.map((it, i) => <li key={i}><span className="mm3-stepn">{i + 1}</span><div><Rich text={it} /></div></li>)}</ol> : <ul className="mm3-bullets">{s.items.map((it, i) => <li key={i}><Rich text={it} /></li>)}</ul>;
    case "term": return <div className="mm3-body"><p className="mm3-lead"><Rich text={s.definition} /></p>{s.neighbors.length ? <p className="mm3-when"><span className="mm3-tag">헷갈리는 말</span><Rich text={s.neighbors.join(", ")} /></p> : null}</div>;
    case "fact": return <p className="mm3-lead"><Rich text={s.value} /></p>;
    case "concept": return <div className="mm3-body"><p className="mm3-lead"><Rich text={s.claim} /></p>{s.reason ? <p className="mm3-when"><span className="mm3-tag">왜</span><Rich text={s.reason} /></p> : null}{s.limit ? <p className="mm3-when"><span className="mm3-tag">한계</span><Rich text={s.limit} /></p> : null}</div>;
    case "pattern": return <p><Rich text={s.frame} />{s.example ? <span className="small muted"> · 예: <Rich text={s.example} /></span> : null}</p>;
  }
}

// Matrices the engine writes as nested lists ([[1, 0, t_x], [0, 1, t_y], [0, 0, 1]]) read as matrices.
function matrices(expr: string): string {
  let out = "", i = 0;
  while (i < expr.length) {
    if (expr.startsWith("[[", i)) {
      let depth = 0, j = i;
      for (; j < expr.length; j++) { if (expr[j] === "[") depth++; else if (expr[j] === "]" && --depth === 0) break; }
      if (j < expr.length) {
        const rows = expr.slice(i + 2, j - 1).split(/\]\s*,\s*\[/).map((row) => {
          const cells: string[] = []; let d = 0, cur = "";
          for (const ch of row) { if (ch === "(" || ch === "[" || ch === "{") d++; if (ch === ")" || ch === "]" || ch === "}") d--; if (ch === "," && d === 0) { cells.push(cur.trim()); cur = ""; } else cur += ch; }
          cells.push(cur.trim());
          return cells.join(" & ");
        });
        out += `\\begin{bmatrix}${rows.join(" \\\\ ")}\\end{bmatrix}`;
        i = j + 1;
        continue;
      }
    }
    out += expr[i++];
  }
  return out;
}
// On the one-line view a matrix would make the line tall: it shows as [⋯] there and whole when opened.
const asLine = (expr: string) => (expr.includes("$") ? expr : `$${matrices(expr).replace(/\\begin\{bmatrix\}[\s\S]*?\\end\{bmatrix\}/g, "[\\cdots]")}$`);

// One line per piece of knowledge: what to recall at a glance (the formula itself, a rule's condition → result, a procedure's
// steps). The whole shape opens on a click.
function keyLine(s: Shape): string {
  const clip = (x: string, n = 90) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
  switch (s.form) {
    case "formula": return asLine(s.expr);
    case "term": return clip(s.definition);
    case "fact": return clip(s.value);
    case "rule": return clip(`${s.condition} → ${s.result}`);
    case "procedure": return clip(s.steps.map((st) => st.action).join(" → "));
    case "compare": return clip(s.targets.join("  ·  "));
    case "list": return clip(s.items.join(" · "));
    case "concept": return clip(s.claim);
    case "pattern": return clip(s.frame);
  }
}

// ---------- 실시간 카드 (사용자 10/30): while the material is being made, the pages in their order (from 전처리) with each page's
// cards written in as the engine streams them; pages run at once, the board keeps page order. Then the map takes over.
type LiveCard = { title: string; kind: string; weight: string; shape: Record<string, unknown> };
type LivePage = { page: number; done: boolean; cards: LiveCard[] };
type LiveData = { now: number; status: string; live: boolean; outline: Array<{ page: number; title: string }>; pages: LivePage[] };

// A shape the engine is still writing: every field the drawing reads, present (empty until it comes).
function filled(raw: Record<string, unknown>): Shape | null {
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
function liveLines(s: Shape): Array<[string, string]> {
  switch (s.form) {
    case "term": return [["", s.definition], ["헷갈리는 말", s.neighbors.join(", ")]];
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
function Typed({ text, caret }: { text: string; caret?: boolean }) {
  const [n, setN] = useState(0);
  const shown = useRef(0);
  const target = useRef(text);
  const reduce = useMemo(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), []);
  useEffect(() => {
    target.current = text;
    if (reduce) { shown.current = text.length; setN(text.length); return; }
    let raf = 0, last = performance.now();
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
function LiveCardView({ c, writing, index }: { c: LiveCard; writing: boolean; index: number }) {
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
function LiveBoard({ data }: { data: LiveData }) {
  const byPage = new Map(data.pages.map((p) => [p.page, p]));
  const done = data.outline.filter((o) => byPage.get(o.page)?.done).length;
  const writing = data.outline.filter((o) => byPage.has(o.page) && !byPage.get(o.page)!.done).length;
  const cards = data.pages.reduce((n, p) => n + p.cards.length, 0);
  return (
    <section className="mm4" aria-label="지식 카드를 쓰는 중">
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

// 사용자 10/30: the map is where a material is studied (no reading screen): 원문 opens one page over it, 문제 풀기 starts that
// page's questions, and a material made without questions gets them here (문제 만들기).
export default function MaterialMap({ genId, onPage, onPractice, onMakeQuestions, onClose }: { genId: string; onPage: (page: number) => void;
  onPractice?: (page: number, cardId: string) => void; onMakeQuestions?: () => Promise<boolean>; onClose: () => void }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [asking, setAsking] = useState(false);
  const [reload, setReload] = useState(0);
  const [live, setLive] = useState<LiveData | null>(null);
  const [board, setBoard] = useState<"live" | "leaving" | "off">("off");
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"all" | "unknown" | "new">("all");
  // 개념별 (the whole-material pass's topics, each with what it is there to say) once it exists; 목차별 keeps the slides' own titles.
  const [picked, setView] = useState<"outline" | "topic" | null>(null);
  const [coreOnly, setCoreOnly] = useState(false);
  // 첫 화면은 목차만 (사용자 10/30): every group starts folded; a group opens to one line per piece of knowledge, a line to its card.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openCard, setOpenCard] = useState<string | null>(null);
  // While the material is still being made, the map refills every few seconds (cards, then 핵심·주제·연결).
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, misses = 0;
    // Right after the start there are no cards yet (the server answers 422/404 until the first page is organized): keep
    // trying quietly for about two minutes before showing why.
    const load = () => call<{ map: MatMap }>(`/api/study-map/${genId}`)
      .then((r) => { if (!alive) return; setMap(r.map); setError(""); if (r.map.status !== "done" && r.map.status !== "failed") timer = setTimeout(load, 3000); })
      .catch((e) => { if (!alive) return; if (++misses > 40) setError(errorText(e)); else timer = setTimeout(load, 3000); });
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId, reload]);
  // 실시간 카드: the board shows while pages are still being written; when the last page is in, it gives way to the map.
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, since = 0, misses = 0;
    let acc: LiveData | null = null;
    const poll = () => call<LiveData>(`/api/study-map/${genId}/live?since=${since}`).then((r) => {
      if (!alive) return;
      const pages = new Map((acc?.pages ?? []).map((p) => [p.page, p]));
      for (const p of r.pages) pages.set(p.page, p);
      acc = { ...r, outline: r.outline.length ? r.outline : acc?.outline ?? [], pages: [...pages.values()] };
      since = r.now - 1500; // a little overlap: a page written between the read and the answer is not missed
      // Every page in (or the run stopped, or pages it had made before a restart are not streamed again): the map takes over.
      const all = (acc.outline.length > 0 && acc.outline.every((o) => pages.get(o.page)?.done)) || !["queued", "running"].includes(r.status);
      setLive(acc);
      // Nothing written yet: a run still reading its pages is waited for; a finished or stopped one has no board.
      if (!r.live && !pages.size) { if (!["queued", "running"].includes(r.status) || ++misses > 120) { setBoard("off"); return; } timer = setTimeout(poll, 800); return; }
      else if (all) { setBoard((b) => (b === "live" ? "leaving" : b)); setTimeout(() => { if (alive) setBoard("off"); }, 900); return; }
      else setBoard("live");
      timer = setTimeout(poll, 350);
    }).catch(() => { if (alive) timer = setTimeout(poll, 1500); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const view = picked ?? (map?.topics?.length ? "topic" : "outline");
  const titles = useMemo(() => new Map(map?.sections.flatMap((s) => s.cards.map((c) => [c.id, c.title] as const)) ?? []), [map]);
  // Where a card leads (→) and what leads to it (←), once each.
  const next = useMemo(() => { const m = new Map<string, Array<{ to: string; what: string; back: boolean }>>();
    for (const c of map?.chains ?? []) { m.set(c.from, [...(m.get(c.from) ?? []), { to: c.to, what: c.what, back: false }]); if (c.by === "meaning") m.set(c.to, [...(m.get(c.to) ?? []), { to: c.from, what: c.what, back: true }]); }
    return m; }, [map]);
  // 개념별: the whole-material pass's larger ideas, across sections (cards without one stay under 기타).
  const groups = useMemo(() => {
    if (!map) return [];
    // 목차별: a section the engine cut only for size (same title, next pages) shows as one with the one before.
    if (view === "outline" || !map.topics?.length) {
      const base = (t: string) => t.replace(/\s*\(이어서\)$/, "").trim().toLowerCase();
      const merged: Array<{ key: string; title: string; pages: number[]; cards: Card[] }> = [];
      for (const s of map.sections) {
        const last = merged.at(-1);
        if (last && base(last.title) === base(s.title)) { last.pages = [...last.pages, ...s.pages]; last.cards = [...last.cards, ...s.cards]; }
        else merged.push({ key: s.id, title: s.title.replace(/\s*\(이어서\)$/, ""), pages: [...s.pages], cards: [...s.cards] });
      }
      return merged;
    }
    const all = map.sections.flatMap((s) => s.cards);
    const named = [...map.topics, ...(all.some((c) => !c.topic) ? ["기타"] : [])];
    return named.map((t) => { const cards = all.filter((c) => (c.topic ?? "기타") === t); return { key: `t:${t}`, title: t, pages: [...new Set(cards.flatMap((c) => c.pages))].sort((a, b) => a - b), cards }; });
  }, [map, view]);
  const groupOf = (id: string) => groups.find((g) => g.cards.some((c) => c.id === id))?.key;
  const toggleGroup = (key: string) => setOpenGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const jump = (id: string) => {
    const g = groupOf(id);
    if (g) setOpenGroups((prev) => new Set(prev).add(g));
    setOpenCard(id);
    setTimeout(() => { const el = document.getElementById(`mm3-${id}`); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }, 60);
  };
  if (!map) return <div className="mm2 mm3"><div className="mm2-head"><div><p className="eyebrow">자료 지도</p><b>지식을 정리하는 중…</b></div><button className="btn ghost small" onClick={onClose}>닫기</button></div>
    {board !== "off" && live ? <LiveBoard data={live} /> : <p className="small muted">{error || "쪽을 읽고 있어요. 첫 카드까지 5~10초쯤 걸려요."}</p>}</div>;
  const shown = (c: Card) => (!coreOnly || c.core) && (only === "all" || (only === "unknown" ? c.state === "unknown" : c.state === "new" || c.state === "met"));
  const n = map.counts;
  const making = map.status !== "done";
  const visible = groups.map((g) => ({ ...g, list: g.cards.filter(shown) })).filter((g) => g.list.length);
  const allOpen = visible.length > 0 && visible.every((g) => openGroups.has(g.key));
  // State dots say something only once the learner has answered (all 만남 at first is one colour, noise).
  const marked = Boolean(n.unknown || n.known || n.graduated);
  return (
    <div className="mm2 mm3" role="dialog" aria-label="자료 지도">
      <div className="mm2-head">
        <div><p className="eyebrow">자료 지도</p><b>{map.title.replace(/\.pdf$/i, "")}</b>
          <span className="small muted"> · {map.pages}쪽 · 지식 {n.cards}{n.core !== undefined && map.topics?.length ? ` · 핵심 ${n.core}` : ""}{map.questionsLater ? "" : ` · 문제 ${n.questions}`}</span>
          {making ? <span className="small mm3-making"> · {board !== "off" ? "카드 쓰는 중" : map.questionsLater ? (n.cards ? "지식 정리 중" : "자료 읽는 중") : map.topics?.length ? "문제 만드는 중" : n.cards ? "지식 정리 중" : "자료 읽는 중"}…</span> : null}</div>
        <span className="row small">
          {map.questionsLater && !making && n.cards && onMakeQuestions ? <button className="btn small primary" disabled={asking} title="지식마다 확인 문제를 만들어 연습·복습에 붙여요"
            onClick={() => { setAsking(true); void onMakeQuestions().then((ok) => { if (ok) setReload((k) => k + 1); }).finally(() => setAsking(false)); }}>{asking ? "시작하는 중…" : "문제 만들기"}</button> : null}
          <button className="btn ghost small" onClick={onClose}>닫기</button>
        </span>
      </div>
      <div className="row small mm3-tools">
        {map.topics?.length ? <div className="ws-seg">{([["outline", "목차별"], ["topic", "개념별"]] as const).map(([k, label]) =>
          <button key={k} aria-pressed={view === k} onClick={() => { setView(k); setOpenGroups(new Set()); setOpenCard(null); }}>{label}</button>)}</div> : null}
        {map.topics?.length ? <label className="row small"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 핵심만</label> : null}
        {n.unknown || n.known || n.graduated ? <div className="ws-seg">{([["all", "전체"], ["unknown", `몰랐음 ${n.unknown}`], ["new", "아직 확인 안 한 것"]] as const).map(([k, label]) =>
          <button key={k} aria-pressed={only === k} onClick={() => setOnly(k)}>{label}</button>)}</div> : null}
        <span className="cs-gap" />
        {visible.length ? <button className="linkish small" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(visible.map((g) => g.key)))}>{allOpen ? "모두 접기" : "모두 펼치기"}</button> : null}
      </div>
      {board !== "off" && live ? <div className={board === "leaving" ? "mm4-leaving" : undefined}><LiveBoard data={live} /></div> : <div className="mm4-arrive">
      {map.principles?.length ? <section className="mm3-principles" aria-label="이 자료를 꿰는 원리">
        <p className="mm3-label">이 자료를 꿰는 원리</p>
        {map.principles.map((p, i) => <div key={i} className="mm3-principle">
          <b><Rich text={p.title} /></b> <span><Rich text={p.line} /></span>
          <div className="row small mm3-uses">{p.cardIds.filter((id) => titles.has(id)).map((id) => <button key={id} className="chip" onClick={() => jump(id)}><Rich text={titles.get(id)!} /></button>)}</div>
        </div>)}
      </section> : null}
      <ol className="mm3-toc">
        {visible.map((g, gi) => {
          const open = openGroups.has(g.key);
          const core = g.list.filter((c) => c.core).length;
          return (
            <li key={g.key} className={`mm3-group${open ? " open" : ""}`}>
              <button className="mm3-ghead" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                <span className="mm3-caret" aria-hidden>{open ? "▾" : "▸"}</span>
                <span className="mm3-num">{gi + 1}</span>
                <span className="mm3-gtext"><b className="mm3-gtitle"><Rich text={g.title} /></b>
                  {view === "topic" && map.topicNotes?.[g.title] ? <span className="mm3-gist"><Rich text={map.topicNotes[g.title]} /></span> : null}</span>
                <span className="small muted">{range(g.pages)}</span>
                <span className="cs-gap" />
                <span className="small muted">{map.topics?.length && core ? `★${core} · ` : ""}{g.list.length}개</span>
                {marked ? <span className="mm2-dots" aria-hidden>{g.list.map((c) => <span key={c.id} className={`dot ${STATE[c.state][1]}`} />)}</span> : null}
              </button>
              {open ? <ul className="mm3-items">
                {g.list.map((c) => {
                  const isOpen = openCard === c.id;
                  const links = (next.get(c.id) ?? []).filter((x) => titles.has(x.to)).slice(0, 4);
                  return (
                    <li key={c.id} id={`mm3-${c.id}`} className={`mm3-item st-${c.state}${c.core ? " core" : ""}${isOpen ? " open" : ""}`}>
                      <button className="mm3-line" aria-expanded={isOpen} onClick={() => setOpenCard(isOpen ? null : c.id)}>
                        <span className="mm3-star" aria-label={c.core ? "핵심" : undefined}>{map.topics?.length && c.core ? "★" : ""}</span>
                        <span className="mm3-name"><Rich text={c.title} /></span>
                        <span className="mm3-key"><Rich text={keyLine(c.shape)} /></span>
                        {marked ? <span className={`dot ${STATE[c.state][1]}`} title={STATE[c.state][0]} /> : <span />}
                      </button>
                      {isOpen ? <div className="mm3-detail">
                        <div className="mm3-dhead">
                          <span className="mm3-kind">{c.kind}</span>
                          {c.core ? <span className="mm3-kind core">핵심</span> : null}
                          <span className="cs-gap" />
                          {c.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)} title="이 쪽 원문으로">원문 p.{p}</button>)}
                        </div>
                        <Body s={c.shape} />
                        {links.length ? <div className="mm3-rel"><span className="mm3-tag">이어지는 지식</span>
                          <div className="mm3-relchips">{links.map((x, i) =>
                            <button key={i} className="mm3-relchip" onClick={() => jump(x.to)} title={x.what || undefined}>
                              <span className="mm3-arrow">{x.back ? "←" : "→"}</span><Rich text={titles.get(x.to) ?? ""} />{x.what && x.what.length <= 20 ? <em>{x.what}</em> : null}</button>)}</div></div> : null}
                        {c.same.length || c.questions ? <div className="mm3-dfoot">
                          {c.same.length ? <span className="small muted">같은 내용: {c.same.map((x) => range(x.pages)).join(", ")}</span> : null}
                          <span className="cs-gap" />
                          {c.questions ? <button className="btn small primary" onClick={() => onPractice ? onPractice(c.pages[0], c.id) : onPage(c.pages[0])}>이 지식 문제 풀기 ({c.questions})</button> : null}
                        </div> : null}
                      </div> : null}
                    </li>
                  );
                })}
              </ul> : null}
            </li>
          );
        })}
      </ol>
      {!visible.length ? <p className="small muted">{making ? "지식을 정리하는 중… 첫 카드까지 5~10초쯤 걸려요." : "고른 조건에 맞는 지식이 없어요."}</p> : null}
      </div>}
    </div>
  );
}
