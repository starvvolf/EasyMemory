// 전처리 (Recaller 문제 생성 파이프라인, 2026-10-24): every chosen PDF page is read by code first — lines rebuilt from the
// text layer's positions, bullets and their levels kept, broken words and math-font letters fixed, page numbers and
// repeated footers dropped — and only pages code cannot read well (pictures, formulas, vector diagrams, scans, broken
// text) are sent to the model as an image. Consecutive slides with the same title become one section.
// The pure functions below take plain text items so they can be tested without pdf.js.

/** One text run from pdf.js getTextContent: position of its baseline (PDF units, y up), font size, end-of-line flag. */
export type TextRun = { str: string; x: number; y: number; h: number; w?: number; eol?: boolean; font?: string };
export type Line = { y: number; x: number; h: number; bullet: string | null; text: string };
/** How a page is read: by its text layer, by its picture regions (cropped), by the whole page image, or not at all. */
export type PrepRoute = "layer" | "figures" | "page" | "empty";
export type PageStats = { chars: number; mathChars: number; brokenChars: number; lines: number; orphanLines: number;
  /** Area share of content pictures (template pictures that repeat on many pages left out). */
  pictureCover: number; pathOps: number;
  /** prep-2: letters from a math font with no real ToUnicode (PowerPoint subsets: subscripts come out as !"#$%). */
  garbledChars?: number };
export type PrepPage = { page: number; title: string; text: string; route: PrepRoute; score: number; reasons: string[]; stats: PageStats;
  /** Content pictures as [x0, y0, x1, y1] fractions of the page from the top left (template pictures left out). */
  figures?: number[][] };
export type PrepSection = { id: string; title: string; pages: number[] };
export type PrepResult = { version: string; pages: PrepPage[]; sections: PrepSection[] };

export const PREP_VERSION = "prep-1";
const BULLETS = /^([•◦▪▫■□●○◆◇▶►▸▹➢➤✓✔※\-–—»·*]|\d{1,2}[.)]|[a-z][.)]|[①-⑳]|[ⅰ-ⅹ][.)]?)$/u;
const meaningful = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

/**
 * Text as a reader would type it: math-alphabet letters (𝑉𝑣𝑖𝑒𝑤 → Vview) and full-width forms via NFKC, the ㎿ glyph some
 * slide decks use for a hyphen (see checks.ts cleanPageText), and runs of spaces.
 */
export function normalizeText(text: string) {
  // ㎿ first: NFKC would turn it into "MW".
  return text.replace(/(?<=[\p{L}\p{N}])\s*㎿\s*(?=[\p{L}\p{N}])/gu, "-").replace(/㎿/g, "-").normalize("NFKC")
    .replace(/[  -​]/g, " ").replace(/[ \t]+/g, " ").trim();
}

/** Runs on one baseline become a line (left to right); a bullet glyph that starts the line is kept apart from its text. */
export function linesFrom(runs: TextRun[]): Line[] {
  const kept = runs.filter((r) => r.str && r.str.trim() && r.h > 0);
  const rows: TextRun[][] = [];
  for (const run of [...kept].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - run.y) <= Math.max(2, 0.35 * Math.min(r[0].h, run.h)));
    if (row) row.push(run); else rows.push([run]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let bullet: string | null = null;
    let parts = row;
    const first = row[0].str.trim();
    if (row.length > 1 && BULLETS.test(first)) { bullet = first; parts = row.slice(1); }
    let text = "";
    let end = -Infinity;
    let prevFont: string | undefined;
    for (const run of parts) {
      // A gap wider than a third of the font size between runs is a space the text layer left out.
      const gap = run.x - end;
      // So is a switch between fonts (a math-italic symbol inside a sentence: "the" + "z" + "axis") where letters meet.
      const fontSwitch = prevFont !== undefined && run.font !== prevFont && /[\p{L}\p{N}]$/u.test(text) && /^[\p{L}\p{N}]/u.test(run.str);
      if (text && !/\s$/.test(text) && !/^\s/.test(run.str) && (gap > 0.3 * run.h || fontSwitch)) text += " ";
      prevFont = run.font;
      text += run.str;
      end = run.x + (run.w ?? run.str.length * run.h * 0.5);
    }
    return { y: row[0].y, x: parts[0]?.x ?? row[0].x, h: Math.max(...row.map((r) => r.h)), bullet, text: normalizeText(text) };
  }).filter((line) => line.text || line.bullet);
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * A page's lines as structured text: the title (largest type near the top), bullets as "- " indented by level, a line
 * that only continues the one above (same indent, no bullet, close below) joined to it, and the page number dropped.
 */
