// 같은 지식 찾기 시험 (2026-10-28): the same three steps the store runs on every save, on a made-up set with known
// answers (dedupe-eval-set.ts), in memory only — the learner's knowledge is never touched. One embedding pass, then
// the AI judgment once per model, so models are compared on exactly the same candidates.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { judgeBatch, type JudgeItem, type Verdict } from "./dedupe.ts";
import { BASE, INCOMING, type EvalItem } from "./dedupe-eval-set.ts";
import { embedText, embedTexts } from "./embed.ts";
import { sameName } from "./store.ts";

const CANDIDATES = 5, BATCH = 25;
const asJudge = (x: EvalItem): JudgeItem => ({ title: x.title, aliases: x.aliases ?? [], body: x.body ?? "", path: x.path });
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export type EvalModel = { model: string; effort?: string };
type PairOut = { from: string; to: string; truth: string; verdict: Verdict | "1단계 합침" | "후보에 없음"; ok: boolean; reason: string };

/** Steps 1 and 2 (no model): which incoming items merge by name, and each other's five closest items by meaning. */
async function prepare() {
  const all = [...BASE, ...INCOMING];
  const vectors = await embedTexts(all.map((x) => embedText({ title: x.title, aliases: x.aliases ?? [], body: x.body ?? "" })));
  const vec = new Map(all.map((x, i) => [x.key, vectors[i]]));
  const byKey = new Map(all.map((x) => [x.key, x]));
  const step1 = new Map<string, string>();
  const work: Array<{ key: string; cands: Array<{ key: string; score: number }> }> = [];
  for (const n of INCOMING) {
    const hit = sameName(BASE.map((x) => ({ ...x, aliases: x.aliases ?? [] })), n.title, n.aliases ?? []);
    if (hit) { step1.set(n.key, hit.key); continue; }
    const cands = all.filter((x) => x.key !== n.key && !step1.has(x.key)).map((x) => ({ key: x.key, score: dot(vec.get(n.key)!, vec.get(x.key)!) }))
      .sort((a, b) => b.score - a.score).slice(0, CANDIDATES);
    work.push({ key: n.key, cands });
  }
  return { byKey, step1, work };
}

function score(prep: Awaited<ReturnType<typeof prepare>>, verdicts: Array<Array<{ verdict: Verdict; reason: string }>>) {
  const { byKey, step1, work } = prep;
  const pairs: PairOut[] = [];
  const extra: PairOut[] = [];
  const t = (k: string) => byKey.get(k)!.title;
  for (const n of INCOMING) {
    const merged = step1.get(n.key);
    const w = work.findIndex((x) => x.key === n.key);
    for (const [other, ok] of Object.entries(n.truth)) {
      const truth = ok.join("/");
      if (merged) { pairs.push({ from: t(n.key), to: t(other), truth, verdict: "1단계 합침", ok: merged === other ? ok.includes("same") : !ok.includes("same"), reason: `이름으로 ${t(merged)}에 합침` }); continue; }
      const m = work[w].cands.findIndex((c) => c.key === other);
      if (m < 0) { pairs.push({ from: t(n.key), to: t(other), truth, verdict: "후보에 없음", ok: !ok.includes("same") && ok.includes("different"), reason: "" }); continue; }
      const v = verdicts[w][m];
      pairs.push({ from: t(n.key), to: t(other), truth, verdict: v.verdict, ok: ok.includes(v.verdict), reason: v.reason });
    }
    // Merged by name into something the answer does not call the same: a wrong merge too.
    if (merged && !n.truth[merged]?.includes("same")) extra.push({ from: t(n.key), to: t(merged), truth: "(정답 없음 = 다름)", verdict: "same", ok: false, reason: "이름으로 합침" });
    if (w < 0) continue;
    // What the model said about candidates the answer does not mention: those are "다름", anything else is noise.
    work[w].cands.forEach((c, m) => {
      if (n.truth[c.key]) return;
      const back = INCOMING.find((x) => x.key === c.key)?.truth[n.key];
      if (back) return;
      const v = verdicts[w][m];
      if (v.verdict !== "different") extra.push({ from: t(n.key), to: t(c.key), truth: "(정답 없음 = 다름)", verdict: v.verdict, ok: false, reason: v.reason });
    });
  }
  const sameTruth = pairs.filter((p) => p.truth === "same");
  const notSameTruth = pairs.filter((p) => !p.truth.split("/").includes("same"));
  const falseMerge = [...pairs.filter((p) => !p.truth.split("/").includes("same") && (p.verdict === "same")), ...extra.filter((p) => p.verdict === "same")];
  return {
    same: { total: sameTruth.length, caught: sameTruth.filter((p) => p.ok).length, byName: sameTruth.filter((p) => p.verdict === "1단계 합침" && p.ok).length,
      notInCandidates: sameTruth.filter((p) => p.verdict === "후보에 없음").length, missedByModel: sameTruth.filter((p) => !p.ok && p.verdict !== "후보에 없음" && p.verdict !== "1단계 합침").length },
    falseMerge: falseMerge.length,
    relations: { total: notSameTruth.length, right: notSameTruth.filter((p) => p.ok).length },
    noiseLinks: extra.filter((p) => p.verdict !== "same").length,
    wrong: [...pairs.filter((p) => !p.ok), ...extra],
  };
}

/** Run the set once per model; the report is also kept as knowledge/dedupe-eval-<time>.json in the data folder. */
export async function runDedupeEval(models: EvalModel[]) {
  const t0 = Date.now();
  const prep = await prepare();
  const embedMs = Date.now() - t0;
  const results = [];
  for (const m of models) {
    const started = Date.now();
    const verdicts: Array<Array<{ verdict: Verdict; reason: string }>> = [];
    let calls = 0, error = "";
    try {
      for (let i = 0; i < prep.work.length; i += BATCH) {
        const chunk = prep.work.slice(i, i + BATCH);
        verdicts.push(...await judgeBatch(chunk.map((w) => ({ item: asJudge(prep.byKey.get(w.key)!), cands: w.cands.map((c) => asJudge(prep.byKey.get(c.key)!)) })), { model: m.model, effort: m.effort ?? "low" }));
        calls++;
      }
    } catch (e) { error = e instanceof Error ? e.message.slice(0, 300) : String(e); }
    results.push({ model: m.model, effort: m.effort ?? "low", calls, ms: Date.now() - started, error, ...(error ? {} : score(prep, verdicts)) });
  }
  const candidateRecall = (() => {
    const pairs = INCOMING.flatMap((n) => Object.entries(n.truth).filter(([, ok]) => ok.includes("same")).map(([o]) => [n.key, o] as const));
    const byName = pairs.filter(([n]) => prep.step1.has(n)).length;
    const inTop = pairs.filter(([n, o]) => prep.work.find((w) => w.key === n)?.cands.some((c) => c.key === o)).length;
    return { samePairs: pairs.length, byName, inTop5: inTop };
  })();
  const report = { at: new Date().toISOString(), set: { base: BASE.length, incoming: INCOMING.length }, embedMs, candidateRecall, results,
    candidates: prep.work.map((w) => ({ item: prep.byKey.get(w.key)!.title, cands: w.cands.map((c) => `${prep.byKey.get(c.key)!.title} ${Math.round(c.score * 100)}%`) })) };
  const dir = path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `dedupe-eval-${report.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 1), "utf8");
  return report;
}
