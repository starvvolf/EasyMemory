import { Fragment, type ReactNode } from "react";

/** Chat-style text as elements (never HTML): paragraphs, - / 1. lists, **bold**, `code` and ``` code blocks. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>);
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
