import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2]; const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8"));
const r = s.recaller; const t = r.timing ?? {}; const t0 = Date.parse(s.createdAt);
const sec = (x) => x ? ((Date.parse(x) - t0) / 1000).toFixed(1) : "-";
let cost = 0, quiz = 0;
for (const f of readdirSync(`${dir}/calls`)) { const c = JSON.parse(readFileSync(`${dir}/calls/${f}`, "utf8")); const u = c.usage ?? {}; const m = c.model ?? "";
  const p = m.includes("terra") ? [1, .05, 5] : m.includes("sol") ? [2, .1, 10] : [.1, .01, .5];
  const inp = u.inputTokens ?? u.input_tokens ?? 0, cached = u.cachedInputTokens ?? u.cached_tokens ?? 0, out = u.outputTokens ?? u.output_tokens ?? 0;
  const usd = ((inp - cached) * p[0] + cached * p[1] + out * p[2]) / 1e6; cost += usd; if (/rc-q-|rc-check/.test(c.step)) quiz += usd; }
console.log(s.status, "calls", s.calls, "cards", sec(t.cardsDoneAt), "firstQ", sec(t.firstPublishedAt), "done", sec(t.completedAt), "cost $" + cost.toFixed(4), "quiz $" + quiz.toFixed(4));
for (const sc of s.sections) { const u = r.units[sc.id]; if (!u) continue;
  for (const ch of Object.values(u.chunks ?? {})) {
    for (const q of ch.questions ?? []) { const a = q.authored; const ans = a.answer;
      const stem = (a.stem ?? a.prompt ?? []).map?.((b) => b.text).join(" ") ?? JSON.stringify(a).slice(0, 200);
      console.log(`\n[${sc.id}] ${q.format} ${q.cardIds[0]} p.${q.pages}  ${stem}`);
      if (ans?.options) ans.options.forEach((o, i) => console.log(`   ${i === ans.correctIndex ? "*" : " "}${i + 1}. ${o.text}  — ${o.note ?? ""}`));
      if (ans?.before != null) console.log(`   ${ans.before}[____]${ans.after}  = ${ans.accepted?.join(" / ")}`);
      console.log(`   해설: ${ans?.explanation}`); if (q.hint) console.log(`   힌트: ${q.hint}`); }
    for (const h of ch.held ?? []) console.log(`  (held ${h.cardId}: ${h.reason.slice(0, 120)})`); } }
