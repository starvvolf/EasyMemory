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
    case "formula": return <div><p className="mm2-expr"><Rich text={s.expr.includes("$") ? s.expr : `$${s.expr}$`} /></p>{s.vars.length ? <p className="small muted">{s.vars.map((v, i) => <span key={i}>{i ? " · " : ""}<Rich text={v.symbol} />: <Rich text={v.meaning} /></span>)}</p> : null}{s.when ? <p className="small muted">쓸 때: <Rich text={s.when} /></p> : null}</div>;
    case "compare": return <div className="mm2-tablewrap"><table className="mm2-table"><thead><tr><th /> {s.targets.map((t) => <th key={t}><Rich text={t} /></th>)}</tr></thead>
      <tbody>{s.criteria.map((c) => <tr key={c.name}><th><Rich text={c.name} /></th>{s.targets.map((_, i) => <td key={i}><Rich text={c.values[i] ?? ""} /></td>)}</tr>)}</tbody></table></div>;
    case "list": return <ul className="mm2-list">{s.items.map((it, i) => <li key={i}>{s.ordered ? `${i + 1}. ` : ""}<Rich text={it} /></li>)}</ul>;
    case "term": return <p><Rich text={s.definition} />{s.neighbors.length ? <span className="small muted"> · 헷갈리는 말: {s.neighbors.join(", ")}</span> : null}</p>;
    case "fact": return <p><Rich text={s.subject} />: <Rich text={s.value} /></p>;
    case "concept": return <p><Rich text={s.claim} />{s.reason ? <span className="small muted"> · 왜: <Rich text={s.reason} /></span> : null}{s.limit ? <span className="small muted"> · 한계: <Rich text={s.limit} /></span> : null}</p>;
    case "pattern": return <p><Rich text={s.frame} />{s.example ? <span className="small muted"> · 예: <Rich text={s.example} /></span> : null}</p>;
  }
}

export default function MaterialMap({ genId, onPage, onClose }: { genId: string; onPage: (page: number) => void; onClose: () => void }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"all" | "unknown" | "new">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"outline" | "topic">("outline");
  const [coreOnly, setCoreOnly] = useState(false);
  useEffect(() => { call<{ map: MatMap }>(`/api/study-map/${genId}`).then((r) => setMap(r.map)).catch((e) => setError(errorText(e))); }, [genId]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const titles = useMemo(() => new Map(map?.sections.flatMap((s) => s.cards.map((c) => [c.id, c.title] as const)) ?? []), [map]);
  // Links both ways: a card shows where it leads and what it rests on.
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
  const jump = (id: string) => { const el = document.getElementById(`mm2-${id}`); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); };
  if (!map) return <div className="mm2"><div className="mm2-head"><b>자료 지도</b><button className="btn ghost small" onClick={onClose}>닫기</button></div><p className="small muted">{error || "지도를 그리는 중…"}</p></div>;
  const shown = (c: Card) => (!coreOnly || c.core) && (only === "all" || (only === "unknown" ? c.state === "unknown" : c.state === "new" || c.state === "met"));
  const n = map.counts;
  return (
    <div className="mm2" role="dialog" aria-label="자료 지도">
      <div className="mm2-head">
        <div><p className="eyebrow">자료 지도</p><b>{map.title}</b> <span className="small muted">· {map.pages}쪽 · 구역 {map.sections.length} · 지식 {n.cards} · 문제 {n.questions}{map.status !== "done" ? " · 만드는 중" : ""}</span></div>
        <button className="btn ghost small" onClick={onClose}>닫기</button>
      </div>
      <div className="mm2-bar" aria-label="내 상태">
        {(["unknown", "met", "known", "graduated", "new"] as const).filter((k) => n[k]).map((k) => <span key={k} className={`mm2-seg ${STATE[k][1]}`} style={{ flexGrow: n[k] }} title={`${STATE[k][0]} ${n[k]}`} />)}
      </div>
      <div className="row small">
        {(["unknown", "met", "known", "graduated", "new"] as const).filter((k) => n[k]).map((k) => <span key={k} className={`chip ${STATE[k][1]}`}>{STATE[k][0]} {n[k]}</span>)}
        <span className="cs-gap" />
        <div className="ws-seg">{([["all", "전체"], ["unknown", "몰랐음만"], ["new", "아직 확인 안 한 것"]] as const).map(([k, label]) =>
          <button key={k} aria-pressed={only === k} onClick={() => setOnly(k)}>{label}</button>)}</div>
      </div>
      <div className="row small">
        {map.topics?.length ? <div className="ws-seg">{([["outline", "목차별"], ["topic", "개념별"]] as const).map(([k, label]) =>
          <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>)}</div> : null}
        <label className="row small"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 핵심만{n.core !== undefined ? ` (${n.core})` : ""}</label>
        {map.status !== "done" && !map.topics?.length ? <span className="muted">개념별 보기는 자료 전체 정리가 끝나면 생겨요</span> : null}
      </div>
      <div className="mm2-sections">
        {groups.map((s) => {
          const cards = s.cards.filter(shown);
          if (!cards.length) return null;
          return (
            <section key={s.key} className="mm2-sec">
              <div className="mm2-sec-head"><b>{s.title}</b><span className="small muted">{range(s.pages)}</span>
                <span className="mm2-dots">{s.cards.map((c) => <span key={c.id} className={`dot ${STATE[c.state][1]}`} title={`${c.title}: ${STATE[c.state][0]}`} />)}</span></div>
              <div className="mm2-cards">
                {cards.map((c) => (
                  <article key={c.id} id={`mm2-${c.id}`} className={`mm2-card st-${c.state}${c.core ? "" : " minor"}`}>
                    <div className="row small"><span className="chip">{c.kind}</span>{c.core ? <span className="chip core">핵심</span> : null}<span className={`chip ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span><span className="cs-gap" />
                      {c.pages.map((p) => <button key={p} className="linkish small" onClick={() => onPage(p)} title="이 쪽 원문으로">p.{p}</button>)}</div>
                    <b className="mm2-title"><Rich text={c.title} /></b>
                    <Body s={c.shape} />
                    {next.get(c.id)?.length ? <p className="small muted mm2-links">{next.get(c.id)!.filter((x) => titles.has(x.to)).map((x, i) =>
                      <span key={i}>{x.back ? "← " : "→ "}<button className="linkish small" onClick={() => jump(x.to)}>{titles.get(x.to)}</button>{x.what && x.what.length <= 20 ? ` (${x.what})` : ""}</span>)}</p> : null}
                    {c.same.length ? <p className="small muted">같은 지식: {c.same.map((x) => range(x.pages)).join(", ")}</p> : null}
                    {c.mistakes.length ? (open === c.id
                      ? <ul className="mm2-mist small">{c.mistakes.map((m, i) => <li key={i}><Rich text={m} /></li>)}</ul>
                      : <button className="linkish small" onClick={() => setOpen(c.id)}>헷갈리는 점 {c.mistakes.length}</button>) : null}
                    <div className="row small"><span className="muted">{c.questions ? `문제 ${c.questions}개` : "문제 없음"}</span><span className="cs-gap" />
                      {c.questions ? <button className="btn small" onClick={() => onPage(c.pages[0])}>그 쪽 문제 풀기</button> : null}</div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
