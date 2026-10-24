import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeJson, createGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
import { basicProblem, codeChains, completeItems, deepProblems, fillValues, recallerFakeReply, slotCards } from "./recaller.ts";
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
  // One situation, asked along its solution: 1-1 then 1-2, each its own question.
  assert.deepEqual(done.recaller?.deep.g1.parts?.map((q) => q.objectiveId), ["s1-d1-1", "s1-d1-2"]);
  assert.match(done.recaller!.deep.g1.parts![1].authored.stem.at(-1)!.text ?? "", /^\(1-2\) /);
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
    if (step === "rc-solve") reply.answers = reply.answers.map((a: { choice: number }) => ({ ...a, choice: (a.choice + 1) % 4 }));
    return JSON.stringify(reply);
  };
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", deep: true, deepDrafts: 2 });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages, fakeReply });
  assert.equal(done.recaller?.deep.g1.status, "held");
  assert.match(done.recaller!.deep.g1.problems[0], /따로 푼 답/);
  // Two drafts at once, both disagree, then one revision of the closer one.
  assert.equal((await readGenCalls(done.id)).filter((c) => c.step === "rc-deep").length, 3);
  // One draft by default: one try, one revision.
  const single = await runGen((await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", deep: true })).id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages, fakeReply });
  assert.equal((await readGenCalls(single.id)).filter((c) => c.step === "rc-deep").length, 2);
}));

test("cards complete in a streaming reply are picked out before the reply ends", () => {
  const raw = '{"cards":[{"id":"c1","t":"a \\"}\\" b"},{"id":"c2","t":[1,{"x":2}]},{"id":"c3","t":"unfin';
  assert.deepEqual(completeItems(raw, "cards").map((c) => (c as { id: string }).id), ["c1", "c2"]);
});

test("code checks: a wrong option must be the value its stated mistake gives; a choice needs a note per option", () => {
  // Through JSON, as a reply would come: the test changes parts freely.
  const deep = JSON.parse(JSON.stringify(fillValues(JSON.parse(recallerFakeReply("rc-deep", JSON.stringify({ group: { id: "g1", cardIds: ["s1.c1", "s1.c2"] } }))).question)));
  assert.deepEqual(deepProblems(deep), []);
  const part = (k: number, change: object) => ({ ...deep, parts: deep.parts.map((p: object, i: number) => i === k ? { ...p, ...change } : p) });
  assert.match(deepProblems(part(1, { distractors: deep.parts[1].distractors.map((d: { option: number }) => d.option === 1 ? { ...d, expr: "2+2" } : d) })).join(), /소문항 2: 오답 2/);
  assert.match(deepProblems({ ...deep, steps: deep.steps.map((s: { value: string }, i: number) => i === 1 ? { ...s, value: "6" } : s) }).join(), /2단계/);
  assert.match(deepProblems(part(0, { upTo: 2 })).join(), /풀이 순서대로/);
  assert.match(deepProblems(part(1, { ask: "값 20을 확인하라" })).join(), /주어진 값 그대로/);
  assert.match(deepProblems(part(0, { correctIndex: 1, distractors: [{ option: 0, step: 1, mistake: "x", expr: "" }, { option: 2, step: 1, mistake: "x", expr: "" }, { option: 3, step: 1, mistake: "x", expr: "" }] })).join(), /2단계 값과 다릅니다/);
  const card = { id: "c1", kind: "사실", weight: "핵심" } as never;
  const basic = JSON.parse(recallerFakeReply("rc-author", JSON.stringify({ cards: [{ id: "c1", title: "요지 문장" }] }))).questions[0];
  assert.equal(basicProblem(basic, card), null);
  assert.match(basicProblem({ ...basic, optionNotes: null }, card)!, /optionNotes/);
  assert.equal(slotCards([{ weight: "보조", kind: "사실" }, { weight: "핵심", kind: "용어" }] as never, "core").length, 1);
});

