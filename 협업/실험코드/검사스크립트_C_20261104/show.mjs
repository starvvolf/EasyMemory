import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2]; const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8"));
const r = s.recaller; const t = r.timing ?? {}; const t0 = Date.parse(s.createdAt);
const sec = (x) => x ? ((Date.parse(x) - t0) / 1000).toFixed(1) : "-";
console.log("status", s.status, s.phase, s.message, "calls", s.calls);
console.log("timing", Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === "string" ? sec(v) : v])));
let cost = 0; const by = {};
for (const f of readdirSync(`${dir}/calls`)) { const c = JSON.parse(readFileSync(`${dir}/calls/${f}`, "utf8")); const u = c.usage ?? {}; const m = c.model ?? "";
  const p = m.includes("terra") ? [1, .05, 5] : m.includes("sol") ? [2, .1, 10] : [.1, .01, .5];
  const inp = u.inputTokens ?? u.input_tokens ?? 0, cached = u.cachedInputTokens ?? u.cached_tokens ?? 0, out = u.outputTokens ?? u.output_tokens ?? 0;
  const usd = ((inp - cached) * p[0] + cached * p[1] + out * p[2]) / 1e6; cost += usd; by[c.step] = (by[c.step] ?? 0) + usd; }
console.log("cost $", cost.toFixed(4), Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.toFixed(4)])));
let firstQ = null;
for (const sc of s.sections) { const u = r.units[sc.id]; if (!u) continue;
  for (const ch of Object.values(u.chunks ?? {})) {
    for (const q of ch.questions ?? []) { const a = q.authored; console.log(`\n[${sc.id} ${sc.title}] ${q.format} card ${q.cardIds[0]} p.${q.pages}`);
      console.log(" Q:", JSON.stringify(a.prompt ?? a.stem ?? a).slice(0, 600));
      if (a.answer) console.log(" A:", JSON.stringify(a.answer).slice(0, 700));
      if (q.hint) console.log(" hint:", q.hint); }
    for (const h of ch.held ?? []) console.log(`  held ${h.cardId}: ${h.reason.slice(0, 150)}`); } }
