// 빈 뜻·다른 이름 채우기 (knowledge-ai fillMissing → store enrichKnowledge), with a fake model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { fillMissing } from "../assist/knowledge-ai.ts";
import { getKnowledge, saveMany } from "./store.ts";

async function withFake(reply: (request: ModelRequest) => unknown, run: (seen: ModelRequest[]) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-fill-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir;
  process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const seen: ModelRequest[] = [];
  setFakeModelResponder((request) => { seen.push(request); return JSON.stringify(reply(request)); });
  try { await run(seen); } finally {
    setFakeModelResponder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("one call fills empty meanings and other names; what the learner wrote and names others use stay untouched", () => withFake((request) => {
  // Items in the prompt are numbered; empty meanings come first.
  const lines = request.user.split("\n");
  const n = (title: string) => lines.findIndex((l) => l.includes(`. ${title} |`));
  return { items: [
    { n: n("다익스트라 알고리즘"), body: "음수 간선이 없는 그래프에서 한 점으로부터 모든 점까지의 최단 거리를 구한다.", aliases: ["Dijkstra", "이분 탐색"] },
    { n: n("이분 탐색"), body: "덮어쓰면 안 되는 뜻", aliases: ["Binary Search", "이진 탐색"] },
  ] };
}, async (seen) => {
  const [dij, bin] = await saveMany([{ title: "다익스트라 알고리즘", folder: "알고리즘/그래프" }, { title: "이분 탐색", body: "반씩 줄여 찾는다", folder: "알고리즘" }]);
  const result = await fillMissing();
  assert.equal(seen.length, 1, "one model call");
  assert.equal(result.asked, 2);
  assert.deepEqual(result.changed.sort(), [dij.item.id, bin.item.id].sort());
  const d = (await getKnowledge(dij.item.id)).item;
  assert.match(d.body, /최단 거리/);
  assert.deepEqual(d.aliases, ["Dijkstra"], "a name another item already has is not taken");
  const b = (await getKnowledge(bin.item.id)).item;
  assert.equal(b.body, "반씩 줄여 찾는다", "an existing meaning is never replaced");
  assert.deepEqual(b.aliases, ["Binary Search", "이진 탐색"]);
  assert.deepEqual(await fillMissing(), { asked: 0, changed: [] }, "nothing missing, no call");
  assert.equal(seen.length, 1);
}));
