import { Fragment, useEffect, useState, type ReactNode } from "react";

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
/** One formula. MathML output needs no stylesheet, so it reads the same on every screen that shows Rich text. */
function TeX({ tex }: { tex: string }) {
  const k = useKatex();
  if (!k) return <span className="ws-math">{tex}</span>;
  // KaTeX escapes its input and trust is off: this is markup KaTeX built, not text from the learner as HTML.
  return <span className="ws-math" dangerouslySetInnerHTML={{ __html: k.renderToString(tex, { output: "mathml", throwOnError: false, strict: "ignore", trust: false }) }} />;
}
/**
 * Knowledge text keeps formulas without $ (z_{vp}, P_0, y_view, xw_{min}): short names with a subscript or superscript
 * become $…$. Longer words with "_" (lower_bound, snake_case) stay text; so do $ amounts ("$5 and $10").
 */
const BARE = /(?<![\w$\\])([A-Za-z]{1,2}(?:_\{[^{}\s]{1,16}\}|_[A-Za-z0-9]{1,4})(?:\^\{[^{}]{1,8}\}|\^[A-Za-z0-9])?|[A-Za-z]\^\{[^{}]{1,8}\})(?![\w{])/g;
const isTex = (inner: string) => /[\\_^{}=|]/.test(inner) || /^[A-Za-z]$/.test(inner);
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
export function Rich({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  const chunks = text.replace(/\r/g, "").split(/```/);
  chunks.forEach((chunk, ci) => {
    if (ci % 2 === 1) { out.push(<pre key={`c${ci}`} className="ws-code">{chunk.replace(/^[a-z+#]*\n/i, "").replace(/\n$/, "")}</pre>); return; }
    chunk.split(/\n{2,}/).forEach((block, bi) => {
      if (!block.trim()) return;
      const lines = block.split("\n").filter((l) => l.trim());
      const key = `${ci}-${bi}`;
      if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
        const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
        out.push(/^\s*\d/.test(lines[0]) ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) out.push(<p key={key} className="ws-h">{inline(lines[0].replace(/^#+\s/, ""))}</p>);
      else out.push(<p key={key}>{lines.map((l, k) => <Fragment key={k}>{k ? <br /> : null}{inline(l)}</Fragment>)}</p>);
    });
  });
  return <div className={`ws-rich ${className ?? ""}`}>{out}</div>;
}
/** One line inside other text (no paragraph): math and `code` still render (자료 지도 cards, 2026-10-29). */
export function RichInline({ text }: { text: string }) {
  return <span className="ws-rich-inline">{inline(text.replace(/\s*\n+\s*/g, " "))}</span>;
}
