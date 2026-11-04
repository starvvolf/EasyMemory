import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2]; const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8")); const t0 = Date.parse(s.createdAt);
const cs = readdirSync(`${dir}/calls`).map((f) => JSON.parse(readFileSync(`${dir}/calls/${f}`, "utf8")));
const usd = (c) => { const u = c.usage ?? {}; const m = c.model ?? ""; const p = m.includes("terra") ? [1, .05, 5] : m.includes("sol") ? [2, .1, 10] : [.1, .01, .5];
  return (((u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)) * p[0] + (u.cachedInputTokens ?? 0) * p[1] + (u.outputTokens ?? 0) * p[2]) / 1e6; };
const plan = cs.find((c) => c.step === "rc-digest-plan"), goals = cs.find((c) => c.step === "rc-q-goals");
const topics = cs.filter((c) => c.step === "rc-topic").map((c) => (Date.parse(c.startedAt) - t0) / 1000);
const d = s.recaller.digest; const tm = s.recaller.timing;
console.log(s.status, "plan ms", plan?.ms, "out", plan?.usage?.outputTokens, "$" + usd(plan).toFixed(4), "| goals call", goals ? `${goals.ms}ms $${usd(goals).toFixed(4)}` : "-",
  "| outline(skeletonMs)", d.skeleton.ms, "first topic", Math.min(...topics).toFixed(1), "goalsMs", d.timing.goalsMs, "| cards", ((Date.parse(tm.cardsDoneAt) - t0) / 1000).toFixed(1),
  "firstQ", ((Date.parse(tm.firstPublishedAt) - t0) / 1000).toFixed(1), "done", ((Date.parse(tm.completedAt) - t0) / 1000).toFixed(1), "total $" + cs.reduce((a, c) => a + usd(c), 0).toFixed(4));
const qs = s.sections.flatMap((sc) => Object.values(s.recaller.units[sc.id]?.chunks ?? {}).flatMap((c) => c.questions ?? []));
for (const o of d.objectives ?? []) console.log(" ", o.id, o.verb, o.core ? "핵심" : "보조", o.topics.join(","), "|", qs.filter((q) => q.goal === o.text).map((q) => q.format).join(",") || "-", "|", o.text);
