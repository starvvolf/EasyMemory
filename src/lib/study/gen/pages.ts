// Page images for slides whose content lives in pictures (matrices, diagrams, charts, scanned text).
// Such pages are read once from an image and the reading replaces the page text for every later step
// (docs/DECISIONS.md 2026-10-12 "그림 쪽 글로 옮기기"). Rendering runs on the server with @napi-rs/canvas.

/** Long side of the rendered page in pixels: enough for slide text and subscripts, small enough for one request. */
const RENDER_WIDTH = 1600;

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { pdfjs, document: await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise };
}

/** Renders pages to JPEG data URLs. */
export async function renderPageImages(bytes: Uint8Array, pages: readonly number[], width = RENDER_WIDTH) {
  const [{ createCanvas }, { document }] = await Promise.all([import("@napi-rs/canvas"), openPdf(bytes)]);
  const images = new Map<number, string>();
  try {
    for (const pageNumber of [...new Set(pages)]) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / Math.max(base.width, base.height) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      images.set(pageNumber, `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 85).toString("base64")}`);
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return images;
}

/** A cropped picture region of a page (rendered page pixels, so labels drawn over the picture come along). */
export type PageFigure = { page: number; label: string; dataUrl: string; area: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
const MIN_FIGURE = 0.01;   // smaller pictures (bullets, icons) are left out
const MERGE_GAP = 0.02;    // pictures this close (fraction of the page width) are one figure
const MARGIN = 0.015;      // a little room around each figure for nearby labels
const WHOLE_PAGE = 0.8;    // figures covering more than this: send the page itself
const LOGO_PAGES = 3;      // the same small picture on this many pages is the slide template
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const near = (a: Box, b: Box, gap: number) => a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1;
const where = (b: Box, w: number, h: number) => {
  const cx = (b.x0 + b.x1) / 2 / w, cy = (b.y0 + b.y1) / 2 / h;
  return `${cy < 0.34 ? "위" : cy > 0.66 ? "아래" : "가운데"}${cx < 0.34 ? " 왼쪽" : cx > 0.66 ? " 오른쪽" : ""}`;
};

/**
 * Picture regions of pages, cropped from the rendered page: the plan sees each picture (with the labels and arrows
 * drawn on it) instead of the whole slide, about half the image tokens on picture slides (그래픽스03 1~24쪽: pictures
 * cover ~45% of a slide on average). Pages whose pictures fill most of the slide are sent whole; a page with no
 * picture and almost no text (a vector drawing) is sent whole too. Returns the figures per page in reading order.
 */
export async function renderPageFigures(bytes: Uint8Array, pages: readonly number[], width = RENDER_WIDTH) {
  const [{ createCanvas }, { pdfjs, document }] = await Promise.all([import("@napi-rs/canvas"), openPdf(bytes)]);
  const OPS = pdfjs.OPS as Record<string, number>;
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter(v => v !== undefined));
  const found = new Map<number, Array<Box & { id: string }>>();
  const seen = new Map<string, Set<number>>();
  const result = new Map<number, PageFigure[]>();
  try {
    const wanted = [...new Set(pages)].filter(n => Number.isInteger(n) && n >= 1 && n <= document.numPages);
    // Pass 1: where each picture is painted (user space → viewport), from the operator list and its transforms.
    for (const n of wanted) {
      const page = await document.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / Math.max(base.width, base.height) });
      const ops = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      const times = (m: number[], t: number[]) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
      const boxes: Array<Box & { id: string }> = [];
      ops.fnArray.forEach((fn, i) => {
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = times(ctm, args as number[]);
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = times(ctm, args[0] as number[]); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (paint.has(fn)) {
          const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
          const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
          const box = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(viewport.width, Math.max(...xs)), y1: Math.min(viewport.height, Math.max(...ys)), id: String(args?.[0] ?? `inline-${i}`) };
          if (area(box) >= MIN_FIGURE * viewport.width * viewport.height) boxes.push(box);
        }
      });
      for (const b of boxes) (seen.get(b.id) ?? seen.set(b.id, new Set()).get(b.id)!).add(n);
      found.set(n, boxes);
      page.cleanup();
    }
    // Pass 2: drop template pictures, merge neighbours, crop from the rendered page.
    for (const n of wanted) {
      const page = await document.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / Math.max(base.width, base.height) });
      const W = viewport.width, H = viewport.height, full = W * H;
      let boxes: Box[] = (found.get(n) ?? []).filter(b => !((seen.get(b.id)?.size ?? 0) >= LOGO_PAGES && area(b) < 0.08 * full)).map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
      for (let merged = true; merged;) {
        merged = false;
        outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (near(boxes[i], boxes[j], MERGE_GAP * W)) {
          const a = boxes[i], b = boxes[j];
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          boxes.splice(j, 1); merged = true; break outer;
        }
      }
      boxes = boxes.map(b => ({ x0: Math.max(0, b.x0 - MARGIN * W), y0: Math.max(0, b.y0 - MARGIN * H), x1: Math.min(W, b.x1 + MARGIN * W), y1: Math.min(H, b.y1 + MARGIN * H) }))
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      const covered = boxes.reduce((s, b) => s + area(b), 0) / full;
      const text = (await page.getTextContent()).items.map(item => ("str" in item ? item.str : "")).join(" ");
      const whole = covered > WHOLE_PAGE || (!boxes.length && meaningfulChars(text) < 100);
      if (!boxes.length && !whole) { result.set(n, []); page.cleanup(); continue; }
      const canvas = createCanvas(Math.ceil(W), Math.ceil(H));
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      if (whole) result.set(n, [{ page: n, label: `원문 p.${n} (쪽 전체)`, dataUrl: `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 85).toString("base64")}`, area: 1 }]);
      else result.set(n, boxes.map((b, k) => {
        const w = Math.ceil(b.x1 - b.x0), h = Math.ceil(b.y1 - b.y0);
        const crop = createCanvas(w, h);
        crop.getContext("2d").drawImage(canvas as never, b.x0, b.y0, w, h, 0, 0, w, h);
        return { page: n, label: `원문 p.${n} 그림${k + 1} (${where(b, W, H)})`, dataUrl: `data:image/jpeg;base64,${crop.toBuffer("image/jpeg", 85).toString("base64")}`, area: area(b) / full };
      }));
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return result;
}

