import fs from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { createWorker, PSM } from "tesseract.js";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pdfPath = argument("--pdf");
const id = argument("--id") ?? "document";
const requestedPages = argument("--pages")
  ?.split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value > 0);
if (!pdfPath) throw new Error("--pdf 경로가 필요합니다.");

const resolvedPdfPath = path.resolve(pdfPath);
const stamp = new Date().toISOString().replace(/[:.]/g, "");
const imageDirectory = path.resolve("tmp/pdfs", `${stamp}-${id}`);
const outputDirectory = path.resolve("eval/local/pdf-ocr-v1");
await fs.mkdir(imageDirectory, { recursive: true });
await fs.mkdir(outputDirectory, { recursive: true });

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const bytes = new Uint8Array(await fs.readFile(resolvedPdfPath));
const document = await pdfjs.getDocument({ data: bytes }).promise;
const worker = await createWorker(["eng", "kor"], 1, {
  logger: (message) => {
    if (message.status === "recognizing text") return;
    console.log(JSON.stringify({ ocrStatus: message.status, progress: message.progress }));
  },
});
await worker.setParameters({
  tessedit_pageseg_mode: PSM.AUTO,
  preserve_interword_spaces: "1",
});

const pages: Array<{
  pageNumber: number;
  text: string;
  confidence: number;
  imagePath: string;
}> = [];

try {
  const pageNumbers = requestedPages?.length
    ? [...new Set(requestedPages)].filter((pageNumber) => pageNumber <= document.numPages)
    : Array.from({ length: document.numPages }, (_, index) => index + 1);
  if (pageNumbers.length === 0) throw new Error("OCR할 유효한 페이지가 없습니다.");
  for (const pageNumber of pageNumbers) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
    const imagePath = path.join(imageDirectory, `page-${String(pageNumber).padStart(3, "0")}.png`);
    await fs.writeFile(imagePath, canvas.toBuffer("image/png"));
    const recognition = await worker.recognize(imagePath);
    pages.push({
      pageNumber,
      text: recognition.data.text.replace(/\r\n/g, "\n").trim(),
      confidence: recognition.data.confidence,
      imagePath,
    });
    console.log(JSON.stringify({
      pageNumber,
      pageCount: pageNumbers.length,
      confidence: recognition.data.confidence,
      textLength: recognition.data.text.trim().length,
    }));
  }
} finally {
  await worker.terminate();
}

const outputPath = path.join(outputDirectory, `${stamp}-${id}.json`);
await fs.writeFile(
  outputPath,
  `${JSON.stringify({
    artifactType: "study-forge-local-pdf-ocr",
    artifactVersion: "v1",
    completedAt: new Date().toISOString(),
    source: { id, pdfPath: resolvedPdfPath, requestedPages: requestedPages ?? null },
    engine: { name: "tesseract.js", languages: ["eng", "kor"], renderScale: 2.5 },
    pages,
  }, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify({ outputPath, imageDirectory, pageCount: pages.length }));
