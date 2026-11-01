import { readFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
const RE = /["#$%&'*][()"#$%&'*]/g;
for (const f of process.argv.slice(2)) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)) }).promise; const hits: string[] = [];
  for (let n = 1; n <= d.numPages; n++) { const p = await d.getPage(n); const t = (await p.getTextContent()).items.map((i: any) => i.str ?? "").join(" ");
    const m = t.match(RE); if (m) hits.push(`p.${n}:${m.length}[${m.slice(0, 4).join(" ")}]`); }
  console.log(path.basename(f), hits.join("  ") || "(없음)");
}
