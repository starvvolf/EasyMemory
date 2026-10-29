"use client";
// 자료 지도 (2026-10-29): one material on one screen — the outline, under each section its knowledge in its own shape,
// and the learner's state on each. Page reading is for the first pass; this is for the second pass and the night before.
// Data: GET /api/study-map/<material> (src/lib/study/material-map.ts). Opened from the PDF reader's bar.
import { useEffect, useMemo, useState } from "react";
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
  topics?: string[]; counts: Record<MapState, number> & { cards: number; questions: number; core?: number } };

const STATE: Record<MapState, [string, string]> = { unknown: ["몰랐음", "bad"], met: ["만남", "read"], known: ["앎", "good"], graduated: ["졸업", "good"], new: ["아직", ""] };
const range = (pages: number[]) => !pages.length ? "" : pages.length === 1 ? `p.${pages[0]}` : `p.${Math.min(...pages)}–${Math.max(...pages)}`;

function Body({ s }: { s: Shape }) {
  switch (s.form) {
    case "procedure": return <ol className="mm2-steps">{s.steps.map((st, i) => <li key={i}><Rich text={st.action} />{st.input || st.output ? <span className="small muted"> {st.input ? <Rich text={st.input} /> : "…"} → {st.output ? <Rich text={st.output} /> : "…"}</span> : null}</li>)}</ol>;
    case "rule": return <p className="mm2-rule">{s.premise ? <span className="small muted"><Rich text={s.premise} /> · </span> : null}<b><Rich text={s.condition} /></b> → <Rich text={s.result} />{s.boundary ? <span className="small muted"> (경계: <Rich text={s.boundary} />)</span> : null}</p>;
    case "formula": return <div><p className="mm2-expr"><Rich text={asMath(s.expr)} /></p>{s.vars.length ? <p className="small muted">{s.vars.map((v, i) => <span key={i}>{i ? " · " : ""}<Rich text={v.symbol} />: <Rich text={v.meaning} /></span>)}</p> : null}{s.when ? <p className="small muted">쓸 때: <Rich text={s.when} /></p> : null}</div>;
    case "compare": return <div className="mm2-tablewrap"><table className="mm2-table"><thead><tr><th />{s.targets.map((t) => <th key={t}><Rich text={t} /></th>)}</tr></thead>
      <tbody>{s.criteria.map((c) => <tr key={c.name}><th><Rich text={c.name} /></th>{s.targets.map((_, i) => <td key={i}><Rich text={c.values[i] ?? ""} /></td>)}</tr>)}</tbody></table></div>;
    case "list": return <ul className="mm2-list">{s.items.map((it, i) => <li key={i}>{s.ordered ? `${i + 1}. ` : ""}<Rich text={it} /></li>)}</ul>;
    case "term": return <p><Rich text={s.definition} />{s.neighbors.length ? <span className="small muted"> · 헷갈리는 말: {s.neighbors.join(", ")}</span> : null}</p>;
    case "fact": return <p><Rich text={s.subject} />: <Rich text={s.value} /></p>;
    case "concept": return <p><Rich text={s.claim} />{s.reason ? <span className="small muted"> · 왜: <Rich text={s.reason} /></span> : null}{s.limit ? <span className="small muted"> · 한계: <Rich text={s.limit} /></span> : null}</p>;
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
const asMath = (expr: string) => (expr.includes("$") ? expr : `$${matrices(expr)}$`);
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
    case "compare": return clip(s.targets.join(" vs "));
    case "list": return clip(s.items.join(" · "));
    case "concept": return clip(s.claim);
    case "pattern": return clip(s.frame);
  }
}