export function structure(lines: Line[], pageHeight: number): { title: string; text: string; orphanLines: number } {
  if (!lines.length) return { title: "", text: "", orphanLines: 0 };
  const body = median(lines.map((l) => l.h));
  const top = lines.filter((l) => l.y > pageHeight * 0.7 && !l.bullet && meaningful(l.text) >= 2);
  const biggest = top.sort((a, b) => b.h - a.h)[0];
  const title = biggest && biggest.h >= body * 1.25 ? biggest : null;
  const rest = lines.filter((l) => l !== title && !(/^\d{1,3}$/.test(l.text) && !l.bullet && (l.y < pageHeight * 0.1 || l.h < body * 0.8)));
  // Bullet levels by indent: the distinct x positions where bullets stand, left to right.
  const marks: number[] = [];
  for (const x of rest.filter((l) => l.bullet).map((l) => l.x).sort((a, b) => a - b)) if (!marks.some((m) => Math.abs(m - x) < 6)) marks.push(x);
  const levelOf = (x: number) => Math.max(0, marks.findIndex((m) => Math.abs(m - x) < 6));
  const out: Array<{ level: number; bullet: boolean; text: string; x: number; y: number; h: number }> = [];
  for (const line of rest) {
    const prev = out.at(-1);
    const continues = prev && !line.bullet && Math.abs(line.x - prev.x) < 6 && prev.y - line.y <= 1.8 * Math.max(line.h, prev.h) && line.h <= prev.h * 1.15;
    if (prev && continues) {
      // "Back" + "-Face Removal" → "Back-Face Removal"; a word cut with a hyphen at the line end joins too.
      prev.text = /^[-‐-]/.test(line.text) || /[A-Za-z]-$/.test(prev.text) ? prev.text + line.text.replace(/^\s+/, "") : `${prev.text} ${line.text}`;
      prev.y = line.y;
      continue;
    }
    out.push({ level: line.bullet ? levelOf(line.x) : 0, bullet: !!line.bullet, text: line.text, x: line.x, y: line.y, h: line.h });
  }
  const text = out.map((l) => (l.bullet ? `${"  ".repeat(l.level)}- ${l.text}` : l.text)).join("\n");
  const orphanLines = out.filter((l) => meaningful(l.text) <= 2).length;
  return { title: title ? title.text : "", text, orphanLines };
}

/**
 * How well code read the page (1 = clean), and which way to read it. Pictures, formulas and drawings are not in the
 * text layer at all, so a page with them goes to the model as well — cropped pictures when the rest is clean text,
 * the whole page when the formulas or drawings are part of the text flow.
 */
