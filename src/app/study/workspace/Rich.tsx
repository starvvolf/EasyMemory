import { Fragment, useEffect, useState, type ReactNode } from "react";
// 11/11 사용자 "렌더링이 조잡하게 느껴져": 브라우저 기본 MathML 대신 KaTeX 글꼴·조판(html)으로. 스타일은 여기서 같이 불러 Rich를 쓰는 어느 화면에서나.
import "katex/dist/katex.min.css";

/* ---------- math: $…$ and bare subscripts (z_{vp}, P_0, y_view) as KaTeX, like the study screen ---------- */
type Katex = { renderToString(tex: string, options: Record<string, unknown>): string };
let katex: Katex | null = null;
let loading: Promise<void> | null = null;
function useKatex() {
  const [ready, setReady] = useState(Boolean(katex));
  useEffect(() => {
    if (katex) return;
    let live = true;
    loading ??= import("katex").then((m) => { katex = ((m as { default?: Katex }).default ?? m) as Katex; }, () => undefined);
    void loading.then(() => { if (live && katex) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready ? katex : null;
}
/** One formula, KaTeX html (글꼴·간격이 KaTeX 것). 화면 읽기용 MathML도 함께 붙는다(htmlAndMathml, 스타일이 MathML을 가린다). */
export function TeX({ tex, display = false }: { tex: string; display?: boolean }) {
  const k = useKatex();
  if (!k) return <span className={display ? "ws-math ws-math-d" : "ws-math"}>{tex}</span>;
  // 따로 떼어 쓴 식(11/11 사용자 "수식이 위엄이 없음"): 가운데·크게, 분수는 펴서(displayMode)
  if (display) return <span className="ws-math ws-math-d" dangerouslySetInnerHTML={{ __html: k.renderToString(tex, { output: "htmlAndMathml", displayMode: true, throwOnError: false, strict: "ignore", trust: false }) }} />;
  // KaTeX escapes its input and trust is off: this is markup KaTeX built, not text from the learner as HTML.
  return <span className="ws-math" dangerouslySetInnerHTML={{ __html: k.renderToString(tex, { output: "htmlAndMathml", throwOnError: false, strict: "ignore", trust: false }) }} />;
}
/**
 * Knowledge text keeps formulas without $ (z_{vp}, P_0, y_view, xw_{min}): short names with a subscript or superscript
 * become $…$. Longer words with "_" (lower_bound, snake_case) stay text; so do $ amounts ("$5 and $10").
 */
const BARE = /(?<![\w$\\])([A-Za-z]{1,2}(?:_\{[^{}\s]{1,16}\}|_[A-Za-z0-9]{1,4})(?:\^\{[^{}]{1,8}\}|\^[A-Za-z0-9])?|[A-Za-z]\^\{[^{}]{1,8}\})(?![\w{])/g;
const isTex = (inner: string) => /[\\_^{}=|]/.test(inner) || /^[A-Za-z]$/.test(inner) || /^[-−+]\s?[A-Za-z]{1,2}\d?$/.test(inner.trim()) // -u 같은 짧은 식(11/11)
  || /^[A-Za-z0-9]{1,4}(?:\([A-Za-z0-9, ]{1,12}\))?$/.test(inner) // $P0$ $1$ $P(S)$ 같은 짧은 이름·숫자·함수꼴 (11/11, 강의에서 $가 그대로 보임)
  // 그리스 문자·수학 기호가 든 짧은 식(11/12 질문·답 카드 "$Δx$", "$0 ≤ m ≤ 1$", "$2Δy − 2Δx$"가 그대로 보임). 한글이 든 것은 글로 둔다.
  || (/[Α-Ωα-ω≤≥−×·→←∑√∞≠±∈∉⊂∩∪∠°]/.test(inner) && !/[가-힣]/.test(inner) && inner.length <= 80)
  // 쉼표로 늘어놓은 기호(11/12 "$A,B,C$"가 그대로 보임): 한두 글자 이름·숫자만 쉼표로 이은 것. 돈 표기("$5 and $")는 낱말이 있어 걸리지 않는다
  || /^\s*[A-Za-z0-9]{1,2}(?:'|_\w+)?(?:\s*,\s*[A-Za-z0-9]{1,2}(?:'|_\w+)?)+\s*$/.test(inner)
  // 괄호로 묶은 좌표·순서쌍(11/12 "$(0, 0)$")
  || /^\s*\(\s*[A-Za-z0-9.]{1,6}(?:\s*,\s*[A-Za-z0-9.]{1,6})+\s*\)\s*$/.test(inner);
/*
 * Formulas written with plain signs (n = N/|N|, u = (V × n)/|V × n|, P_0=(x_0,y_0,z_0)): a run of one- or two-letter
 * names, digits and signs that holds = or × becomes one $…$, cut where its brackets close.
 */
const TOK = String.raw`(?:[A-Za-z0-9]{1,2}(?![A-Za-z0-9])(?:_\{[^{}\s]{1,12}\}|_[A-Za-z0-9]{1,4}(?![A-Za-z0-9]))?|[()|/×·=+\-−,])`;
const RUN = new RegExp(String.raw`(?<![A-Za-z0-9_\\$])${TOK}(?:[ ]?${TOK})*`, "g");
const toTex = (s: string) => s.replace(/×/g, " \\times ").replace(/·/g, " \\cdot ").replace(/−/g, "-").replace(/_([A-Za-z0-9]{2,4})(?![A-Za-z0-9])/g, "_{$1}").replace(/\s+/g, " ").trim();
function equations(text: string) {
  return text.replace(RUN, (m) => {
    const lead = m.match(/^(?:\d+\)|[\s,)])*/)?.[0] ?? "";
    const rest = m.slice(lead.length);
    let depth = 0, end = 0;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === "(") depth++; else if (c === ")") { if (!depth) break; depth--; }
      if (!depth && /[A-Za-z0-9)|}]/.test(c)) end = i + 1; // } closes a subscript (y = y_{ref})
    }
    const core = rest.slice(0, end);
    if (!/[=×]/.test(core) || core.replace(/\s/g, "").length < 4 || !/^[A-Za-z(|]/.test(core)) return m;
    return `${lead}$${toTex(core)}$${rest.slice(end)}`;
  });
}
const outsideMath = (text: string, change: (plain: string) => string) =>
  text.split(/(\$[^$\n]+\$)/g).map((seg) => seg.length > 2 && seg.startsWith("$") && seg.endsWith("$") ? seg : change(seg)).join("");
