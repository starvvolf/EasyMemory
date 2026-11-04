import { readFileSync, readdirSync } from "node:fs";
const dir = readdirSync(".").find(f=>f.startsWith(process.argv[2]));
const s = JSON.parse(readFileSync(`${dir}/state.json`, "utf8")); const d=s.recaller.digest;
const cards = s.sections.flatMap(sc=>Object.values(s.recaller.units[sc.id]?.chunks??{}).flatMap(c=>c.cards??[]));
const body = (sh)=>{ const o={...sh}; delete o.form; delete o.name; return Object.entries(o).filter(([k,v])=>v&&(!Array.isArray(v)||v.length)).map(([k,v])=>k+"="+(typeof v==="string"?v:JSON.stringify(v))).join(" | "); };
for (const c of cards) console.log(`${c.id} [${c.kind}/${c.shape?.form}]${c.weight==="핵심"?"★":""} ${c.title} :: ${body(c.shape??{}).slice(0,230)} || 오답:${(c.mistakes??[]).length} p.${(c.evidence??[]).map(e=>e.page).join(",")}`);
const kinds={}; for(const c of cards){kinds[c.shape?.form]=(kinds[c.shape?.form]||0)+1}
console.log("forms",JSON.stringify(kinds),"mistakes avg",(cards.reduce((a,c)=>a+(c.mistakes?.length??0),0)/cards.length).toFixed(2),"links avg",(cards.reduce((a,c)=>a+(c.links?.length??0),0)/cards.length).toFixed(2));
