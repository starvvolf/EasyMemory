import { readFileSync, writeFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const { renderPageFigures } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/pages.ts")).href);
const m = await renderPageFigures(new Uint8Array(readFileSync(process.argv[2])), JSON.parse(process.argv[3]), 1024);
for (const [p, figs] of m) { console.log(`p.${p}`, figs.map((f: any) => `${f.label} ${(f.area*100).toFixed(0)}%`).join(" | ")); figs.forEach((f: any, k: number) => writeFileSync(`${process.argv[4]}/p${p}-${k+1}.jpg`, Buffer.from(f.dataUrl.split(",")[1], "base64"))); }
