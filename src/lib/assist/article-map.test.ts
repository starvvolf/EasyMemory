// 글 지도로 읽기: 핵심만 지식(만남)이 되고, 개념어는 후보로 남았다가 모른다고 고른 것만 지식(몰랐음)이 된다. 이미 아는 개념어는 ✓.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder } from "../ai/model.ts";
import { extractFromText, pickTerms } from "./knowledge-ai.ts";
import { getKnowledge, recordEvent, saveKnowledge, tree } from "../knowledge/store.ts";

test("글 지도: 핵심은 저장, 개념어는 고를 때만", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "article-map-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake"; process.env.RECALLER_AFTER_SAVE = "off";
  setFakeModelResponder(() => JSON.stringify({ genre: "concept", question: "금리가 내리면 채권은?", flow: ["금리", "채권 가격"], claim: { text: "금리와 채권 가격은 반대로 움직인다", basis: [] },
    ideas: [{ title: "금리와 채권 가격의 역관계", body: "금리가 오르면 기존 채권 가격이 내린다.", quote: "금리가 오르면 채권 가격은 내리고" }],
    terms: [{ name: "듀레이션", line: "금리 변화에 대한 채권 가격 민감도" }, { name: "채권", line: "돈을 빌려주고 받는 증서" }], consider: ["신용위험은 다루지 않았다"] }));
  try {
    const known = await saveKnowledge({ title: "채권", body: "돈을 빌려주는 증서" });
    await recordEvent(known.item.id, "correct");
    const r = await extractFromText({ kind: "web", title: "채권 기초", url: "https://ex.com/bond", text: "금리가 오르면 채권 가격은 내리고 금리가 내리면 채권 가격은 오른다. ".repeat(4) });
    assert.deepEqual((await tree()).items.map((i) => i.title).sort(), ["금리와 채권 가격의 역관계", "채권"], "only the idea is new; 듀레이션 is not saved yet");
    assert.equal(r.source.map!.terms.find((t) => t.name === "채권")!.have, "known");
    assert.ok(r.source.againIds.includes(known.item.id), "a known term counts as 예전에 배운 것");
    assert.deepEqual(r.source.map!.consider, ["신용위험은 다루지 않았다"]);

    const after = await pickTerms(r.source.id, ["듀레이션"], true);
    const dur = (await tree()).items.find((i) => i.title === "듀레이션")!;
    assert.equal((await getKnowledge(dur.id)).item.state, "unknown", "picked = 몰랐음, goes to review");
    assert.deepEqual(after.map!.termIds, [dur.id]);
    const off = await pickTerms(r.source.id, ["듀레이션"], false);
    assert.deepEqual(off.map!.termIds, []);
    assert.ok((await tree()).items.some((i) => i.id === dur.id), "unpicking keeps the knowledge");
  } finally {
    setFakeModelResponder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
