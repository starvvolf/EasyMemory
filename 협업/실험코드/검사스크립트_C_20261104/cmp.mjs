import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2]; const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8")); const d = s.recaller.digest; const t0 = Date.parse(s.createdAt); const tm = s.recaller.timing;
const cs = readdirSync(`${dir}/calls`).map((f) => JSON.parse(readFileSync(`${dir}/calls/${f}`, "utf8")));
const usd = (c) => { const u = c.usage ?? {}; const m = c.model ?? ""; const p = m.includes("terra") ? [1, .05, 5] : m.includes("sol") ? [2, .1, 10] : [.1, .01, .5];
  return (((u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)) * p[0] + (u.cachedInputTokens ?? 0) * p[1] + (u.outputTokens ?? 0) * p[2]) / 1e6; };
const upto = cs.filter((c) => !/rc-q-|rc-check/.test(c.step));
const cards = s.sections.flatMap((sc) => Object.values(s.recaller.units[sc.id]?.chunks ?? {}).flatMap((c) => c.cards ?? []));
console.log(dir.slice(4, 12), "| concepts", d.concepts?.length ?? "-", "| topics", d.skeleton.topics.length, "| body lines", Object.values(d.topics).reduce((n, t) => n + t.body.length, 0),
  "| cards", cards.length, "핵심", cards.filter((c) => c.weight === "핵심").length, "| uncovered", d.checks.uncovered.length, "| cards s", ((Date.parse(tm.cardsDoneAt) - t0) / 1000).toFixed(0),
  "| $ upto cards", upto.reduce((a, c) => a + usd(c), 0).toFixed(3), "| out tokens", upto.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0));
if (process.argv[3]) for (const t of d.skeleton.topics) { console.log(`${t.id} ${t.title}`); for (const l of d.topics[t.id]?.body ?? []) console.log(`   ${l.id} ${l.name}: ${l.text.slice(0, 70)}`); console.log("   cards:", cards.filter((c) => c.id.startsWith(t.id + ".")).map((c) => (c.weight === "핵심" ? "★" : "") + c.title).join(" / ")); }
