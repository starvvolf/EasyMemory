// 바킹독 workbook 목록 만들기 (docs/DECISIONS.md 2026-10-26 "바킹독 workbook 문제 내장"): reads the workbook tables on
// GitHub and writes src/lib/code/bakingdog-workbook.json. Only the list goes in: chapter, category, number, title and
// the solution's address. No problem text and no solution code (no license to copy them). Run: node scripts/bakingdog-workbook.mjs
import { writeFileSync } from "node:fs";

const REPO = "encrypted-def/basic-algo-lecture";
const BRANCH = "master";
const listing = await (await fetch(`https://api.github.com/repos/${REPO}/contents/workbook?ref=${BRANCH}`)).json();
const chapters = [];
for (const file of listing.filter((f) => f.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))) {
  const md = await (await fetch(file.download_url)).text();
  const chapter = file.name.replace(/\.md$/, "");
  const title = /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? chapter;
  const problems = [];
  for (const line of md.split(/\r?\n/)) {
    const number = /acmicpc\.net\/problem\/(\d+)/.exec(line)?.[1];
    if (!line.trim().startsWith("|") || !number) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const name = /\[([^\]]+)\]\([^)]*acmicpc[^)]*\)/.exec(line)?.[1] ?? "";
    const code = [...line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]).find((href) => !/acmicpc/.test(href) && /\.(cpp|cc|py|js|cs)$/.test(href));
    const solution = code ? new URL(code, `https://raw.githubusercontent.com/${REPO}/${BRANCH}/workbook/${encodeURIComponent(file.name)}`).toString() : "";
    problems.push({ category: cells[0].replace(/[✔✅]/g, "").trim(), recommended: /✔|✅/.test(cells[0]), number, title: name, solution });
  }
  if (problems.length) chapters.push({ chapter, title, problems });
}
const out = { source: `https://github.com/${REPO}/tree/${BRANCH}/workbook`, fetchedAt: new Date().toISOString().slice(0, 10), chapters };
writeFileSync(new URL("../src/lib/code/bakingdog-workbook.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.problems.length, 0)} problems`);
