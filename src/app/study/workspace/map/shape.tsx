"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): 자료 지도 카드 한 장의 모양: 식(행렬 · 경우 나눔) · 기호 · 단계 · 비교 · 한 줄 요약 · 그림 · 몫 칩 · 답 · 강의 카드.
import { useState } from "react";
import { Rich as RichBlock, RichInline as Rich } from "../Rich";


export type Shape =
  | { form: "term"; name: string; symbol: string; definition: string; neighbors: string[] }
  | { form: "fact"; subject: string; value: string }
  | { form: "list"; name: string; items: string[]; ordered: boolean }
  | { form: "rule"; premise: string; condition: string; result: string; boundary: string }
  | { form: "procedure"; steps: Array<{ action: string; input: string; output: string }> }
  | { form: "formula"; expr: string; vars: Array<{ symbol: string; meaning: string }>; when: string }
  | { form: "compare"; targets: string[]; criteria: Array<{ name: string; values: string[] }> }
  | { form: "concept"; claim: string; reason: string; limit: string }
  | { form: "pattern"; frame: string; slots: string[]; example: string };
export type MapState = "new" | "met" | "unknown" | "known" | "graduated";
export type Card = { id: string; ref: string; kind: string; title: string; core: boolean; shape: Shape; pages: number[]; quotes: string[]; mistakes: string[];
  takes: string[]; gives: string[]; questions: number; same: Array<{ id: string; pages: number[] }>; state: MapState; knowledgeId?: string; dueAt?: string; topic?: string;
  figure?: { page: number; role: string; says: string; file: string; mode?: string };
  memo?: { question?: string; line?: string; answer?: string; idea?: string; facts?: string[]; details?: string[]; role?: string } };
export type Section = { id: string; title: string; pages: number[]; cards: Card[] };
export type MatMap = { id: string; title: string; status: string; pages: number; sections: Section[]; chains: Array<{ from: string; to: string; what: string; by?: string }>;
  topics?: string[]; topicNotes?: Record<string, string>; principles?: Array<{ title: string; line: string; cardIds: string[] }>; counts: Record<MapState, number> & { cards: number; questions: number; core?: number };
  questionsLater?: boolean };

export const STATE: Record<MapState, [string, string]> = { unknown: ["몰랐음", "bad"], met: ["아직", ""], known: ["앎", "good"], graduated: ["졸업", "good"], new: ["아직", ""] };
export const range = (pages: number[]) => !pages.length ? "" : pages.length === 1 ? `p.${pages[0]}` : `p.${Math.min(...pages)}–${Math.max(...pages)}`;

