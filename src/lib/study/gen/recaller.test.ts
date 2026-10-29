import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeJson, createGen, questionsGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
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

test("lab.skimOnly (연구 1): cards for every page and no questions; the first pass is timed per page", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true, pageParallel: 4 } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const calls = (await readGenCalls(done.id)).map((c) => c.step);
  assert.deepEqual(calls, ["rc-organize", "rc-organize"]);
  assert.ok(done.sections.every((s) => (done.recaller!.units[s.id].cards ?? []).length > 0));
  assert.deepEqual(Object.keys(done.recaller!.timing.organizedAt ?? {}).sort(), ["1", "2"]);
  assert.ok(done.recaller!.timing.skimDoneAt);
}));

test("questionsLater (공부 화면 10/30): cards and 자료 전체 정리 only, then 문제 만들기 goes on in the same run", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true });
  const io = { pdf: async () => null, pages: async () => pages };
  const first = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(first.status, "done", first.message);
  let calls = (await readGenCalls(first.id)).map((c) => c.step);
  assert.ok(!calls.includes("rc-author"), calls.join(" "));
  assert.ok(calls.includes("rc-merge"), "지식만 정리해도 자료 전체 정리는 한다");
  assert.ok(first.sections.every((s) => !s.author));
  const cards = first.sections.flatMap((s) => first.recaller!.units[s.id].cards ?? []).map((c) => c.id);
  const queued = await questionsGen(first.id);
  assert.equal(queued.status, "queued");
  const second = await runGen(first.id, { uid: "local-experiment" }, io);
  assert.equal(second.status, "done", second.message);
  calls = (await readGenCalls(second.id)).map((c) => c.step);
  assert.equal(calls.filter((s) => s === "rc-organize").length, 2, "카드는 다시 만들지 않는다");
  assert.equal(calls.filter((s) => s === "rc-merge").length, 1, "자료 전체 정리도 다시 하지 않는다");
  assert.equal(calls.filter((s) => s === "rc-author").length, 4);
  assert.deepEqual(second.sections.flatMap((s) => second.recaller!.units[s.id].cards ?? []).map((c) => c.id), cards);
  assert.ok(second.sections.every((s) => (s.author?.questionCount ?? 0) > 0));
  // A second press does nothing.
  assert.equal((await questionsGen(first.id)).status, "done");
}));

test("lab.outline and lab.consolidate (연구 1 3번): each 정리 call sees the material's page titles; one pass names, joins and files every card", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true, outline: true, consolidate: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const calls = await readGenCalls(done.id);
  assert.deepEqual(calls.map((c) => c.step), ["rc-organize", "rc-organize", "rc-merge"]);
  const organize = JSON.parse(calls[0].user) as { outline?: { pages: string[] } };
  assert.deepEqual(organize.outline?.pages, ["p.1 Back-Face Detection", "p.2 Depth-Buffer Method"]);
  const cards = done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []);
  assert.deepEqual(done.recaller!.consolidated!.cards.map((c) => c.id), cards.map((c) => c.id));
  assert.equal(done.recaller!.consolidated!.cards[0].weight, "핵심");
  assert.equal(done.recaller!.consolidated!.topicNotes?.["가짜 주제"], "가짜 요지");
  assert.equal(done.recaller!.consolidated!.principles?.[0].cardIds.length, 2);
}));

test("자료 지도: the whole-material pass runs by default beside the questions, and lab.consolidate=false turns it off", () => withData(async () => {
  const on = await runGen((await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" })).id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(on.status, "done", on.message);
  assert.ok(on.recaller!.consolidated?.cards.length, "the pass ran");
  assert.ok((await readGenCalls(on.id)).some((c) => c.step === "rc-author"), "questions were made as before");
  const off = await runGen((await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { consolidate: false } })).id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(off.recaller!.consolidated, undefined);
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
  assert.doesNotMatch(deepProblems(part(1, { ask: "값을 구하라: 120개와 CH20" })).join(), /주어진 값 그대로/);
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

test("기준선: one plain call per section, published without cards or checks", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", baseline: true });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const calls = (await readGenCalls(done.id)).map((c) => c.step);
  assert.deepEqual(calls, ["rc-author", "rc-author"]);
  const doc = await readSectionDocument(done.id, "s1") as { questions: unknown[] };
  assert.ok(doc.questions.length >= 1);
}));

test("a basic question the blind solver answers differently is sent back, then held", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string) => {
    const reply = JSON.parse(recallerFakeReply(step, user));
    if (step === "rc-check" && JSON.parse(user).question) reply.choice = 2;
    return JSON.stringify(reply);
  };
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages, fakeReply });
  assert.equal(done.status, "done", done.message);
  const units = Object.values(done.recaller!.units);
  // Choice questions all disagree and are held; flashcards are self-checked and stay.
  assert.ok(units.every((u) => (u.questions ?? []).every((q) => q.format === "flashcard")), JSON.stringify(units.map((u) => (u.questions ?? []).map((q) => q.format))));
  assert.ok(units.some((u) => (u.held ?? []).some((h) => /따로 푼 답/.test(h.reason))));
}));

