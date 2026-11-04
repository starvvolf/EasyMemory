const S = process.argv[2];
const docs = { deadlocks: ["deadlocks"], graphics03: ["graphics03"], geometric: ["geo"], week7: ["s1", "s2", "s3"] };
const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const out = {};
for (const [d, keys] of Object.entries(docs)) {
  const rows = keys.flatMap((k) => require(`${S}/scan-${k}.json`).rows.map((r) => ({ ...r, id: keys.length > 1 ? `${k}-p${r.page}` : `p${r.page}` })));
  const m = med(rows.map((r) => r.chars)); const layer = rows.filter((r) => r.route === "layer");
  const R = { R1: (r) => r.chars < 300 && r.pathOps >= 20, R3: (r) => r.pictureCover >= 0.03 };
  for (const f of [0.3, 0.4, 0.5]) R[`R2x${f}`] = (r) => r.chars < m * f && (r.pathOps >= 20 || r.pictureCover > 0);
  out[d] = { median: m, pages: rows.length, layer: layer.map((r) => `${r.id}(c${r.chars},o${r.pathOps},pc${r.pictureCover.toFixed(2)})`), switched: Object.fromEntries(Object.entries(R).map(([k, fn]) => [k, layer.filter(fn).map((r) => r.id)])) };
}
console.log(JSON.stringify(out, null, 1));