/**
 * Coloured text (a lecturer's red/blue emphasis) per page, from the operator list: the fill colour in force when each
 * text run is shown. Black, grey and white are ordinary text; template bullets and one-letter runs are left out.
 * The text layer itself carries no colour, so this is added to it as a [색 강조] line.
 */
export async function pageEmphasis(bytes: Uint8Array, pages: readonly number[]) {
  const { pdfjs, document } = await openPdf(bytes);
  const OPS = pdfjs.OPS as Record<string, number>;
  const result = new Map<number, string[]>();
  const nameOf = (hex: string) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) < 70) return null;   // black, grey, white
    if (r > 150 && g < 110 && b < 110) return "빨강";
    if (r > 180 && g >= 110 && g < 190 && b < 110) return "주황";
    if (b > 140 && r < 120) return "파랑";
    if (g > 120 && r < 110 && b < 130) return "초록";
    return "색";
  };
  try {
    for (const n of [...new Set(pages)]) {
      if (!Number.isInteger(n) || n < 1 || n > document.numPages) continue;
      const page = await document.getPage(n);
      const ops = await page.getOperatorList();
      let fill: string | null = null;
      const stack: Array<string | null> = [];
      const runs: Array<{ color: string; text: string }> = [];
      ops.fnArray.forEach((fn, i) => {
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(fill);
        else if (fn === OPS.restore) fill = stack.pop() ?? null;
        else if (fn === OPS.setFillRGBColor) fill = typeof args?.[0] === "string" ? nameOf(args[0] as string) : null;
        else if (fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) fill = null;
        else if (fn === OPS.showText || fn === OPS.showSpacedText) {
          if (!fill) return;
          const glyphs = (args?.[0] ?? []) as Array<{ unicode?: string } | number>;
          const text = glyphs.map(g => typeof g === "number" ? (g < -200 ? " " : "") : g?.unicode ?? "").join("");
          const last = runs.at(-1);
          if (last && last.color === fill) last.text += text; else runs.push({ color: fill, text });
        } else if (fn === OPS.endText) runs.push({ color: "", text: "" });   // a new text block starts a new run
      });
      const kept = [...new Set(runs.filter(r => r.color).map(r => `${r.color}: ${r.text.replace(/\s+/g, " ").trim()}`))]
        .filter(line => meaningfulChars(line.slice(line.indexOf(":") + 1)) >= 2).slice(0, 30);
      if (kept.length) result.set(n, kept);
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return result;
}

export const meaningfulChars = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Below this many letters and digits a slide is read from its image; a full text slide is left to its text layer. */
export const TEXT_RICH_CHARS = 600;
/**
 * Pages worth reading from the image. Picture counts were tried and dropped: slide templates repeat decorative
 * images on every page, while a matrix drawn as one picture looks like any other slide (graphics 02 p.10).
 * Reading costs about 2,000 input tokens and 10–30 s per page (GPT 실측 2026-10-12), so anything short of a full
 * text slide is read.
 */
export function needsImage(text: string) {
  return meaningfulChars(text) < TEXT_RICH_CHARS;
}

export const TRANSCRIBE_SYSTEM = [
  "너는 강의 슬라이드 한 쪽을 글로 옮기는 사람이다. 이미지에 보이는 것만 옮기고, 보이지 않는 내용은 지어내지 않는다.",
  "순서: 제목 → 본문 글(글머리표 구조 유지) → 식(LaTeX, $...$) → 표(마크다운 표) → 그림·도표(무엇을 보여 주는지 한두 문장, 그림 안 글자·수치·축 이름은 그대로).",
  "원문의 언어와 표기를 그대로 둔다. 해설·요약·번역을 덧붙이지 않는다. 읽을 수 없는 부분은 [읽을 수 없음]으로 쓴다.",
  "아래 [글자 층]은 PDF에서 뽑은 글자다. 깨졌거나 빠진 부분이 있을 수 있으니 이미지를 기준으로 하고, 글자 층에 있는 문장은 글자 그대로 살린다.",
].join("\n");
