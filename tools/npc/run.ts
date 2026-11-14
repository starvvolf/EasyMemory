// 가상 학습자 실행기 (설계 9 · 10번). 결과는 tools/npc/out/(깃에 안 올림).
//   node --experimental-strip-types tools/npc/run.ts --problem 2606 --with 문법약함-py,버티기,설명두번 --seed 3 [--dry]
//   node --experimental-strip-types tools/npc/run.ts --experiment first --dry          첫 실험(8번): 다섯 명
//   node --experimental-strip-types tools/npc/run.ts --replay tools/npc/out/runs/<판>/<npc>   뒤 단계(빈틈 뽑기 · 장면 · 채점)만 다시
// 그 밖: --mode loose(느슨) · --remap(지도를 AI로 다시) · --map(지도 확인 표만) · --max-tokens N · --suspect-ai · --no-scenes · --plant <틀린 조각> · --practice
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const LIB = path.join(ROOT, "src", "lib", "npc");
const OUT = process.env.NPC_OUT_DIR?.trim() || path.join(HERE, "out");
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string) => args.includes(`--${name}`);
if (flag("help") || flag("h")) { console.log((await readFile(fileURLToPath(import.meta.url), "utf8")).split("\n").slice(0, 7).join("\n")); process.exit(0); }

const { ensureMap, reviewTable, saveMap, mapFile } = await import(path.join(LIB, "map.ts"));
const { buildSpec, loadOptions, loadSpec, validated, describe, holdings } = await import(path.join(LIB, "profile.ts"));
const { FIRST_EXPERIMENT } = await import(path.join(LIB, "experiment.ts"));
const { summaryTable } = await import(path.join(LIB, "score.ts"));
const { allLearnedCheck } = await import(path.join(LIB, "guard.ts"));
const { switchDataDir } = await import(path.join(LIB, "algo-driver.ts"));
const { dice } = await import(path.join(LIB, "dice.ts"));

const problem = opt("problem") ?? "2606";
const packModule = opt("pack") ?? path.join(LIB, "fixtures", `p${problem}.ts`);
const dry = flag("dry");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (dry ? "-dry" : "");
const runDir = path.join(OUT, "runs", opt("name") ?? stamp);
const dataRoot = path.join(OUT, "data", opt("name") ?? stamp);
await mkdir(runDir, { recursive: true });
if (dry) { process.env.STUDY_FORGE_MODEL_PROVIDER = "fake"; }
const provider = process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt";
console.log(`가상 학습자 · 문제 ${problem} · ${dry ? "가짜 AI(AI 0번)" : `AI(${provider})`} · 결과 ${path.relative(ROOT, runDir)}`);

/* ---------- 다시 쓰기 ---------- */
if (opt("replay")) {
  const saved = path.resolve(opt("replay")!);
  const job = JSON.parse(await readFile(path.join(saved, "job.json"), "utf8"));
  const outDir = path.join(runDir, path.basename(saved));
  const next = { ...job, dataDir: path.join(dataRoot, path.basename(saved)), outDir, dry };
  await mkdir(outDir, { recursive: true });
  const jf = path.join(outDir, "job.json");
  await writeFile(jf, JSON.stringify(next, null, 1), "utf8");
  const code = await child(jf, ["--replay", saved]);
  console.log(code === 0 ? `다시 쓰기 끝: ${path.relative(ROOT, path.join(outDir, "report.md"))}` : "다시 쓰기 실패");
  process.exit(code);
}

