// 인용 둘레 잘라 보이기 (2026-11-08 사용자 "베스트는 그림을 AI가 딱 잘라 주는 것" → "잘라서 붙이는 거로 테스트"): AI는 지금처럼
// 원문 인용만 고르고, 코드가 그 인용이 쪽의 어디에 있는지 PDF 글자 위치로 찾아 그 덩어리(이어진 줄들 + 맞닿은 그림)를 잘라 낸다.
// AI 호출은 늘지 않는다. 글자 층이 없는 쪽(스캔·그림 속 글자)은 찾지 못한다(null).
import type { TextRun } from "./prep.ts";

export type Box = { x0: number; y0: number; x1: number; y1: number }; // 쪽 왼쪽 위 기준, PDF 단위
type Placed = { str: string; box: Box };
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s ]+/g, "");

/** Runs with their boxes in top-left page coordinates. */
export function placeRuns(runs: TextRun[], pageHeight: number): Placed[] {
  return runs.filter((r) => r.str.trim()).map((r) => {
    const w = r.w ?? r.str.length * r.h * 0.5;
    return { str: r.str, box: { x0: r.x, y0: pageHeight - r.y - r.h, x1: r.x + w, y1: pageHeight - r.y + r.h * 0.25 } };
  });
}
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Where the quote's characters are: the runs that hold them (spaces and case ignored). Falls back to the longest matching start (12+ chars). */
export function findQuote(placed: Placed[], quote: string): Box | null {
  const q = squash(quote);
  if (q.length < 4) return null;
  let text = ""; const owner: number[] = [];
  placed.forEach((p, i) => { const s = squash(p.str); text += s; for (let k = 0; k < s.length; k++) owner.push(i); });
  let at = text.indexOf(q), len = q.length;
  for (let cut = q.length - 1; at < 0 && cut >= 12; cut--) { at = text.indexOf(q.slice(0, cut)); len = cut; }
  if (at < 0) return null;
  const hit = [...new Set(owner.slice(at, at + len))];
  return hit.map((i) => placed[i].box).reduce(union);
}

type Row = { box: Box; x: number };
/** Runs on the same baseline as one row (slides: one bullet line). */
function rowsOf(placed: Placed[]): Row[] {
  const rows: Row[] = [];
  const bottom = Math.max(...placed.map((p) => p.box.y1));
  for (const p of [...placed].filter((p) => !(/^\s*\d{1,3}\s*$/.test(p.str) && p.box.y0 > bottom * 0.9)).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)) {
    const h = p.box.y1 - p.box.y0, mid = (p.box.y0 + p.box.y1) / 2;
    const row = rows.find((r) => Math.abs((r.box.y0 + r.box.y1) / 2 - mid) < h * 0.45);
    if (row) { row.box = union(row.box, p.box); row.x = Math.min(row.x, p.box.x0); } else rows.push({ box: { ...p.box }, x: p.box.x0 });
  }
  return rows.sort((a, b) => a.box.y0 - b.box.y0);
}

/**
 * The block the quote belongs to, by indentation (11/8 첫 시험: 줄 간격만 보고 넓히니 쪽 절반이 딸려 왔다): the quote's rows,
 * the bullet just above them that is less indented (their heading), and the rows under that heading until the next row
 * that is not more indented than the heading. Pictures that touch the block come with it.
 */
