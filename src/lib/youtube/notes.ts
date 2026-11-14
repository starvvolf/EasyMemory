// 유튜브 내용 정리의 글 모양 (11/15): 사용자의 「유튜브 정리 패널」(youtube-summary.user.js v1.7.0)의 순수 함수를 그대로 옮겼다.
// 마크다운(@유형/@한줄/@키워드 + # 대단원 · ## 중단원 · ### 소제목 · > [!정의] 상자 · 표 · [분:초]) → HTML, 그리고 엔진이 읽을 쪽 나누기.
// 화면(src/app/study/workspace/youtube/)과 엔진(text-sources → runner) 둘 다 이것을 쓴다.

export const CALLOUTS: Record<string, { icon: string }> = {
  핵심: { icon: "💡" }, 정의: { icon: "📖" }, 예시: { icon: "🧪" }, 주의: { icon: "⚠️" }, 의견: { icon: "💬" }, 팁: { icon: "✨" }, 참고: { icon: "📌" },
};
const TS_RE = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}";

export function esc(s: unknown) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function tsToSec(ts: string) {
  const p = String(ts).trim().split(":").map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.reduce((a, b) => a * 60 + b, 0);
}
export function secToTs(sec: number) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type NotesMeta = { type: string; oneLine: string; keywords: string[] };
/** 맨 앞 @유형/@한줄/@키워드 메타 블록 분리 */
export function parseMeta(md: string): { meta: NotesMeta; body: string } {
  const meta: NotesMeta = { type: "", oneLine: "", keywords: [] };
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (!l.startsWith("@")) break;
    const m = l.match(/^@(유형|한줄|키워드)\s*[:：]\s*(.*)$/);
    if (m) {
      if (m[1] === "유형") meta.type = m[2].trim();
      else if (m[1] === "한줄") meta.oneLine = m[2].trim();
      else meta.keywords = m[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    }
    i++;
  }
  return { meta, body: lines.slice(i).join("\n") };
}

type ListItem = { text: string; ordered: boolean; children: ListItem[]; indent: number };
type Block = { t: "code"; lang: string; text: string } | { t: "h"; level: number; text: string } | { t: "hr" }
  | { t: "callout"; kind: string; lines: string[] } | { t: "quote"; lines: string[] } | { t: "table"; rows: string[][] }
  | { t: "list"; items: ListItem[] } | { t: "p"; text: string };

function splitRow(line: string) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function nestList(items: Array<{ text: string; ordered: boolean; indent: number }>): ListItem[] {
  const root: ListItem = { text: "", ordered: false, children: [], indent: -1 };
  const stack = [root];
  for (const it of items) {
    const node: ListItem = { text: it.text, ordered: it.ordered, children: [], indent: it.indent };
    while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}
const LIST_RE = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const BLOCK_START_RE = /^(#{1,6}\s|\s*>|\s*```|\s*([-*+•]|\d+[.)])\s+|\s*\|)/;

/** 마크다운 → 블록 배열 */
export function parseBlocks(src: string): Block[] {
  const L = String(src || "").replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  const isSep = (s: string | undefined) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s || "");
  let i = 0;
  while (i < L.length) {
    const line = L[i];
    if (!line.trim()) { i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*```\s*([\w+-]*)/))) {
      const buf: string[] = []; i++;
      while (i < L.length && !/^\s*```/.test(L[i])) { buf.push(L[i]); i++; }
      i++;
      out.push({ t: "code", lang: m[1] || "", text: buf.join("\n") });
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      out.push({ t: "h", level: Math.min(m[1].length, 4), text: m[2].replace(/\s*#+\s*$/, "").trim() });
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < L.length && /^\s*>/.test(L[i])) { buf.push(L[i].replace(/^\s*>\s?/, "")); i++; }
      let cur: { t: "callout"; kind: string; lines: string[] } | { t: "quote"; lines: string[] } | null = null;
      const flush = () => { if (cur) { cur.lines = cur.lines.filter((s, j) => j > 0 || s.trim()); out.push(cur); } cur = null; };
      for (const b of buf) {
        const cm = b.match(/^\s*\[!([^\]]+)\]\s*(.*)$/);
        if (cm) { flush(); cur = { t: "callout", kind: cm[1].trim(), lines: [cm[2]] }; }
        else if (cur) (cur as { lines: string[] }).lines.push(b);
        else cur = { t: "quote", lines: [b] };
      }
      flush();
      continue;
    }
    if (/^\s*\|/.test(line) && isSep(L[i + 1])) {
      const rows = [splitRow(line)]; i += 2;
      while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(splitRow(L[i])); i++; }
      out.push({ t: "table", rows });
      continue;
    }
    if (LIST_RE.test(line)) {
      const items: Array<{ text: string; ordered: boolean; indent: number }> = [];
      while (i < L.length) {
        const lm = L[i].match(LIST_RE);
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(lm[2]), text: lm[3].trim() }); i++; continue; }
        if (!L[i].trim()) {
          let j = i; while (j < L.length && !L[j].trim()) j++;
          if (j < L.length && LIST_RE.test(L[j])) { i = j; continue; }
          break;
        }
        if (/^\s{2,}\S/.test(L[i]) && items.length) { items[items.length - 1].text += " " + L[i].trim(); i++; continue; }
        break;
      }
      out.push({ t: "list", items: nestList(items) });
      continue;
    }
    const buf = [line.trim()]; i++;
    while (i < L.length && L[i].trim() && !BLOCK_START_RE.test(L[i]) && !/^\s*-{3,}\s*$/.test(L[i])) { buf.push(L[i].trim()); i++; }
    out.push({ t: "p", text: buf.join(" ") });
  }
  return out;
}