/* ---------- 지도 ---------- */
const pack = Object.values(await import(packModule) as Record<string, unknown>).find((v) => v && typeof v === "object" && "referenceJs" in (v as object)) as { number: string } & Record<string, unknown>;
if (!pack) { console.log(`문제 묶음이 없어요: ${packModule}`); process.exit(1); }
const hand = problem === "2606" && !flag("remap") ? (await import(path.join(LIB, "map2606.ts"))).MAP_2606 : undefined;
if (flag("remap") && dry) { console.log("--remap은 AI가 필요해요(--dry와 같이 못 씀)."); process.exit(1); }
switchDataDir(path.join(dataRoot, "_map"));
const t0 = Date.now();
const map = await ensureMap(pack, { outDir: OUT, ...(hand ? { hand } : {}), regenerate: flag("remap") });
await saveMap(OUT, map);
await writeFile(path.join(runDir, "map-review.md"), reviewTable(map), "utf8");
const allOk = allLearnedCheck(map);
console.log(`지도: 조각 ${map.fragments.length} · 길 ${map.routes.map((r: { id: string; measured?: { verdict: string } }) => `${r.id}=${r.measured?.verdict}`).join(" ")} (${((Date.now() - t0) / 1000).toFixed(1)}초) · 다 배운 뒤 점검: ${allOk.why}`);
if (flag("map")) { console.log(reviewTable(map)); process.exit(0); }

/* ---------- 심기 모드(설계 6번) ---------- */
if (opt("plant")) {
  const { plants, measurePlants, runPlant } = await import(path.join(LIB, "plant.ts"));
  const { installDry } = await import(path.join(LIB, "dry-ai.ts"));
  const all = await measurePlants(plants(map), pack);
  const chosen = opt("plant") === "all" ? all : all.filter((p: { id: string; wrong: string }) => p.id === opt("plant") || p.wrong === opt("plant"));
  if (!chosen.length) { console.log(`심을 것: ${all.map((p: { id: string }) => p.id).join(", ")}`); process.exit(1); }
  const rows: string[] = [];
  for (const [i, p] of chosen.entries()) {
    switchDataDir(path.join(dataRoot, `plant-${i}`));
    const d = dry ? installDry(map) : null;
    const r = await runPlant(map, pack, p, { keyGap: dry }).finally(() => d?.uninstall());
    console.log(`  심음 ${p.id}(${p.verdict}): 잡음 ${dry ? "AI 필요" : r.caught ? "예" : "아니오"} · 빈틈 ${r.gaps.length} · 장면 ${r.scene ? `${r.scene.format} 심은 코드 ${r.scene.planted} / 고친 코드 ${r.scene.fixed}` : "없음"}${r.why ? ` (${r.why})` : ""}`);
    rows.push(`| ${p.id} | ${p.what} | ${p.verdict} | ${dry ? "AI 필요" : r.caught ? "예" : "아니오"} | ${r.gaps.map((g: { title: string; fragments: string[] }) => `${g.title}(${g.fragments.join(",") || "-"})`).join("<br>") || "-"} | ${r.scene ? `${r.scene.format}: 심은 코드 ${r.scene.planted} · 고친 코드 ${r.scene.fixed}` : "-"} |`);
  }
  const md = [`# 심기 모드 — ${problem} (${stamp})`, "", "우리가 심은 실수를 우리 시스템이 찾는지(두 시스템이 맞물리는지)만 보는 회귀 시험이에요.", "",
    "| 심은 것 | 생각 | 판정 | 빈틈으로 잡음 | 뽑힌 빈틈(맞춘 조각) | 장면(심은 코드 → 같은 실수, 고친 코드 → 통과여야 함) |", "|---|---|---|---|---|---|", ...rows, ""].join("\n");
  await writeFile(path.join(runDir, "plant.md"), md, "utf8");
  console.log(`보고서: ${path.relative(ROOT, path.join(runDir, "plant.md"))}`);
  process.exit(0);
}

/* ---------- 실습(설계 4번 실습 · 10번) ---------- */
if (flag("practice")) {
  const { runPractice } = await import(path.join(LIB, "practice-driver.ts"));
  const r = await runPractice({ outDir: path.join(runDir, "practice"), dataDir: path.join(dataRoot, "practice"), port: Number(opt("port") ?? 4110), dry, seed: Number(opt("seed") ?? 7), log: (s: string) => console.log(s) });
  console.log(`실습 끝: ${r.summary}\n보고서: ${path.relative(ROOT, path.join(runDir, "practice", "report.md"))}`);
  process.exit(r.ok ? 0 : 1);
}

