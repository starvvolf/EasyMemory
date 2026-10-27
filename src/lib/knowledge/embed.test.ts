// 비슷한 지식 후보: vectors kept per item, remade only when the text changes; candidates by closeness, best first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { embedText, setEmbedder, similarKnowledge } from "./embed.ts";
import { linkKnowledge, saveMany, updateKnowledge } from "./store.ts";

// A stand-in for the model: letters of the text counted into 64 buckets (close words → close vectors).
let calls = 0;
const fake = async (texts: string[]) => { calls += texts.length; return texts.map((t) => {
  const v = new Float32Array(64); for (const ch of t.normalize("NFKC").toLowerCase()) if (/\p{L}|\p{N}/u.test(ch)) v[ch.codePointAt(0)! % 64] += 1; return v; }); };

test("candidates by meaning: closest first, linked ones marked, vectors remade only for changed items", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-embed-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  setEmbedder(fake); calls = 0;
  try {
    const [a, b, c] = await saveMany([{ title: "이분 탐색", body: "정렬된 배열을 반씩 줄여 찾는다" }, { title: "이진 탐색", body: "정렬된 배열을 반으로 나눠 찾는다" }, { title: "기준금리", body: "중앙은행이 정하는 금리" }]);
    await linkKnowledge(a.item.id, c.item.id, "관련");
    const { hits, made } = await similarKnowledge({ id: a.item.id });
    assert.equal(made, 3);
    assert.deepEqual(hits.map((h) => h.title), ["이진 탐색", "기준금리"]);
    assert.ok(hits[0].score > hits[1].score);
    assert.equal(hits[1].linked, true);
    const file = JSON.parse(await readFile(path.join(dir, "knowledge", "vectors.json"), "utf8"));
    assert.equal(Object.keys(file.items).length, 3);
    assert.equal((await similarKnowledge({ id: a.item.id })).made, 0, "nothing changed, nothing remade");
    await updateKnowledge(b.item.id, { aliases: ["Binary Search"] });
    assert.equal((await similarKnowledge({ id: a.item.id })).made, 1, "only the changed item");
    assert.equal(calls, 4);
    assert.equal((await similarKnowledge({ text: "정렬된 배열 반씩" })).hits[0].title === "기준금리", false);
  } finally {
    setEmbedder(null);
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("what is compared: name, other names and the meaning's first line, not the 헷갈림 notes", () => {
  assert.equal(embedText({ title: "누적 합", aliases: ["prefix sum"], body: "헷갈림: 인덱스\nS[r] - S[l-1]로 구간 합" }), "누적 합 (prefix sum) : S[r] - S[l-1]로 구간 합");
  assert.equal(embedText({ title: "DFS", aliases: [], body: "" }), "DFS");
});
