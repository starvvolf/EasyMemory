import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
import { basicProblem, completeItems, deepProblems, recallerFakeReply, slotCards } from "./recaller.ts";
import type { GenStep } from "./types.ts";

// Invented public pages (not lecture material): two sections by title.
const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer\n- In a right-handed system the test is C <= 0"],
  [2, "# Depth-Buffer Method\n- Initialize the depth buffer to 1.0 for every pixel\n- A surface is drawn only where its depth is smaller than the stored depth"],
]);

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("recaller: sections from titles, cards, basic questions per section, then a deep question that passed its checks", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", deep: true });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.sections.map((s) => s.title), ["Back-Face Detection", "Depth-Buffer Method"]);
  const calls = (await readGenCalls(done.id)).map((c) => c.step);
  assert.equal(calls.filter((s) => s === "rc-organize").length, 2);
  // One question per card, started while the organize reply streams in.
  assert.equal(calls.filter((s) => s === "rc-author").length, 4);
  assert.ok(calls.includes("rc-link") && calls.includes("rc-deep") && calls.includes("rc-solve"), calls.join(" "));
  // The solver never sees the answer or the worked steps.
  const solve = (await readGenCalls(done.id)).find((c) => c.step === "rc-solve")!;
  assert.ok(!solve.user.includes("correctIndex") && !solve.user.includes("steps"));
  const first = await readSectionDocument(done.id, "s1") as { questions: Array<{ id: string }> };
  assert.ok(first.questions.some((q) => q.id.startsWith("q-s1-q")), JSON.stringify(first.questions.map((q) => q.id)));
  assert.ok(first.questions.some((q) => q.id.startsWith("q-s1-d")), "심화 문제는 첫 카드의 구역에 붙는다");
  assert.equal(done.recaller?.deep.g1.status, "ready");
}));

test("deep questions are made only when asked", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const calls = (await readGenCalls(done.id)).map((c) => c.step);
  assert.ok(calls.includes("rc-author") && !calls.includes("rc-link") && !calls.includes("rc-deep"), calls.join(" "));
}));

test("종합 문제: cards of two earlier runs, one group across them, checked and published", () => withData(async () => {
  const run = async () => { const g = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" }); return runGen(g.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages }); };
  const [a, b] = [await run(), await run()];
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "종합", pageNumbers: [1], purpose: "understand", engine: "recaller", provider: "fake", combine: [a.id, b.id] });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.sections.map((s) => s.id), ["m1", "m2"]);
  const calls = (await readGenCalls(done.id)).map((c) => c.step);
  assert.ok(!calls.includes("rc-organize") && !calls.includes("rc-author") && calls.includes("rc-deep"), calls.join(" "));
  const group = done.recaller!.groups![0];
  assert.deepEqual(group.cardIds.map((id) => id.split(".")[0]), ["m1", "m2"]);
  assert.equal(done.recaller!.deep.g1.status, "ready");
  const deep = (await readGenCalls(done.id)).find((c) => c.step === "rc-deep")!;
  assert.match(deep.user, /invented · 원문 p\.1|invented p\.1–2 · 원문 p\.1/);
}));

test("a deep question whose blind solve disagrees is rewritten once, then held", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string) => {
    const reply = JSON.parse(recallerFakeReply(step, user));
    if (step === "rc-solve") reply.choice = (reply.choice + 1) % 4;
    return JSON.stringify(reply);
  };
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", deep: true });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages, fakeReply });
  assert.equal(done.recaller?.deep.g1.status, "held");
  assert.match(done.recaller!.deep.g1.problems[0], /따로 푼 답/);
  assert.equal((await readGenCalls(done.id)).filter((c) => c.step === "rc-deep").length, 2);
}));

test("cards complete in a streaming reply are picked out before the reply ends", () => {
  const raw = '{"cards":[{"id":"c1","t":"a \\"}\\" b"},{"id":"c2","t":[1,{"x":2}]},{"id":"c3","t":"unfin';
  assert.deepEqual(completeItems(raw, "cards").map((c) => (c as { id: string }).id), ["c1", "c2"]);
});

test("code checks: a wrong option must be the value its stated mistake gives; a choice needs a note per option", () => {
  const deep = JSON.parse(recallerFakeReply("rc-deep", JSON.stringify({ group: { id: "g1", cardIds: ["s1.c1", "s1.c2"] } }))).question;
  assert.deepEqual(deepProblems(deep), []);
  assert.match(deepProblems({ ...deep, distractors: deep.distractors.map((d: { option: number }) => d.option === 1 ? { ...d, expr: "2+2" } : d) }).join(), /오답 2/);
  assert.match(deepProblems({ ...deep, steps: deep.steps.map((s: { value: string }, i: number) => i === 0 ? { ...s, value: "6" } : s) }).join(), /1단계/);
  const given = `${deep.options[deep.correctIndex]}`.replace(/\$/g, "");
  assert.match(deepProblems({ ...deep, stem: [{ kind: "text", text: `벡터 $${given}$의 성분은?` }] }).join(), /주어진 값 그대로/);
  const card = { id: "c1", kind: "사실", weight: "핵심" } as never;
  const basic = JSON.parse(recallerFakeReply("rc-author", JSON.stringify({ cards: [{ id: "c1", title: "요지 문장" }] }))).questions[0];
  assert.equal(basicProblem(basic, card), null);
  assert.match(basicProblem({ ...basic, optionNotes: null }, card)!, /optionNotes/);
  assert.equal(slotCards([{ weight: "보조", kind: "사실" }, { weight: "핵심", kind: "용어" }] as never, "core").length, 1);
});