/* ---------- 누구를 돌리나 ---------- */
const base = await loadSpec(opt("spec") ?? path.join(HERE, "default.json"));
const options = await loadOptions(path.join(HERE, "options"));
const seed = opt("seed") ? Number(opt("seed")) : base.seed;
type Who = { id: string; name: string; options: string[]; expect?: { route: string; see: string } };
let who: Who[];
if (opt("experiment") === "first") who = FIRST_EXPERIMENT;
else if (opt("experiment")) { console.log(`모르는 실험: ${opt("experiment")}`); process.exit(1); }
else { const names = (opt("with") ?? "").split(",").map((s) => s.trim()).filter(Boolean); who = [{ id: opt("id") ?? `npc_${names.join("_") || "기본"}`.replace(/[^\w가-힣-]/g, "_"), name: opt("label") ?? (names.join(" + ") || "기본 학습자"), options: names }]; }

const jobs: Array<{ who: Who; file: string; outDir: string }> = [];
for (const w of who) {
  const b = buildSpec(base, options, w.options, { id: w.id, name: w.name, seed });
  const v = validated(b.spec, map);
  if (b.unknown.length) console.log(`  [${w.name}] 모르는 옵션 조각: ${b.unknown.join(", ")} (뺌)`);
  if (b.conflicts.length) console.log(`  [${w.name}] 부딪침:\n    - ${b.conflicts.join("\n    - ")}`);
  if (b.notes.length) console.log(`  [${w.name}] 고친 값: ${b.notes.join(", ")}`);
  if (v.dropped.length) console.log(`  [${w.name}] 지도에 없는 항목 이름: ${v.dropped.join(", ")} (뺌)`);
  const h = holdings(v.spec, map, dice(v.spec.seed, map.problem));
  console.log(`  [${w.name}] ${describe(v.spec, base)} → 안 가진 조각 ${map.fragments.filter((f: { id: string; wrong?: boolean }) => !f.wrong && !h.holds.has(f.id)).map((f: { id: string }) => f.id).join(", ") || "없음"}${h.wrongs.size ? ` · 틀린 조각 ${[...h.wrongs.values()].join(", ")}` : ""}`);
  const outDir = path.join(runDir, w.id);
  await mkdir(outDir, { recursive: true });
  const job = { name: w.name, spec: v.spec, mapFile: mapFile(OUT, map.problem), packModule, dataDir: path.join(dataRoot, w.id), outDir, dry, mode: (opt("mode") === "loose" ? "loose" : "strict"),
    ...(w.expect ? { expect: w.expect } : {}), suspectAi: flag("suspect-ai"), scenes: !flag("no-scenes") };
  const file = path.join(outDir, "job.json");
  await writeFile(file, JSON.stringify(job, null, 1), "utf8");
  jobs.push({ who: w, file, outDir });
}

/* ---------- 사용량: 실행 전 어림 · 실행 뒤 실제 ---------- */
// 설계 9번 표: NPC 한 명 × 문제 하나 ≈ 8만~9만(보통 판). 지도는 문제마다 1.5만. 가짜 AI는 0.
const PER_NPC = dry ? 0 : 85_000, MAP = flag("remap") ? 15_000 : 0;
const maxTokens = opt("max-tokens") ? Number(opt("max-tokens")) : Infinity;
console.log(`예상 사용량: 지도 ${MAP.toLocaleString()} + NPC ${jobs.length}명 × ${PER_NPC.toLocaleString()} = 약 ${(MAP + PER_NPC * jobs.length).toLocaleString()} 토큰${Number.isFinite(maxTokens) ? ` (상한 ${maxTokens.toLocaleString()})` : ""}`);
if (flag("plan")) process.exit(0);

