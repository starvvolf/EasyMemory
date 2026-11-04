import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2]; const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8")); const d = s.recaller.digest;
const cs = readdirSync(`${dir}/calls`).map((f) => JSON.parse(readFileSync(`${dir}/calls/${f}`, "utf8")));
const usd = (c) => { const u = c.usage ?? {}; const m = c.model ?? ""; const p = m.includes("terra") ? [1, .05, 5] : m.includes("sol") ? [2, .1, 10] : [.1, .01, .5];
  return (((u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)) * p[0] + (u.cachedInputTokens ?? 0) * p[1] + (u.outputTokens ?? 0) * p[2]) / 1e6; };
const plan = cs.find((c) => c.step === "rc-digest-plan");
console.log(s.status, s.message || "", "| source", d.conceptSource, "| topics", d.skeleton.topics.length, "| concepts", (d.concepts ?? []).length,
  "| plan", plan?.ms, "ms in", plan?.usage?.inputTokens, "cached", plan?.usage?.cachedInputTokens, "out", plan?.usage?.outputTokens, "$" + usd(plan ?? {}).toFixed(4), "| total $" + cs.reduce((a, c) => a + usd(c), 0).toFixed(4));
console.log("개요", JSON.stringify(d.skeleton.overview), "problems", d.skeleton.problems.length);
for (const t of d.skeleton.topics) { console.log(`${t.id} [${t.kind}] p.${t.pages.join(",")} ${t.title}`); for (const c of (d.concepts ?? []).filter((c) => c.topic === t.id)) console.log(`    ${c.id} ${c.name} (p.${c.pages.join(",")})`); }
if (process.argv[3] === "cards") {
  const cards = s.sections.flatMap((sc) => Object.values(s.recaller.units[sc.id]?.chunks ?? {}).flatMap((c) => c.cards ?? []));
  const ids = new Set((d.concepts ?? []).map((c) => c.id));
  const lines = Object.values(d.topics).flatMap((t) => t.body);
  const lineConcepts = new Map(lines.map((l) => [l.id, (l.concepts ?? []).filter((x) => ids.has(x))]));
  const conceptsOf = (c) => [...new Set((d.notes[c.id]?.covers ?? []).flatMap((x) => lineConcepts.get(x) ?? []))];
  const lost = cards.filter((c) => !conceptsOf(c).length);
  const hit = new Set(cards.flatMap(conceptsOf));
  const dupNames = Object.values(d.topics).reduce((n, t) => n + t.body.length - new Set(t.body.map((l) => l.name.replace(/\s/g, ""))).size, 0);
  const sameAsConcept = lines.filter((l) => (d.concepts ?? []).some((c) => (l.concepts ?? []).includes(c.id) && c.name.replace(/\s/g, "") === l.name.replace(/\s/g, ""))).length;
  console.log("dup line names within topic", dupNames, "| line name = concept name", sameAsConcept);
  console.log("body lines", lines.length, "untagged lines", lines.filter((l) => !(lineConcepts.get(l.id) ?? []).length).map((l) => l.id).join(",") || "-");
  console.log("cards", cards.length, "attached", cards.length - lost.length, "unattached", lost.map((c) => c.id + " " + c.title).join("; ") || "-");
  console.log("concepts without card", [...ids].filter((x) => !hit.has(x)).join(", ") || "-", "| concepts without line", [...ids].filter((x) => !lines.some((l) => (l.concepts ?? []).includes(x))).join(", ") || "-");
}
