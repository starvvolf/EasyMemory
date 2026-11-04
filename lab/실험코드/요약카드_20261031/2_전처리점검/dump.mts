import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path"; import { pathToFileURL } from "node:url";
const { renderPageImages } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/pages.ts")).href);
const m = await renderPageImages(new Uint8Array(readFileSync(process.argv[2])), JSON.parse(process.argv[4]), 1024);
for (const [p, d] of m) writeFileSync(`${process.argv[3]}/${process.argv[5]}${p}.jpg`, Buffer.from(d.split(",")[1], "base64"));
