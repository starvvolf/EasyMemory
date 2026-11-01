import { readFileSync, writeFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const S = process.argv[2];
const { checkCards, cardLine } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/study/gen/cards.ts")).href);
const run = JSON.parse(readFileSync(`${S}/s2c-run.json`, "utf8")); const results = JSON.parse(readFileSync(`${S}/s2c-cards.json`, "utf8"));
const sum = readFileSync(`${S}/s2c-summary.md`, "utf8");
const texts = new Map(Object.entries(run.pageTexts).map(([k, v]) => [Number(k), v as string]));
function cited(text: string) { const out: number[] = []; for (const m of text.matchAll(/\(p\.\s*([0-9][0-9\s,~–—-]*(?:,\s*p\.\s*[0-9][0-9\s,~–—-]*)*)\)/g)) for (const part of m[1].replace(/p\.\s*/g, "").split(",")) { const [a, b] = part.split(/[~–—-]/).map((x) => Number(x.trim())); if (!Number.isInteger(a)) continue; if (Number.isInteger(b) && b >= a) for (let n = a; n <= b; n++) out.push(n); else out.push(a); } return out; }
// S
const bodyLines = [...sum.matchAll(/^\s*[-*]\s*\[(b\d+)\]\s*(.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
const allCited = new Set(cited(sum)); const missing = [2,3,4,5,6,7,8,9,10,11,12,13,14].filter((n) => !allCited.has(n));
const noPage = bodyLines.filter((l) => !cited(l.text).length).map((l) => l.id);
const h2 = (sum.match(/^##\s(?!#)/gm) ?? []).length, h3 = (sum.match(/^###\s/gm) ?? []).length;
const secs = sum.split(/^###\s/m).slice(1).map((s) => s.split(/^##\s(?!#)/m)[0]);
const five = secs.map((s) => { const easy = s.split("**쉬운 설명**")[1] ?? ""; const body = (s.split("**쉬운 설명**")[0].match(/^\s*[-*]\s*\[b\d+\]/gm) ?? []).length;
  const pre = easy.split(/흔한 오해/)[0]; const analog = (pre.split(/장면:/)[1] ?? "").split("\n").filter((l) => /^\s*-\s/.test(l)).length;
  return { 한마디로: /한마디로/.test(easy), 질문: /\?/.test(easy.split(/장면:/)[0] ?? ""), 장면: /장면:/.test(easy), 비유줄: analog, 본문줄: body, 오해: /흔한 오해/.test(easy), 마무리: /마무리:/.test(easy) }; });
const fiveOk = five.filter((f) => f.한마디로 && f.질문 && f.장면 && f.비유줄 > 0 && f.오해 && f.마무리).length;
const analogRatio = five.reduce((a, f) => a + f.비유줄, 0) / five.reduce((a, f) => a + f.본문줄, 0);
const cross = bodyLines.filter((l) => new Set(cited(l.text)).size >= 2).map((l) => l.id);
const keyLines = sum.split("## 핵심 정리")[1] ?? ""; const crossAll = [...sum.split("\n")].filter((l) => /\(p\./.test(l) && new Set(cited(l)).size >= 2).length;
const outside = [...allCited].filter((n) => !texts.has(n));
// C
const allIds = new Set(bodyLines.map((l) => l.id)); const coveredBy = new Map<string, Set<number>>();
let cards: any[] = []; const issues: any[] = []; const badIds: string[] = []; let shapeErr = 0, quoteMiss = 0, outsidePage = 0;
for (const r of results) {
  if (!r.data) continue; const secIds = new Set(r.section.lines.map((l: any) => l.id));
  const res = checkCards({ cards: r.data.cards.map((c: any) => ({ ...c })) }, { pages: r.section.pages }, texts, { lenientQuotes: true });
  for (const i of res.issues) { issues.push({ sec: r.section.idx, ...i }); if (/모양|대상 수/.test(i.message)) shapeErr++; if (/글자 층에 없어/.test(i.message)) quoteMiss++; if (/구역 밖/.test(i.message)) outsidePage++; }
  for (const c of res.cards) { cards.push({ sec: r.section.idx, secTitle: r.section.title, ...c }); for (const id of c.covers) { if (!secIds.has(id)) badIds.push(`${r.section.idx}:${c.id}:${id}`); (coveredBy.get(id) ?? coveredBy.set(id, new Set()).get(id)!).add(r.section.idx); } }
}
const uncovered = [...allIds].filter((id) => !coveredBy.has(id)); const multi = [...coveredBy].filter(([, s]) => s.size > 1).map(([id]) => id);
const tok = results.reduce((a: any, r: any) => ({ in: a.in + (r.usage?.inputTokens ?? 0), out: a.out + (r.usage?.outputTokens ?? 0) }), { in: 0, out: 0 });
const titleLen = cards.map((c) => c.title.length); const quotes = cards.flatMap((c) => c.evidence).filter((e: any) => e.quote).length;
const report = { S: { S1_missing: missing, S2_noPage: noPage, S3: `${h2 - 1}/${h3} (핵심 정리 빼고 ## ${h2 - 1})`, S4: `${fiveOk}/${five.length}`, S5: +analogRatio.toFixed(2), S6: `${five.filter((f) => f.오해).length}/${five.length}`, S7_body: cross, S7_all: crossAll, S8_outside: outside, bodyLines: bodyLines.length, five },
  C: { cards: cards.length, C1_uncovered: uncovered, C2_quoteMiss: quoteMiss, C2_outsidePage: outsidePage, quotesKept: quotes, C3_badIds: badIds, C4_multi: multi, C5_shapeErr: shapeErr, titleMax: Math.max(...titleLen), titleAvg: +(titleLen.reduce((a, b) => a + b, 0) / titleLen.length).toFixed(1), kinds: cards.reduce((a: any, c) => (a[c.kind] = (a[c.kind] ?? 0) + 1, a), {}), issues },
  T: { prep: run.prepSec, firstText: run.firstTextSec, firstCard: run.firstCardSec, summaryDone: run.summaryDoneSec, allDone: run.allDoneSec, calls: 1 + results.length, summaryUsage: run.summaryUsage, cardTokens: tok,
    perSection: results.map((r: any) => ({ sec: r.section.idx, title: r.section.title, lines: r.section.lines.length, pages: r.section.pages, start: r.startedAt, done: r.doneAt, images: r.images, in: r.usage?.inputTokens, out: r.usage?.outputTokens, cards: r.data?.cards.length })) } };
writeFileSync(`${S}/s2c-score.json`, JSON.stringify(report, null, 1));
writeFileSync(`${S}/s2c-cardlines.md`, results.map((r: any) => `### ${r.section.idx}. ${r.section.title} (본문 ${r.section.lines.map((l: any) => l.id).join(", ")})\n\n` + cards.filter((c) => c.sec === r.section.idx).map((c) => `- ${cardLine(c)} — covers ${c.covers.join(", ")} · 근거 ${c.evidence.map((e: any) => `p.${e.page}${e.quote ? ` "${e.quote}"` : " (그림)"}`).join(", ")} · ${c.weight}`).join("\n")).join("\n\n"));
const { five: _f, ...s } = report.S; const { issues: _i, ...c } = report.C; console.log(JSON.stringify({ S: s, C: c, T: report.T }, null, 1)); console.log(issues.map((i) => `${i.sec} ${i.severity} ${i.message}`).join("\n"));
