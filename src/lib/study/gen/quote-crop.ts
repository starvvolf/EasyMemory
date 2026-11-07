// 인용 둘레 잘라 보이기 (2026-11-08 사용자 "베스트는 그림을 딱 잘라 주는 것" → 시험 → 2차 기준 "글만 있는 건 자를 필요 없다,
// 그림은 그 그림만 적당히, 그림 여럿이 이어지면 통째로, 글과 그림이 얽히면 덩어리, 애매하면 빡빡한 것보다 덩어리"):
// AI는 지금처럼 원문 인용만 고르고, 코드가 PDF 글자 위치로 그 인용을 찾아 판단한다. AI 호출은 늘지 않는다.
//   글만 → 자르지 않음(none) / 글 옆 그림 → 그 그림만(figure) / 그림끼리 이어짐 → 이어진 그림 통째(figure)
//   글과 그림이 섞임·애매 → 글 덩어리 + 그림(block)
// 그림은 이미지와 선·도형(벡터) 둘 다. 쪽 배경·여러 쪽에 되풀이되는 틀(제목 밑줄 등)·글 뒤에 깐 색 상자는 그림으로 보지 않는다.
// 글 뒤 색 상자는 따로 돌려준다(강조 단서: 자료 안에서 드문 색만 강조로 볼 것 — 쓰는 쪽에서 판단).
// 글자 층이 없는 쪽(스캔·그림 속 글자)은 찾지 못한다(none).
import type { TextRun } from "./prep.ts";

export type Box = { x0: number; y0: number; x1: number; y1: number }; // 쪽 왼쪽 위 기준, PDF 단위
type Placed = { str: string; box: Box };
type Row = { box: Box; x: number; text: string };
export type Graphic = { box: Box; kind: "image" | "drawing" };
export type Shade = { box: Box; color: string };
export type CropMode = "none" | "figure" | "block";
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s ]+/g, "");
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const overlap = (a: Box, b: Box) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const gapBetween = (a: Box, b: Box) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
const vOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Runs with their boxes in top-left page coordinates. */
export function placeRuns(runs: TextRun[], pageHeight: number): Placed[] {
  return runs.filter((r) => r.str.trim()).map((r) => {
    const w = r.w ?? r.str.length * r.h * 0.5;
    return { str: r.str, box: { x0: r.x, y0: pageHeight - r.y - r.h, x1: r.x + w, y1: pageHeight - r.y + r.h * 0.25 } };
  });
}

/** Where the quote's characters are (spaces and case ignored). Falls back to the longest matching start (12+ chars). */
export function findQuote(placed: Placed[], quote: string): Box | null {
  const q = squash(quote);
  if (q.length < 4) return null;
  let text = ""; const owner: number[] = [];
  placed.forEach((p, i) => { const s = squash(p.str); text += s; for (let k = 0; k < s.length; k++) owner.push(i); });
  let at = text.indexOf(q), len = q.length;
  for (let cut = q.length - 1; at < 0 && cut >= 12; cut--) { at = text.indexOf(q.slice(0, cut)); len = cut; }
  if (at < 0) return null;
  // 글자 흐름에서 이어진 글자가 엉뚱한 곳(그림 속 라벨 P_i 등)의 조각을 끼울 수 있다: 글자를 가장 많이 가진 조각 둘레(줄바꿈 한 줄까지)만
  const counts = new Map<number, number>();
  for (const i of owner.slice(at, at + len)) counts.set(i, (counts.get(i) ?? 0) + 1);
  const anchor = placed[[...counts].sort((x, y) => y[1] - x[1])[0][0]].box, h = anchor.y1 - anchor.y0;
  const kept = [...counts.keys()].map((i) => placed[i].box).filter((b) => gapBetween(b, anchor) <= h * 1.6);
  return kept.reduce(union);
}

/** Runs on the same baseline as one row (slides: one bullet line); page numbers at the foot left out. */
export function rowsOf(placed: Placed[]): Row[] {
  const rows: Row[] = [];
  const bottom = Math.max(...placed.map((p) => p.box.y1));
  for (const p of [...placed].filter((p) => !(/^\s*\d{1,3}\s*$/.test(p.str) && p.box.y0 > bottom * 0.9)).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)) {
    const h = p.box.y1 - p.box.y0, mid = (p.box.y0 + p.box.y1) / 2;
    const row = rows.find((r) => Math.abs((r.box.y0 + r.box.y1) / 2 - mid) < h * 0.45);
    if (row) { row.box = union(row.box, p.box); row.x = Math.min(row.x, p.box.x0); row.text += ` ${p.str}`; } else rows.push({ box: { ...p.box }, x: p.box.x0, text: p.str });
  }
  return rows.sort((a, b) => a.box.y0 - b.box.y0);
}