// A formula with its matrices drawn as grids (MathML's matrices came out cramped and misaligned): the text between them stays math.
export function splitMatrices(expr: string): Array<{ text: string } | { rows: string[][] }> {
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
export const tex = (x: string) => (/[_^\\{}=]/.test(x) || /^[A-Za-z]$/.test(x.trim()) ? `$${x}$` : x);
// 경우 나눔 식(11/11 버그: "I = { a, if c; b, if d }"를 ;에서 잘라 괄호가 갈라져 빨갛게 깨짐): 평문 경우 식을 cases로.
export const mathSym = (x: string) => x.replace(/·/g, " \\cdot ").replace(/≤/g, " \\le ").replace(/≥/g, " \\ge ").replace(/≠/g, " \\ne ").replace(/×/g, " \\times ");
/** 괄호 밖의 ;에서만 나눈다. */
export function splitTop(x: string, sep = ";") { const out: string[] = []; let d = 0, cur = ""; for (const ch of x) { if ("({[".includes(ch)) d++; if (")}]".includes(ch)) d--; if (ch === sep && d === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((y) => y.trim()).filter(Boolean); }
export function piecewiseTex(expr: string): string | null {
  const m = /^\s*(.*?=)\s*\{([\s\S]*)\}\s*$/.exec(expr);
  if (!m || !/\b(if|otherwise)\b|일 때|그 밖/.test(m[2])) return null;
  const rows = splitTop(m[2]).map((piece) => {
    const c = /^(.*?)(?:,\s*|\s+)(if\s+.+|otherwise|그 밖.*|.+일 때)$/.exec(piece);
    if (!c) return mathSym(piece);
    const cond = c[2].replace(/^if\s+/, "");
    return `${mathSym(c[1])} & ${/^otherwise$/.test(c[2]) ? "\\text{otherwise}" : `\\text{if } ${mathSym(cond)}`}`;
  });
  return `$${mathSym(m[1])} \\begin{cases} ${rows.join(" \\\\ ")} \\end{cases}$`;
}
export function Formula({ expr }: { expr: string }) {
  if (expr.includes("$")) return <div className="mm3-formula"><Rich text={expr} /></div>;
  const cases = piecewiseTex(expr);
  if (cases) return <div className="mm3-formula"><div className="mm3-eq"><Rich text={cases} /></div></div>;
  // "a; b; c": one equation per line (괄호 안의 ;는 자르지 않는다).
  const lines = splitTop(expr);
  return <div className="mm3-formula">{lines.map((line, k) => <div key={k} className="mm3-eq">{splitMatrices(line).map((part, i) => "rows" in part
    ? <span key={i} className="mm3-matrix" style={{ gridTemplateColumns: `repeat(${Math.max(...part.rows.map((r) => r.length))}, auto)` }}>
        {part.rows.flatMap((r, ri) => r.map((cell, ci) => <span key={`${ri}-${ci}`}><Rich text={tex(cell)} /></span>))}</span>
    : <Rich key={i} text={tex(part.text.trim())} />)}</div>)}</div>;
}

// 11/11 사용자 "약어 하나씩 다 설명해 주잖아" → "접기 가자": 식의 기호 뜻은 접어 두고 눌러야 펼친다.
export function VarList({ vars }: { vars: Array<{ symbol: string; meaning: string }> }) {
  const [open, setOpen] = useState(false);
  return <div className="mm3-varsbox">
    <button className="lc3-detailsbtn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open}>{open ? "기호 뜻 접기" : `기호 뜻 ${vars.length}개`}</button>
    {open ? <dl className="mm3-vars">{vars.map((v, i) => <div key={i}><dt><Rich text={v.symbol.includes("$") ? v.symbol : tex(v.symbol)} /></dt><dd><Rich text={v.meaning} /></dd></div>)}</dl> : null}</div>;
}
export function Body({ s }: { s: Shape }) {
  switch (s.form) {
    case "procedure": return <ol className="mm3-steps">{s.steps.map((st, i) => <li key={i}><span className="mm3-stepn">{i + 1}</span><div><Rich text={st.action} />{st.output ? <div className="mm3-stepio"><Rich text={`→ ${st.output}`} /></div> : null}</div></li>)}</ol>;
    case "rule": return <div className="mm3-body"><p className="mm3-rule"><span className="mm3-tag">조건</span><Rich text={s.condition} /></p><p className="mm3-rule"><span className="mm3-tag">결과</span><b><Rich text={s.result} /></b></p>
      {s.premise ? <p className="mm3-when"><span className="mm3-tag">전제</span><Rich text={s.premise} /></p> : null}{s.boundary ? <p className="mm3-when"><span className="mm3-tag">경계</span><Rich text={s.boundary} /></p> : null}</div>;
    case "formula": return <div className="mm3-body"><Formula expr={s.expr} />
      {s.when ? <p className="mm3-when"><span className="mm3-tag">쓸 때</span><Rich text={s.when} /></p> : null}
      {s.vars.length ? <VarList vars={s.vars} /> : null}</div>;
    case "compare": return <div className="mm2-tablewrap"><table className="mm2-table"><thead><tr><th />{s.targets.map((t) => <th key={t}><Rich text={t} /></th>)}</tr></thead>
      <tbody>{s.criteria.map((c) => <tr key={c.name}><th><Rich text={c.name} /></th>{s.targets.map((_, i) => <td key={i}><Rich text={c.values[i] ?? ""} /></td>)}</tr>)}</tbody></table></div>;
    case "list": return s.ordered ? <ol className="mm3-steps">{s.items.map((it, i) => <li key={i}><span className="mm3-stepn">{i + 1}</span><div><Rich text={it} /></div></li>)}</ol> : <ul className="mm3-bullets">{s.items.map((it, i) => <li key={i}><Rich text={it} /></li>)}</ul>;
    // 표기(기호) 11/8 사용자 "요청 간선 P→R 표기가 안 보여": 카드에는 있었는데 그리지 않았다.
    case "term": return <div className="mm3-body"><p className="mm3-lead"><Rich text={s.definition} /></p>
      {s.symbol ? <p className="mm3-when"><span className="mm3-tag">표기</span><Rich text={s.symbol.includes("$") ? s.symbol : tex(s.symbol)} /></p> : null}{s.neighbors.length ? <p className="mm3-when"><span className="mm3-tag">헷갈리는 말</span><Rich text={s.neighbors.join(", ")} /></p> : null}</div>;
    case "fact": return <p className="mm3-lead"><Rich text={s.value} /></p>;
    // 11/11 사용자 "왜, 한계 안 보이게": 개념은 무엇(claim)만 보인다. 왜·한계는 데이터로 남아 문제 만들기에 쓰인다.
    case "concept": return <div className="mm3-body"><p className="mm3-lead"><Rich text={s.claim} /></p></div>;
    case "pattern": return <p><Rich text={s.frame} />{s.example ? <span className="small muted"> · 예: <Rich text={s.example} /></span> : null}</p>;
  }
}

// Matrices the engine writes as nested lists ([[1, 0, t_x], [0, 1, t_y], [0, 0, 1]]) read as matrices.
export function matrices(expr: string): string {
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
export const asLine = (expr: string) => (expr.includes("$") ? expr : `$${matrices(expr).replace(/\\begin\{bmatrix\}[\s\S]*?\\end\{bmatrix\}/g, "[\\cdots]")}$`);

// One line per piece of knowledge: what to recall at a glance (the formula itself, a rule's condition → result, a procedure's
// steps). The whole shape opens on a click.
export function keyLine(s: Shape): string {
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

export const isFlowCard = (c: Card) => c.title.startsWith("흐름: ");
// 카드에 붙은 그림 (11/8): 잘라 둔 그림 + 역할 + 그림 설명 한 줄. 누르면 원문 쪽으로.
export const FIG_ROLE: Record<string, string> = { 근거: "근거", 장면: "장면", 그림풀이: "그림풀이" };
// 같은 그림을 쓰는 다른 카드(그림 하나가 여러 개념을 설명, 11/8): 이름을 보이고 누르면 그 카드로.
export function FigureView({ genId, c, onPage, all = [], onCard }: { genId: string; c: Card; onPage: (page: number) => void; all?: Card[]; onCard?: (id: string) => void }) {
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
/** 자세히(11/11): 외울 핵심은 아닌 참고 — 눌러야 보인다. */
/** 질문 하나 · 답 하나 카드의 답(11/11 lab.cardQA): 한 줄이면 한 줄, 단계·식·표가 있으면 그 모양 그대로(마크다운) */
/** 목록 한 줄 (11/12 점검 16번): 늘 답의 첫 줄. 답이 표뿐이면 질문 대신 표 머리("대상 · 기준 (표)"). */
export function rowLine(c: Card): string {
  const m = c.memo;
  if (m?.answer) {
    const lines = m.answer.split("\n").map((x) => x.trim()).filter(Boolean);
    const text = lines.find((x) => !x.startsWith("|"));
    if (text) return text.replace(/^(\d+[.)]|[-*•])\s+/, "");
    const head = (lines[0] ?? "").split("|").map((x) => x.trim()).filter(Boolean);
    if (head.length) return `${head.join(" · ")} (표)`;
  }
  return m?.line || keyLine(c.shape);
}
/** 기억의 몫 (11/12 사용자 "바탕 · 곁이랑 메인을 다르게 표시"): 메인 = 이 강의에서 새로 배우는 것, 바탕 = 미리 알아야 할 것을 다시 적은 것, 곁 = 곁가지 */
export type Role = "메인" | "바탕" | "곁";
export const roleOfCard = (c: Card): Role => (c.memo?.role === "바탕" || c.memo?.role === "곁" ? c.memo.role : "메인");
// 칩 글자는 사용자 11/12 "메인, 곁가지 → main, sub"
export const ROLE_CHIP: Record<Role, [string, string]> = { 메인: ["main", "이 강의에서 새로 배우는 것"], 바탕: ["바탕", "미리 알아야 할 것을 다시 적은 것"], 곁: ["sub", "알아 두면 좋은 곁 내용"] };
export function RoleChip({ role }: { role: Role }) {
  return <span className={`role-chip role-${role === "메인" ? "main" : role === "바탕" ? "base" : "side"}`} title={ROLE_CHIP[role][1]}>{ROLE_CHIP[role][0]}</span>;
}
export const roleClass = (r: Role) => ` role-${r === "메인" ? "main" : r === "바탕" ? "base" : "side"}`;
export function Answer({ text }: { text: string }) {
  return <div className="lc3-ca mm3-a mm3-ans"><span className="lc3-qtag a">A</span><RichBlock text={text} /></div>;
}
/** 예전 세 겹 카드의 나머지(풀이 · 모양 · 자세히)를 하나로 접어 둔다 (11/12 사용자 "네 개 뜨면 어디 집중할지 모르겠다"). 덧붙임은 화면에서 뺐다(사용자 "덧붙임 갖다 버려"). */
// 모양이 단계 · 식 · 비교표 · 목록이면 답에 없는 내용이라 펼친 채로 두고(11/12 사용자: 원 그리기 카드의 단계는 제 몫을 한다), 정의 · 주장 · 사실처럼
// 답을 다시 말하기 쉬운 모양만 접는다.
export const SHOWN_FORMS = new Set(["procedure", "formula", "compare", "list"]);
export function OldMore({ idea, shape, details }: { idea?: string; shape: Shape; details?: string[] }) {
  const [open, setOpen] = useState(false);
  const shown = SHOWN_FORMS.has(shape.form);
  const rest = Boolean(idea || !shown || details?.length);
  return <>{shown ? <Body s={shape} /> : null}{rest ? <div className="lc3-details">{open ? <>
    {idea ? <div className="lc3-idea"><span className="lc3-ideatag">풀이</span><Rich text={idea} /></div> : null}
    {shown ? null : <Body s={shape} />}
    {details?.length ? <ul className="st-facts lc3-detaillist">{details.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul> : null}
    <button className="lc3-detailsbtn" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>접기</button></>
    : <button className="lc3-detailsbtn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>자세히</button>}</div> : null}</>;
}
export function CardDetails({ items }: { items?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return <div className="lc3-details">{open ? <><p className="lc3-detailshead small muted">자세히 (참고)</p><ul className="st-facts lc3-detaillist">{items.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul>
    <button className="lc3-detailsbtn" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>접기</button></> : <button className="lc3-detailsbtn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>자세히 {items.length}</button>}</div>;
}
// 카드 세 겹(11/11 사용자 "중요 내용 · 보이는 부분은 의미 전달 · 문제로 바꿀 때도 도움"): 앞면 = 이름 + 질문 + 답 한 줄, 펼치면 핵심(모양 · 덧붙임), 자세히는 눌러야.
export function LectureCard({ genId, c, onPage, startOpen = false }: { genId: string; c: Card; onPage: (page: number) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const role = roleOfCard(c);
  return <div className={`lc3-card${open ? " open" : ""}${roleClass(role)}`}>
    <button className="lc3-cardhead" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open}>
      <span className="lc3-cardtag">{role === "메인" ? "기억 카드" : role === "바탕" ? "바탕 지식" : "sub"}</span>
      <span className="lc3-cardtitle"><Rich text={c.title} /></span>
      <span className="lc3-cardline">{c.memo?.question ? <span className="lc3-cq"><span className="lc3-qtag">Q</span><Rich text={c.memo.question} /></span> : null}
        {/* 11/12 사용자 "A가 답이면 Q 밑의 줄은 뭐냐": 그 줄은 답의 첫 줄(접었을 때 미리 보기)이라, 펼치면 A와 겹친다 — 질문·답 카드는 펼치면 숨기고, 접었을 때도 'A' 표시를 붙여 답 미리 보기임을 밝힌다 */}
        {c.memo?.line && !(open && c.memo.answer) ? <span className="lc3-ca">{c.memo.answer ? <span className="lc3-qtag a">A</span> : null}<Rich text={c.memo.answer ? rowLine(c) : c.memo.line} /></span> : null}</span>
      <span className="lc3-chev" aria-hidden>›</span>
    </button>
    {open ? <div className="lc3-cardbody">{c.memo?.answer ? <><Answer text={c.memo.answer} /><CardDetails items={c.memo.details} /></> : c.memo?.line ? <OldMore idea={c.memo.idea} shape={c.shape} details={c.memo.details} /> : <Body s={c.shape} />}
      <FigureView genId={genId} c={c} onPage={onPage} />
      <div className="lc3-pages">{c.pages.slice(0, 4).map((p) => <button key={p} className="lc3-pagechip" onClick={() => onPage(p)}>원문 p.{p}</button>)}</div></div> : null}</div>;
}
