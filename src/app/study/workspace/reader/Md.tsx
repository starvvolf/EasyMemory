"use client";
import { Fragment, type ReactNode } from "react";
import { RichInline } from "../Rich";

/* 채팅 같은 답(11/11 바닐라 richLines를 React로): 문단, **굵게**, `코드`, # 소제목, - / 1. 목록, | 표 |, $…$ 식.
   "원문 밖 설명:"으로 시작하는 줄은 자료 밖 설명으로 표시한다. */
function line(text: string, key: string): ReactNode {
  const m = /^\s*원문 밖 설명\s*[:：]\s*(.*)$/.exec(text);
  return m ? <span key={key} className="outside"><b>원문 밖 설명</b> <RichInline text={m[1]} /></span> : <RichInline key={key} text={text} />;
}
const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
export function MdLines({ text }: { text: string }) {
  const lines = String(text ?? "").split("\n"), out: ReactNode[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { const k = `p${out.length}`; out.push(<p key={k} className="md-p">{para.map((l, i) => <Fragment key={i}>{i ? <br /> : null}{line(l, `${k}-${i}`)}</Fragment>)}</p>); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      flush();
      const head = cells(l), body: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      i--;
      out.push(<div key={`t${out.length}`} className="md-table"><table><thead><tr>{head.map((c, j) => <th key={j}><RichInline text={c} /></th>)}</tr></thead>
        <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}><RichInline text={c} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const hd = /^\s*#{1,4}\s+(.*)$/.exec(l);
    if (hd) { flush(); out.push(<p key={`h${out.length}`} className="md-h"><b><RichInline text={hd[1]} /></b></p>); continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(l), items: string[] = [], same = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
      while (i < lines.length && same.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      i--;
      const lis = items.map((t, j) => <li key={j}>{line(t, `l${j}`)}</li>);
      out.push(ordered ? <ol key={`o${out.length}`} className="md-list">{lis}</ol> : <ul key={`u${out.length}`} className="md-list">{lis}</ul>);
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    para.push(l);
  }
  flush();
  return <>{out}</>;
}