/** The quote's rows, their less-indented heading just above, and the rows under that heading (by indentation). */
export function textBlock(start: Box, rows: Row[]): { box: Box; quoteRows: Box[]; above: number; below: number } | null {
  const lineH = Math.max(6, start.y1 - start.y0);
  const hit = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.box.y1 > start.y0 + 1 && r.box.y0 < start.y1 - 1);
  if (!hit.length) return null;
  const first = hit[0].i, last = hit[hit.length - 1].i, x = Math.min(...hit.map(({ r }) => r.x));
  let head = first;
  for (let i = first - 1; i >= 0 && rows[first].box.y0 - rows[i].box.y1 < lineH * 8; i--) if (rows[i].x < x - lineH * 0.6) { head = i; break; }
  const hx = rows[head].x;
  let end = last;
  for (let i = last + 1; i < rows.length; i++) { if (rows[i].x <= hx + lineH * 0.3 || rows[i].box.y0 - rows[i - 1].box.y1 > lineH * 3) break; end = i; }
  const box = rows.slice(head, end + 1).map((r) => r.box).reduce(union);
  return { box, quoteRows: hit.map(({ r }) => r.box), above: head > 0 ? box.y0 - rows[head - 1].box.y1 : Infinity, below: end + 1 < rows.length ? rows[end + 1].box.y0 - box.y1 : Infinity };
}

/** Graphics that touch `seed`, then every graphic close to those (transitively): pictures that belong together. */
function cluster(seed: Graphic[], all: Graphic[], gap: number): Box | null {
  if (!seed.length) return null;
  const inSet = new Set(seed);
  for (let grew = true; grew;) {
    grew = false;
    for (const g of all) if (!inSet.has(g) && [...inSet].some((s) => gapBetween(s.box, g.box) <= gap)) { inSet.add(g); grew = true; }
  }
  return [...inSet].map((g) => g.box).reduce(union);
}

/**
 * The decision (exported for tests). `page` is the page size. Returns the mode and the box to cut (none: no box).
 * - no graphic near the text block → none (the card's text is enough)
 * - the pictures sit beside the text (not among its words) and some lie level with the quote → figure: those pictures,
 *   with every picture close to them (two graphs joined by an arrow come together)
 * - otherwise (pictures among the words, or none level with the quote) → block: the text block and its pictures
 */
export function decideCrop(quote: Box, rows: Row[], graphics: Graphic[], page: { width: number; height: number }, shades: Shade[] = []): { mode: CropMode; box?: Box; pad?: { top: number; bottom: number } } {
  const block = textBlock(quote, rows);
  if (!block) return { mode: "none" };
  const lineH = Math.max(6, quote.y1 - quote.y0);
  const near = graphics.filter((g) => gapBetween(g.box, block.box) <= lineH * 1.5);
  if (!near.length) return { mode: "none" };
  const joinGap = Math.min(page.width, page.height) * 0.06;
  // graphics among the block's words: a picture whose box covers rows of the block's text
  const blockRows = rows.filter((r) => overlap(r.box, block.box) > 0);
  // 그림 속 짧은 라벨(R_j, P_i)은 글 줄로 치지 않는다: 줄 길이가 몇 글자 높이를 넘는 것만
  const among = near.some((g) => blockRows.some((r) => r.box.x1 - r.box.x0 > lineH * 4 && overlap(r.box, g.box) > area(r.box) * 0.3));
  const level = near.filter((g) => block.quoteRows.some((q) => vOverlap(q, g.box) > 0 || gapBetween(q, g.box) <= lineH * 0.8));
  if (!among && level.length) {
    let box = cluster(level, graphics, joinGap)!;
    // 그림 덩어리에 붙은 색 상자(그림의 결론 글 상자 등)도 같이
    const core = box;
    // 그림 바로 밑·옆의 색 상자(그림의 결론 글)는 같이: 그림 폭 안에 있고 쪽 높이의 15% 안
    for (const sh of shades) if (sh.box.x0 >= core.x0 - lineH && sh.box.x1 <= core.x1 + lineH && gapBetween(sh.box, core) <= page.height * 0.15) box = union(box, sh.box);
    // 그림에 붙은 짧은 라벨(R_j 등)은 그림 상자 밖으로 조금 나가도 같이 (원래 그림 상자 기준, 한 번만)
    for (const r of rows) if ((r.box.x1 - r.box.x0 <= lineH * 4 || (r.box.x0 >= core.x0 - lineH && r.box.x1 <= core.x1 + lineH)) && gapBetween(r.box, core) <= lineH * 0.8) box = union(box, r.box);
    // 그 그림 덩어리 안에 들어간 글(그림 설명·라벨)은 같이 잘린다(상자로 자르니까).
    return { mode: "figure", box, pad: { top: 8, bottom: 8 } };
  }
  const box = [block.box, ...near.map((g) => g.box)].reduce(union);
  const whole = cluster(near, graphics, joinGap)!;
  return { mode: "block", box: union(box, whole), pad: { top: Math.max(0, Math.min(10, block.above / 2 - 1)), bottom: Math.max(0, Math.min(10, block.below / 2 - 1)) } };
}

