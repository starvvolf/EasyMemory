// GPT 프롬프트 점검(2026-11-04) 반영: 모델이 본 적 없는 것·학습자가 쓴 것은 모델 답으로 바꾸지 않는다.
//   ① 층 나누기: 400자에서 잘려 간 뜻은 바꾸지 않는다(뒤쪽 조건·식을 모델이 못 봄). 예는 넣는다.
//   ② 층 나누기: 학습자가 직접 쓴 뜻(지식 창에서 고침·직접 추가)은 바꾸지 않는다.
//   ③ 글 지도: 본문에 없는 인용은 비운다(공백·기호 차이는 같다고 본다).
//   ④ 쉽게 풀어 보기: 저장해 둔 원문 문장을 자료 근거로 함께 보낸다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { mapArticle } from "../assist/article-map.ts";
import { explainKnowledge, runLayer } from "./layer.ts";
import { getKnowledge, saveKnowledge, saveMany, sortItems, updateKnowledge } from "./store.ts";

async function withData(run: (calls: ModelRequest[], reply: { fn: (r: ModelRequest) => string }) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-protect-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake"; process.env.RECALLER_AFTER_SAVE = "off";
  const calls: ModelRequest[] = [];
  const reply: { fn: (r: ModelRequest) => string } = { fn: () => "{}" };
  setFakeModelResponder((r) => { calls.push(r); return reply.fn(r); });
  try { await run(calls, reply); } finally {
    setFakeModelResponder(null);
    for (const [k, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(dir, { recursive: true, force: true });
  }
}

test("층 나누기: 잘려 간 긴 뜻과 직접 쓴 뜻은 그대로, 예·헷갈림만 더한다", () => withData(async (_calls, reply) => {
  const long = `원근 투영 행렬은 시야 절두체를 정규 시야 공간으로 옮긴다. ${"설명이 이어진다. ".repeat(40)}끝의 조건: near > 0 이어야 한다.`;
  const [persp, hand] = await saveMany([{ title: "원근 투영 행렬", body: long, source: { kind: "pdf", title: "그래픽스", ref: "gen_x:c1" } },
    { title: "해시", body: "AI가 만든 뜻", source: { kind: "code", title: "문제", ref: "code:p1" } }]);
  await updateKnowledge(hand.item.id, { body: "내가 쓴 뜻: 키로 자리를 계산한다" });
  await sortItems([{ id: persp.item.id, topic: "CS/그래픽스", kind: "formula" }, { id: hand.item.id, topic: "CS/자료구조", kind: "concept" }]);
  reply.fn = (r) => { const lines = r.user.split("\n").filter((l) => /^\d+\. /.test(l)); const n = (t: string) => lines.findIndex((l) => l.includes(`. ${t} `));
    return JSON.stringify({ items: [{ n: n("원근 투영 행렬"), meaning: "짧게 줄인 뜻", example: "강의 예제에서 쓰임", confusion: "" }, { n: n("해시"), meaning: "모델이 고친 뜻", example: "", confusion: "충돌이 난다" }] }); };
  await runLayer();
  const p = (await getKnowledge(persp.item.id)).item;
  assert.equal(p.body, long, "the model saw only 400 characters, so the meaning is not replaced");
  assert.equal(p.example, "강의 예제에서 쓰임");
  const h = (await getKnowledge(hand.item.id)).item;
  assert.equal(h.body, "내가 쓴 뜻: 키로 자리를 계산한다\n헷갈림: 충돌이 난다", "what the learner wrote stays; only 헷갈림 is added");
  assert.ok(h.bodyByHand && h.layered);
  const manual = await saveKnowledge({ title: "직접 적은 지식", body: "직접 적은 뜻", source: { kind: "manual", title: "직접 추가" } });
  assert.ok(manual.item.bodyByHand, "a meaning written when adding by hand counts as the learner's");
}));

test("글 지도: 본문에 없는 인용은 비우고, 띄어쓰기·기호만 다른 인용은 남긴다", () => withData(async (_calls, reply) => {
  reply.fn = () => JSON.stringify({ genre: "concept", question: "q", flow: [], claim: { text: "c", basis: [] }, consider: [], terms: [],
    ideas: [{ title: "역관계", body: "b", ask: "a", quote: "금리가 오르면, 채권 가격은 내린다" }, { title: "지어낸 인용", body: "b", ask: "a", quote: "글에 없는 문장이다" }] });
  const map = await mapArticle({ title: "채권", text: "금리가 오르면 채권가격은 내린다. 반대로 금리가 내리면 오른다." });
  assert.equal(map.ideas[0].quote, "금리가 오르면, 채권 가격은 내린다");
  assert.equal(map.ideas[1].quote, "", "a quote that is not in the article is dropped");
}));

test("쉽게 풀어 보기: 저장된 원문 문장을 자료 근거로 보낸다", () => withData(async (calls, reply) => {
  const k = await saveKnowledge({ title: "월드 좌표계", body: "장면 전체의 기준 좌표계", source: { kind: "pdf", title: "그래픽스 3장", ref: "gen_x:c2", quote: "We use a right-handed world coordinate system" } });
  reply.fn = () => JSON.stringify({ plain: "p", differs: "", extras: [], see: [] });
  await explainKnowledge(k.item.id);
  assert.match(calls.at(-1)!.user, /\[배운 자료\] 강의·교재 PDF 「그래픽스 3장」 원문: "We use a right-handed world coordinate system"/);
}));
