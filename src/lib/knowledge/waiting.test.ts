// 핵심 카드만 지식으로 (2026-10-30): 핵심은 바로 지식, 보조·미정은 기다렸다가 풀거나 "모름"을 누를 때 지식이 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKnowledge, importPoints, itemsByRef, pickWaiting, recordByRef, tree, waitingCount } from "./store.ts";

test("핵심만 바로 지식, 보조는 풀거나 모름을 누를 때", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "waiting-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  const pt = (id: string, title: string, importance?: "core" | "minor" | "pending") => ({ ref: `gen_x:${id}`, title, essentials: [`${title}의 뜻`], folder: "그래픽스/투영", material: "그래픽스", page: 3, ...(importance ? { importance } : {}) });
  try {
    const r = await importPoints([pt("a", "원근 투영", "core"), pt("b", "소실점", "minor"), pt("c", "투영 행렬", "pending")]);
    assert.equal(r.added, 1);
    assert.deepEqual((await tree()).items.map((i) => i.title), ["원근 투영"], "only the core card is knowledge");
    assert.equal(await waitingCount(), 2);

    await recordByRef(["gen_x:b"], "wrong", "자료 지도에서 틀림");
    const [b] = await itemsByRef(["gen_x:b"]);
    assert.ok(b, "a practice result on a waiting card makes it knowledge");
    assert.equal((await getKnowledge(b.id)).item.state, "unknown");

    await pickWaiting("gen_x:c");
    const [c] = await itemsByRef(["gen_x:c"]);
    assert.equal((await getKnowledge(c.id)).item.state, "unknown", "모름 → 몰랐음");
    assert.equal(await waitingCount(), 0);

    // 정리가 끝나 핵심이 된 카드는 다음 가져오기에 지식이 되고, 중요도가 없는 예전 엔진은 전부 지식.
    await importPoints([pt("d", "클리핑", "pending")]);
    assert.equal((await itemsByRef(["gen_x:d"])).length, 0);
    await importPoints([pt("d", "클리핑", "core"), pt("e", "뷰포트")]);
    assert.equal((await itemsByRef(["gen_x:d", "gen_x:e"])).length, 2);
    assert.equal(await waitingCount(), 0);
  } finally {
    for (const [k, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});