export function routePage(stats: PageStats, router: PrepRouter = "prep-1"): { route: PrepRoute; score: number; reasons: string[] } {
  if (router === "prep-2") return routePage2(stats);
  const reasons: string[] = [];
  const orphan = stats.lines ? stats.orphanLines / stats.lines : 0;
  const broken = stats.chars ? stats.brokenChars / (stats.chars + stats.brokenChars) : 0;
  let score = 1 - Math.min(0.5, orphan) - Math.min(0.5, broken * 5);
  if (stats.mathChars >= 5) { score -= 0.2; reasons.push(`수식 글꼴 ${stats.mathChars}자`); }
  if (orphan > 0.25) reasons.push(`짧게 끊긴 줄 ${Math.round(orphan * 100)}%`);
  if (broken > 0.02) reasons.push("깨진 글자");
  score = Math.max(0, Math.round(score * 100) / 100);
  if (stats.chars < 5 && stats.pictureCover < 0.05 && stats.pathOps < 20) return { route: "empty", score, reasons: [...reasons, "내용 없음"] };
  if (stats.chars < 40) return { route: "page", score, reasons: [...reasons, stats.pictureCover > 0.3 ? "그림으로 된 쪽" : "글자 층 거의 없음(스캔·그림)"] };
  if (stats.pictureCover > 0.6) return { route: "page", score, reasons: [...reasons, "그림이 쪽 대부분"] };
  if (score < 0.7 || stats.mathChars >= 5) return { route: "page", score, reasons };
  if (stats.pathOps > 150) return { route: "page", score, reasons: [...reasons, "선으로 그린 도식"] };
  if (stats.pictureCover >= 0.08) return { route: "figures", score, reasons: [...reasons, `그림 ${Math.round(stats.pictureCover * 100)}%`] };
  return { route: "layer", score, reasons };
}

export const prepRouters = ["prep-1", "prep-2"] as const;
export type PrepRouter = (typeof prepRouters)[number];
/**
 * prep-2 (실험, 2026-10-28 연구 1): math-alphabet letters (𝑃, 𝑧) read fine once NFKC turns them into P, z, so they no longer
 * send a page to the model. What does: letters the text layer cannot give (a math font with no ToUnicode, short runs
 * of broken lines), pictures, and pages with almost no text.
 */
function routePage2(stats: PageStats): { route: PrepRoute; score: number; reasons: string[] } {
  const reasons: string[] = [];
  const orphan = stats.lines ? stats.orphanLines / stats.lines : 0;
  const broken = stats.chars ? stats.brokenChars / (stats.chars + stats.brokenChars) : 0;
  let score = 1 - Math.min(0.5, orphan) - Math.min(0.5, broken * 5);
  if (stats.garbledChars) { score -= 0.3; reasons.push(`깨진 수식 글자 ${stats.garbledChars}자`); }
  if (orphan > 0.25) reasons.push(`짧게 끊긴 줄 ${Math.round(orphan * 100)}%`);
  if (broken > 0.02) reasons.push("깨진 글자");
  score = Math.max(0, Math.round(score * 100) / 100);
  if (stats.chars < 5 && stats.pictureCover < 0.05 && stats.pathOps < 20) return { route: "empty", score, reasons: [...reasons, "내용 없음"] };
  if (stats.chars < 40) return { route: "page", score, reasons: [...reasons, stats.pictureCover > 0.3 ? "그림으로 된 쪽" : "글자 층 거의 없음(스캔·그림)"] };
  if (stats.pictureCover > 0.6) return { route: "page", score, reasons: [...reasons, "그림이 쪽 대부분"] };
  if (score < 0.7 || stats.garbledChars) return { route: "page", score, reasons };
  if (stats.pathOps > 150) return { route: "page", score, reasons: [...reasons, "선으로 그린 도식"] };
  if (stats.pictureCover >= 0.08) return { route: "figures", score, reasons: [...reasons, `그림 ${Math.round(stats.pictureCover * 100)}%`] };
  return { route: "layer", score, reasons };
}

