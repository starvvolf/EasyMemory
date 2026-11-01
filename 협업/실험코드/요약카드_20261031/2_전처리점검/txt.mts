import { readFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const { preparePdf, pageText } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/prep.ts")).href);
const r = await preparePdf(new Uint8Array(readFileSync(process.argv[2])), JSON.parse(process.argv[3]), "prep-2");
for (const p of r.pages) console.log(`--- p.${p.page}\n${pageText(p)}`);
