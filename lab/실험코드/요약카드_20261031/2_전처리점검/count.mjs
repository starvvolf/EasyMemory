import { readFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
for (const f of process.argv.slice(2)) { const d = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)) }).promise; console.log(d.numPages, f); }