/** Crop rectangle in pixels of an image drawn at `scale`, with padding, kept on the page. */
export function cropRect(box: Box, scale: number, page: { width: number; height: number }, pad = { top: 10, bottom: 10 }, side = 10) {
  const x = Math.max(0, Math.floor((box.x0 - side) * scale)), y = Math.max(0, Math.floor((box.y0 - pad.top) * scale));
  const w = Math.min(Math.ceil(page.width * scale) - x, Math.ceil((box.x1 - box.x0 + side * 2) * scale));
  const h = Math.min(Math.ceil(page.height * scale) - y, Math.ceil((box.y1 - box.y0 + pad.top + pad.bottom) * scale));
  return { x, y, w, h };
}

type ImageObj = { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array };
type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; getTextContent(): Promise<{ items: unknown[] }>; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  objs?: { has(id: string): boolean; get(id: string): unknown }; commonObjs?: { has(id: string): boolean; get(id: string): unknown } };

/**
 * The part of an image that shows something (11/8 그래픽스 04 p.30: 그림이 둘레에 큰 투명 여백을 단 채 박혀 있어 상자가 쪽 절반이
 * 됐다): bounds of the pixels that are neither transparent nor near-white, as fractions [u0, v0, u1, v1] of the image (v from the top).
 * Sampled on a coarse grid; null when the pixels cannot be read (then the whole image box is used).
 */
