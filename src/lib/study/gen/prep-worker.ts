// 빠른 전처리 일꾼 (연구 1, 2026-10-28): reads and draws some pages of one PDF in its own process, so a large or
// vector-drawn deck is read on several CPU cores at once. Prints one JSON line per page (RawPage) as it is done.
//   node --experimental-strip-types prep-worker.ts <pdf file> <pages, comma separated> <router> <image width, 0 = none>
import { readFile } from "node:fs/promises";
import { readPdfPages, type PrepRouter } from "./prep.ts";

const [file, list, router, width] = process.argv.slice(2);
const bytes = new Uint8Array(await readFile(file));
const pages = list.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
await readPdfPages(bytes, pages, (router || "prep-1") as PrepRouter, {
  ...(Number(width) > 0 ? { render: { width: Number(width) } } : {}),
  emphasis: true,
  onPage: (raw) => { process.stdout.write(`${JSON.stringify(raw)}\n`); },
});