/** "Depth-Buffer (z-Buffer) Method", "Depth-Buffer Method (cont.)", "… (2)" are one title. */
export function titleKey(title: string) {
  return title.toLowerCase().replace(/\((cont(inued|'d|’d|\.)?|계속|\d+)\)/g, "").replace(/\(.*?\)/g, "").replace(/\s*\d+\s*$/, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Consecutive pages with the same title make a section; an untitled page belongs with the one before. At most `max` pages. */
export function splitSections(pages: Array<Pick<PrepPage, "page" | "title" | "route">>, max = 8): PrepSection[] {
  const sections: PrepSection[] = [];
  for (const p of pages) {
    if (p.route === "empty" && !p.title) continue;
    const last = sections.at(-1);
    const key = titleKey(p.title);
    if (last && (!key || titleKey(last.title) === key) && last.pages.length < max && p.page === last.pages.at(-1)! + 1) last.pages.push(p.page);
    else sections.push({ id: `s${sections.length + 1}`, title: p.title || (last ? `${last.title} (이어서)` : `p.${p.page}`), pages: [p.page] });
  }
  return sections;
}

/** The page text every later step reads, before any model reading: title first, then the structured lines. */
export function pageText(p: Pick<PrepPage, "title" | "text">) {
  return [p.title ? `# ${p.title}` : "", p.text].filter(Boolean).join("\n");
}

type Box = [number, number, number, number];
/** Share of the page covered by the union of boxes, on a 48×27 grid (overlapping pictures count once). */
export function coverage(boxes: Box[], width: number, height: number) {
  const cols = 48, rows = 27;
  let hit = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i + 0.5) * width / cols, y = (j + 0.5) * height / rows;
    if (boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) hit++;
  }
  return Math.round(hit / (cols * rows) * 100) / 100;
}

const MATH = /[\u{1D400}-\u{1D7FF}]/gu;
const BROKEN = /[�-]/gu;

/**
 * What one page gives before the material-wide steps (running headers, template pictures). Plain data, so pages can be
 * read in other processes (연구 1: a vector-drawn deck spends ~0.3 s per page here and ~0.9 s more drawing it).
 * `image`: the page drawn while its operator list is still warm, when asked (fast path).
 */
export type RawPage = { n: number; lines: Line[]; width: number; height: number; chars: number; mathChars: number; brokenChars: number; pathOps: number; garbledChars: number;
  pictures: Array<{ id: string; area: number; box: Box }>; image?: string };

/** Reads the chosen pages of a PDF with pdf.js (text layer + where pictures are painted) and prepares them. */
export async function preparePdf(bytes: Uint8Array, pageNumbers: readonly number[], router: PrepRouter = "prep-1"): Promise<PrepResult> {
  return finishPrep(await readPdfPages(bytes, pageNumbers, router), router);
}

/** Page by page; `render` also draws each page (JPEG data URL, long side `width`), `onPage` hears each page as it is done. */
export async function readPdfPages(bytes: Uint8Array, pageNumbers: readonly number[], router: PrepRouter = "prep-1",
  options: { render?: { width: number; quality?: number }; onPage?: (raw: RawPage) => void } = {}): Promise<RawPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvasLib = options.render ? await import("@napi-rs/canvas") : null;
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes), ...(router === "prep-2" ? { fontExtraProperties: true } : {}) }).promise;
  const OPS = pdfjs.OPS as Record<string, number>;
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((v) => v !== undefined));
  const out: RawPage[] = [];
  try {
    const wanted = [...new Set(pageNumbers)].filter((n) => Number.isInteger(n) && n >= 1 && n <= document.numPages).sort((a, b) => a - b);
    for (const n of wanted) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      let all = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        all += item.str;
        runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], h: item.height || Math.hypot(item.transform[2], item.transform[3]), w: item.width, eol: item.hasEOL, font: item.fontName });
      }
      const ops = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      const times = (m: number[], t: number[]) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
      const found: Array<{ id: string; area: number; box: Box }> = [];
      let pathOps = 0;
      ops.fnArray.forEach((fn, i) => {
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = times(ctm, args as number[]);
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = times(ctm, args[0] as number[]); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.constructPath) pathOps += 1;
        else if (paint.has(fn)) {
          // The unit square through the current transform, clipped to the page (slides often hang pictures off the edge).
          const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]], ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
          const box: Box = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(viewport.width, Math.max(...xs)), Math.min(viewport.height, Math.max(...ys))];
          const area = Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]) / (viewport.width * viewport.height);
          if (area >= 0.01) found.push({ id: String(args?.[0] ?? `inline-${i}`), area, box });
        }
      });
      // prep-2: a math font whose code points fall back to a plain 8-bit table (no ToUnicode) gives "!"#$%" for its
      // letters; the fonts are known once the operator list has run.
      let garbledChars = 0;
      if (router === "prep-2") {
        const garbled = new Map<string, boolean>();
        const isGarbled = (name: string) => {
          if (!garbled.has(name)) {
            let g = false;
            try { const font = page.commonObjs.get(name) as { name?: string; toUnicode?: { _map?: string[] } }; const m = font.toUnicode?._map ?? [];
              g = /Math|Symbol/i.test(font.name ?? "") && m[33] === "!" && m[34] === "\"" && m[35] === "#"; } catch { g = false; }
            garbled.set(name, g);
          }
          return garbled.get(name)!;
        };
        for (const run of runs) if (run.font && run.str.trim() && isGarbled(run.font)) garbledChars += run.str.trim().length;
      }
      let image: string | undefined;
      if (options.render && canvasLib) {
        // Drawn now, while this page's operator list is still in pdf.js's cache (drawing it later parses it again).
        const scaled = page.getViewport({ scale: options.render.width / Math.max(viewport.width, viewport.height) });
        const canvas = canvasLib.createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
        const context = canvas.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport: scaled }).promise;
        image = `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", options.render.quality ?? 85).toString("base64")}`;
      }
      const raw: RawPage = { n, lines: linesFrom(runs), width: viewport.width, height: viewport.height, chars: meaningful(normalizeText(all)),
        mathChars: (all.match(MATH) ?? []).length, brokenChars: (all.match(BROKEN) ?? []).length, pathOps, garbledChars, pictures: found, ...(image ? { image } : {}) };
      out.push(raw);
      options.onPage?.(raw);
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return out;
}