export function visibleFraction(img: ImageObj): [number, number, number, number] | null {
  const { width: W, height: H, data, kind } = img;
  if (!data || !W || !H) return null;
  const ch = kind === 3 ? 4 : kind === 2 ? 3 : 0;
  if (!ch || data.length < W * H * ch) return null;
  const step = Math.max(1, Math.floor(Math.max(W, H) / 400));
  let u0 = W, v0 = H, u1 = -1, v1 = -1;
  for (let v = 0; v < H; v += step) for (let u = 0; u < W; u += step) {
    const i = (v * W + u) * ch;
    if (ch === 4 && data[i + 3] < 24) continue;
    if (data[i] > 238 && data[i + 1] > 238 && data[i + 2] > 238) continue;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  if (u1 < 0) return [0, 0, 0, 0];
  return [u0 / W, v0 / H, Math.min(1, (u1 + step) / W), Math.min(1, (v1 + step) / H)];
}
/** Text runs, pictures and filled shapes of one page (top-left coordinates). */
export async function readPage(p: PdfPage, OPS: Record<string, number>) {
  const viewport = p.getViewport({ scale: 1 });
  const runs: TextRun[] = [];
  for (const item of (await p.getTextContent()).items as Array<{ str?: string; transform: number[]; height: number; width: number }>) if (typeof item.str === "string")
    runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], h: item.height || Math.hypot(item.transform[2], item.transform[3]), w: item.width });
  const ops = await p.getOperatorList();
  const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((v) => v !== undefined));
  const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  // 잘라 그리기(클립)와 폼 그림 테두리도 따라간다(11/8 그래픽스 04 p.30: 그림 하나를 세 번, 매번 다른 곳만 보이게 잘라 그렸다)
  const full: Box = { x0: 0, y0: 0, x1: viewport.width, y1: viewport.height };
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000", clip: Box = full;
  const stack: Array<{ ctm: number[]; fill: string; clip: Box }> = [];
  const times = (m: number[], t: number[]) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
  const raw = (x0: number, y0: number, x1: number, y1: number): Box => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: viewport.height - Math.max(...ys), y1: viewport.height - Math.min(...ys) };
  };
  const cut = (b: Box): Box => ({ x0: Math.max(b.x0, clip.x0), y0: Math.max(b.y0, clip.y0), x1: Math.min(b.x1, clip.x1), y1: Math.min(b.y1, clip.y1) });
  const toBox = (x0: number, y0: number, x1: number, y1: number): Box => cut(raw(x0, y0, x1, y1));
  const shapes: Array<{ box: Box; filled: boolean; stroked: boolean; fill: string }> = [];
  const graphics: Graphic[] = [];
  let lastPath: Box | null = null, clipNext = false;
  const clipOps = new Set([OPS.clip, OPS.eoClip].filter((v) => v !== undefined));
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push({ ctm, fill, clip }); else if (fn === OPS.restore) ({ ctm, fill, clip } = stack.pop() ?? { ctm: [1, 0, 0, 1, 0, 0], fill: "#000000", clip: full });
    else if (fn === OPS.transform) ctm = times(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, fill, clip });
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = times(ctm, Array.from(args[0] as ArrayLike<number>));
      const bb = args?.[1] as ArrayLike<number> | null | undefined;
      if (bb && bb.length === 4) clip = cut(raw(bb[0], bb[1], bb[2], bb[3]));
    } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, fill, clip } = stack.pop() ?? { ctm: [1, 0, 0, 1, 0, 0], fill: "#000000", clip: full });
    else if (fn === OPS.setFillRGBColor) fill = String(args?.[0] ?? fill);
    else if (clipOps.has(fn)) { if (lastPath) { clip = cut(lastPath); lastPath = null; } else clipNext = true; }
    else if (images.has(fn)) {
      // 보이는 부분만 (이미지 공간은 아래가 y=0이라 v를 뒤집는다)
      const id = String(args?.[0] ?? "");
      let obj: ImageObj | null = null;
      try { obj = (p.objs?.has(id) ? p.objs.get(id) : p.commonObjs?.has(id) ? p.commonObjs.get(id) : null) as ImageObj | null; } catch { obj = null; }
      const f = obj ? visibleFraction(obj) : null;
      if (f && f[2] <= f[0]) return; // 다 투명하거나 흰 그림
      const box = f ? toBox(f[0], 1 - f[3], f[2], 1 - f[1]) : toBox(0, 0, 1, 1);
      if (box.x1 > box.x0 && box.y1 > box.y0) graphics.push({ box, kind: "image" });
    }
    else if (fn === OPS.constructPath) {
      const op = Number(args?.[0]); const mm = args?.[2] as ArrayLike<number> | undefined;
      if (!mm) return;
      const box = raw(mm[0], mm[1], mm[2], mm[3]);
      if (op === OPS.endPath) { if (clipNext) { clip = cut(box); clipNext = false; } else lastPath = box; return; }
      lastPath = null;
      if (!(fills.has(op) || strokes.has(op))) return;
      const b = cut(box);
      if (b.x1 >= b.x0 && b.y1 >= b.y0 && (b.x1 > b.x0 || b.y1 > b.y0)) shapes.push({ box: b, filled: fills.has(op), stroked: strokes.has(op), fill });
    }
  });
  return { viewport, runs, shapes, graphics };
}

/** A row that reads as words (3+ words of 2+ letters), not code tokens like "P (S); P (Q);" or labels. */
const isSentence = (r: Row) => (r.text.match(/[\p{L}]{2,}/gu) ?? []).length >= 3;
const keyOf = (b: Box) => [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v / 3)).join(",");
/**
 * Pictures of the page as the reader sees them: images and drawn shapes, without the page background, the deck's
 * repeated frame (a shape at the same place on many pages), hairlines across the page, and colored boxes laid behind text
 * (those come back as shades).
 */
