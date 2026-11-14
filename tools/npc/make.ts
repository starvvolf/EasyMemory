// 옵션 조각 만들기 (설계 1번): AI 1번(terra low). 결과를 사람 말로 풀어 보여 주고, --save면 options/에 저장한다.
//   node --experimental-strip-types tools/npc/make.ts "C#은 처음이고 파이썬은 좀 하는 2학년. 질문을 못 참고, 튜터 코드를 그대로 붙여 넣음" [--save]
//   node --experimental-strip-types tools/npc/make.ts --from-record <기록 파일> [--save]        나 닮은 NPC(실제 풀이 기록에서)
//   node --experimental-strip-types tools/npc/make.ts --batch "초보 5명을 서로 다르게" [--save]  한꺼번에(서로 너무 비슷한 것은 거름)
//   --save-last: 바로 앞 결과(tools/npc/out/make-last.json)를 AI 없이 저장.
//   --problem 2606: 그 문제 지도의 조각 이름으로 항목을 검사(없는 이름은 버림). AI 자리는 STUDY_FORGE_MODEL_PROVIDER(relay면 대역 모델).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, "..", "..", "src", "lib", "npc");
const OUT = process.env.NPC_OUT_DIR?.trim() || path.join(HERE, "out");
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);
const text = args.find((a, i) => !a.startsWith("--") && !["--from-record", "--batch", "--problem", "--min"].includes(args[i - 1] ?? "")) ?? opt("batch") ?? "";
const { makeOption, makeBatch, plainWords } = await import(path.join(LIB, "maker.ts"));
const { readMap } = await import(path.join(LIB, "map.ts"));
const { switchDataDir } = await import(path.join(LIB, "algo-driver.ts"));
const { loadOptions } = await import(path.join(LIB, "profile.ts"));
switchDataDir(path.join(OUT, "data", "make"));
const map = opt("problem") ? await readMap(OUT, opt("problem")!) ?? (opt("problem") === "2606" ? (await import(path.join(LIB, "map2606.ts"))).MAP_2606 : undefined) : undefined;
const existing = await loadOptions(path.join(HERE, "options"));
type Opt = { id: string; label: string; patch: unknown };
const save = async (o: Opt) => {
  let id = o.id; for (let k = 2; existing[id]; k++) id = `${o.id}-${k}`;
  await mkdir(path.join(HERE, "options"), { recursive: true });
  await writeFile(path.join(HERE, "options", `${id}.json`), JSON.stringify({ ...o, id }, null, 1) + "\n", "utf8");
  console.log(`  저장: options/${id}.json`);
};
const LAST = path.join(OUT, "make-last.json");
if (flag("save-last")) {
  const last = JSON.parse(await readFile(LAST, "utf8").catch(() => "[]")) as Opt[];
  if (!last.length) { console.log("저장할 마지막 결과가 없어요."); process.exit(1); }
  for (const o of last) { console.log(`- ${plainWords(o)}`); await save(o); }
  process.exit(0);
}
if (opt("batch")) {
  const r = await makeBatch(opt("batch")!, { ...(map ? { map } : {}), ...(opt("min") ? { min: Number(opt("min")) } : {}) });
  for (const o of r.kept) console.log(`- ${plainWords(o)}`);
  for (const d of r.dropped) console.log(`  (거름) ${d.id}: ${d.like}와 너무 비슷함(거리 ${d.d})`);
  for (const n of r.notes) console.log(`  (고침) ${n}`);
  await mkdir(OUT, { recursive: true }); await writeFile(LAST, JSON.stringify(r.kept, null, 1), "utf8");
  if (flag("save")) for (const o of r.kept) await save(o); else console.log("마음에 들면 --save-last로 이 결과를 저장하세요(AI를 다시 부르지 않음).");
} else {
  const fromRecord = opt("from-record");
  const input = fromRecord ? await readFile(fromRecord, "utf8") : text;
  if (!input.trim()) { console.log("설명이나 --from-record <파일>을 주세요."); process.exit(1); }
  const r = await makeOption(input, { ...(map ? { map } : {}), fromRecord: Boolean(fromRecord) });
  console.log(plainWords(r.option));
  for (const n of r.notes) console.log(`  (고침) ${n}`);
  console.log(JSON.stringify(r.option, null, 1));
  await mkdir(OUT, { recursive: true }); await writeFile(LAST, JSON.stringify([r.option], null, 1), "utf8");
  if (flag("save")) await save(r.option); else console.log("마음에 들면 --save-last로 이 결과를 저장하세요(AI를 다시 부르지 않음).");
}