test("the judges read a recaller run's own page texts (picture pages as read), not the bare text layer", () => withData(async () => {
  const { withTranscripts } = await import("./runner.ts");
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  const { writeFile } = await import("node:fs/promises");
  const file = path.join(process.env.STUDY_FORGE_DATA_DIR!, "study-gen", done.id, "state.json");
  done.recaller!.texts[2] = "# Depth-Buffer Method\n[그림·식·표 옮김]\n$z' = z - A/C$";
  await writeFile(file, JSON.stringify(done));
  const texts = await withTranscripts(done.id, new Map([[1, "layer one"], [2, "layer two"]]));
  assert.equal(texts.get(2), done.recaller!.texts[2]);
  assert.match(texts.get(1)!, /Back-Face Detection/);
}));

test("a restart reads again a picture page whose reading failed, when its section still has work (사용자 점검 10/29)", () => withData(async () => {
  const { prepFromTexts } = await import("./prep.ts");
  const { writeFile } = await import("node:fs/promises");
  const prep = async () => { const p = prepFromTexts(pages, [1, 2]); p.pages = p.pages.map((x) => ({ ...x, route: "page" as const })); return p; };
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true } });
  const fakeReply = (step: GenStep, user: string) => step === "transcribe" ? "# Read from the picture\n- read" : recallerFakeReply(step, user);
  // First start: no picture for p.2, so its reading fails.
  const first = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, prep, fakeReply, pageImages: async (_input, wanted) => new Map(wanted.filter((p) => p === 1).map((p) => [p, "data:image/png;base64,AA=="])) });
  assert.deepEqual(first.recaller!.read.failed, [2]);
  // The run stopped before p.2's section was finished; the restart has the picture.
  const s2 = first.sections.find((s) => s.pages.includes(2))!.id;
  first.status = "paused-invalid"; first.recaller!.units[s2] = { status: "waiting" };
  await writeFile(path.join(process.env.STUDY_FORGE_DATA_DIR!, "study-gen", first.id, "state.json"), JSON.stringify(first));
  const again = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, prep, fakeReply, pageImages: async (_input, wanted) => new Map(wanted.map((p) => [p, "data:image/png;base64,AA=="])) });
  assert.equal(again.status, "done", again.message);
  assert.deepEqual(again.recaller!.read.failed, []);
  assert.ok(again.recaller!.read.done.includes(2));
}));

test("공부 화면 Recaller starts with the fast first pass; the lab keeps its own knobs", () => withData(async () => {
  const { studyRecallerLab } = await import("./runner.ts");
  const study = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", origin: "study" });
  assert.deepEqual(study.input.lab, studyRecallerLab(2));
  const lab = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
  assert.equal(lab.input.lab, undefined);
}));

test("자료 전체 정리 written as changes only is spread back per card; bad numbers and extra links are dropped", async () => {
  const { unfoldMerge } = await import("./recaller.ts");
  const all = [{ id: "s1.1c1", title: "A" }, { id: "s1.1c2", title: "B" }, { id: "s2.1c1", title: "C" }];
  const out = unfoldMerge({ topics: [{ name: "뷰잉", gist: "", cards: [0] }, { name: "투영", gist: "", cards: [2, 7] }], principles: [], core: [1, 9, 2], same: [{ n: 1, of: 0 }, { n: 2, of: 2 }], rename: [{ n: 0, title: "뷰 좌표계" }, { n: 7, title: "x" }],
    links: [{ a: 0, b: 2, why: "다음 단계" }, { a: 0, b: 1, why: "대비" }, { a: 0, b: 1, why: "대비" }, { a: 0, b: 2, why: "또" }, { a: 2, b: 5, why: "x" }, { a: 1, b: 1, why: "x" }] }, all);
  assert.deepEqual(out.map((c) => [c.title, c.sameAs, c.topic, c.weight]), [["뷰 좌표계", null, "뷰잉", "핵심"], ["B", "s1.1c1", "뷰잉", "보조"], ["C", null, "투영", "보조"]]);
  assert.deepEqual(out[0].links, [{ to: "s2.1c1", why: "다음 단계" }, { to: "s1.1c2", why: "대비" }]);
  assert.deepEqual(out[2].links, []);
});