export function sortShapes(shapes: Array<{ box: Box; filled: boolean; stroked: boolean; fill: string }>, images: Graphic[], rows: Row[], page: { width: number; height: number }, frame: Set<string>) {
  const pageArea = page.width * page.height;
  // 글줄 높이: 식을 그림으로 박은 자료(그래픽스 04)는 줄마다 작은 식 그림이 있다 — 글줄 높이의 2.5배보다 낮은 그림은 글로 본다.
  const hs = rows.map((r) => r.box.y1 - r.box.y0).sort((a, b) => a - b), lineH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;
  const graphics: Graphic[] = images.filter((g) => {
    if (area(g.box) >= pageArea * 0.8 || area(g.box) <= pageArea * 0.002 || frame.has(keyOf(g.box))) return false;
    if (g.box.y1 - g.box.y0 < lineH * 2.5) return false; // 줄 속 식
    // 글줄 바로 옆에 붙은 그림(줄머리 "– " 뒤의 여러 줄 식)도 글로 본다
    if (rows.some((r) => vOverlap(r.box, g.box) > (r.box.y1 - r.box.y0) * 0.5 && gapBetween(r.box, g.box) < lineH * 3 && r.box.x1 <= g.box.x0 + lineH)) return false;
    const under = rows.filter((r) => overlap(r.box, g.box) > area(r.box) * 0.6).length;
    if (under >= 4 && area(g.box) > pageArea * 0.2) return false; // 글 뒤에 깐 큰 그림(바탕)
    return true;
  });
  const shades: Shade[] = [];
  for (const s of shapes) {
    const w = s.box.x1 - s.box.x0, h = s.box.y1 - s.box.y0;
    if (area(s.box) > pageArea * 0.8 || frame.has(keyOf(s.box))) continue;
    if (w < 1.5 && h < 1.5) continue;
    if (h < 2.5 && w > page.width * 0.5) continue; // 쪽을 가로지르는 줄(제목 밑줄)
    const white = /^#?(f[ef]){3}$/i.test(s.fill) || s.fill.toLowerCase() === "#ffffff";
    const covered = rows.filter((r) => overlap(r.box, s.box) > area(r.box) * 0.6);
    // 글 뒤 색 상자: 문장 줄(글자 높이의 4배보다 긴 줄)을 덮는 칠한 도형. 짧은 라벨(P_i)을 덮는 동그라미는 그림이다.
    const sentence = covered.some((r) => r.box.x1 - r.box.x0 > (r.box.y1 - r.box.y0) * 4);
    if (s.filled && sentence && !white) { shades.push({ box: s.box, color: s.fill }); continue; }
    if (s.filled && !s.stroked && white) continue;
    // 글을 둘러싼 테두리 상자(글이 상자 넓이 대부분을 차지)는 그림이 아니다
    const textArea = covered.reduce((a, r) => a + overlap(r.box, s.box), 0);
    if (covered.length >= 2 && textArea > area(s.box) * 0.25 && w > page.width * 0.3) continue;
    graphics.push({ box: s.box, kind: "drawing" });
  }
  // 이어진 그림 덩어리마다 그 안에 문장 줄이 둘 이상이면 그림이 아니라 글(선으로 그린 식·글자)로 본다(그래픽스 04 p.14의 식들).
  const gap = Math.min(page.width, page.height) * 0.06, left = [...graphics], keep: Graphic[] = [];
  while (left.length) {
    const group = [left.shift()!];
    for (let grew = true; grew;) { grew = false; for (let i = left.length - 1; i >= 0; i--) if (group.some((g) => gapBetween(g.box, left[i].box) <= gap)) { group.push(...left.splice(i, 1)); grew = true; } }
    // 덩어리 상자가 아니라 도형 하나하나가 문장 줄을 덮는지로 본다(세마포어 화살표처럼 줄 사이를 지나는 선은 줄을 덮지 않는다)
    const sentences = rows.filter((r) => isSentence(r) && group.reduce((a, g) => a + (area(g.box) < area(r.box) * 3 ? overlap(r.box, g.box) : 0), 0) > area(r.box) * 0.3).length; // 줄을 통째로 감싼 큰 테두리는 빼고
    if (sentences < 2) keep.push(...group);
  }
  return { graphics: keep, shades };
}

