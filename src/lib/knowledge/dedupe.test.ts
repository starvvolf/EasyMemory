// 같은 지식 찾기 3단계 with a fake embedder and a fake model: 같음 → 중복 의심 (never merged by itself),
// 포함·관련 → 고리, 다름 → nothing; every item is checked once; the learner's 합치기 / 다른 지식.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { setEmbedder } from "./embed.ts";
import { openDuplicates, resolveDuplicate, runDuplicateCheck } from "./dedupe.ts";
import { getKnowledge, onKnowledgeCreated, saveKnowledge, saveMany, tree } from "./store.ts";

// Letters counted into buckets: names that share letters come out close.
const fakeEmbed = async (texts: string[]) => texts.map((t) => {
  const v = new Float32Array(64); for (const ch of t.normalize("NFKC").toLowerCase()) if (/\p{L}|\p{N}/u.test(ch)) v[ch.codePointAt(0)! % 64] += 1; return v; });
// The judge: what a careful model would say for these names.
const RULES: Record<string, string> = { "이진 탐색|이분 탐색": "same", "lower_bound|이분 탐색": "narrower", "다익스트라|우선순위 큐": "related" };
function judge(request: ModelRequest) {
  const blocks = request.user.split("\n\n");
  return { items: blocks.map((block, n) => {
    const [head, ...cands] = block.split("\n");
    const name = head.replace(/^\[새 지식 \d+\] /, "").split(" [")[0].split(" (")[0];
    return { n, candidates: cands.map((c, m) => {
      const other = c.replace(/^\s*후보 \d+\. /, "").split(" [")[0].split(" (")[0];
      return { m, verdict: RULES[`${name}|${other}`] ?? "different", reason: `${name}와 ${other}` };
    }) };
  }) };
}

async function withFakes(run: (calls: ModelRequest[]) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-dedupe-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir;
  process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const calls: ModelRequest[] = [];
  setEmbedder(fakeEmbed);
  setFakeModelResponder((request) => { calls.push(request); return JSON.stringify(judge(request)); });
  try { await run(calls); } finally {
    setFakeModelResponder(null); setEmbedder(null); onKnowledgeCreated(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("3단계: same becomes a pair to confirm, part-of and related become links, different leaves nothing", () => withFakes(async (calls) => {
  await saveMany([{ kind: "concept" as const, title: "이분 탐색", body: "정렬된 범위를 반씩 줄여 찾는다", folder: "알고리즘" }, { kind: "concept" as const, title: "우선순위 큐", body: "작은 것부터 꺼내는 자료구조", folder: "알고리즘" },
    { kind: "concept" as const, title: "기준금리", body: "중앙은행이 정하는 금리", folder: "경제" }]);
  assert.deepEqual(await runDuplicateCheck(), { checked: 3, found: 0, left: 0 }, "the first items have nothing to be the same as");
  const before = calls.length;
  const told: string[][] = [];
  onKnowledgeCreated((ids) => told.push(ids));
  await saveMany([{ kind: "concept" as const, title: "이진 탐색", body: "정렬된 배열을 반으로 나눠 찾는다" }, { kind: "concept" as const, title: "lower_bound", body: "x 이상이 처음 나오는 자리" }, { kind: "concept" as const, title: "다익스트라", body: "최단 거리" }]);
  assert.equal(told.length, 1, "the listener hears about a save that made new items");
  assert.equal(told[0].length, 3);
  const result = await runDuplicateCheck();
  assert.equal(result.checked, 3);
  assert.equal(calls.length - before, 1, "one model call for the batch");

  const pairs = await openDuplicates();
  assert.deepEqual(pairs.map((p) => [p.otherTitle, p.newTitle, p.verdict]), [["이분 탐색", "이진 탐색", "same"]]);
  assert.equal((await tree()).items.length, 6, "nothing is merged by itself");
  const byTitle = Object.fromEntries((await tree()).items.map((i) => [i.title, i.id]));
  const bin = await getKnowledge(byTitle["이분 탐색"]);
  assert.deepEqual(bin.links.map((l) => [l.item.title, l.relation]), [["lower_bound", "포함"]], "the broader one points to the narrower one");
  const dij = await getKnowledge(byTitle["다익스트라"]);
  assert.deepEqual(dij.links.map((l) => [l.item.title, l.relation]), [["우선순위 큐", "관련"]]);
  assert.equal((await getKnowledge(byTitle["기준금리"])).backlinks.length, 0);

  assert.deepEqual(await runDuplicateCheck(), { checked: 0, found: 0, left: 0 }, "every item is checked once");
  await resolveDuplicate(pairs[0].id, "merge", pairs[0].otherId);
  const merged = await getKnowledge(byTitle["이분 탐색"]);
  assert.ok(merged.item.aliases.includes("이진 탐색"), "the other name stays as 다른 이름");
  assert.equal((await tree()).items.length, 5);
  assert.deepEqual(await openDuplicates(), []);
}));

test("다른 지식이에요 closes the pair and it is not asked again", () => withFakes(async () => {
  await saveKnowledge({ kind: "concept" as const, title: "이분 탐색", body: "반씩 줄여 찾기" });
  await runDuplicateCheck();
  await saveKnowledge({ kind: "concept" as const, title: "이진 탐색", body: "반으로 나눠 찾기" });
  await runDuplicateCheck();
  const [pair] = await openDuplicates();
  await resolveDuplicate(pair.id, "dismiss");
  assert.deepEqual(await openDuplicates(), []);
  assert.equal((await tree()).items.length, 2);
}));

test("이유는 평소 같음에만 쓰게 하고, RECALLER_DEDUPE_REASONS=all이면 전부", () => withFakes(async (calls) => {
  const { judgeBatch } = await import("./dedupe.ts");
  const work = [{ item: { title: "이진 탐색", aliases: [], body: "", path: "" }, cands: [{ title: "이분 탐색", aliases: [], body: "", path: "" }] }];
  await judgeBatch(work);
  assert.match(calls.at(-1)!.system, /same이 아니면 빈 문자열/);
  process.env.RECALLER_DEDUPE_REASONS = "all";
  try { await judgeBatch(work); } finally { delete process.env.RECALLER_DEDUPE_REASONS; }
  assert.doesNotMatch(calls.at(-1)!.system, /same이 아니면/);
  assert.match(calls.at(-1)!.system, /reason: 한국어 한 문장\./);
}));
