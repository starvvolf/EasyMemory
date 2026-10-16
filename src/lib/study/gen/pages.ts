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
