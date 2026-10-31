// 같은 지식 찾기 시험 (2026-10-28): the same three steps the store runs on every save, on a made-up set with known
// answers (dedupe-eval-set.ts), in memory only — the learner's knowledge is never touched. One embedding pass, then
// the AI judgment once per model, so models are compared on exactly the same candidates.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { judgeBatch, type JudgeItem, type Verdict } from "./dedupe.ts";
import { judgeBatchDecisions, type DecisionsInfo } from "./dedupe-decisions.ts";
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

/**
 * The answer for any two items. Items that are the same knowledge share one concept (the base item's key), so
 * "이진 탐색 ↔ Binary Search" is 같음 too, and a relation given for one name holds for its other names; the other
 * way round, 포함 flips (narrower ↔ broader). Anything not given is 다름.
 */
function truthOf(a: string, b: string): string[] {
  const group = (k: string) => INCOMING.find((x) => x.key === k && Object.entries(x.truth).some(([, ok]) => ok.length === 1 && ok[0] === "same"))
    ? Object.entries(INCOMING.find((x) => x.key === k)!.truth).find(([, ok]) => ok.length === 1 && ok[0] === "same")![0] : k;
  const ga = group(a), gb = group(b);
  if (ga === gb) return ["same"];
  const flip = (v: string) => v === "narrower" ? "broader" : v === "broader" ? "narrower" : v;
  for (const x of INCOMING) for (const [k, ok] of Object.entries(x.truth)) {
    if (ok.length === 1 && ok[0] === "same") continue;
    if (group(x.key) === ga && group(k) === gb) return [...ok];
    if (group(x.key) === gb && group(k) === ga) return ok.map(flip);
  }
  return ["different"];
}

// Verdicts that make a link (2026-10-28 고리 종류: 포함·활용·선수; "related" is the old 관련 and 어휘 비슷한 말). 가까움 makes none.
const LINK_VERDICTS: string[] = ["narrower", "broader", "uses", "used_by", "needs", "needed_by", "related"];
// The test set's truth still says "related" for 관련: any of the new link kinds or 가까움 counts as that.
const asTruth = (v: string) => (["uses", "used_by", "needs", "needed_by", "near"].includes(v) ? "related" : v);
function score(prep: Awaited<ReturnType<typeof prepare>>, verdicts: Array<Array<{ verdict: Verdict; reason: string }>>) {
  const { byKey, step1, work } = prep;
  const t = (k: string) => byKey.get(k)!.title;
  const all: PairOut[] = [];
  for (const n of INCOMING) {
    const merged = step1.get(n.key);
    if (merged) { const ok = truthOf(n.key, merged); all.push({ from: t(n.key), to: t(merged), truth: ok.join("/"), verdict: "1단계 합침", ok: ok.includes("same"), reason: "이름·별칭이 같음" }); }
    const w = work.findIndex((x) => x.key === n.key);
    if (w >= 0) work[w].cands.forEach((c, m) => { const ok = truthOf(n.key, c.key), v = verdicts[w][m];
      all.push({ from: t(n.key), to: t(c.key), truth: ok.join("/"), verdict: v.verdict, ok: ok.includes(asTruth(v.verdict) as never) || (v.verdict !== "same" && v.verdict !== "different" && !ok.includes("same") && ok.length > 1), reason: v.reason }); });
    // Pairs the answer cares about that never reached the model (not among the five candidates).
    for (const [other, ok] of Object.entries(n.truth)) {
      if (merged === other || (w >= 0 && work[w].cands.some((c) => c.key === other))) continue;
      all.push({ from: t(n.key), to: t(other), truth: ok.join("/"), verdict: "후보에 없음", ok: ok.includes("different"), reason: "" });
    }
  }
  const isSame = (p: PairOut) => p.truth === "same";
  const sameKeys = new Set<string>();
  const same = all.filter(isSame).filter((p) => { const k = [p.from, p.to].sort().join("|"); if (sameKeys.has(k)) return false; sameKeys.add(k); return true; });
  const judgedSame = (p: PairOut) => p.verdict === "same" || p.verdict === "1단계 합침";
  return {
    same: { total: same.length, caught: same.filter(judgedSame).length, notInCandidates: same.filter((p) => p.verdict === "후보에 없음").length,
      missedByModel: same.filter((p) => !judgedSame(p) && p.verdict !== "후보에 없음").length },
    falseMerge: all.filter((p) => judgedSame(p) && !isSame(p)).length,
    relations: { total: all.filter((p) => !isSame(p) && p.truth !== "different").length, right: all.filter((p) => !isSame(p) && p.truth !== "different" && p.ok).length },
    // Links the answer does not have: not always wrong (최대 힙 ↔ 힙 정렬), but each one is a link the learner did not ask for.
    extraLinks: all.filter((p) => p.truth === "different" && LINK_VERDICTS.includes(p.verdict)).length,
    wrong: all.filter((p) => !p.ok && !(p.truth === "different" && p.verdict !== "same")),
    extra: all.filter((p) => p.truth === "different" && LINK_VERDICTS.includes(p.verdict)),
    all,
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
    // "decisions:gpt-6-luna@0.8" = Decisions API, 같음은 확률 0.8 이상만 (dedupe-decisions.ts, 2026-10-31 실험).
    const decisions = /^decisions(?::([^@]+))?(?:@([\d.]+))?$/.exec(m.model);
    const infos: DecisionsInfo[] = [];
    try {
      for (let i = 0; i < prep.work.length; i += BATCH) {
        const chunk = prep.work.slice(i, i + BATCH).map((w) => ({ item: asJudge(prep.byKey.get(w.key)!), cands: w.cands.map((c) => asJudge(prep.byKey.get(c.key)!)) }));
        if (decisions) {
          const r = await judgeBatchDecisions(chunk, { model: decisions[1] || "gpt-6-luna", sameMin: decisions[2] ? Number(decisions[2]) : 0.5 });
          verdicts.push(...r.verdicts); if (r.info) infos.push(r.info);
        } else verdicts.push(...await judgeBatch(chunk, { model: m.model, effort: m.effort ?? "low" }));
        calls++;
      }
    } catch (e) { error = e instanceof Error ? e.message.slice(0, 500) : String(e); }
    results.push({ model: m.model, effort: decisions ? "" : m.effort ?? "low", calls, ms: Date.now() - started, error, ...(infos.length ? { decisions: infos } : {}), ...(error ? {} : score(prep, verdicts)) });
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
