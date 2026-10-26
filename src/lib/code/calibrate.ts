// 채점 보정 (2026-10-27, docs/DECISIONS.md "로컬 채점: 보정"): makes this PC judge like the reference PC.
//  - Speed: three small benchmarks (plain arithmetic, cache-missing memory reads, sorting), each the best of three
//    runs, compared with the same benchmarks on the reference PC; the speed factor is their geometric mean.
//    C++ when this PC has it (closest to the machine), JavaScript otherwise.
//  - Empty-program cost per language (start-up CPU, memory), the least of five runs: taken off every measurement,
//    so a solution is judged on what it used itself, not on how heavy this PC's Python install is.
// The job object counts CPU time in 15.6 ms ticks, so each benchmark runs about half a second or more.
// Measured once (about 10–20 s, in the background when the code tab opens) and kept in STUDY_FORGE_DATA_DIR/code;
// measured again when a compiler changes, after 30 days, or from the screen.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, execute, jobrun, LANGS, prepare, tools, type Calibration, type Lang } from "./run.ts";

/**
 * The reference PC (the desktop this app was built on, measured 2026-10-27: g++ 14.2 -O2, Node 24): best-of-three CPU ms
 * per benchmark, the middle of three calibrations (they were within 5% of each other). Treated as the judge's speed.
 */
export const REFERENCE: Record<"cpp" | "javascript", Record<Bench, number>> = {
  cpp: { arith: 625, memory: 531, sort: 546 },
  javascript: { arith: 421, memory: 750, sort: 656 },
};
type Bench = "arith" | "memory" | "sort";
const BENCHES: Bench[] = ["arith", "memory", "sort"];
const MAX_AGE_MS = 30 * 24 * 3600_000;

const CPP = `#include <cstdio>
#include <cstring>
#include <cstdint>
#include <vector>
#include <algorithm>
static uint64_t s = 88172645463325252ULL;
static inline uint64_t nxt() { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s; }
int main() {
  char k[16] = {0}; if (scanf("%15s", k) != 1) return 0;
  uint64_t r = 0;
  if (!strcmp(k, "arith")) { uint64_t x = 1; for (long i = 0; i < 800000000L; i++) { x = x * 6364136223846793005ULL + 1442695040888963407ULL; r ^= x >> 33; } }
  else if (!strcmp(k, "memory")) { const int n = 1 << 23; std::vector<uint32_t> nx(n); for (int i = 0; i < n; i++) nx[i] = i;
    for (int i = n - 1; i > 0; i--) { int j = (int)(nxt() % (uint64_t)i); std::swap(nx[i], nx[j]); } // one cycle: no short loops in cache
    uint32_t p = 0; for (int i = 0; i < 40000000; i++) p = nx[p]; r = p; }
  else { const int n = 10000000; std::vector<uint32_t> a(n); for (auto& v : a) v = (uint32_t)nxt(); std::sort(a.begin(), a.end()); r = a[n / 2]; }
  printf("%llu\\n", (unsigned long long)r);
}`;
const JS = `const k = require("fs").readFileSync(0, "utf8").trim(); let r = 0;
let s = 88172645; const nxt = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
if (k === "arith") { let x = 1; for (let i = 0; i < 500000000; i++) { x = (Math.imul(x, 1103515245) + 12345) | 0; r ^= x >>> 16; } }
else if (k === "memory") { const n = 1 << 23; const nx = new Int32Array(n); for (let i = 0; i < n; i++) nx[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = nxt() % i; const t = nx[i]; nx[i] = nx[j]; nx[j] = t; }
  let p = 0; for (let i = 0; i < 40000000; i++) p = nx[p]; r = p; }
else { const n = 10000000; const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = nxt(); a.sort(); r = a[n >> 1]; }
console.log(String(r));`;
const EMPTY: Record<Lang, string> = {
  python: "import sys\nsys.stdin.read()\n",
  javascript: "require('fs').readFileSync(0);\n",
  cpp: "#include <cstdio>\nint main() { int c; while ((c = getchar()) != EOF) {} }\n",
  csharp: "class P { static void Main() { System.Console.In.ReadToEnd(); } }\n",
};