export function mathify(text: string) {
  return outsideMath(outsideMath(text, equations), (plain) => plain.replace(BARE, (m) => `$${m.replace(/_([A-Za-z0-9]{2,4})(?=\^|$)/, "_{$1}")}$`));
}
function bold(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={`${key}${i}`}>{part.slice(2, -2)}</b> : <Fragment key={`${key}${i}`}>{part}</Fragment>);
}
function withMath(text: string, key: string): ReactNode[] {
  return mathify(text).split(/(\$[^$\n]+\$)/g).flatMap<ReactNode>((seg, j) => seg.length > 2 && seg.startsWith("$") && seg.endsWith("$") && isTex(seg.slice(1, -1))
    ? [<TeX key={`${key}m${j}`} tex={seg.slice(1, -1)} />] : bold(seg, `${key}t${j}.`));
}

/** Chat-style text as elements: paragraphs, - / 1. lists, **bold**, `code`, ``` code blocks, and formulas. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).flatMap<ReactNode>((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? [<code key={`c${i}`}>{part.slice(1, -1)}</code>] : withMath(part, `p${i}.`));
}
/** One line of text (a title, a question, an option) with its formulas, no paragraphs. */
export function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>;
}
// 표(11/11 사용자 "AI가 한 번씩 표 쓰잖아, 이런 거 처리 안 됨?"): | a | b | 머리줄 + |---|---:| 구분줄이 있으면 표로.
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l) || (l.includes("|") && /^\s*\|/.test(l));
const cellsOf = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
function table(lines: string[], key: string) {
  const head = cellsOf(lines[0]); const aligns = cellsOf(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left") as "center" | "right" | "left");
  const rows = lines.slice(2).map(cellsOf);
  return <div key={key} className="ws-tablewrap"><table className="ws-table"><thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: aligns[i] ?? "left" }}>{inline(h)}</th>)}</tr></thead>
    <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, i) => <td key={i} style={{ textAlign: aligns[i] ?? "left" }}>{inline(r[i] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}
/** 한 덩어리 안에서 표 부분과 글 부분을 나눈다. */
function splitTables(lines: string[]): Array<{ table: boolean; lines: string[] }> {
  const out: Array<{ table: boolean; lines: string[] }> = [];
  for (let i = 0; i < lines.length;) {
    if (isRow(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      let j = i + 2; while (j < lines.length && isRow(lines[j]) && !TABLE_SEP.test(lines[j])) j++;
      out.push({ table: true, lines: lines.slice(i, j) }); i = j; continue;
    }
    const last = out[out.length - 1];
    if (last && !last.table) last.lines.push(lines[i]); else out.push({ table: false, lines: [lines[i]] });
    i++;
  }
  return out;
}
export function Rich({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  const chunks = text.replace(/\r/g, "").split(/```/);
  chunks.forEach((chunk, ci) => {
    if (ci % 2 === 1) { out.push(<pre key={`c${ci}`} className="ws-code">{chunk.replace(/^[a-z+#]*\n/i, "").replace(/\n$/, "")}</pre>); return; }
    chunk.split(/\n{2,}/).forEach((block, bi) => {
      if (!block.trim()) return;
      const all = block.split("\n").filter((l) => l.trim());
      const parts = splitTables(all);
      parts.forEach((part, pi) => { const lines = part.lines; const key = `${ci}-${bi}-${pi}`;
      if (part.table) { out.push(table(lines, key)); return; }
      // 한 줄 전체가 식 하나($…$ 또는 $$…$$)면 따로 떼어 쓴 식으로
      const solo = lines.map((l) => /^\s*\$\$?([^$]+?)\$\$?\s*$/.exec(l)?.[1] ?? null);
      if (solo.every((x) => x !== null && isTex(x))) { lines.forEach((_, k) => out.push(<div key={`${key}d${k}`} className="ws-display"><TeX tex={solo[k]!} display /></div>)); return; }
      const isItem = (l: string) => /^\s*([-*•]|\d+[.)])\s+/.test(l);
      if (lines.every(isItem)) {
        const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
        out.push(/^\s*\d/.test(lines[0]) ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else if (lines.some(isItem) && lines.length > 1) {
        // 글 줄과 목록 줄이 빈 줄 없이 섞인 덩어리(11/11 질문·답 카드 "간선은 두 종류다.\n- …\n- …"): 이어진 줄끼리 나눠 글은 문단, 목록은 목록으로
        const runs: Array<{ item: boolean; ls: string[] }> = [];
        for (const l of lines) { const it = isItem(l); const last = runs[runs.length - 1]; if (last && last.item === it) last.ls.push(l); else runs.push({ item: it, ls: [l] }); }
        runs.forEach((r, ri) => {
          if (!r.item) { out.push(<p key={`${key}r${ri}`}>{r.ls.map((l, k) => <Fragment key={k}>{k ? <br /> : null}{inline(l)}</Fragment>)}</p>); return; }
          const items = r.ls.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
          out.push(/^\s*\d/.test(r.ls[0]) ? <ol key={`${key}r${ri}`}>{items}</ol> : <ul key={`${key}r${ri}`}>{items}</ul>);
        });
      } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) out.push(<p key={key} className="ws-h">{inline(lines[0].replace(/^#+\s/, ""))}</p>);
      else out.push(<p key={key}>{lines.map((l, k) => <Fragment key={k}>{k ? <br /> : null}{inline(l)}</Fragment>)}</p>);
      });
    });
  });
  return <div className={`ws-rich ${className ?? ""}`}>{out}</div>;
}
/** One line inside other text (no paragraph): math and `code` still render (자료 지도 cards, 2026-10-29). */
export function RichInline({ text }: { text: string }) {
  return <span className="ws-rich-inline">{inline(text.replace(/\s*\n+\s*/g, " "))}</span>;
}
/** Several lines, each with its formulas (정답 순서·내가 적은 답처럼 줄바꿈을 살려야 할 때). */
export function RichLines({ text }: { text: string }) {
  return <>{String(text ?? "").split("\n").map((l, i) => <Fragment key={i}>{i ? <br /> : null}<RichInline text={l} /></Fragment>)}</>;
}