/** For each quote on one page: whether to cut and what (JPEG data URL when cut). `frame` from `frameOf` (shapes repeated across the deck). */
export async function cropQuotes(bytes: Uint8Array, page: number, quotes: string[], options: { width?: number; frame?: Set<string> } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  try {
    const OPS = pdfjs.OPS as Record<string, number>;
    const p = await document.getPage(page) as unknown as PdfPage & { render: (o: unknown) => { promise: Promise<void> } };
    const { viewport, runs, shapes, graphics: images } = await readPage(p, OPS);
    const placed = placeRuns(runs, viewport.height);
    const rows = rowsOf(placed);
    const { graphics, shades } = sortShapes(shapes, images, rows, viewport, options.frame ?? new Set());
    let canvas: import("@napi-rs/canvas").Canvas | undefined;
    const width = options.width ?? 1600, scale = width / Math.max(viewport.width, viewport.height);
    const draw = async () => {
      if (canvas) return canvas;
      const view = p.getViewport({ scale });
      const c = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
      const ctx = c.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvas: c, canvasContext: ctx, viewport: view }).promise;
      canvas = c;
      return c;
    };
    const out = [];
    for (const quote of quotes) {
      const hit = findQuote(placed, quote);
      if (!hit) { out.push({ quote, found: false, mode: "none" as CropMode }); continue; }
      const d = decideCrop(hit, rows, graphics, viewport, shades);
      const emphasized = shades.some((s) => overlap(s.box, hit) > area(hit) * 0.5);
      if (d.mode === "none" || !d.box) { out.push({ quote, found: true, mode: d.mode, emphasized }); continue; }
      const r = cropRect(d.box, scale, viewport, d.pad);
      const c = await draw();
      const cut = createCanvas(r.w, r.h); cut.getContext("2d").drawImage(c as never, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      out.push({ quote, found: true, mode: d.mode, emphasized, box: [d.box.x0 / viewport.width, d.box.y0 / viewport.height, d.box.x1 / viewport.width, d.box.y1 / viewport.height],
        image: `data:image/jpeg;base64,${cut.toBuffer("image/jpeg", 85).toString("base64")}` });
    }
    return out;
  } finally { await (document as unknown as { cleanup?: () => Promise<void> }).cleanup?.(); }
}

/** Shapes and pictures at the same place on many pages of the deck (template frame), to leave out. */
export async function frameOf(bytes: Uint8Array, pages: number[], share = 0.4) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const count = new Map<string, number>();
  try {
    for (const n of pages) {
      const { shapes, graphics } = await readPage(await document.getPage(n) as unknown as PdfPage, pdfjs.OPS as Record<string, number>);
      for (const k of new Set([...shapes.map((s) => keyOf(s.box)), ...graphics.map((g) => keyOf(g.box))])) count.set(k, (count.get(k) ?? 0) + 1);
    }
  } finally { await (document as unknown as { cleanup?: () => Promise<void> }).cleanup?.(); }
  return new Set([...count].filter(([, c]) => pages.length >= 3 && c >= pages.length * share).map(([k]) => k));
}

/**
 * 그림 위치 힌트로 자르기 (11/8 그래픽스 04처럼 글자가 그림으로 박혀 인용으로 위치를 못 찾는 자료): 카드 AI가 쪽 그림을 보고
 * 대략의 상자(쪽을 0~100으로 본 [x0, y0, x1, y1])를 주면, 코드가 그 상자와 겹치는 그림 덩어리에 맞춘다(figure).
 * 겹치는 그림이 없거나 애매하면 AI 상자를 조금 넓혀 그대로 자른다(block, 사용자 "애매하면 덩어리").
 */
export function snapHint(hint: Box, graphics: Graphic[], page: { width: number; height: number }, rows: Row[] = [], placed: Placed[] = []): { mode: CropMode; box?: Box } {
  const d = snapAt(hint, graphics, page, rows, placed);
  if (d.mode !== "none" || page.width <= page.height) return d;
  // 11/8 그래픽스 04: 가로 쪽에서 AI가 세로 위치를 가로 길이 기준(정사각형)으로 준 카드가 있었다(p.29 힌트 y 33~51 → 그림 57~91 = ×960/540).
  // 그 자리에 그림이 없을 때만, 비율을 고친 자리에서 그림이 딱 잡히면 그것을 쓴다.
  const k = page.width / page.height;
  if (hint.y1 * k > page.height * 1.02) return d;
  const fixed = snapAt({ ...hint, y0: hint.y0 * k, y1: hint.y1 * k }, graphics, page, rows, placed);
  return fixed.mode === "figure" ? fixed : d;
}

