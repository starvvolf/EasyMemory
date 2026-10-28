// 자료 지도: a real engine run (fake model) → its cards under the outline, with the learner's state from the knowledge store.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, runGen } from "./gen/runner.ts";
import { knowledgeLayer } from "./knowledge.ts";
import { importPayload, practiceRefs } from "./knowledge-contract.ts";
import { materialMap } from "./material-map.ts";
import { importPoints, itemsForRefs, recordByRef } from "../knowledge/store.ts";

const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer\n- In a right-handed system the test is C <= 0"],
  [2, "# Depth-Buffer Method\n- Initialize the depth buffer to 1.0 for every pixel\n- A surface is drawn only where its depth is smaller than the stored depth"],
]);

test("the map shows the outline's cards and the learner's state on each", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "map-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const start = await createGen({ sourceId: "src_map_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
    const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
    assert.equal(done.status, "done", done.message);
    const refsOf = (s: typeof done) => s.sections.flatMap((x) => (s.recaller?.units[x.id]?.cards ?? []).map((c) => `${s.id}:${c.id}`));

    const before = materialMap(done, {})!;
    assert.ok(before.sections.length >= 1 && before.counts.cards > 0);
    assert.equal(before.counts.new, before.counts.cards, "nothing saved yet: every card is new");
    assert.ok(before.sections.every((s) => s.cards.every((c) => c.pages.length && c.ref.startsWith(`${done.id}:`))));

    const layer = knowledgeLayer(done);
    await importPoints(importPayload({ id: done.id, sourceName: "invented.pdf" }, layer));
    const objective = Object.keys(layer.byObjective)[0];
    await recordByRef(practiceRefs(done.id, layer, objective), "wrong", "지도 시험");
    const after = materialMap(done, await itemsForRefs(refsOf(done)))!;
    assert.ok(after.counts.unknown >= 1, JSON.stringify(after.counts));
    assert.equal(after.counts.new, 0, "every card is in the knowledge store after the import");
    assert.ok(after.sections.flatMap((s) => s.cards).filter((c) => c.state === "unknown").every((c) => c.knowledgeId));
    assert.ok(after.counts.questions > 0);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("the same knowledge on two pages is one card with both pages, and a card's result feeding another is a chain", () => {
  const card = (id: string, page: number, extra: Record<string, unknown> = {}) => ({ id, kind: "절차", title: id, weight: "핵심", shape: { form: "fact", subject: id, value: "v" },
    evidence: [{ page, quote: "" }], mistakes: [], links: [], takes: [], gives: [], ...extra });
  const state = { id: "gen_x", status: "done", input: { fileName: "a.pdf", pageNumbers: [1, 2, 3] }, sections: [{ id: "s1", title: "앞", pages: [1, 2] }, { id: "s2", title: "뒤", pages: [3] }],
    recaller: { units: { s1: { cards: [card("c1", 1, { gives: ["view matrix"] }), card("c2", 2)] }, s2: { cards: [card("c3", 3, { takes: ["View Matrix"] })] } },
      deep: {}, dups: { c2: "c1" } } } as unknown as Parameters<typeof materialMap>[0];
  const map = materialMap(state, {})!;
  assert.deepEqual(map.sections.map((s) => s.cards.map((c) => c.id)), [["c1"], ["c3"]]);
  assert.deepEqual(map.sections[0].cards[0].pages, [1, 2]);
  assert.deepEqual(map.chains, [{ from: "c1", to: "c3", what: "View Matrix" }]);
});