export function growBlock(start: Box, placed: Placed[], figures: Box[] = []): Box & { padTop?: number; padBottom?: number } {
  const rows = rowsOf(placed);
  const lineH = Math.max(6, (start.y1 - start.y0));
  const hit = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.box.y1 > start.y0 + 1 && r.box.y0 < start.y1 - 1);
  if (!hit.length) return start;
  const first = hit[0].i, last = hit[hit.length - 1].i, x = Math.min(...hit.map(({ r }) => r.x));
  // heading: the nearest row above that is clearly less indented (not further than ~6 lines up)
  let head = first;
  for (let i = first - 1; i >= 0 && rows[first].box.y0 - rows[i].box.y1 < lineH * 8; i--) if (rows[i].x < x - lineH * 0.6) { head = i; break; }
  const hx = rows[head].x;
  let end = last;
  for (let i = last + 1; i < rows.length; i++) { if (rows[i].x <= hx + lineH * 0.3 || rows[i].box.y0 - rows[i - 1].box.y1 > lineH * 3) break; end = i; }
  let box = rows.slice(head, end + 1).map((r) => r.box).reduce(union);
  // 잘라 낼 때 위아래 이웃 줄이 비치지 않게: 여백은 이웃 줄까지 거리의 절반까지만
  const above = head > 0 ? box.y0 - rows[head - 1].box.y1 : Infinity, below = end + 1 < rows.length ? rows[end + 1].box.y0 - box.y1 : Infinity;
  for (const f of figures) {
    const near = f.x1 > box.x0 - lineH * 2 && f.x0 < box.x1 + lineH * 2 && f.y1 > box.y0 - lineH * 1.5 && f.y0 < box.y1 + lineH * 1.5;
    if (near) box = union(box, f);
  }
  return Object.assign(box, { padTop: Math.max(0, Math.min(10, above / 2 - 1)), padBottom: Math.max(0, Math.min(10, below / 2 - 1)) });
}

/** Crop rectangle in pixels of an image drawn at `scale`, with padding, kept on the page. */
export function cropRect(box: Box & { padTop?: number; padBottom?: number }, scale: number, page: { width: number; height: number }, pad = 10) {
  const top = box.padTop ?? pad, bot = box.padBottom ?? pad;
  const x = Math.max(0, Math.floor((box.x0 - pad) * scale)), y = Math.max(0, Math.floor((box.y0 - top) * scale));
  const w = Math.min(Math.ceil(page.width * scale) - x, Math.ceil((box.x1 - box.x0 + pad * 2) * scale));
  const h = Math.min(Math.ceil(page.height * scale) - y, Math.ceil((box.y1 - box.y0 + top + bot) * scale));
  return { x, y, w, h };
}

/** For each quote on one page: the block around it, cut out of the page drawing (JPEG data URL), or null when not found. */
export async function cropQuotes(bytes: Uint8Array, page: number, quotes: string[], width = 1600) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  try {
    const p = await document.getPage(page);
    const viewport = p.getViewport({ scale: 1 });
    const runs: TextRun[] = [];
    for (const item of (await p.getTextContent()).items) if ("str" in item)
      runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], h: item.height || Math.hypot(item.transform[2], item.transform[3]), w: item.width });
    // pictures painted on the page (user space → top-left), same walk as prep.ts
    const OPS = pdfjs.OPS as Record<string, number>;
    const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((v) => v !== undefined));
    const ops = await p.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0]; const stack: number[][] = []; const figures: Box[] = [];
    const times = (m: number[], t: number[]) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(ctm); else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = times(ctm, args as number[]);
      else if (paint.has(fn)) {
        const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]], ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
        const b = { x0: Math.max(0, Math.min(...xs)), x1: Math.min(viewport.width, Math.max(...xs)), y0: Math.max(0, viewport.height - Math.max(...ys)), y1: Math.min(viewport.height, viewport.height - Math.min(...ys)) };
        const area = (b.x1 - b.x0) * (b.y1 - b.y0) / (viewport.width * viewport.height);
        if (area >= 0.01 && area < 0.9) figures.push(b); // 배경 그림(쪽 전체)은 뺀다
      }
    });
    const placed = placeRuns(runs, viewport.height);
    const scale = width / Math.max(viewport.width, viewport.height);
    const view = p.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: view }).promise;
    return quotes.map((quote) => {
      const hit = findQuote(placed, quote);
      if (!hit) return { quote, found: false as const };
      const box = growBlock(hit, placed, figures);
      const r = cropRect(box, scale, viewport);
      const out = createCanvas(r.w, r.h); out.getContext("2d").drawImage(canvas as never, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return { quote, found: true as const, box: [box.x0 / viewport.width, box.y0 / viewport.height, box.x1 / viewport.width, box.y1 / viewport.height],
        image: `data:image/jpeg;base64,${out.toBuffer("image/jpeg", 85).toString("base64")}` };
    });
  } finally { await (document as unknown as { cleanup?: () => Promise<void> }).cleanup?.(); }
}