/** The material-wide steps over pages read one by one: running headers and footers, template pictures, then each page's route. */
export function finishPrep(raws: RawPage[], router: PrepRouter = "prep-1"): PrepResult {
  const sorted = [...raws].sort((a, b) => a.n - b.n);
  const wanted = sorted.map((r) => r.n);
  const raw = new Map(sorted.map((r) => [r.n, { ...r, lines: [...r.lines] }]));
  const seen = new Map<string, Set<number>>();
  for (const r of sorted) for (const f of r.pictures) (seen.get(f.id) ?? seen.set(f.id, new Set()).get(f.id)!).add(r.n);
  const pages: PrepPage[] = [];
  // A line that sits in the top or bottom strip of half the pages or more (course name, author, date) is a running header or footer.
  const edgeKey = (l: Line, h: number) => (l.y < h * 0.12 || l.y > h * 0.93) ? l.text.replace(/\d+/g, "#") : null;
  const counts = new Map<string, number>();
  for (const n of wanted) for (const key of new Set(raw.get(n)!.lines.map((l) => edgeKey(l, raw.get(n)!.height)).filter((k): k is string => !!k))) counts.set(key, (counts.get(key) ?? 0) + 1);
  const running = new Set([...counts].filter(([, c]) => wanted.length >= 3 && c >= Math.max(3, wanted.length / 2)).map(([k]) => k));
  for (const n of wanted) {
    const r = raw.get(n)!;
    r.lines = r.lines.filter((l) => { const key = edgeKey(l, r.height); return !key || !running.has(key); });
    // Template pictures (a logo or frame on three or more pages) are not content.
    const content = r.pictures.filter((f) => (seen.get(f.id)?.size ?? 0) < 3);
    const cover = coverage(content.map((f) => f.box), r.width, r.height);
    const { title, text, orphanLines } = structure(r.lines, r.height);
    const stats: PageStats = { chars: r.chars, mathChars: r.mathChars, brokenChars: r.brokenChars, lines: text ? text.split("\n").length : 0, orphanLines, pictureCover: cover, pathOps: r.pathOps,
      ...(router === "prep-2" ? { garbledChars: r.garbledChars } : {}) };
    // Where the content pictures are, as fractions of the page from the top left (for cropping a page drawn elsewhere).
    const figures = content.map((f) => [f.box[0] / r.width, 1 - f.box[3] / r.height, f.box[2] / r.width, 1 - f.box[1] / r.height]);
    pages.push({ page: n, title, text, ...routePage(stats, router), stats, ...(figures.length ? { figures } : {}) });
  }
  return { version: router === "prep-2" ? "prep-2" : PREP_VERSION, pages, sections: splitSections(pages) };
}

