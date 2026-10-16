import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractPdfPageTexts } from "../tools/study-forge-mcp/source-evidence.ts";
import { pageBlock } from "../src/lib/study/auto-executor.ts";

// Offline measurement using the exact text extraction and clipping used by the executor.
const directory = path.resolve("eval/corpus/user-test-pdfs");
const inputs = (await readdir(directory)).filter(name => name.endsWith(".pdf")).sort().map(name => path.join(directory, name));
inputs.push(...process.argv.slice(2));
const results = [];
for (const input of inputs) {
  const bytes = new Uint8Array(await readFile(input));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const pdf = await loading.promise;
  const pageCount = pdf.numPages;
  await loading.destroy();
  const texts = await extractPdfPageTexts(bytes, Array.from({ length: pageCount }, (_, i) => i + 1));
  const counts = [...texts.values()].map(text => text.length).sort((a, b) => a - b);
  const middle = Math.floor(counts.length / 2);
  let budget = 60000;
  const totalLimitPages: number[] = [];
  for (const [page, text] of texts) {
    const beforeTotalLimit = (text || "(이 쪽은 추출된 글자가 없음)").slice(0, 3500);
    if (beforeTotalLimit.length > Math.max(budget, 0)) totalLimitPages.push(page);
    budget -= Math.min(beforeTotalLimit.length, Math.max(budget, 0));
  }
  results.push({ file: path.basename(input), pageCount,
    noTextPages: [...texts].filter(([, text]) => !text.trim()).map(([page]) => page),
    min: counts[0], median: counts.length % 2 ? counts[middle] : (counts[middle - 1] + counts[middle]) / 2, max: counts.at(-1),
    perPageLimitPages: [...texts].filter(([, text]) => text.length > 3500).map(([page]) => page),
    totalLimitPages, charsSent: pageBlock(texts).input.charsSent,
  });
}
console.log(JSON.stringify(results, null, 2));