/** 인라인: `코드`, **굵게**, [분:초] */
function inlineTokens(s: string) {
  const re = new RegExp("`([^`]+)`|\\*\\*([^*]+?)\\*\\*|\\[(" + TS_RE + ")(?:\\s*[-–~]\\s*" + TS_RE + ")?\\]", "g");
  const out: Array<{ text: string; code?: boolean; bold?: boolean; ts?: number }> = [];
  let last = 0, m: RegExpExecArray | null;
  s = String(s || "");
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], code: true });
    else if (m[2] != null) out.push({ text: m[2], bold: true });
    else out.push({ text: m[3], ts: tsToSec(m[3]) });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
function inlineHTML(s: string) {
  return inlineTokens(s).map((t) => {
    if (t.code) return `<code>${esc(t.text)}</code>`;
    if (t.bold) return `<strong>${esc(t.text)}</strong>`;
    if (t.ts != null) return `<a class="ys-ts" data-t="${t.ts}">${esc(t.text)}</a>`;
    return esc(t.text);
  }).join("");
}

type Heading = { rel: number; num: string; title: string; ts: string | null };
/** 제목 번호: 쓰인 가장 높은 단계 = 대단원(1.), 다음 = 중단원(1-1), 그 아래 = 소제목 */
function computeHeadings(blocks: Block[]) {
  const levels = [...new Set(blocks.flatMap((b) => b.t === "h" ? [b.level] : []))].sort((a, b) => a - b);
  const [top, mid] = levels;
  let n1 = 0, n2 = 0;
  const tsRe = new RegExp("\\s*\\[(" + TS_RE + ")[^\\]]*\\]\\s*$");
  const map = new Map<number, Heading>();
  blocks.forEach((b, idx) => {
    if (b.t !== "h") return;
    let title = b.text, ts: string | null = null;
    const m = title.match(tsRe);
    if (m) { ts = m[1]; title = title.slice(0, m.index).trim(); }
    let rel: number, num = "";
    if (/^(복습 질문|참고|협찬)/.test(title)) { map.set(idx, { rel: b.level === top ? 1 : 2, num: "", title, ts }); return; }
    if (b.level === top) { rel = 1; n1++; n2 = 0; num = String(n1); }
    else if (b.level === mid) { rel = 2; n2++; num = n1 ? `${n1}-${n2}` : String(n2); }
    else rel = 3;
    map.set(idx, { rel, num, title, ts });
  });
  return map;
}
function calloutKey(kind: string) { return Object.keys(CALLOUTS).find((k) => kind.includes(k)) || "참고"; }
function renderListHTML(items: ListItem[]): string {
  let html = "", i = 0;
  while (i < items.length) {
    const ordered = items[i].ordered, tag = ordered ? "ol" : "ul";
    html += `<${tag}>`;
    while (i < items.length && items[i].ordered === ordered) {
      const it = items[i];
      html += `<li>${inlineHTML(it.text)}${it.children.length ? renderListHTML(it.children) : ""}</li>`;
      i++;
    }
    html += `</${tag}>`;
  }
  return html;
}

