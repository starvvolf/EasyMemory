// The evaluation itself: steps 1–2 without a model, scoring against the answers (a fake judge that says "same" for
// every candidate must show false merges; one that says "different" must miss every 같음 not caught by name).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder } from "../ai/model.ts";
import { setEmbedder } from "./embed.ts";
import { runDedupeEval } from "./dedupe-eval.ts";
import { INCOMING } from "./dedupe-eval-set.ts";

const fakeEmbed = async (texts: string[]) => texts.map((t) => {
  const v = new Float32Array(64); for (const ch of t.normalize("NFKC").toLowerCase()) if (/\p{L}|\p{N}/u.test(ch)) v[ch.codePointAt(0)! % 64] += 1; return v; });

test("the evaluation scores judges against the answers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dedupe-eval-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  setEmbedder(fakeEmbed);
  setFakeModelResponder((request) => {
    const n = request.user.split("\n\n").length;
    const verdict = request.model === "always-same" ? "same" : "different";
    return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i, candidates: [0, 1, 2, 3, 4].map((m) => ({ m, verdict, reason: "" })) })) });
  });
  try {
    const report = await runDedupeEval([{ model: "always-same" }, { model: "always-different" }]);
    const [yes, no] = report.results as Array<{ same: { total: number; caught: number }; falseMerge: number; calls: number }>;
    assert.equal(report.candidateRecall.byName, 2, "주가수익비율 (alias) and 기준 금리 (spacing) merge by name");
    assert.ok(yes.falseMerge > 10, "saying same to everything merges the wrong things");
    assert.equal(no.falseMerge, 0);
    assert.equal(no.same.caught, 2, "saying different finds only what the names find");
    assert.equal(yes.calls, Math.ceil((INCOMING.length - 2) / 25));
  } finally {
    setFakeModelResponder(null); setEmbedder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
