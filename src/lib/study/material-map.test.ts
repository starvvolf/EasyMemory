// 자료 지도: a real engine run (fake model) → its cards under the outline, with the learner's state from the knowledge store.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, runGen } from "./gen/runner.ts";
import { knowledgeLayer } from "./knowledge.ts";
import type { KnowledgeLayer } from "./knowledge.ts";
import { materialMap } from "./material-map.ts";
import { importPoints, itemsForRefs, recordByRef } from "../knowledge/store.ts";

// 엔진 카드를 지식 저장소에 넣는 모양 (예전 knowledge-contract.ts, 11/15 리팩토링에서 화면 쪽 사용이 없어져 이 시험에만 남김)
const materialOf = (deck: { sourceName?: string; title?: string }) => String(deck.sourceName || deck.title || "").replace(/\.pdf$/i, "");

/** A material's knowledge points as the knowledge store takes them: ref "자료id:포인트id", folder "자료 이름/구역". */
function importPayload(deck: { id: string; sourceName?: string; title?: string }, layer: KnowledgeLayer | undefined) {
  const material = materialOf(deck);
  return (layer?.points ?? []).map((point) => ({
    ref: `${deck.id}:${point.id}`.slice(0, 200),
    title: point.title.slice(0, 120),
    essentials: point.essentials.slice(0, 6).map((e) => e.slice(0, 1500)),
    folder: `${material.slice(0, 60)}${point.section ? `/${point.section.slice(0, 60)}` : ""}`,
    material: material.slice(0, 120),
    ...(point.pages[0] ? { page: point.pages[0] } : {}),
    ...(point.importance ? { importance: point.importance } : {}),
    ...(point.ask ? { ask: point.ask.slice(0, 300) } : {}),
  }));
}

/** The refs a practice result on one question goes to: the points its objective covers. */
function practiceRefs(deckId: string, layer: KnowledgeLayer | undefined, objectiveId: string | undefined) {
  if (!layer || !objectiveId) return [];
  return (layer.byObjective[objectiveId] ?? []).slice(0, 20).map((pid) => `${deckId}:${pid}`);
}


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
    const payload = importPayload({ id: done.id, sourceName: "invented.pdf" }, layer);
    await importPoints(payload);
    const objective = Object.keys(layer.byObjective)[0];
    await recordByRef(practiceRefs(done.id, layer, objective), "wrong", "지도 시험");
    const after = materialMap(done, await itemsForRefs(refsOf(done)))!;
    assert.ok(after.counts.unknown >= 1, JSON.stringify(after.counts));
    // 핵심 카드만 지식으로 (B, 10/30): 핵심 카드는 가져오자마자 지식, 보조 카드는 풀거나 "모름"을 누르기 전까지 "아직".
    const core = new Set(payload.filter((p) => p.importance === "core").map((p) => p.ref));
    assert.ok(after.sections.flatMap((s) => s.cards).filter((c) => core.has(c.ref)).every((c) => c.knowledgeId), "every core card is in the knowledge store after the import");
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
  assert.deepEqual(map.chains, [{ from: "c1", to: "c3", what: "View Matrix", by: "wording" }]);
  assert.deepEqual(map.topics, []);
});

test("the whole-material pass gives each card its weight, its larger idea and links across sections", () => {
  const card = (id: string, page: number) => ({ id, kind: "개념", title: id, weight: "핵심", shape: { form: "fact", subject: id, value: "v" },
    evidence: [{ page, quote: "" }], mistakes: [], links: [], takes: [], gives: [] });
  const state = { id: "gen_y", status: "done", input: { fileName: "a.pdf", pageNumbers: [1, 2] }, sections: [{ id: "s1", title: "앞", pages: [1] }, { id: "s2", title: "뒤", pages: [2] }],
    recaller: { units: { s1: { cards: [card("c1", 1), card("c2", 1)] }, s2: { cards: [card("c3", 2)] } }, deep: {},
      consolidated: { ms: 1, cards: [
        { id: "c1", title: "투영 행렬", sameAs: null, topic: "투영", weight: "핵심", links: [] },
        { id: "c2", title: "예시", sameAs: null, topic: "투영", weight: "보조", links: [] },
        { id: "c3", title: "클리핑", sameAs: null, topic: "클리핑", weight: "핵심", links: [{ to: "c1", why: "바탕 개념" }] }] } } } as unknown as Parameters<typeof materialMap>[0];
  const map = materialMap(state, {})!;
  assert.deepEqual(map.sections.flatMap((s) => s.cards.map((c) => [c.title, c.core, c.topic])), [["투영 행렬", true, "투영"], ["예시", false, "투영"], ["클리핑", true, "클리핑"]]);
  assert.deepEqual(map.topics, ["투영", "클리핑"]);
  assert.equal(map.counts.core, 2);
  assert.deepEqual(map.chains, [{ from: "c3", to: "c1", what: "바탕 개념", by: "meaning" }]);
});