/**
 * 빠른 전처리 (연구 1 실험): the pages split over `procs` processes (round robin, so heavy pages spread out), each reading
 * and, with `width`, drawing its pages in one pass. Returns the prepared material and the page images drawn on the way.
 * Falls back to one process when a worker cannot start.
 */
export async function preparePdfFast(bytes: Uint8Array, pageNumbers: readonly number[], router: PrepRouter, options: { procs: number; width?: number; workerPath: string }) {
  const [{ spawn }, { mkdtemp, writeFile, rm }, os, path] = await Promise.all([import("node:child_process"), import("node:fs/promises"), import("node:os"), import("node:path")]);
  const pages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const procs = Math.max(1, Math.min(options.procs, pages.length));
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-prep-"));
  const file = path.join(dir, "source.pdf");
  await writeFile(file, bytes);
  const got = new Map<number, RawPage>();
  const failed: number[] = [];
  // One worker over `list` in order; resolves with the pages it did not finish (a native crash while drawing ends the process).
  const run = (list: number[], width: number) => new Promise<number[]>((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", options.workerPath, file, list.join(","), router, String(width)], { stdio: ["ignore", "pipe", "ignore"] });
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (line.trim()) { try { const raw = JSON.parse(line) as RawPage; got.set(raw.n, raw); } catch { /* a line cut by the crash */ } }
      }
    });
    const done = () => resolve(list.filter((n) => !got.has(n)));
    child.on("error", done);
    child.on("close", done);
  });
  // A worker that dies goes on from the page after the one it died on; that page is tried twice more alone, then read
  // without its picture (pdf.js + @napi-rs/canvas crash on some transparency-heavy slides: 반도체07 p.29, p.35 about 1 in 3).
  const work = async (list: number[]) => {
    let rest = await run(list, options.width ?? 0);
    while (rest.length) {
      const [hit, ...after] = rest;
      let left = await run([hit], options.width ?? 0);
      if (left.length && options.width) left = await run([hit], options.width);
      if (left.length && options.width) { left = await run([hit], 0); if (!left.length) failed.push(hit); }
      if (left.length) return false;
      rest = after.length ? await run(after, options.width ?? 0) : [];
    }
    return true;
  };
  let ok = true;
  try {
    const results = await Promise.all(Array.from({ length: procs }, (_, k) => work(pages.filter((_, i) => i % procs === k))));
    ok = results.every(Boolean);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
  // No worker could run at all (an older Node without type stripping): read in this process, without drawing.
  if (!ok || got.size < pages.length) {
    console.warn("[빠른 전처리] 일꾼이 돌지 않아 이 프로세스에서 그림 없이 읽어요.");
    for (const raw of await readPdfPages(bytes, pages.filter((n) => !got.has(n)), router)) got.set(raw.n, raw);
  }
  const raws = pages.map((n) => got.get(n)!).filter(Boolean);
  const images = new Map(raws.filter((r) => r.image).map((r) => [r.n, r.image!]));
  return { prep: finishPrep(raws.map(({ image: _image, ...r }) => r), router), images, failed };
}

/** Without the PDF (tests, a text-only source): page texts as already extracted, each on the text layer. */
export function prepFromTexts(texts: Map<number, string>, pageNumbers: readonly number[]): PrepResult {
  const pages: PrepPage[] = [...new Set(pageNumbers)].sort((a, b) => a - b).map((page) => {
    const raw = (texts.get(page) ?? "").trim();
    const [first, ...rest] = raw.split("\n");
    const title = /^#\s/.test(first ?? "") ? first.replace(/^#\s*/, "") : "";
    const text = title ? rest.join("\n").trim() : raw;
    const stats: PageStats = { chars: meaningful(raw), mathChars: 0, brokenChars: 0, lines: text ? text.split("\n").length : 0, orphanLines: 0, pictureCover: 0, pathOps: 0 };
    return { page, title, text, route: stats.chars ? "layer" : "empty", score: 1, reasons: [], stats };
  });
  return { version: PREP_VERSION, pages, sections: splitSections(pages) };
}
