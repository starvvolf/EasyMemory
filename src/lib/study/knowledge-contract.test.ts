// 엔진 → 지식 저장소 약속: a real engine run (fake model) goes through both sides. Run before pushing a change to the
// engine (src/lib/study/gen, src/lib/study/knowledge.ts) or to the knowledge store's import (thread B).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, runGen } from "./gen/runner.ts";
import { knowledgeLayer } from "./knowledge.ts";
import { IMPORT_LIMITS, importPayload, layerProblems, practiceRefs } from "./knowledge-contract.ts";
import { getKnowledge, importPoints, itemsByRef, recordByRef } from "../knowledge/store.ts";

const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer\n- In a right-handed system the test is C <= 0"],
  [2, "# Depth-Buffer Method\n- Initialize the depth buffer to 1.0 for every pixel\n- A surface is drawn only where its depth is smaller than the stored depth"],
]);

test("the default engine's knowledge points go into the knowledge store, and a practice result reaches them", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "contract-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const start = await createGen({ sourceId: "src_contract_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
    const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
    assert.equal(done.status, "done", done.message);

    // The engine side: a layer the store can take.
    const layer = knowledgeLayer(done);
    assert.ok(layer.points.length > 0, "every material has points");
    assert.deepEqual(layerProblems(layer), []);
    const payload = importPayload({ id: done.id, sourceName: "invented.pdf" }, layer);
    for (const p of payload) {
      assert.ok(p.ref.length <= IMPORT_LIMITS.ref && p.title.length >= 1 && p.title.length <= IMPORT_LIMITS.title, JSON.stringify(p));
      assert.ok(p.essentials.length <= IMPORT_LIMITS.essentials && p.essentials.every((e) => e.length <= IMPORT_LIMITS.essential));
      assert.ok(p.folder.length <= IMPORT_LIMITS.folder && p.folder.startsWith("invented"), p.folder);
    }

    // The store side: imported once (again is a no-op), found by ref, and a result on a question reaches its points.
    const first = await importPoints(payload);
    assert.ok(first.added + first.merged === payload.length, JSON.stringify(first));
    assert.equal((await importPoints(payload)).added, 0, "importing again adds nothing");
    const objective = Object.keys(layer.byObjective)[0];
    assert.ok(objective, "questions point at knowledge through their objectives");
    const refs = practiceRefs(done.id, layer, objective);
    assert.ok(refs.length > 0);
    const hit = await itemsByRef(refs);
    assert.equal(hit.length, new Set(refs).size, "every ref is a saved item");
    assert.equal((await recordByRef(refs, "wrong", "계약 시험")).recorded, hit.length);
    assert.equal((await getKnowledge(hit[0].id)).item.state, "unknown");
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("practice refs: nothing for an unknown objective or a deck without points", () => {
  const layer = { points: [{ id: "c1", title: "a", essentials: [], section: "", pages: [1], spans: [] }], byObjective: { o1: ["c1"] } };
  assert.deepEqual(practiceRefs("d", layer, "o1"), ["d:c1"]);
  assert.deepEqual(practiceRefs("d", layer, "nope"), []);
  assert.deepEqual(practiceRefs("d", undefined, "o1"), []);
  assert.deepEqual(layerProblems({ ...layer, byObjective: { o1: ["ghost"] } }), ["목표 o1가 없는 포인트 ghost를 가리킴"]);
});
