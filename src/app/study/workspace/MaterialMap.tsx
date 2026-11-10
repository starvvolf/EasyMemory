"use client";
// 자료 지도 (2026-10-29): one material on one screen — the outline, under each section its knowledge in its own shape,
// and the learner's state on each. Page reading is for the first pass; this is for the second pass and the night before.
// Data: GET /api/study-map/<material> (src/lib/study/material-map.ts). Opened from the PDF reader's bar.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText, go } from "./api";
import { Rich as RichBlock, RichInline as Rich } from "./Rich";

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
  takes: string[]; gives: string[]; questions: number; same: Array<{ id: string; pages: number[] }>; state: MapState; knowledgeId?: string; dueAt?: string; topic?: string;
  figure?: { page: number; role: string; says: string; file: string; mode?: string };
  memo?: { question?: string; line?: string; facts?: string[]; role?: string } };
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
    // 표기(기호) 11/8 사용자 "요청 간선 P→R 표기가 안 보여": 카드에는 있었는데 그리지 않았다.
    case "term": return <div className="mm3-body"><p className="mm3-lead"><Rich text={s.definition} /></p>
      {s.symbol ? <p className="mm3-when"><span className="mm3-tag">표기</span><Rich text={s.symbol.includes("$") ? s.symbol : tex(s.symbol)} /></p> : null}{s.neighbors.length ? <p className="mm3-when"><span className="mm3-tag">헷갈리는 말</span><Rich text={s.neighbors.join(", ")} /></p> : null}</div>;
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
    case "term": return clip(`${s.symbol ? `${s.symbol.includes("$") ? s.symbol : tex(s.symbol)} · ` : ""}${s.definition}`);
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
type Summary = { status: "writing" | "done" | "failed"; text: string; firstMs?: number; ms?: number; error?: string };
type LiveData = { now: number; status: string; live: boolean; outline: Array<{ page: number; title: string }>; pages: LivePage[]; summary?: Summary | null; digest?: DigestLite | null };

// [요약] 탭 (11/6 사용자 "요약을 스트리밍으로, 넓은 채팅창처럼"): 엔진이 쓰는 정리 글(summary.json)을 쓰는 대로 보여 준다.
// 목차 (11/6 사용자 "1의 목차로 바꾸고, 목차가 나오면서 그 목차에 지식이 하나씩 붙고 누르면 확인 가능하게"): the engine's own
// outline (rc-digest-plan, streamed: topics and what each teaches), with each topic's cards attached to the item they cover
// as they are made. Replaces the separate 정리 글 (summary.ts) for new runs.
type DigestLite = {
  skeleton?: { status: string; text: string; topics: Array<{ id: string; title: string; pages: number[] }> };
  topics?: Record<string, { body?: Array<{ id: string; name: string; pages: number[] }> }>;
  notes?: Record<string, { covers?: string[] }>;
  objectives?: Array<{ id: string; verb: string; text: string; core: boolean }>;
};
type OutlineItem = { key: string; name: string; pages: number[] };
/** Items as the plan call writes them ("t3-c1|이름|쪽"), so they show while the outline is still streaming. */
function streamedItems(text: string): Map<string, OutlineItem[]> {
  const out = new Map<string, OutlineItem[]>();
  for (const m of text.matchAll(/^(t\d+)-c(\d+)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]*)/gm)) {
    const pages = [...m[4].matchAll(/\d+/g)].map((x) => Number(x[0]));
    out.set(m[1], [...(out.get(m[1]) ?? []), { key: `${m[1]}-c${m[2]}`, name: m[3].trim(), pages }]);
  }
  return out;
}
const isFlowCard = (c: Card) => c.title.startsWith("흐름: ");
// 카드에 붙은 그림 (11/8): 잘라 둔 그림 + 역할 + 그림 설명 한 줄. 누르면 원문 쪽으로.
const FIG_ROLE: Record<string, string> = { 근거: "근거", 장면: "장면", 그림풀이: "그림풀이" };
// 같은 그림을 쓰는 다른 카드(그림 하나가 여러 개념을 설명, 11/8): 이름을 보이고 누르면 그 카드로.
function FigureView({ genId, c, onPage, all = [], onCard }: { genId: string; c: Card; onPage: (page: number) => void; all?: Card[]; onCard?: (id: string) => void }) {
  if (!c.figure) return null;
  const f = c.figure;
  const others = all.filter((x) => x.id !== c.id && x.figure?.file === f.file);
  return (
    <figure className={`mm9-fig r-${f.role}`}>
      <button className="mm9-img" onClick={() => onPage(f.page)} title={`원문 p.${f.page}에서 보기`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/study-map/${genId}/figure/${encodeURIComponent(f.file)}`} alt={f.says || `p.${f.page} 그림`} loading="lazy" />
      </button>
      <figcaption className="small"><span className="mm9-role">{FIG_ROLE[f.role] ?? f.role}</span>{f.says ? <Rich text={f.says} /> : null}<span className="muted"> · p.{f.page}</span></figcaption>
      {others.length ? <div className="mm9-share small"><span className="muted">이 그림을 같이 쓰는 카드</span>{others.map((o) => onCard
        ? <button key={o.id} className="mm3-relchip" onClick={() => onCard(o.id)} title={o.figure?.says || undefined}><Rich text={o.title} /></button>
        : <span key={o.id} className="mm3-relchip" title={o.figure?.says || undefined}><Rich text={o.title} /></span>)}</div> : null}
    </figure>);
}
function OutlinePane({ genId, digest, cards, making, onPage, onPractice }: { genId: string; digest: DigestLite | null | undefined; cards: Card[]; making: boolean;
  onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const sk = digest?.skeleton;
  if (!sk || (!sk.topics.length && !sk.text)) return <p className="small muted mm6-wait">{making ? "목차를 만드는 중이에요. 몇 초 뒤부터 주제가 하나씩 보여요." : "이 자료에는 목차가 없어요. [기억] 탭에서 보세요."}</p>;
  const streamed = streamedItems(sk.text ?? "");
  const byTopic = new Map<string, Card[]>();
  for (const c of cards) { const t = c.id.split(".")[0]; byTopic.set(t, [...(byTopic.get(t) ?? []), c]); }
  // 11/9 사용자 "목차에서 개념 누르면 뜨는 거 새 미니 화면에서, 구조처럼": 구조 탭과 같은 아래 칸(떠 있는 카드)에 연다.
  const detail = (c: Card) => (
    <div className="mm8-detail mm6-card">
      <div className="mm3-dhead"><b><Rich text={c.title} /></b><span className="mm3-kind">{c.kind}</span>{c.core ? <span className="mm3-kind core">핵심</span> : null}<span className="cs-gap" />
        {c.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => setOpen(null)}>닫기</button></div>
      <Body s={c.shape} />
      <FigureView genId={genId} c={c} onPage={onPage} all={cards} onCard={setOpen} />
      {c.questions && onPractice ? <div className="mm3-dfoot"><span className="cs-gap" /><button className="btn small primary" onClick={() => onPractice(c.pages[0], c.id)}>이 기억 문제 풀기 ({c.questions})</button></div> : null}
    </div>);
  const chip = (c: Card) => <button key={c.id} className={`chip mm6-chip${open === c.id ? " on" : ""}${c.core ? " core" : ""}`} aria-expanded={open === c.id}
    onClick={() => setOpen(open === c.id ? null : c.id)}><Rich text={isFlowCard(c) ? "흐름 보기" : c.title} /></button>;
  const openCard = open ? cards.find((c) => c.id === open) : undefined;
  return (
    <div className={`mm6${openCard ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("button,a,input,label,.mm8-detail")) setOpen(null); }}>
      {digest?.objectives?.length ? <section className="mm6-goals"><p className="mm3-label">학습 목표</p>
        <ol>{digest.objectives.map((o) => <li key={o.id}><span className="mm6-verb">{o.verb}</span> <Rich text={o.text} /></li>)}</ol></section> : null}
      <ol className="mm6-topics">
        {sk.topics.map((t, i) => {
          const body = digest?.topics?.[t.id]?.body ?? [];
          const items: OutlineItem[] = body.length ? body.map((l) => ({ key: l.id, name: l.name, pages: l.pages })) : streamed.get(t.id) ?? [];
          const mine = byTopic.get(t.id) ?? [];
          const under = (it: OutlineItem) => mine.filter((c) => !isFlowCard(c) && (digest?.notes?.[c.id]?.covers ?? []).includes(it.key));
          const placed = new Set(items.flatMap((it) => under(it).map((c) => c.id)));
          const loose = mine.filter((c) => !isFlowCard(c) && !placed.has(c.id));
          return (
            <li key={t.id} className="mm6-topic">
              <div className="mm6-thead"><span className="mm3-num">{i + 1}</span><b><Rich text={t.title} /></b><span className="small muted">{range(t.pages)}</span>
                </div>
              {items.length ? <p className="mm6-learn small muted"><Rich text={`${items.map((it) => it.name).join(", ")}을(를) 배워요.`} /></p> : null}
              <ul className="mm6-items">
                {items.map((it) => { const got = under(it); return (
                  <li key={it.key} className="mm6-item"><span className="mm6-iname"><Rich text={it.name} /></span>
                    <span className="mm6-chips">{got.length ? got.map(chip) : <span className="small muted">{making ? "기억 만드는 중…" : "—"}</span>}</span></li>); })}
                {loose.length ? <li className="mm6-item"><span className="mm6-iname muted">그 밖</span><span className="mm6-chips">{loose.map(chip)}</span></li> : null}
              </ul>
            </li>);
        })}
      </ol>
      {sk.status === "writing" ? <p className="small muted">목차를 이어 쓰는 중…</p> : null}
      {openCard ? detail(openCard) : null}
    </div>);
}