export type CalibrationFile = Calibration & {
  at: string; via: "cpp" | "javascript"; benches: Record<Bench, number>; ratios: Record<Bench, number>;
  procs: Partial<Record<Lang, number>>; versions: Record<string, string>;
};

const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "calibration.json");
const state = globalThis as unknown as { __calibration?: Promise<CalibrationFile | null> };

async function versions() {
  const t = await tools();
  return Object.fromEntries(LANGS.map((l) => [l, t[l]?.version ?? ""]));
}

/** The saved calibration if still good, else a fresh one (one at a time). null when this PC can't measure (not Windows). */
export function calibration(force = false): Promise<CalibrationFile | null> {
  if (!force && state.__calibration) return state.__calibration;
  const run = (async () => {
    if (!(await jobrun())) return null;
    if (!force) {
      try {
        const saved = JSON.parse(await readFile(file(), "utf8")) as CalibrationFile;
        const same = JSON.stringify(saved.versions) === JSON.stringify(await versions());
        if (same && Date.now() - Date.parse(saved.at) < MAX_AGE_MS) return saved;
      } catch { /* none yet */ }
    }
    const made = await measure();
    if (made) { await mkdir(path.dirname(file()), { recursive: true }); await writeFile(file(), JSON.stringify(made, null, 2), "utf8"); }
    return made;
  })().catch((e) => { console.warn(`[code] calibration failed: ${(e as Error).message}`); return null; });
  state.__calibration = run;
  return run;
}

async function bestOf(lang: Lang, code: string, input: string, times: number) {
  const prepared = await prepare(lang, code);
  if (!prepared.ok) return null;
  try {
    let cpu = Infinity, peak = Infinity, procs = 0;
    for (let i = 0; i < times; i++) {
      const out = await execute(prepared.cmd, prepared.args, { cwd: prepared.dir, input, timeMs: 30_000, limits: { cpuMs: 20_000, memMb: 2048 }, ...(prepared.env ? { env: prepared.env } : {}) });
      if (!out.usage || out.code !== 0) return null;
      cpu = Math.min(cpu, out.usage.cpuMs); peak = Math.min(peak, out.usage.peakKb); procs = Math.max(procs, out.usage.procs);
    }
    return { cpuMs: cpu, peakKb: peak, procs };
  } finally { await cleanup(prepared); }
}

async function measure(): Promise<CalibrationFile | null> {
  const t = await tools();
  const base: Calibration["base"] = {}, procs: CalibrationFile["procs"] = {};
  for (const lang of LANGS) {
    if (!t[lang]) continue;
    const b = await bestOf(lang, EMPTY[lang], "", 5);
    if (b) { base[lang] = { cpuMs: b.cpuMs, peakKb: b.peakKb }; procs[lang] = b.procs; }
  }
  const via: "cpp" | "javascript" = t.cpp ? "cpp" : "javascript";
  const benches = {} as Record<Bench, number>, ratios = {} as Record<Bench, number>;
  for (const bench of BENCHES) {
    const r = await bestOf(via, via === "cpp" ? CPP : JS, bench, 3);
    if (!r) return null;
    benches[bench] = r.cpuMs;
    ratios[bench] = REFERENCE[via][bench] > 0 ? r.cpuMs / REFERENCE[via][bench] : 1;
  }
  const speed = Math.exp(BENCHES.reduce((sum, b) => sum + Math.log(Math.max(0.05, ratios[b])), 0) / BENCHES.length);
  // Within 5% is run-to-run noise (the reference PC itself measures 0.95–1.05): judge it as the reference.
  return { speed: Math.abs(speed - 1) < 0.05 ? 1 : Math.round(speed * 1000) / 1000, base, at: new Date().toISOString(), via, benches, ratios, procs, versions: await versions() };
}
