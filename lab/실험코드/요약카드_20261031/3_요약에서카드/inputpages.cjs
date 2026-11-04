const fs = require("fs"); const S = process.argv[2];
const r = JSON.parse(fs.readFileSync(`${S}/v3-score.json`, "utf8")); const sum = fs.readFileSync(`${S}/v3-summary.md`, "utf8");
const cited = (t) => { const o = []; for (const m of t.matchAll(/\(p\.\s*([0-9][0-9\s,~–—-]*(?:,\s*p\.\s*[0-9][0-9\s,~–—-]*)*)\)/g)) for (const part of m[1].replace(/p\.\s*/g, "").split(",")) { const [a, b] = part.split(/[~–—-]/).map((x) => Number(x.trim())); if (!Number.isInteger(a)) continue; if (Number.isInteger(b) && b >= a) for (let n = a; n <= b; n++) o.push(n); else o.push(a); } return o; };
const topics = new Map(r.skeleton.topics.map((t) => [t.id, t]));
const lines = [...sum.matchAll(/^\s*[-*]?\s*\[(t\d+)-b\d+\]\s*(.+)$/gm)].map((m) => ({ id: m[0].match(/\[(t\d+-b\d+)\]/)[1], topic: m[1], text: m[2] }));
let outsideTopic = 0, outsideInput = 0;
for (const t of r.skeleton.topics) {
  const input = [...new Set([...t.pages, ...t.related.flatMap((x) => topics.get(x)?.pages ?? [])])].sort((a, b) => a - b);
  const mine = lines.filter((l) => l.topic === t.id);
  const offTopic = mine.filter((l) => cited(l.text).some((p) => !t.pages.includes(p)));
  const offInput = mine.filter((l) => cited(l.text).some((p) => !input.includes(p)));
  outsideTopic += offTopic.length; outsideInput += offInput.length;
  console.log(`${t.id} 뼈대쪽 [${t.pages}] related [${t.related}] → 입력쪽 [${input}] | 뼈대 밖 인용 ${offTopic.map((l) => `${l.id}(${[...new Set(cited(l.text))]})`).join(" ") || "-"} | 입력 밖 인용 ${offInput.map((l) => l.id).join(" ") || "-"}`);
}
console.log(`본문 줄 ${lines.length}개, 뼈대 쪽 밖 인용 ${outsideTopic}줄, 입력 밖 인용 ${outsideInput}줄`);