test("a JSON reply that ran on in blank space after its last value is closed and read; an unfinished one is not", () => {
  assert.deepEqual(closeJson('{"question":{"a":[1,2],"b":"x}"}' + " \t".repeat(800)), { question: { a: [1, 2], b: "x}" } });
  assert.equal(closeJson('{"question":{"a":"unfini'), undefined);
  assert.equal(closeJson('{"question":{"a":1,'), undefined);
  assert.equal(closeJson('{"a":1}'), undefined, "nothing open: not a cut reply");
});

test("종합 chains the cards' own words join are found by code: longest first, across materials, no shared cards", () => {
  const card = (id: string, takes: string[], gives: string[]) => ({ id, kind: "공식", title: id, weight: "핵심", shape: { form: "formula", expr: "x", vars: [], when: "" }, evidence: [{ page: 1, quote: "" }], mistakes: [], links: [], takes, gives }) as never;
  const cards = [card("m1.a", ["거래"], ["분개"]), card("m1.b", ["분개"], ["시산표"]), card("m2.c", ["시산표"], ["재무제표"]), card("m2.d", ["재무제표"], ["비율 분석"]), card("m2.e", ["날씨"], ["기분"])];
  const chains = codeChains(cards, 2);
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].cardIds, ["m1.a", "m1.b", "m2.c", "m2.d"]);
  assert.deepEqual(chains[0].joints.map((j) => j.gives), ["분개", "시산표", "재무제표"]);
  assert.deepEqual(codeChains([cards[0], cards[1], cards[4]], 2), [], "one material, or nothing joined: no chain");
});

test("a step that hands back what it was given (identity, the same value) is sent back", () => {
  // Through JSON, as a reply would come: the test changes parts freely.
  const deep = JSON.parse(JSON.stringify(fillValues(JSON.parse(recallerFakeReply("rc-deep", JSON.stringify({ group: { id: "g1", cardIds: ["s1.c1", "s1.c2"] } }))).question)));
  const steps = [{ what: "점", page: null, expr: "(1,2)", value: "(1,2)", name: "p" }, { what: "축 행렬", page: null, expr: "eye(2)", value: "((1,0),(0,1))", name: "R" }, { what: "회전", page: null, expr: "R*p", value: "(1,2)", name: "q" }];
  const problems = deepProblems({ ...deep, steps, parts: [{ ...deep.parts[0], upTo: 2, options: ["(1,2)", "(2,1)", "(0,0)", "(3,3)"], correctIndex: 0, distractors: deep.parts[0].distractors.map((d: object) => ({ ...d, expr: "" })) }] });
  assert.ok(problems.some((p) => /2단계가 값을 바꾸지 않습니다\(단위 행렬\)/.test(p)) && problems.some((p) => /3단계가 값을 바꾸지 않습니다\(앞 값 그대로\)/.test(p)), problems.join(" | "));
});

test("the calculator writes the values: blank step values, and options built from the answer step and distinct mistakes", () => {
  const raw = JSON.parse(recallerFakeReply("rc-deep", JSON.stringify({ group: { id: "g1", cardIds: ["s1.c1", "s1.c2"] } }))).question;
  const blank = { ...raw, steps: raw.steps.map((s: { value: string; name: string | null }) => ({ ...s, value: s.name?.includes("(") ? s.value : "" })) };
  const built = fillValues(blank);
  assert.deepEqual(built.steps.map((s: { value: string }) => s.value), ["정의", "5", "20"]);
  // 2+3*4 and "14" are the same value: the second is skipped and the next mistake takes its place.
  assert.deepEqual(built.parts[1].options, ["$20$", "$14$", "$24$", "$9$"]);
  assert.deepEqual(built.short, []);
  assert.deepEqual(deepProblems(built), []);
  const thin = fillValues({ ...raw, parts: [{ ...raw.parts[0], distractors: raw.parts[0].distractors.map((d: object) => ({ ...d, expr: "2+3" })) }] });
  assert.match(thin.short.join(), /오답 값이 0개뿐/);
  const messy = fillValues({ ...raw, parts: [{ ...raw.parts[0], distractors: [{ step: 1, mistake: "a", expr: "sqrt(2)", value: "" }, ...raw.parts[0].distractors] }] });
  assert.deepEqual(messy.parts[0].options, ["$5$", "$6$", "$4$", "$7$"], "1.4142 beside a clean answer is skipped");
});