function child(file: string, extra: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(HERE, "one.ts"), file, ...extra],
      { cwd: ROOT, env: { ...process.env, ...(dry ? { STUDY_FORGE_MODEL_PROVIDER: "fake" } : {}) }, stdio: "inherit" });
    p.on("exit", (c) => resolve(c ?? 1));
  });
}
const { usageOf } = await import(path.join(LIB, "algo-driver.ts"));
let spent = (await usageOf(path.join(dataRoot, "_map"))).tokens;
const scores: unknown[] = [];
const skipped: string[] = [];
for (const j of jobs) {
  if (spent + PER_NPC > maxTokens) { skipped.push(j.who.name); console.log(`  [${j.who.name}] 토큰 상한을 넘을 것 같아 시작하지 않음(지금까지 ${spent.toLocaleString()})`); continue; }
  const code = await child(j.file);
  const s = await readFile(path.join(j.outDir, "score.json"), "utf8").then((x) => JSON.parse(x)).catch(() => null);
  if (code !== 0 || !s) { console.log(`  [${j.who.name}] 실패 (${path.join(j.outDir, "error.txt")})`); continue; }
  scores.push(s);
  spent += s.usage?.tokens ?? 0;
}

/* ---------- 묶음 보고서 ---------- */
const report = [`# 가상 학습자 실행 — ${problem} ${map.title} (${stamp})`, "",
  `- ${dry ? "가짜 AI(--dry, AI 0번): 연출가 · 검사 · 정답지 · 드라이버가 끝까지 도는지 보는 판. 앱의 AI 자리는 가짜 답(빈틈 뽑기는 빈 목록)." : `AI: ${provider}${provider === "relay" ? " (대역 모델 — 실제 ChatGPT가 아님)" : ""}`} · 모드 ${opt("mode") === "loose" ? "느슨" : "엄격"} · 씨앗 ${seed}`,
  `- 지도: ${map.source === "hand" ? "손으로 쓴 지도" : "AI가 만든 지도"} · 길 판정 ${map.routes.map((r: { id: string; measured?: { verdict: string } }) => `${r.id} ${r.measured?.verdict}`).join(" · ")} · 다 배운 뒤 점검: ${allOk.ok ? "통과" : "실패"} (${allOk.why}) · 확인 표 [map-review.md](map-review.md)`,
  `- 사용량: 예상 약 ${(MAP + PER_NPC * jobs.length).toLocaleString()} · 실제 ${spent.toLocaleString()} 토큰${skipped.length ? ` · 상한 때문에 안 돌린 NPC: ${skipped.join(", ")}` : ""}`, "",
  summaryTable(scores as never), "",
  ...((scores as Array<{ played: { spec: { id: string } }; name: string }>).map((s) => `- [${s.name}](${s.played.spec.id}/report.md)`)), "",
  "판정 기준(설계 8번): 예상 길과 실제 코드의 길이 같은지는 각 보고서의 \"마지막 코드\"를 사람이 읽고 확인한다. 막힌 자리가 빠진 조각 자리인지는 자동 확인 표에 있다.", ""].join("\n");
// 진짜 사람과 맞춰 보기(설계 5번의 5): --human <파일.json> = {"1": 말 수, "2": …}(사람 기록의 층 분포)
let human = "";
if (opt("human")) {
  const { compareLayers, layerDistribution } = await import(path.join(LIB, "score.ts"));
  const h = JSON.parse(await readFile(opt("human")!, "utf8"));
  const npcAll: Record<string, number> = {};
  for (const s of scores as Array<{ played: never }>) for (const [k, v] of Object.entries(layerDistribution(s.played) as Record<string, number>)) npcAll[k] = (npcAll[k] ?? 0) + v;
  human = `\n## 진짜 사람과 맞춰 보기(막힌 층 분포)\n\n${compareLayers(h, npcAll).md}\n`;
  console.log(human);
}
await writeFile(path.join(runDir, "report.md"), report + human, "utf8");
console.log(`\n${summaryTable(scores as never)}\n\n보고서: ${path.relative(ROOT, path.join(runDir, "report.md"))}`);