export default function MaterialMap({ genId, onPage, onClose }: { genId: string; onPage: (page: number) => void; onClose: () => void }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"all" | "unknown" | "new">("all");
  const [view, setView] = useState<"outline" | "topic">("outline");
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
  }, [genId]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const titles = useMemo(() => new Map(map?.sections.flatMap((s) => s.cards.map((c) => [c.id, c.title] as const)) ?? []), [map]);
  // Where a card leads (→) and what leads to it (←), once each.
  const next = useMemo(() => { const m = new Map<string, Array<{ to: string; what: string; back: boolean }>>();
    for (const c of map?.chains ?? []) { m.set(c.from, [...(m.get(c.from) ?? []), { to: c.to, what: c.what, back: false }]); if (c.by === "meaning") m.set(c.to, [...(m.get(c.to) ?? []), { to: c.from, what: c.what, back: true }]); }
    return m; }, [map]);
  // 개념별: the whole-material pass's larger ideas, across sections (cards without one stay under 기타).
  const groups = useMemo(() => {
    if (!map) return [];
    if (view === "outline" || !map.topics?.length) return map.sections.map((s) => ({ key: s.id, title: s.title, pages: s.pages, cards: s.cards }));
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
  if (!map) return <div className="mm2"><div className="mm2-head"><b>자료 지도</b><button className="btn ghost small" onClick={onClose}>닫기</button></div><p className="small muted">{error || "지식을 정리하는 중… 첫 카드까지 10~15초쯤 걸려요."}</p></div>;
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
          <span className="small muted"> · {map.pages}쪽 · 지식 {n.cards}{n.core !== undefined && map.topics?.length ? ` · 핵심 ${n.core}` : ""} · 문제 {n.questions}</span>
          {making ? <span className="small mm3-making"> · {map.topics?.length ? "문제 만드는 중" : n.cards ? "지식 정리 중" : "자료 읽는 중"}…</span> : null}</div>
        <button className="btn ghost small" onClick={onClose}>닫기</button>
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
      <ol className="mm3-toc">
        {visible.map((g, gi) => {
          const open = openGroups.has(g.key);
          const core = g.list.filter((c) => c.core).length;
          return (
            <li key={g.key} className={`mm3-group${open ? " open" : ""}`}>
              <button className="mm3-ghead" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                <span className="mm3-caret" aria-hidden>{open ? "▾" : "▸"}</span>
                <span className="mm3-num">{gi + 1}</span>
                <b className="mm3-gtitle"><Rich text={g.title} /></b>
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
                        <Body s={c.shape} />
                        {c.mistakes.length ? <div className="mm3-sub"><span className="mm3-label">헷갈리는 점</span>
                          <ul className="mm2-mist small">{c.mistakes.slice(0, 2).map((m, i) => <li key={i}><Rich text={m} /></li>)}</ul></div> : null}
                        {links.length ? <div className="mm3-sub"><span className="mm3-label">이어지는 지식</span>
                          <ul className="mm3-links small">{links.map((x, i) =>
                            <li key={i}><span className="muted">{x.back ? "←" : "→"}</span> <button className="linkish small" onClick={() => jump(x.to)}><Rich text={titles.get(x.to) ?? ""} /></button>{x.what && x.what.length <= 20 ? <span className="muted"> · {x.what}</span> : null}</li>)}</ul></div> : null}
                        <div className="row small">
                          <span className={`chip ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span>
                          <span className="muted">{c.kind}{c.same.length ? ` · 같은 지식 ${c.same.map((x) => range(x.pages)).join(", ")}` : ""}</span>
                          <span className="cs-gap" />
                          {c.pages.map((p) => <button key={p} className="linkish small" onClick={() => onPage(p)} title="이 쪽 원문으로">원문 p.{p}</button>)}
                          {c.questions ? <button className="btn small" onClick={() => onPage(c.pages[0])}>문제 {c.questions}개 풀기</button> : null}
                        </div>
                      </div> : null}
                    </li>
                  );
                })}
              </ul> : null}
            </li>
          );
        })}
      </ol>
      {!visible.length ? <p className="small muted">{making ? "지식을 정리하는 중… 첫 카드까지 10~15초쯤 걸려요." : "고른 조건에 맞는 지식이 없어요."}</p> : null}
    </div>
  );
}