function snapAt(hint: Box, graphics: Graphic[], page: { width: number; height: number }, rows: Row[], placed: Placed[]): { mode: CropMode; box?: Box } {
  const pageArea = page.width * page.height;
  const joinGap = Math.min(page.width, page.height) * 0.06;
  const big = (b: Box) => area(b) > pageArea * 0.6;
  // 그림에 붙은 짧은 라벨(R_j, P_i, (a))이 상자 밖으로 조금 나가면 같이
  const hs = rows.map((r) => r.box.y1 - r.box.y0).sort((x, y) => x - y), lineH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;
  // 줄이 아니라 글자 조각 단위로(같은 높이의 라벨 R₁, R₂가 한 줄로 묶이면 줄 폭이 그림보다 넓어져 빠졌다)
  const labels = placed.length ? placed.filter((p) => (p.str.match(/[\p{L}]{2,}/gu) ?? []).length < 3).map((p) => p.box) : rows.filter((r) => !isSentence(r)).map((r) => r.box);
  const withLabels = (box: Box) => labels.reduce((b, l) => (gapBetween(l, box) <= lineH * 1.2 && l.x0 >= box.x0 - lineH * 2 && l.x1 <= box.x1 + lineH * 2 ? union(b, l) : b), box);
  // 쪽 절반이 넘는 그림은 바탕·내용 틀로 본다(11/8: 틀을 12쪽만 보고 정해 놓친 내용 상자가 덩어리를 쪽 전체로 키워 그림 27개가 빠졌다)
  const pool = big(hint) ? graphics : graphics.filter((g) => area(g.box) <= pageArea * 0.5);
  const touching = pool.filter((g) => overlap(g.box, hint) > Math.min(area(g.box), area(hint)) * 0.3);
  if (touching.length) {
    const box = cluster(touching, pool, joinGap)!;
    if (!big(box)) {
      // 그림이 힌트보다 훨씬 작으면(세마포어: 화살표만 그림이고 코드는 글) 힌트가 가리킨 덩어리를 믿는다. 힌트가 쪽 대부분이면 그림 쪽을.
      if (area(box) >= area(hint) * 0.35 || big(hint)) return { mode: "figure", box: withLabels(box) };
      return { mode: "block", box: withLabels(hint) };
    }
  }
  // 근처에 그림이 없으면 자르지 않는다(11/8 그래픽스 점검: 글줄이 그림으로 박힌 쪽에서 글만 반쯤 잘려 나왔다)
  return { mode: "none" };
}

export async function cropHints(bytes: Uint8Array, page: number, hints: Array<[number, number, number, number]>, options: { width?: number; frame?: Set<string> } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  try {
    const p = await document.getPage(page) as unknown as PdfPage & { render: (o: unknown) => { promise: Promise<void> } };
    const { viewport, runs, shapes, graphics: images } = await readPage(p, pdfjs.OPS as Record<string, number>);
    const rows = rowsOf(placeRuns(runs, viewport.height));
    const { graphics } = sortShapes(shapes, images, rows, viewport, options.frame ?? new Set());
    const width = options.width ?? 1600, scale = width / Math.max(viewport.width, viewport.height);
    const view = p.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport: view }).promise;
    return hints.map((h) => {
      const hint: Box = { x0: h[0] / 100 * viewport.width, y0: h[1] / 100 * viewport.height, x1: h[2] / 100 * viewport.width, y1: h[3] / 100 * viewport.height };
      const d = snapHint(hint, graphics, viewport, rows, placeRuns(runs, viewport.height));
      if (d.mode === "none" || !d.box) return { hint: h, mode: "none" as CropMode };
      const r = cropRect(d.box, scale, viewport, { top: 8, bottom: 8 }, 8);
      const cut = createCanvas(Math.max(1, r.w), Math.max(1, r.h)); cut.getContext("2d").drawImage(canvas as never, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return { hint: h, mode: d.mode, box: [d.box.x0 / viewport.width, d.box.y0 / viewport.height, d.box.x1 / viewport.width, d.box.y1 / viewport.height], image: `data:image/jpeg;base64,${cut.toBuffer("image/jpeg", 85).toString("base64")}` };
    });
  } finally { await (document as unknown as { cleanup?: () => Promise<void> }).cleanup?.(); }
}

/**
 * 한 자료를 한 번만 열어 쪽마다 한 번만 읽고 그린다 (11/8 그래픽스 04: 쪽마다 PDF를 다시 열고 다시 그려 61초) — figures.ts가 주제 카드가
 * 나오는 대로 부른다. 틀(여러 쪽 되풀이 도형)은 쪽을 고르게 최대 12쪽만 보고 정한다.
 */