// 줄기 (11/9 사용자 "목차를 없애야 하나, 줄기로 바꾸려면" → "바꿔서 테스트 후 보고"): 기억 합치기(src/lib/study/compact.ts)가 묶은 영역 → 기억.
// 영역은 자료 순서라 목차를 겸한다(쪽 범위). 메인 기억은 한 줄씩, 바탕·곁은 영역 끝에 접어 둔다. 누르면 아래 떠 있는 칸에 요지·단계·근거 카드.
// 아직 합치지 않은 자료는 예전 목차를 보이고 위에 [줄기 만들기].
type MemoryLite = { id: string; name: string; kind: string; role: "메인" | "바탕" | "곁"; area: number; question: string; line: string; steps: string[]; cards: string[]; facts?: string[] };
type CompactLite = { at: string; ms: number; model?: string; cards: number; areas: Array<{ name: string; question: string }>; memories: MemoryLite[] };
function StemPane(props: { genId: string; digest: DigestLite | null | undefined; cards: Card[]; making: boolean; onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const { genId, cards, making, onPage } = props;
  const [data, setData] = useState<CompactLite | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => { let alive = true;
    call<{ compact: CompactLite | null }>(`/api/study-map/${genId}/compact`).then((r) => { if (alive) setData(r.compact); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; }; }, [genId]);
  const make = () => { setBusy(true); setError("");
    call<{ compact: CompactLite }>(`/api/study-map/${genId}/compact`, {}).then((r) => setData(r.compact)).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); };
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const btn = (label: string, primary: boolean) => <button className={`btn small ${primary ? "primary" : "ghost"}`} disabled={busy || making} onClick={make} title="카드를 영역·기억으로 묶어요. AI 영역 1번 + 영역마다 1번(동시), 약 30초">{busy ? "줄기를 만드는 중… (약 30초)" : label}</button>;
  if (data === undefined) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (!data) return <>
    <div className="row small mm8-goalbar"><span className="muted">카드 {cards.filter((c) => !isFlowCard(c)).length}장을 외울 단위(알고리즘은 한 장)로 묶어 줄기로 볼 수 있어요.</span><span className="cs-gap" />{btn("줄기 만들기", true)}</div>
    {error ? <p className="small bad">{error}</p> : null}
    <OutlinePane {...props} /></>;
  const pagesOf = (m: MemoryLite) => [...new Set(m.cards.flatMap((id) => byId.get(id)?.pages ?? []))].sort((a, b) => a - b);
  const mem = data.memories.find((m) => m.id === open);
  const self = mem && mem.cards.length === 1 && mem.cards[0] === mem.id ? byId.get(mem.id) : undefined;
  const openCard = card ? byId.get(card) : undefined;
  const range = (ps: number[]) => ps.length ? (ps[0] === ps.at(-1) ? `p.${ps[0]}` : `p.${ps[0]}–${ps.at(-1)}`) : "";
  const main = data.memories.filter((m) => m.role === "메인").length;
  return (
    <div className={`mm6 st${mem ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("button,a,input,label,summary,.mm8-detail")) { setOpen(null); setCard(null); } }}>
      <div className="row small mm8-goalbar"><span className="muted">{data.model === "stem" ? `기억 ${data.memories.length}개` : `카드 ${data.cards}장 → 기억 ${data.memories.length}개`} (이 강의에서 새로 배우는 것 {main}개)</span><span className="cs-gap" />{btn("다시 만들기", false)}</div>
      {error ? <p className="small bad">{error}</p> : null}
      <ol className="mm6-topics">{data.areas.map((a, i) => {
        const list = data.memories.filter((m) => m.area === i + 1);
        const mains = list.filter((m) => m.role === "메인"), rest = list.filter((m) => m.role !== "메인");
        const ps = [...new Set(list.flatMap(pagesOf))].sort((x, y) => x - y);
        const row = (m: MemoryLite) => <li key={m.id}><button className={`st-row${open === m.id ? " on" : ""}${m.role !== "메인" ? " side" : ""}`} onClick={() => { setOpen(open === m.id ? null : m.id); setCard(null); }}>
          <span className="st-name"><Rich text={m.name} /></span>{m.kind === "알고리즘" ? <span className="st-kind">알고리즘 · {m.steps.length}단계</span> : <span className="st-kind">{m.kind}</span>}
          <span className="st-line"><Rich text={m.line} /></span></button></li>;
        return <li key={i} className="mm6-topic">
          <div className="mm6-thead"><span className="mm3-num">{i + 1}</span><b><Rich text={a.name} /></b><span className="small muted">{range(ps)}</span></div>
          {a.question ? <p className="st-q small muted"><Rich text={a.question} /></p> : null}
          <ul className="st-list">{mains.map(row)}</ul>
          {rest.length ? <details className="st-more"><summary className="small muted">바탕·곁 {rest.length}개 · {rest.map((m) => m.name).join(", ")}</summary><ul className="st-list">{rest.map(row)}</ul></details> : null}
        </li>;
      })}
      {data.memories.some((m) => !m.area) ? <li className="mm6-topic"><div className="mm6-thead"><b>그 밖</b></div><ul className="st-list">{data.memories.filter((m) => !m.area).map((m) =>
        <li key={m.id}><button className="st-row side" onClick={() => setOpen(m.id)}><span className="st-name"><Rich text={m.name} /></span></button></li>)}</ul></li> : null}
      </ol>
      {mem ? <div className="mm8-detail mm6-card">
        <div className="mm3-dhead"><b><Rich text={mem.name} /></b><span className="mm3-kind">{mem.kind}</span>{mem.role !== "메인" ? <span className="mm3-kind">{mem.role === "바탕" ? "바탕 지식" : "곁가지"}</span> : null}<span className="cs-gap" />
          {pagesOf(mem).slice(0, 6).map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => { setOpen(null); setCard(null); }}>닫기</button></div>
        {mem.question ? <p className="small muted" style={{ margin: 0 }}><Rich text={mem.question} /></p> : null}
        <p style={{ margin: 0 }}><Rich text={mem.line} /></p>
        {self ? <>
          {/* 줄기 모드(11/10): 기억 하나가 곧 카드 한 장 — 모양(단계·기준…), 모양에 없는 식·조건, 근거, 그림을 바로 */}
          <Body s={self.shape} />
          {mem.facts?.length ? <ul className="st-facts">{mem.facts.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul> : null}
          {self.quotes.length ? <div className="st-quotes small muted">{self.quotes.map((q, k) => <span key={k}>“{q}”</span>)}</div> : null}
          <FigureView genId={genId} c={self} onPage={onPage} />
        </> : <>
        {mem.steps.length ? <ol className="st-steps">{mem.steps.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ol> : null}
        <div className="st-src"><span className="small muted">근거 카드 {mem.cards.length}</span>{mem.cards.map((id) => byId.get(id)).filter((c): c is Card => !!c).map((c) =>
          <button key={c.id} className={`mm3-relchip${card === c.id ? " on" : ""}`} onClick={() => setCard(card === c.id ? null : c.id)}><Rich text={c.title} /></button>)}</div>
        {openCard && mem.cards.includes(openCard.id) ? <div className="st-card"><Body s={openCard.shape} /><FigureView genId={genId} c={openCard} onPage={onPage} /></div> : null}
        </>}
      </div> : null}
    </div>);
}

// 구조 (11/7 사용자 "목차와 구조 두 탭, 구조는 뜻으로 재배치" → 2차 "위에서 아래로 내리는 느낌, 집합으로 정리되고 가까운 것·먼 것,
// 조건이 발생 조건에서 한 번, 예방에서 한 번 더 나오는 연계까지 — 다이어그램이면 완전 다른 구조도"): src/lib/study/structure.ts가
// AI 한 번(terra)으로 묶은 것을 집합 그림으로 그린다. 큰 묶음은 나란한 큰 상자, 하위 묶음은 그 안의 상자, 카드는 상자 안의 알약.
// 묶음 사이 연결(막음·씀·이어짐·대비·예시)은 늘 보이는 선, 카드끼리 짝(구조의 짝 + 자료 전체 정리의 연결 중 묶음을 넘는 것)은
// 카드·상자에 마우스를 올리면(또는 "카드 연결 모두") 선으로. 흐름 카드는 보이지 않는다(카드 만들 때 쓰는 것, 사용자 11/7).
// 3차 (11/8 사용자 "큰 개념과 작은 개념, 대비, 모두 성립 — 위와 아래를 레이어로"): head는 상자의 대표 카드(상자 머리에 크게),
// members는 안의 것과 대표의 관계(이루는 것·갈래·모두 성립해야·차례로), versus는 나란히 견주는 카드(같은 상자면 A vs B 한 덩어리).
type StructGroup = { id: string; name: string; parent: string; head?: string; cards: string[]; members?: string; explain: string; link?: string; role?: StructRole };
type StructVersus = { a: string; b: string; on: string };
const MEMBER_LABEL: Record<string, string> = { 부분: "이루는 것", 종류: "갈래", 모두: "모두 성립해야", 순서: "차례로" };
const MEMBER_JOIN: Record<string, string> = { 모두: "+", 순서: "→" };
const sameName = (a: string, b: string) => { const n = (x: string) => x.replace(/\(.*?\)|[\s·]/g, "").toLowerCase(); const x = n(a), y = n(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
type StructRole = "메인" | "바탕" | "곁";
type StructEdge = { a: string; b: string; type: string; why: string };
type StructPair = { a: string; b: string; why: string };
type Structure = { at: string; ms: number; model: string; effort: string; unit?: "card" | "memory"; groups: StructGroup[]; edges: StructEdge[]; pairs?: StructPair[]; versus?: StructVersus[]; base?: string[]; fixes: string[] };
function StructurePane({ genId, cards: cardList, chains: chainList, making, onPage, onPractice }: { genId: string; cards: Card[]; chains: MatMap["chains"]; making: boolean;
  onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const [data, setData] = useState<{ structure: Structure | null; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<{ card?: string; group?: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { let alive = true;
    call<{ structure: Structure | null; stale: boolean }>(`/api/study-map/${genId}/structure-v2`).then((r) => { if (alive) setData(r); }).catch((e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; }; }, [genId]);
  const make = () => { setBusy(true); setError("");
    call<{ structure: Structure; stale: boolean }>(`/api/study-map/${genId}/structure-v2`, {}).then(setData).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); };
  const s = data?.structure;
  // 줄기 기반 구조 (11/9): 묶은 것이 기억이면 기억을 카드 모양으로 바꿔 같은 그림에 올린다(알약 = 기억, 열면 요지·단계·근거 카드).
  const [compact, setCompact] = useState<CompactLite | null>(null);
  const [srcCard, setSrcCard] = useState<string | null>(null);
  useEffect(() => { if (s?.unit !== "memory") return; let alive = true;
    call<{ compact: CompactLite | null }>(`/api/study-map/${genId}/compact`).then((r) => { if (alive) setCompact(r.compact); }).catch(() => undefined);
    return () => { alive = false; }; }, [genId, s?.unit]);
  const cardById = useMemo(() => new Map(cardList.map((c) => [c.id, c])), [cardList]);
  const memById = useMemo(() => new Map((compact?.memories ?? []).map((m) => [m.id, m])), [compact]);
  const cards = useMemo<Card[]>(() => s?.unit !== "memory" ? cardList : (compact?.memories ?? []).map((m) => {
    // 줄기 모드로 만든 자료(11/10): 기억이 곧 카드 — 그 카드를 그대로(모양·그림까지).
    const own = m.cards.length === 1 && m.cards[0] === m.id ? cardById.get(m.id) : undefined;
    if (own) return { ...own, core: m.role === "메인" };
    const src = m.cards.map((id) => cardById.get(id)).filter((c): c is Card => !!c);
    return { id: m.id, ref: m.id, kind: m.kind, title: m.name, core: m.role === "메인",
      shape: m.steps.length ? { form: "procedure", steps: m.steps.map((x) => ({ action: x, input: "", output: "" })) } as Shape : { form: "concept", claim: m.line, reason: "", limit: "" } as Shape,
      pages: [...new Set(src.flatMap((c) => c.pages))].sort((a, b) => a - b), quotes: [], mistakes: [], takes: [], gives: [], questions: 0, same: [], state: "new" as MapState,
      ...(src.find((c) => c.figure) ? { figure: src.find((c) => c.figure)!.figure } : {}) };
  }), [s?.unit, cardList, compact, cardById]);
  const chains = useMemo(() => (s?.unit === "memory" ? [] : chainList), [s?.unit, chainList]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const groupOfCard = useMemo(() => new Map((s?.groups ?? []).flatMap((g) => [...(g.head ? [g.head] : []), ...g.cards].map((id) => [id, g.id] as const))), [s]);
  // Card pairs across groups: the structure's own, then the whole-material pass's links that cross a group.
  const pairs = useMemo(() => {
    const out: StructPair[] = [], seen = new Set<string>();
    const add = (a: string, b: string, why: string) => {
      const ga = groupOfCard.get(a), gb = groupOfCard.get(b);
      if (!ga || !gb || ga === gb || !byId.has(a) || !byId.has(b) || isFlowCard(byId.get(a)!) || isFlowCard(byId.get(b)!)) return;
      const k = [a, b].sort().join(">"); if (seen.has(k)) return; seen.add(k); out.push({ a, b, why });
    };
    for (const p of s?.pairs ?? []) add(p.a, p.b, p.why);
    for (const v of s?.versus ?? []) add(v.a, v.b, `대비${v.on ? ` · ${v.on}` : ""}`); // 다른 상자끼리 견주는 것은 짝 선으로
    for (const c of chains) if (c.by === "meaning" || c.by === "wording") add(c.from, c.to, c.what);
    return out;
  }, [s, chains, groupOfCard, byId]);
  const pairCount = useMemo(() => { const m = new Map<string, number>(); for (const p of pairs) { m.set(p.a, (m.get(p.a) ?? 0) + 1); m.set(p.b, (m.get(p.b) ?? 0) + 1); } return m; }, [pairs]);
  // 연 카드가 아래 칸(내용)에 가리면 그 위로 굴린다.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = wrap.current?.querySelector<HTMLElement>(`[data-c="${open}"]`), panel = document.querySelector<HTMLElement>(".mm8-detail");
      if (!el || !panel) return;
      const r = el.getBoundingClientRect(), top = panel.getBoundingClientRect().top;
      if (r.bottom > top - 12) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const again = el.getBoundingClientRect();
      if (again.bottom > top - 12) { let box: HTMLElement | null = el.parentElement; while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement; (box ?? document.scrollingElement as HTMLElement | null)?.scrollBy({ top: again.bottom - top + 40, behavior: "smooth" }); }
    }, 60);
    return () => clearTimeout(t);
  }, [open]);
  // 메인·바탕·곁 (11/9 사용자: 목표 기준 강조는 "이렇게 하면 안 될 것 같음" → "구조 묶을 때 AI가 메인 포인트를 잡게, 기울기·절편 방정식은 메인이
  // 아니라 사전에 알아야 하는 지식"): 구조 AI가 묶음마다 role을 고른다(src/lib/study/structure.ts). 메인은 위에 옅게 강조, 바탕·곁은 흐리게 아래로.
  // 아래 묶음에 role이 없으면(큰 상자 다시 정리로 생긴 것) 위 묶음을 따른다. "풀기"(사용자 "풀기 하나 만들어 봐")는 체크 상자로 끈다.
  const [roleOn, setRoleOnState] = useState(() => { try { return localStorage.getItem("recaller:role-hl") !== "0"; } catch { return true; } });
  const setRoleOn = (on: boolean) => { setRoleOnState(on); try { localStorage.setItem("recaller:role-hl", on ? "1" : "0"); } catch { /* storage off */ } };
  const roleView = useMemo(() => {
    const groups = s?.groups ?? [];
    const byG = new Map(groups.map((g) => [g.id, g]));
    const roleOf = (id: string): StructRole | undefined => { for (let g = byG.get(id); g; g = byG.get(g.parent)) if (g.role) return g.role; return undefined; };
    const has = groups.some((g) => g.role);
    return { has, on: has && roleOn, roleOf, base: new Set(s?.base ?? []) };
  }, [s, roleOn]);
  const makeBtn = (label: string, primary = true) => <button className={`btn small ${primary ? "primary" : "ghost"}`} disabled={busy || making} onClick={make}
    title="기억 카드를 뜻으로 다시 묶어요. AI 1번(terra), 약 15초">{busy ? "구조를 만드는 중… (약 15초)" : label}</button>;
  if (!data && !error) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (!s) return <div className="mm7-empty"><p className="small muted">목차는 자료가 쪽 순서로 보여 준 차례예요. 구조는 같은 기억들을 뜻으로 다시 묶어, 무엇이 무엇의 부분이고 무엇이 무엇을 막거나 쓰는지 그림으로 보여 줘요.</p>
    <div className="row small">{makeBtn("구조 만들기")}<span className="small muted">AI 1번 (terra) · 약 15초{making ? " · 자료를 다 만든 뒤에 할 수 있어요" : ""}</span></div>
    {error ? <p className="small bad">{error}</p> : null}</div>;
  const kids = (id: string) => s.groups.filter((g) => g.parent === id);
  // 메인 묶음을 위로(차례로 묶인 것은 순서를 지킨다). 같은 등급 안에서는 원래 순서.
  const RANK: Record<StructRole, number> = { 메인: 0, 바탕: 1, 곁: 2 };
  const ranked = (list: StructGroup[]) => roleView.on ? [...list].sort((a, b) => RANK[roleView.roleOf(a.id) ?? "메인"] - RANK[roleView.roleOf(b.id) ?? "메인"]) : list;
  const tierClass = (id: string) => { if (!roleView.on) return ""; const r = roleView.roleOf(id); return r === "메인" ? " main" : r === "바탕" ? " side base" : r === "곁" ? " side" : ""; };
  const openCard = open ? byId.get(open) : undefined;
  const litCards = new Set(hover?.card ? [hover.card, ...pairs.filter((p) => p.a === hover.card || p.b === hover.card).map((p) => (p.a === hover.card ? p.b : p.a))] : []);
  const pill = (c: Card) => <button key={c.id} data-c={c.id} className={`mm8-pill${c.core ? " core" : ""}${roleView.on && roleView.base.has(c.id) && roleView.roleOf(groupOfCard.get(c.id) ?? "") === "메인" ? " basecard" : ""}${open === c.id ? " on" : ""}${litCards.has(c.id) ? " lit" : ""}`}
    onClick={() => setOpen(open === c.id ? null : c.id)} title={`${keyLine(c.shape)}${roleView.on && roleView.base.has(c.id) ? "\n바탕 지식(미리 알아야 할 것을 다시 적은 것)" : ""}`}>
    <Rich text={c.title} />{c.figure?.file ? <span className="mm8-fig" aria-label="그림 있음">▣</span> : null}{pairCount.get(c.id) ? <span className="mm8-n" aria-label={`다른 묶음과 연결 ${pairCount.get(c.id)}`}>↔{pairCount.get(c.id)}</span> : null}</button>;
  const box = (g: StructGroup, depth: number): ReactNode => {
    const ok = (c: Card | undefined): c is Card => !!c && !isFlowCard(c);
    const head = g.head ? byId.get(g.head) : undefined;
    const mine = g.cards.map((id) => byId.get(id)).filter(ok);
    const sub = kids(g.id);
    if (!mine.length && !sub.length && !ok(head)) return null;
    // 같은 상자 안에서 견주는 둘은 한 덩어리(A vs B)로, 나머지는 하나씩.
    const ids = new Set(mine.map((c) => c.id)), used = new Set<string>();
    const items: Array<{ vs?: StructVersus; c?: Card }> = [];
    for (const c of mine) {
      if (used.has(c.id)) continue;
      const v = (s.versus ?? []).find((x) => (x.a === c.id && ids.has(x.b) && !used.has(x.b)) || (x.b === c.id && ids.has(x.a) && !used.has(x.a)));
      if (v) { used.add(v.a); used.add(v.b); items.push({ vs: v }); } else { used.add(c.id); items.push({ c }); }
    }
    const rel = g.members ? MEMBER_LABEL[g.members] : "", join = g.members ? MEMBER_JOIN[g.members] : undefined;
    const merged = ok(head) && sameName(head.title, g.name);
    return (
      <div key={g.id} data-g={g.id} className={`mm8-box d${Math.min(depth, 3)}${tierClass(g.id)}${hover?.group === g.id ? " hov" : ""}`}>
        {merged ? null : <div className="mm8-title" title={g.explain || undefined}><Rich text={g.name} /></div>}
        {roleView.on && g.role && g.role !== "메인" && (!g.parent || roleView.roleOf(g.parent) !== g.role) ? <span className="mm8-role">{g.role === "바탕" ? "바탕 지식" : "곁가지"}</span> : null}
        {ok(head) ? <button data-c={head.id} className={`mm8-head${merged ? " as-title" : ""}${open === head.id ? " on" : ""}${litCards.has(head.id) ? " lit" : ""}`} onClick={() => setOpen(open === head.id ? null : head.id)}>
          <span className="mm8-headname"><Rich text={head.title} />{pairCount.get(head.id) ? <span className="mm8-n">↔{pairCount.get(head.id)}</span> : null}</span>
          <span className="mm8-headline"><Rich text={keyLine(head.shape)} /></span></button> : null}
        {g.explain && depth < 2 && !ok(head) ? <p className="mm8-explain"><Rich text={g.explain} /></p> : null}
        {/* 11/8 사용자: 관계 표시는 한 줄을 온전히, 차례로는 상자처럼 위에서 아래로 ↓ */}
        {items.length && rel ? <div className={`mm8-relrow r-${g.members}`}><span className={`mm8-rel r-${g.members}`}>{rel}</span></div> : null}
        {items.length ? <div className={`mm8-cards${g.members === "순서" ? " seq" : ""}`}>
          {items.map((it, i) => <span key={i} className="mm8-item">
            {i && join ? <span className="mm8-join" aria-hidden>{g.members === "순서" ? "↓" : join}</span> : null}
            {it.vs ? <span className="mm8-vs" title={it.vs.on || undefined}>{pill(byId.get(it.vs.a)!)}<span className="mm8-vsmark">vs{it.vs.on ? <em>{it.vs.on}</em> : null}</span>{pill(byId.get(it.vs.b)!)}</span> : pill(it.c!)}
          </span>)}</div> : null}
        {sub.length ? <>{!items.length && rel ? <div className={`mm8-relrow r-${g.members}`}><span className={`mm8-rel r-${g.members}`}>{rel}</span></div> : null}{g.members === "순서" && !items.length
          ? <div className="mm8-kids seq">{sub.map((k, i) => <Fragment key={k.id}>{i ? <span className="mm8-join seq" aria-hidden>↓{k.link ? <em>{k.link}</em> : null}</span> : null}{box(k, depth + 1)}</Fragment>)}</div>
          : <div className="mm8-kids">{ranked(sub).map((k) => box(k, depth + 1))}</div>}</> : null}
      </div>);
  };
  return (
    <div className={`mm8${openCard ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("[data-c],button,a,input,label,.mm8-detail")) setOpen(null); }}>
      <div className="row small mm7-bar"><span className="small muted">뜻으로 묶은 그림 · 상자 안은 그 부분 · 카드를 열면 다른 묶음의 짝</span><span className="cs-gap" />
        {data?.stale ? <span className="small bad">{s?.unit === "memory" ? "줄기가 바뀌었어요" : "줄기나 카드가 바뀌었어요"}</span> : null}{makeBtn("다시 만들기", Boolean(data?.stale))}</div>
      {roleView.has ? <div className="row small mm8-goalbar"><label className="row small" style={{ gap: 6, cursor: "pointer" }}><input type="checkbox" checked={roleOn} onChange={(e) => setRoleOn(e.target.checked)} /> 메인 포인트 보기</label>
        {roleOn ? <span className="muted">이 강의에서 새로 배우는 것이 위에 · 흐린 것은 바탕 지식(미리 알아야 할 것)·곁가지</span> : null}</div>
        : s ? <p className="small muted mm8-goalbar">구조를 다시 만들면 메인 포인트와 바탕 지식이 나뉘어 보여요.</p> : null}
      {error ? <p className="small bad">{error}</p> : null}
      {/* 11/8 사용자 "눌렀을 때 아래 칸이 덮어서 다시 누를 수 없다": 빈 곳을 누르면 닫히고, 연 카드는 아래 칸 위로 보이게 굴린다. */}
      <div className="mm8-wrap" ref={wrap} onMouseLeave={() => setHover(null)} onMouseOver={(e) => {
        // 가장 안쪽 것 하나만: 카드 위면 그 카드, 아니면 그 상자.
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-c],[data-g]");
        const next = t?.dataset.c ? { card: t.dataset.c } : t?.dataset.g ? { group: t.dataset.g } : null;
        if (next?.card !== hover?.card || next?.group !== hover?.group) setHover(next);
      }}>
        <div className="mm8-roots">{ranked(kids("")).map((g) => box(g, 0))}</div>
        {/* 11/9 사용자 "자료 지도에서 줄로 연결하는 건 빼자": 상자 사이·카드 짝 선을 그리지 않는다. 짝은 카드를 열면 아래 칸에 나온다. */}
      </div>
      {openCard ? <div className="mm8-detail mm6-card">
        <div className="mm3-dhead"><b><Rich text={openCard.title} /></b><span className="mm3-kind">{openCard.kind}</span>{openCard.core ? <span className="mm3-kind core">핵심</span> : null}<span className="cs-gap" />
          {openCard.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => setOpen(null)}>닫기</button></div>
        <Body s={openCard.shape} />
        {memById.get(openCard.id) && cardById.get(openCard.id) ? <>
          {memById.get(openCard.id)!.line ? <p className="small" style={{ margin: 0 }}><Rich text={memById.get(openCard.id)!.line} /></p> : null}
          {memById.get(openCard.id)!.facts?.length ? <ul className="st-facts">{memById.get(openCard.id)!.facts!.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul> : null}
          <FigureView genId={genId} c={openCard} onPage={onPage} /></>
          : memById.get(openCard.id) ? <>{memById.get(openCard.id)!.steps.length ? <p className="small" style={{ margin: 0 }}><Rich text={memById.get(openCard.id)!.line} /></p> : null}
          <div className="st-src"><span className="small muted">근거 카드 {memById.get(openCard.id)!.cards.length}</span>{memById.get(openCard.id)!.cards.map((id) => cardById.get(id)).filter((c): c is Card => !!c).map((c) =>
            <button key={c.id} className={`mm3-relchip${srcCard === c.id ? " on" : ""}`} onClick={() => setSrcCard(srcCard === c.id ? null : c.id)}><Rich text={c.title} /></button>)}</div>
          {srcCard && cardById.get(srcCard) && memById.get(openCard.id)!.cards.includes(srcCard) ? <div className="st-card"><Body s={cardById.get(srcCard)!.shape} /><FigureView genId={genId} c={cardById.get(srcCard)!} onPage={onPage} /></div> : null}</>
          : <FigureView genId={genId} c={openCard} onPage={onPage} all={cards} onCard={setOpen} />}
        {pairs.some((p) => p.a === openCard.id || p.b === openCard.id) ? <div className="mm3-rel"><span className="mm3-tag">다른 묶음의 짝</span><div className="mm3-relchips">
          {pairs.filter((p) => p.a === openCard.id || p.b === openCard.id).map((p, i) => { const other = p.a === openCard.id ? p.b : p.a; return <button key={i} className="mm3-relchip" onClick={() => setOpen(other)} title={p.why}>
            <Rich text={byId.get(other)?.title ?? ""} />{p.why && p.why.length <= 24 ? <em>{p.why}</em> : null}</button>; })}</div></div> : null}
        {openCard.questions && onPractice ? <div className="mm3-dfoot"><span className="cs-gap" /><button className="btn small primary" onClick={() => onPractice(openCard.pages[0], openCard.id)}>이 기억 문제 풀기 ({openCard.questions})</button></div> : null}
      </div> : null}
    </div>);
}