/** 정리 전체 → { metaHTML, tocHTML, bodyHTML }. 글은 모두 이스케이프한다(모델 답을 HTML로 넣지 않는다). */
export function renderNotes(md: string) {
  const { meta, body } = parseMeta(md);
  const blocks = parseBlocks(body);
  const heads = computeHeadings(blocks);
  const toc: Array<Heading & { id: string }> = [];
  let html = "";
  blocks.forEach((b, idx) => {
    switch (b.t) {
      case "h": {
        const h = heads.get(idx)!;
        const id = `ys-h-${idx}`;
        if (h.rel <= 2) toc.push({ ...h, id });
        html += `<div class="ys-h ys-h${h.rel}" id="${id}">` + (h.num ? `<span class="ys-num">${esc(h.num)}</span>` : "") +
          `<span class="ys-ht">${inlineHTML(h.title)}</span>` + (h.ts ? `<a class="ys-ts ys-ts-h" data-t="${tsToSec(h.ts)}">${esc(h.ts)}</a>` : "") + `</div>`;
        break;
      }
      case "p": html += `<p>${inlineHTML(b.text)}</p>`; break;
      case "list": html += renderListHTML(b.items); break;
      case "callout": {
        const key = calloutKey(b.kind);
        const lines = b.lines.map((l) => { const lm = l.match(/^\s*[-*•]\s+(.*)$/); return lm ? `<div class="ys-cli">• ${inlineHTML(lm[1])}</div>` : `<div>${inlineHTML(l)}</div>`; }).join("");
        html += `<div class="ys-callout ys-k-${key}"><div class="ys-ck">${CALLOUTS[key].icon} ${esc(key)}</div><div class="ys-cb">${lines}</div></div>`;
        break;
      }
      case "quote": html += `<blockquote>${b.lines.map(inlineHTML).join("<br>")}</blockquote>`; break;
      case "table": {
        const [head, ...rows] = b.rows;
        html += `<div class="ys-tablewrap"><table><thead><tr>${head.map((c) => `<th>${inlineHTML(c)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => `<td>${inlineHTML(r[k] || "")}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
        break;
      }
      case "code": html += `<pre><code>${esc(b.text)}</code></pre>`; break;
      case "hr": html += "<hr>"; break;
    }
  });
  const tocHTML = toc.length >= 2 ? `<div class="ys-toc"><div class="ys-toc-title">목차</div>` + toc.map((t) =>
    `<a class="ys-toc-i ys-toc-${t.rel}" data-jump="${t.id}"><span class="ys-toc-n">${esc(t.num)}</span><span class="ys-toc-t">${esc(t.title.replace(/\*\*/g, ""))}</span>${t.ts ? `<span class="ys-toc-ts">${esc(t.ts)}</span>` : ""}</a>`).join("") + `</div>` : "";
  let metaHTML = meta.type || meta.keywords.length
    ? `<div class="ys-meta">${meta.type ? `<span class="ys-type">${esc(meta.type)}</span>` : ""}${meta.keywords.map((k) => `<span class="ys-kw">#${esc(k)}</span>`).join("")}</div>` : "";
  if (meta.oneLine) metaHTML += `<div class="ys-one">${inlineHTML(meta.oneLine)}</div>`;
  return { metaHTML, tocHTML, bodyHTML: html, meta };
}

/**
 * 엔진이 읽을 쪽: 정리의 가장 큰 단원(# 없으면 ##)마다 한 쪽. 단원이 하나뿐이면 그 아래 단계로 나눈다.
 * 복습 질문 · 참고 · 협찬 단원은 쪽으로 만들지 않는다(기억이 아니라 확인용). 쪽 글에는 그 단원의 제목 줄(시각 포함)부터 들어간다.
 */
export function notesPages(md: string): string[] {
  const { meta, body } = parseMeta(md);
  const lines = body.replace(/\r/g, "").split("\n");
  const levels = [...new Set(lines.flatMap((l) => { const m = /^(#{1,6})\s+/.exec(l); return m ? [m[1].length] : []; }))].sort((a, b) => a - b);
  const count = (lv: number) => lines.filter((l) => new RegExp(`^#{${lv}}\\s+`).test(l)).length;
  const cutAt = levels.find((lv) => count(lv) >= 2) ?? levels[0];
  const pages: string[] = [];
  let cur: string[] = [];
  const push = () => { const t = cur.join("\n").trim(); if (t) pages.push(t); cur = []; };
  for (const l of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (cutAt && m && m[1].length <= cutAt) push();
    cur.push(l);
  }
  push();
  const kept = pages.filter((p) => !/^#{1,6}\s+(복습 질문|참고|협찬)/.test(p));
  const out = kept.length ? kept : pages;
  if (meta.oneLine && out.length) out[0] = `[영상 한 줄] ${meta.oneLine}\n\n${out[0]}`;
  return out.length ? out : [md.trim()].filter(Boolean);
}
/** 쪽 글의 첫 [분:초] (원문 보기에서 영상 그 장면으로) */
export function firstTs(text: string): number | null {
  const m = new RegExp("\\[(" + TS_RE + ")").exec(text);
  return m ? tsToSec(m[1]) : null;
}