test("실험: the 자료 전체 정리 alone again on a run's cards, one call", () => withData(async () => {
  const { remergeGen } = await import("./runner.ts");
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true } });
  const base = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  const again = await remergeGen(base.id, { model: { model: "gpt-6.1-terra", effort: "low" } });
  const done = await runGen(again.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual((await readGenCalls(done.id)).map((c) => [c.step, c.model]), [["rc-merge", "gpt-6.1-terra"]]);
  assert.equal(done.recaller!.consolidated!.cards.length, Object.values(base.recaller!.units).reduce((n, u) => n + (u.cards?.length ?? 0), 0));
}));

test("쪽 의도 먼저 (lab.intentPass): one short pass, then a cover page makes no card and 정리 sees the intents", () => withData(async () => {
  const three = new Map([[1, "# Computer Graphics\n- Three Dimensional Viewing lecture by someone"], ...pages].map(([p, t], i) => [i + 1, t] as [number, string]));
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true, intentPass: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => three });
  assert.equal(done.status, "done", done.message);
  const calls = await readGenCalls(done.id);
  assert.equal(calls[0].step, "rc-intent");
  assert.deepEqual(done.recaller!.intents!.pages.map((x) => x.intent), ["표지", "정의", "정의"]);
  assert.equal(done.recaller!.intents!.kind, "이론·계산 강의");
  const cards = Object.values(done.recaller!.units).flatMap((u) => u.cards ?? []);
  assert.ok(cards.length && cards.every((c) => c.evidence.some((e) => e.page !== 1)), JSON.stringify(cards.map((c) => c.evidence)));
  assert.match(calls.find((c) => c.step === "rc-organize")!.user, /"intents"/);
}));

test("쪽 의도 (lab.intent): 정리 writes each page's intent first and it is kept", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true, intent: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const chunks = Object.values(done.recaller!.units).flatMap((u) => Object.values(u.chunks ?? {}));
  assert.ok(chunks.every((c) => c.intents?.length), JSON.stringify(chunks.map((c) => c.intents)));
}));

test("쪽 의도 옆에서 (lab.intentParallel): 정리 starts at once; the cover page's cards are dropped when the pass ends", () => withData(async () => {
  const three = new Map([[1, "# Computer Graphics\n- Three Dimensional Viewing lecture by someone"], ...pages].map(([p, t], i) => [i + 1, t] as [number, string]));
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", lab: { intentPass: true, intentParallel: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => three });
  assert.equal(done.status, "done", done.message);
  const units = Object.values(done.recaller!.units);
  assert.ok(units.flatMap((u) => u.cards ?? []).every((c) => c.evidence.some((e) => e.page !== 1)));
  assert.ok(units.flatMap((u) => u.questions ?? []).every((q) => !q.pages.every((p) => p === 1)));
  assert.match((await readGenCalls(done.id)).find((c) => c.step === "rc-organize")!.system, /먼저 pages에 쪽마다 의도/);
}));

test("자료 전체 정리 starts when the cards are in, beside the questions", () => withData(async () => {
  const start = await createGen({ sourceId: "src_recaller_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const t = done.recaller!.timing;
  assert.ok(t.cardsDoneAt && done.recaller!.consolidated?.cards.length);
  assert.ok(t.cardsDoneAt! <= t.basicDoneAt!, `${t.cardsDoneAt} ${t.basicDoneAt}`);
}));

test("a reply stuck saying one short piece over and over is caught early", async () => {
  const { repeating } = await import("./runner.ts");
  assert.equal(repeating(`{"cards":[{"title":"x","value":"${"다. ".repeat(60)}`), true);
  assert.equal(repeating(`{"cards":[{"title":"x","value":"${"가나다라마바사아자차카타파하 ".repeat(20)}`), false);
  assert.equal(repeating("[" + Array.from({ length: 80 }, (_, i) => i).join(", ")), false);
});

test("핵심 at most two from one page", async () => {
  const { unfoldMerge } = await import("./recaller.ts");
  const all = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `c${i}`, title: `t${i}`, evidence: [{ page: i <= 3 ? 7 : i }] }));
  const out = unfoldMerge({ topics: [{ name: "t", gist: "", cards: [0, 1, 2, 3, 4, 5] }], principles: [], core: [0, 1, 2, 3], same: [], rename: [], links: [] }, all);
  assert.deepEqual(out.filter((c) => c.weight === "핵심").map((c) => c.id), ["c1", "c2"]);
});