// 강의 (11/10 사용자 "카드 쥐어 주고 스토리라인을 짜서 카드를 보여 주면서 자연스러운 설명"): src/lib/study/lecture.ts가 이야기 줄기(AI 1번) →
// 장마다 설명(AI 1번씩 동시)을 쓰고, 화면은 걸음마다 강사의 말 + 그 걸음의 기억 카드. 장이 다 써지기 전에도 된 장부터 듣는다.
type LectureStepLite = { cards: string[]; point: string; say?: string };
type LectureChapterLite = { title: string; why: string; bridge: string; steps: LectureStepLite[]; status: string; check?: { after: number; question: string; answer: string; why: string } };
type LectureLite = { at: string; status: string; problem: string; chapters: LectureChapterLite[]; ms: number; error?: string };
function LecturePane({ genId, cards, onPage }: { genId: string; cards: Card[]; onPage: (page: number) => void }) {
  const [lec, setLec] = useState<LectureLite | null | undefined>(undefined);
  const [error, setError] = useState("");
  const key = `recaller:lecture:${genId}`;
  const [pos, setPosState] = useState<{ c: number; s: number }>(() => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); return v && typeof v.c === "number" ? v : { c: -1, s: 0 }; } catch { return { c: -1, s: 0 }; } });
  const setPos = (p: { c: number; s: number }) => { setPosState(p); setShowAnswer(false); try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage off */ } };
  const [showAnswer, setShowAnswer] = useState(false);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => call<{ lecture: LectureLite | null }>(`/api/study-map/${genId}/lecture`).then((r) => { if (!alive) return; setLec(r.lecture);
      if (r.lecture?.status === "writing") timer = setTimeout(load, 2000); }).catch((e) => { if (alive) { setLec(null); setError(errorText(e)); } });
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  const start = () => { setError(""); call<{ lecture: LectureLite | null }>(`/api/study-map/${genId}/lecture`, {}).then((r) => { setLec(r.lecture);
    const poll = () => call<{ lecture: LectureLite | null }>(`/api/study-map/${genId}/lecture`).then((x) => { setLec(x.lecture); if (x.lecture?.status === "writing") setTimeout(poll, 2000); }).catch(() => undefined);
    setTimeout(poll, 2000); }).catch((e) => setError(errorText(e))); };
  const ch = lec && pos.c >= 0 ? lec.chapters[pos.c] : undefined;
  const st = ch?.steps[pos.s];
  const ready = (c?: LectureChapterLite) => c?.status === "done";
  const next = () => { if (!lec) return; if (pos.c < 0) return setPos({ c: 0, s: 0 }); if (ch && pos.s < ch.steps.length - 1) return setPos({ c: pos.c, s: pos.s + 1 }); if (pos.c < lec.chapters.length - 1) setPos({ c: pos.c + 1, s: 0 }); };
  const prev = () => { if (!lec) return; if (pos.s > 0) return setPos({ c: pos.c, s: pos.s - 1 }); if (pos.c > 0) return setPos({ c: pos.c - 1, s: lec.chapters[pos.c - 1].steps.length - 1 }); setPos({ c: -1, s: 0 }); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest("input,textarea")) return; if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  if (lec === undefined) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (!lec || (lec.status === "failed" && !lec.chapters.some(ready))) return <div className="lc-empty">
    <p>기억 카드를 한 장씩 띄우며, 강사가 이 자료를 처음부터 끝까지 이야기로 설명해요.</p>
    <p className="small muted">처음 한 번 만들어요. 이야기 줄기를 짠 뒤 장마다 설명을 써서 1~2분쯤 걸리고, 첫 장이 되면 바로 들을 수 있어요.</p>
    {lec?.error ? <p className="small bad">{lec.error}</p> : null}{error ? <p className="small bad">{error}</p> : null}
    <button className="btn primary" onClick={start}>강의 만들기</button></div>;
  const total = lec.chapters.reduce((n, c) => n + c.steps.length, 0);
  const done = lec.chapters.slice(0, Math.max(0, pos.c)).reduce((n, c) => n + c.steps.length, 0) + (pos.c >= 0 ? pos.s + 1 : 0);
  const isLast = ch && pos.c === lec.chapters.length - 1 && pos.s === ch.steps.length - 1;
  const nextReady = pos.c < 0 ? ready(lec.chapters[0]) : ch && pos.s < ch.steps.length - 1 ? true : ready(lec.chapters[pos.c + 1]);
  const showCheck = ch?.check && pos.s + 1 === ch.check.after && ready(ch);
  return (
    <div className="lc">
      <ol className="lc-chapters">{lec.chapters.map((c, i) => <li key={i}><button className={`lc-chip${i === pos.c ? " on" : ""}${ready(c) ? "" : " wait"}`} disabled={!ready(c)} onClick={() => setPos({ c: i, s: 0 })}>
        <span className="mm3-num">{i + 1}</span><Rich text={c.title} />{c.status === "writing" || c.status === "waiting" ? <span className="small muted"> · 쓰는 중</span> : c.status === "failed" ? <span className="small bad"> · 실패</span> : null}</button></li>)}
        {lec.status === "writing" && !lec.chapters.length ? <li className="small muted">이야기 줄기를 짜는 중… (약 20~30초)</li> : null}</ol>
      {pos.c < 0 ? <section className="lc-stage">
        <p className="eyebrow">들어가며</p>
        <p className="lc-say">{lec.problem ? <Rich text={lec.problem} /> : "이야기 줄기를 짜는 중이에요…"}</p>
        {lec.chapters.length ? <ol className="lc-plan small">{lec.chapters.map((c, i) => <li key={i}><b><Rich text={c.title} /></b> <span className="muted"><Rich text={c.why} /></span></li>)}</ol> : null}
      </section> : ch && st ? <section className="lc-stage">
        <p className="eyebrow">{pos.c + 1}장 · <Rich text={ch.title} /> · {pos.s + 1}/{ch.steps.length}</p>
        {pos.s === 0 && ch.why ? <p className="small muted lc-why"><Rich text={ch.why} /></p> : null}
        {ready(ch) ? <p className="lc-say"><Rich text={st.say || st.point} /></p> : <p className="lc-say muted">이 장의 설명을 쓰는 중이에요… <span className="small">({st.point})</span></p>}
        <div className="lc-cards">{st.cards.map((cid) => byId.get(cid)).filter((c): c is Card => !!c).map((c) => <article key={c.id} className="lc-card">
          <header className="mm3-dhead"><b><Rich text={c.title} /></b><span className="mm3-kind">{c.kind}</span><span className="cs-gap" />
            {c.pages.slice(0, 3).map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}</header>
          {c.memo?.line ? <p className="lc-line"><Rich text={c.memo.line} /></p> : null}
          <Body s={c.shape} />
          {c.memo?.facts?.length ? <ul className="st-facts">{c.memo.facts.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul> : null}
          <FigureView genId={genId} c={c} onPage={onPage} />
        </article>)}</div>
        {showCheck && ch.check ? <div className="lc-check"><p className="eyebrow">잠깐, 직접 따져 봐요</p><p><Rich text={ch.check.question} /></p>
          {showAnswer ? <p className="small"><b><Rich text={ch.check.answer} /></b> <Rich text={ch.check.why} /></p> : <button className="btn ghost small" onClick={() => setShowAnswer(true)}>답 보기</button>}</div> : null}
        {pos.s === ch.steps.length - 1 && ch.bridge && ready(ch) ? <p className="small muted lc-bridge"><Rich text={ch.bridge} /></p> : null}
      </section> : null}
      <div className="row lc-nav"><button className="btn ghost small" disabled={pos.c < 0} onClick={prev}>‹ 이전</button><span className="small muted num">{done}/{total}</span><span className="cs-gap" />
        {isLast ? <span className="small muted">강의 끝</span> : <button className="btn primary small" disabled={!nextReady} onClick={next}>{pos.c < 0 ? "시작" : nextReady ? "다음 ›" : "다음 장 쓰는 중…"}</button>}</div>
    </div>);
}