export async function openCropper(bytes: Uint8Array, pages: number[], width = 1400) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const OPS = pdfjs.OPS as Record<string, number>;
  type Ctx = { viewport: { width: number; height: number }; placed: Placed[]; rows: Row[]; graphics: Graphic[]; shades: Shade[]; scale: number; canvas?: import("@napi-rs/canvas").Canvas; page: PdfPage & { render: (o: unknown) => { promise: Promise<void> } } };
  const cache = new Map<number, Promise<Ctx>>();
  let queue: Promise<unknown> = Promise.resolve(); // pdf.js는 한 줄로
  const serial = <T>(fn: () => Promise<T>) => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run; };
  const sample = pages.length <= 12 ? pages : Array.from({ length: 12 }, (_, i) => pages[Math.floor(i * (pages.length - 1) / 11)]);
  const raw = new Map<number, Awaited<ReturnType<typeof readPage>>>();
  const framePromise = serial(async () => {
    const count = new Map<string, number>();
    for (const n of sample) {
      const r = await readPage(await document.getPage(n) as unknown as PdfPage, OPS); raw.set(n, r);
      for (const k of new Set([...r.shapes.map((x) => keyOf(x.box)), ...r.graphics.map((g) => keyOf(g.box))])) count.set(k, (count.get(k) ?? 0) + 1);
    }
    return new Set([...count].filter(([, c]) => sample.length >= 3 && c >= sample.length * 0.4).map(([k]) => k));
  });
  const ctxOf = (n: number) => {
    if (!cache.has(n)) cache.set(n, framePromise.then((frame) => serial(async () => {
      const page = await document.getPage(n) as unknown as Ctx["page"];
      const r = raw.get(n) ?? await readPage(page, OPS);
      const placed = placeRuns(r.runs, r.viewport.height), rows = rowsOf(placed);
      const { graphics, shades } = sortShapes(r.shapes, r.graphics, rows, r.viewport, frame);
      return { viewport: r.viewport, placed, rows, graphics, shades, scale: width / Math.max(r.viewport.width, r.viewport.height), page };
    })));
    return cache.get(n)!;
  };
  const cut = async (c: Ctx, box: Box, pad?: { top: number; bottom: number }) => serial(async () => {
    if (!c.canvas) {
      const view = c.page.getViewport({ scale: c.scale });
      const cv = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
      const g = cv.getContext("2d"); g.fillStyle = "white"; g.fillRect(0, 0, cv.width, cv.height);
      await c.page.render({ canvas: cv, canvasContext: g, viewport: view }).promise;
      c.canvas = cv;
    }
    const r = cropRect(box, c.scale, c.viewport, pad ?? { top: 8, bottom: 8 }, 8);
    const out = createCanvas(Math.max(1, r.w), Math.max(1, r.h)); out.getContext("2d").drawImage(c.canvas as never, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return out.toBuffer("image/jpeg", 85);
  });
  const frac = (c: Ctx, b: Box) => [b.x0 / c.viewport.width * 100, b.y0 / c.viewport.height * 100, b.x1 / c.viewport.width * 100, b.y1 / c.viewport.height * 100];
  return {
    /** AI 그림 위치(0~100) → 맞춘 그림 */
    async hint(n: number, h: number[]) {
      const c = await ctxOf(n);
      const hint: Box = { x0: h[0] / 100 * c.viewport.width, y0: h[1] / 100 * c.viewport.height, x1: h[2] / 100 * c.viewport.width, y1: h[3] / 100 * c.viewport.height };
      const d = snapHint(hint, c.graphics, c.viewport, c.rows, c.placed);
      if (d.mode === "none" || !d.box) return null;
      return { mode: d.mode, box: frac(c, d.box), jpeg: await cut(c, d.box) };
    },
    /** 원문 인용 → 둘레에 그림이 있을 때만 */
    async quote(n: number, q: string) {
      const c = await ctxOf(n);
      const hit = findQuote(c.placed, q);
      if (!hit) return null;
      const d = decideCrop(hit, c.rows, c.graphics, c.viewport, c.shades);
      if (d.mode === "none" || !d.box) return null;
      return { mode: d.mode, box: frac(c, d.box), jpeg: await cut(c, d.box, d.pad) };
    },
    async close() { await queue; await (document as unknown as { cleanup?: () => Promise<void> }).cleanup?.(); },
  };
}