function SummaryPane({ summary, making }: { summary: Summary | null | undefined; making: boolean }) {
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
type Step = { label: string; state: "done" | "now" | "wait"; note?: string };
function Steps({ steps }: { steps: Step[] }) {
  return <ol className="mm5-steps" aria-label="만드는 단계">{steps.map((st) => (
    <li key={st.label} className={`mm5-step ${st.state}`}><span className="mm5-dot" aria-hidden />{st.label}{st.note ? <span className="mm5-note num"> {st.note}</span> : null}
      <span className="sr-only">{st.state === "done" ? " 끝남" : st.state === "now" ? " 하는 중" : " 기다림"}</span></li>))}</ol>;
}

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
function Typed({ text, caret }: { text: string; caret?: boolean }) {
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

// 사용자 10/30: the map is where a material is studied (no reading screen): 원문 opens one page over it, 문제 풀기 starts that
// page's questions, and a material made without questions gets them here (문제 만들기).
export default function MaterialMap({ genId, onPage, onPractice, onPracticeAll, onMakeQuestions, onClose }: { genId: string; onPage: (page: number) => void;
  onPractice?: (page: number, cardId: string) => void;
  /** 만든 문제부터 풀기 (11/6): the questions made so far, even while the material is still being made. */
  onPracticeAll?: () => void;
  onMakeQuestions?: () => Promise<boolean>; onClose: () => void }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [asking, setAsking] = useState(false);
  const [reload, setReload] = useState(0);
  const [live, setLive] = useState<LiveData | null>(null);
  const [board, setBoard] = useState<"live" | "leaving" | "off">("off");
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"all" | "unknown" | "new">("all");
  // 11/6 사용자: 목차별·개념별을 빼고 위에 [요약 | 지식] 두 탭. 지식은 목차(자료의 순서)로만 보인다.
  const view = "outline" as const;
  // 11/9 사용자 "기존 목록형 탭으로 돌아가지 않게": 고른 탭을 기억하고(원문을 보고 돌아와도, 다시 열어도), 불러오는 동안 [기억] 목록으로 떨어지지 않는다.
  type Tab = "summary" | "structure" | "knowledge" | "lecture";
  const [tab, setTabState] = useState<Tab | null>(() => { try { const t = localStorage.getItem("recaller:map-tab"); return t === "summary" || t === "structure" || t === "knowledge" || t === "lecture" ? t : null; } catch { return null; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem("recaller:map-tab", t); } catch { /* storage off */ } };
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined);
  const [digest, setDigest] = useState<DigestLite | null | undefined>(undefined);
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
      .then((r) => { if (!alive) return; setMap(r.map); setError(""); if (["queued", "running"].includes(r.map.status)) timer = setTimeout(load, 3000); }) // 11/5: 멈춘(이어 만들기) 실행은 다시 묻지 않음
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
      if (r.summary !== undefined) setSummary(r.summary);
      // Nothing written yet: a run still reading its pages is waited for; a finished or stopped one has no board.
      if (!r.live && !pages.size) { if (!["queued", "running"].includes(r.status) || ++misses > 120) { setBoard("off"); return; } timer = setTimeout(poll, 800); return; }
      else if (all) { setBoard((b) => (b === "live" ? "leaving" : b)); setTimeout(() => { if (alive) setBoard("off"); }, 900); return; }
      else setBoard("live");
      timer = setTimeout(poll, 350);
    }).catch(() => { if (alive) timer = setTimeout(poll, 1500); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  // 요약은 카드가 다 써진 뒤에도 이어 쓰일 수 있어, 끝날 때까지 따로 받는다.
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, idle = 0;
    const poll = () => call<LiveData>(`/api/study-map/${genId}/live?since=${Date.now() + 60_000}`).then((r) => {
      if (!alive) return;
      setSummary(r.summary ?? null);
      setDigest(r.digest ?? null);
      const running = ["queued", "running"].includes(r.status);
      // 목차 (11/6): the outline streams and cards attach to it, so the live state is read while the run goes on.
      if (r.summary?.status === "writing" || (running && ++idle < 600)) timer = setTimeout(poll, r.summary?.status === "writing" ? 600 : 1200);
    }).catch(() => { if (alive) timer = setTimeout(poll, 2000); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const titles = useMemo(() => new Map(map?.sections.flatMap((s) => s.cards.map((c) => [c.id, c.title] as const)) ?? []), [map]);
  const everyCard = useMemo(() => map?.sections.flatMap((s) => s.cards) ?? [], [map]);
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
  // 단계: 자료 읽기 → 요약 → 지식 카드 → 핵심·연결 정리 → (문제). 있는 정보로만 판단한다(엔진이 따로 알려 주지 않아도).
  const running = map ? map.status !== "done" : true;
  const pagesIn = live ? live.outline.filter((o) => live.pages.find((p) => p.page === o.page)?.done).length : 0;
  const cardsN = map?.counts.cards ?? 0;
  const steps: Step[] = [
    { label: "자료 읽기", state: live?.outline.length || cardsN || summary?.text ? "done" : "now" },
    ...(summary ? [{ label: "요약", state: (summary.status === "done" || summary.status === "failed" ? "done" : summary.status === "writing" ? "now" : running ? "wait" : "done") as Step["state"],
      note: summary.status === "failed" ? "못 씀" : summary.ms ? `${Math.round(summary.ms / 1000)}초` : undefined }]
      : [{ label: "목차", state: (digest?.skeleton?.status === "done" ? "done" : digest?.skeleton?.text ? "now" : running ? "now" : "done") as Step["state"],
        note: digest?.skeleton?.topics.length ? `주제 ${digest.skeleton.topics.length}` : undefined }]),
    { label: "기억 카드", state: !running || map?.topics?.length ? "done" : cardsN || board === "live" ? "now" : "wait",
      note: cardsN ? `${cardsN}개` : board === "live" && live?.outline.length ? `${pagesIn}/${live.outline.length}쪽` : undefined },
    { label: "핵심·연결 정리", state: map?.topics?.length || !running ? "done" : cardsN && board === "off" ? "now" : "wait" },
    ...(map && !map.questionsLater ? [{ label: "문제", state: (!running ? "done" : map.topics?.length ? "now" : "wait") as Step["state"], note: map.counts.questions ? `${map.counts.questions}개` : undefined }] : []),
  ];
  // 목차가 있으면(엔진의 목차 → 카드) 첫 탭은 목차, 예전 실행의 정리 글은 요약으로 그대로 보인다.
  const hasOutline = Boolean(digest?.skeleton && (digest.skeleton.topics.length || digest.skeleton.text));
  const firstLabel = summary && !hasOutline ? "요약" : "줄기";
  const noFirst = digest !== undefined && summary !== undefined && !hasOutline && !(summary && (summary.text || summary.status === "writing"));
  const picked = (tab === "structure" && !(hasOutline || !summary)) || (tab === "lecture" && running) ? null : tab;
  const shownTab: Tab = picked ?? (noFirst ? "knowledge" : "summary");
  const tabs = <div className="ws-seg mm5-tabs" role="group" aria-label="자료 지도 보기">{([["summary", firstLabel], ...(hasOutline || !summary ? [["structure", "구조"] as const] : []), ["knowledge", "기억"], ...(running ? [] : [["lecture", "강의"] as const])] as const).map(([k, label]) =>
    <button key={k} className={shownTab === k ? "on" : ""} aria-pressed={shownTab === k} onClick={() => setTab(k)}>{label}{k === "knowledge" && running ? <span className="mm5-badge">만드는 중</span> : null}</button>)}</div>;
  if (!map) return <div className="mm2 mm3"><div className="mm2-head"><div><p className="eyebrow">자료 지도</p><b>{hasOutline ? "목차가 나오는 중…" : "자료를 읽는 중…"}</b></div><button className="btn ghost small" onClick={onClose}>닫기</button></div>
    <Steps steps={steps} />{tabs}
    {shownTab === "summary" ? (hasOutline || !summary ? <OutlinePane genId={genId} digest={digest} cards={[]} making onPage={onPage} onPractice={onPractice} /> : <SummaryPane summary={summary} making />)
      : shownTab === "structure" ? <p className="small muted">기억 카드가 다 만들어지면 구조를 만들 수 있어요.</p>
      : board !== "off" && live ? <LiveBoard data={live} />
      : <p className="small muted">{error || "목차 항목마다 기억을 만드는 중이에요. 다 되면 여기에 목차별로 보여요."}</p>}</div>;
  const shown = (c: Card) => !isFlowCard(c) && (!coreOnly || c.core) && (only === "all" || (only === "unknown" ? c.state === "unknown" : c.state === "new" || c.state === "met"));
  const n = map.counts;
  const making = map.status !== "done";
  const visible = groups.map((g) => ({ ...g, list: g.cards.filter(shown) })).filter((g) => g.list.length);
  const allOpen = visible.length > 0 && visible.every((g) => openGroups.has(g.key));
  // State dots say something only once the learner has answered (all 만남 at first is one colour, noise).
  const marked = Boolean(n.unknown || n.known || n.graduated);
  return (
    <div className={`mm2 mm3${shownTab === "structure" ? " mm3-wide" : ""}`} role="dialog" aria-label="자료 지도">
      <div className="mm2-head">
        <div><p className="eyebrow">자료 지도</p><b>{map.title.replace(/\.pdf$/i, "")}</b>
          <span className="small muted"> · {map.pages}쪽 · 기억 {n.cards}{n.core !== undefined && map.topics?.length ? ` · 핵심 ${n.core}` : ""}{map.questionsLater ? "" : ` · 문제 ${n.questions}`}</span>
          {making ? <span className="small mm3-making"> · {board !== "off" ? "카드 쓰는 중" : map.questionsLater ? (n.cards ? "기억 정리 중" : "자료 읽는 중") : map.topics?.length ? "문제 만드는 중" : n.cards ? "기억 정리 중" : "자료 읽는 중"}…</span> : null}</div>
        <span className="row small">
          {map.questionsLater && !making && n.cards && onMakeQuestions ? <button className="btn small primary" disabled={asking} title="기억마다 확인 문제를 만들어 연습·복습에 붙여요"
            onClick={() => { setAsking(true); void onMakeQuestions().then((ok) => { if (ok) setReload((k) => k + 1); }).finally(() => setAsking(false)); }}>{asking ? "시작하는 중…" : "문제 만들기"}</button> : null}
          {!map.questionsLater && n.questions && onPracticeAll ? <button className="btn small primary" title={making ? "지금까지 만들어진 문제부터 풀어요. 나머지는 계속 만들어져요." : "이 자료의 문제를 풀어요."}
            onClick={onPracticeAll}>{making ? `만든 문제부터 풀기 (${n.questions})` : `문제 풀기 (${n.questions})`}</button> : null}
          <button className="btn ghost small" onClick={onClose}>닫기</button>
        </span>
      </div>
      {making ? <Steps steps={steps} /> : null}
      {tabs}
      {shownTab === "summary" ? (hasOutline || !summary ? <StemPane genId={genId} digest={digest} cards={map.sections.flatMap((x) => x.cards)} making={making} onPage={onPage} onPractice={onPractice} />
        : <SummaryPane summary={summary} making={making} />)
      : shownTab === "structure" ? <StructurePane genId={genId} cards={map.sections.flatMap((x) => x.cards)} chains={map.chains} making={making} onPage={onPage} onPractice={onPractice} />
      : shownTab === "lecture" ? <LecturePane genId={genId} cards={map.sections.flatMap((x) => x.cards)} onPage={onPage} /> : <>
      {making ? <p className="small mm5-note-line">기억은 목차 항목마다 조금씩 만들어져요. 다 되기 전에도 지금까지 된 것을 볼 수 있어요.</p> : null}
      <div className="row small mm3-tools">
        {map.topics?.length ? <label className="row small"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 핵심만</label> : null}
        {n.unknown || n.known || n.graduated ? <div className="ws-seg">{([["all", "전체"], ["unknown", "다시 볼 것"], ["new", "아직 확인 안 한 것"]] as const).map(([k, label]) =>
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
                  {map.topicNotes?.[g.title] ? <span className="mm3-gist"><Rich text={map.topicNotes[g.title]} /></span> : null}</span>
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
                          {/* [경계] 2026-11-02 A (점검_UIUX화면연결 4번): 지도에서 이 지식의 내 상태와 지식창으로 가는 길 */}
                          {c.state !== "new" && c.state !== "met" && c.state !== "unknown" ? <span className={`chip ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span> : null}
                          <span className="cs-gap" />
                          {c.knowledgeId ? <button className="btn ghost small" onClick={() => { const id = c.knowledgeId!; onClose(); go("knowledge", { id }); }} title="기억창에서 이 기억의 뜻·기록·이어진 기억 보기">기억창에서 보기</button> : null}
                          {c.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)} title="이 쪽 원문으로">원문 p.{p}</button>)}
                        </div>
                        <Body s={c.shape} />
                        <FigureView genId={genId} c={c} onPage={onPage} all={everyCard} onCard={jump} />
                        {links.length ? <div className="mm3-rel"><span className="mm3-tag">이어지는 기억</span>
                          <div className="mm3-relchips">{links.map((x, i) =>
                            <button key={i} className="mm3-relchip" onClick={() => jump(x.to)} title={x.what || undefined}>
                              <span className="mm3-arrow">{x.back ? "←" : "→"}</span><Rich text={titles.get(x.to) ?? ""} />{x.what && x.what.length <= 20 ? <em>{x.what}</em> : null}</button>)}</div></div> : null}
                        {c.same.length || c.questions ? <div className="mm3-dfoot">
                          {c.same.length ? <span className="small muted">같은 내용: {c.same.map((x) => range(x.pages)).join(", ")}</span> : null}
                          <span className="cs-gap" />
                          {c.questions ? <button className="btn small primary" onClick={() => onPractice ? onPractice(c.pages[0], c.id) : onPage(c.pages[0])}>이 기억 문제 풀기 ({c.questions})</button> : null}
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
      {!visible.length ? <p className="small muted">{making ? "기억을 정리하는 중… 첫 카드까지 5~10초쯤 걸려요." : "고른 조건에 맞는 기억이 없어요."}</p> : null}
      </div>}
      </>}
    </div>
  );
}
