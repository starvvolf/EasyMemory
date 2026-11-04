import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, questionsGen, readGenCalls, runGen } from "./runner.ts";
import { assembleTask, batchLines, digestOverlaps, digestText, oneDomains, planKinds, oneTopicText, pageList, parseSkeleton, parseTopic, settleSkeleton, splitOne, topicPages } from "./digest.ts";
import { cardLine } from "./cards.ts";

// Invented public pages (not lecture material).
const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer"],
  [2, "# Depth-Buffer Method\n- A surface is drawn only where its depth is smaller than the stored depth"],
  [3, "# Scan-Line Method\n- Each scan line keeps a list of the edges it crosses"],
]);
async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-digest-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("요약 → 카드 뼈대: lines are read as they come, and every page ends up in exactly one place", () => {
  assert.deepEqual(pageList("3, 5-7, p.9"), [3, 5, 6, 7, 9]);
  const partial = parseSkeleton("개요|1, 14\nt1|개념|데드락의 정의|3,4|t2\nt2|처리|예", false);
  assert.deepEqual(partial.overview, [1, 14]);
  assert.deepEqual(partial.topics.map((t) => t.id), ["t1"], "줄이 끝나기 전의 줄은 아직 읽지 않는다");
  const parsed = parseSkeleton("개요|1\nt1|개념|정의|2,3|t2,t9\nt2|개념|조건|3,5,20|t1\nt3|처리|빈 주제||t1\nt4|처리|예방|6,7,8,9|", true);
  const s = settleSkeleton(parsed, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(s.topics.map((t) => [t.id, t.pages]), [["t1", [2, 3, 4]], ["t2", [5]], ["t4", [6, 7, 8, 9]]]);
  assert.deepEqual(s.topics[0].related, ["t2"], "없는 주제 id는 뺀다");
  assert.equal(new Set(s.topics.map((t) => t.domain)).size, 3, "주제마다 다른 생활 영역");
  assert.ok(s.problems.some((x) => x.includes("p.20")) && s.problems.some((x) => x.includes("p.4")) && s.problems.some((x) => x.includes("t4: 4쪽")), s.problems.join(" / "));
  assert.deepEqual(topicPages(s.topics[1], s.topics), [2, 3, 4, 5]);
});

test("요약 → 카드 주제 글: body lines until <<<EASY>>>, the analogy of each line, 2–3 lines a batch, overlaps across topics", () => {
  const text = ["[t2-b1] 상호 배제: 자원을 한 번에 하나만 씀. (p.5)", "- [t2-b2] **점유 대기**: 가진 채 기다림. (p.5, 6)", "[t1-b1] 남의 줄: 무시. (p.3)", "<<<EASY>>>",
    "한마디로: 네 조건이에요. 왜일까요?", "장면: 교통 장면이에요.", "안 맞는 점: 차는 조금씩 움직여요.", "[t2-b1] 상호 배제: 화장실 한 칸이에요.", "흔한 오해: 하나만 깨면 된다고 생각해요 (p.5).", "마무리: 넷 다예요.",
    "<<<EXTRA>>>", "### 스스로 확인"].join("\n");
  const t = parseTopic("t2", text);
  assert.deepEqual(t.body.map((l) => [l.id, l.name, l.pages]), [["t2-b1", "상호 배제", [5]], ["t2-b2", "점유 대기", [5, 6]]]);
  assert.equal(t.easy?.analogies["t2-b1"], "화장실 한 칸이에요.");
  assert.equal(t.easy?.breaks, "차는 조금씩 움직여요.");
  assert.match(t.easy!.mistake, /하나만 깨면/);
  assert.equal(parseTopic("t2", text.slice(0, text.indexOf("<<<EASY>>>"))).closed, false);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => batchLines(Array.from({ length: n }, (_, i) => i)).map((b) => b.length)), [[1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2]]);
  const overlaps = digestOverlaps([{ id: "t1.1c1", title: "사이클과 데드락 판정", shape: { form: "rule" } }, { id: "t1.1c2", title: "사이클과 데드락 판정", shape: { form: "rule" } },
    { id: "t6.1c1", title: "사이클과 데드락 판정", shape: { form: "rule" } }], (id) => id.split(".")[0]);
  assert.deepEqual(overlaps.map((o) => [o.a, o.b]), [["t1.1c1", "t6.1c1"], ["t1.1c2", "t6.1c1"]], "같은 주제 안은 후보가 아니다");
  // A term card whose title is its name does not print the name twice (4차 B6).
  assert.equal(cardLine({ id: "c1", kind: "용어", title: "System modeling", weight: "핵심", shape: { form: "term", name: "System modeling", symbol: "", definition: "자원과 프로세스로 본다", neighbors: [] },
    evidence: [{ page: 4, quote: "" }], mistakes: [], links: [], takes: [], gives: [] }), "[용어] System modeling: 자원과 프로세스로 본다");
});

test("lab.digest: skeleton → topics as sections → cards from summary lines, every line covered, notes on every card", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const d = done.recaller!.digest!;
  assert.equal(d.skeleton.status, "done");
  assert.deepEqual(done.sections.map((s) => s.id), ["t1", "t2", "t3"]);
  assert.deepEqual(done.sections.map((s) => s.title), ["Back-Face Detection", "Depth-Buffer Method", "Scan-Line Method"]);
  assert.ok(Object.values(d.topics).every((t) => t.status === "done" && t.body.length > 0 && t.easy));
  assert.equal(d.wrap?.status, "done");
  assert.deepEqual(d.checks.uncovered, []);
  assert.deepEqual(d.checks.outsideInput, []);
  assert.deepEqual(d.checks.outsideRange, []);
  const cards = done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []);
  assert.ok(cards.length >= 3);
  assert.ok(cards.every((c) => d.notes[c.id]?.covers.length && d.notes[c.id].analogy && d.notes[c.id].mistake), JSON.stringify(d.notes));
  const steps = (await readGenCalls(done.id)).map((c) => c.step);
  assert.equal(steps.filter((s) => s === "rc-skeleton").length, 1);
  assert.equal(steps.filter((s) => s === "rc-topic").length, 3);
  assert.ok(steps.includes("rc-digest-card") && steps.includes("rc-wrap"));
  assert.ok(!steps.includes("rc-organize"), "쪽 정리는 하지 않는다");
  assert.ok(!steps.includes("rc-intent"));
  assert.match(digestText(d), /^가짜 개요[\s\S]*## 가짜 큰 주제[\s\S]*### Back-Face Detection[\s\S]*쉬운 설명[\s\S]*## 핵심 정리/);
}));

test("sol 한 번: the text is cut at its marks; a body is closed only at <<<BODY_END tN>>>, easy and extra come later", () => {
  const head = "개요|1\nt1|큰|정의|2||학교\nt2|큰|조건|3|t1|교통\n<<<OUTLINE_END>>>\n두 문장 개요예요 (p.1). 둘째예요 (p.1).\n### [t1] 정의\n[t1-b1] 정의: 한 문장임. (p.2)\n";
  let cut = splitOne(head);
  assert.equal(cut.overview, "두 문장 개요예요 (p.1). 둘째예요 (p.1).");
  assert.equal(cut.topics.t1.closed, false);
  assert.deepEqual(oneDomains(cut.outline!), { t1: "학교", t2: "교통" });
  const all = `${head}<<<BODY_END t1>>>\n### [t2] 조건\n[t2-b1] 조건: 둘째 문장임. (p.3)\n<<<BODY_END t2>>>\n<<<EASY t1>>>\n한마디로: 짧아요.\n장면: 학교예요.\n[t1-b1] 정의: 교실 비유예요.\n흔한 오해: 틀려요 (p.2).\n마무리: 끝.\n<<<EXTRA t1>>>\n### 스스로 확인\n질문?\n<<<EASY t2>>>\n한마디로: 조건이에요.\n## 핵심 정리\n- [t1] 정의 (p.2)\n- [t2] 조건 (p.3)`;
  cut = splitOne(all);
  assert.ok(cut.topics.t1.closed && cut.topics.t2.closed);
  const t1 = parseTopic("t1", oneTopicText(cut.topics.t1));
  assert.deepEqual(t1.body.map((l) => l.id), ["t1-b1"]);
  assert.equal(t1.easy?.analogies["t1-b1"], "교실 비유예요.");
  assert.equal(t1.easy?.mistake, "틀려요 (p.2).");
  assert.match(t1.extra ?? "", /스스로 확인/);
  assert.equal(parseTopic("t2", oneTopicText(cut.topics.t2)).body[0].pages[0], 3);
  assert.match(cut.key, /^## 핵심 정리[\s\S]*\[t2\]/);
});

test("lab.digestOne: one sol call, outline → sections, cards per topic as bodies close, no skeleton/topic/wrap calls", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true, digestOne: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const d = done.recaller!.digest!;
  assert.deepEqual(done.sections.map((s) => s.id), ["t1", "t2", "t3"]);
  assert.ok(Object.values(d.topics).every((t) => t.status === "done" && t.body.length > 0 && t.easy), JSON.stringify(d.topics));
  assert.equal(d.wrap?.status, "done");
  assert.match(d.wrap!.text, /^개요: [\s\S]*## 핵심 정리/);
  assert.deepEqual(d.checks.uncovered, []);
  const cards = done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []);
  assert.ok(cards.length >= 3);
  assert.ok(cards.every((c) => d.notes[c.id]?.analogy && d.notes[c.id].mistake), JSON.stringify(d.notes));
  const steps = (await readGenCalls(done.id)).map((c) => c.step);
  assert.equal(steps.filter((s) => s === "rc-digest-one").length, 1);
  assert.equal(steps.filter((s) => s === "rc-digest-card").length, 3, "주제마다 카드 호출 한 번");
  assert.ok(!steps.some((s) => s === "rc-skeleton" || s === "rc-topic" || s === "rc-wrap" || s === "rc-organize"));
}));

test("목차 먼저 → 조립: kinds are read from the outline, and the task carries only the rules of the kinds that occur", () => {
  assert.deepEqual(planKinds("개요|1\nt1|큰|정의|2||개념\nt2|큰|시장|3||수치·현황\nt3|큰|단계|4||절차/알고리즘\n"), { t1: "개념", t2: "수치·현황", t3: "절차·알고리즘" });
  const task = assembleTask([{ id: "t1", group: "큰", title: "정의", pages: [2], related: [], domain: "", kind: "개념" }, { id: "t2", group: "큰", title: "시장", pages: [3], related: [], domain: "", kind: "수치·현황" }]);
  assert.match(task, /- 개념: /);
  assert.match(task, /- 수치·현황: /);
  assert.doesNotMatch(task, /- 유도·수식: /);
  assert.match(task, /t2 \| 큰 \| 시장 \| 쪽 3 \| 성격 수치·현황/);
});

test("lab.digestStyle plan: outline call then summary call, same system and material first, task last; sections carry kinds", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true, digestOne: true, digestStyle: "plan" } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const d = done.recaller!.digest!;
  assert.deepEqual(d.skeleton.topics.map((t) => t.kind), ["개념", "구조·흐름", "유도·수식"]);
  assert.ok(Object.values(d.topics).every((t) => t.status === "done" && t.body.length > 0 && t.easy), JSON.stringify(d.topics));
  assert.match(d.wrap!.text, /^개요: 가짜 개요[\s\S]*## 핵심 정리/);
  const calls = await readGenCalls(done.id);
  assert.deepEqual(calls.filter((c) => c.step.startsWith("rc-digest-p") || c.step === "rc-digest-one").map((c) => c.step), ["rc-digest-plan", "rc-digest-one"]);
  const [planCall, oneCall] = [calls.find((c) => c.step === "rc-digest-plan")!, calls.find((c) => c.step === "rc-digest-one")!];
  assert.equal(planCall.system, oneCall.system, "같은 지시문");
  const material = planCall.user!.slice(0, planCall.user!.indexOf("[작업]"));
  assert.ok(material.length > 20 && oneCall.user!.startsWith(material), "같은 자료가 앞에");
  assert.equal(calls.filter((c) => c.step === "rc-digest-card").length, 3);
}));

test("lab.digestStyle plan without digestOne: outline+kinds call, then every topic at once with its kind's rules, then the wrap", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true, digestStyle: "plan", digestTopicCards: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const d = done.recaller!.digest!;
  assert.deepEqual(d.skeleton.topics.map((t) => t.kind), ["개념", "구조·흐름", "유도·수식"]);
  assert.ok(Object.values(d.topics).every((t) => t.status === "done" && t.body.length > 0 && t.easy));
  const calls = await readGenCalls(done.id);
  const steps = calls.map((c) => c.step);
  assert.equal(steps.filter((s) => s === "rc-digest-plan").length, 1);
  assert.equal(steps.filter((s) => s === "rc-topic").length, 3);
  assert.equal(steps.filter((s) => s === "rc-digest-card").length, 3);
  assert.ok(steps.includes("rc-wrap") && !steps.includes("rc-skeleton") && !steps.includes("rc-digest-one"));
  const topicSystems = calls.filter((c) => c.step === "rc-topic").map((c) => c.system ?? "");
  assert.ok(topicSystems.some((s) => s.includes('성격은 "유도·수식"')) && topicSystems.some((s) => s.includes('성격은 "개념"')));
}));

test("lab.quiz luna: 문제 만들기 goes through the luna layers (material → format → score → explain), one format per card, hints kept", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "all", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true, digestStyle: "plan", digestTopicCards: true, quiz: "luna" } });
  const first = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(first.status, "done", first.message);
  await questionsGen(first.id);
  const done = await runGen(first.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const steps = (await readGenCalls(done.id)).map((c) => c.step);
  assert.ok(!steps.includes("rc-author"), "terra 출제를 부르지 않는다");
  assert.ok(steps.includes("rc-q-material") && steps.includes("rc-q-explain"), steps.join(" "));
  const qs = done.sections.flatMap((s) => done.recaller!.units[s.id].questions ?? []);
  const held = done.sections.flatMap((s) => done.recaller!.units[s.id].held ?? []);
  // The fake solver always answers the first option, so some questions are held by the blind check; each card ends one way.
  assert.ok(qs.length + held.length >= 1, "카드마다 문제가 되거나 보류된다");
  assert.ok(held.every((x) => /따로 푼|재료/.test(x.reason)), JSON.stringify(held));
  assert.ok(qs.every((q) => q.checks.includes("luna 출제") && q.hint), JSON.stringify(qs.map((q) => [q.format, q.checks, q.hint])));
}));

test("lab.quizCount: one pick call over every card, then only the picked cards get questions (format from the pick)", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "all", engine: "recaller", provider: "fake", lab: { digest: true, digestStyle: "plan", digestTopicCards: true, quiz: "luna", quizCount: 2 } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const calls = await readGenCalls(done.id);
  assert.equal(calls.filter((c) => c.step === "rc-q-pick").length, 1);
  const materials = calls.filter((c) => c.step === "rc-q-material").map((c) => JSON.parse(c.user ?? "{}") as { ask?: string; card: { id: string } });
  assert.ok(materials.length >= 1 && materials.length <= 2 + 4, String(materials.length));
  assert.ok(materials.some((m) => m.ask?.startsWith("가짜 지점")), "고른 지점을 출제에 넘긴다");
  // 학습 목표: written after the outline of the plan call, handed to the pick, and shown as the question's goal.
  assert.ok((done.recaller!.digest!.objectives ?? []).length >= 1, "학습 목표를 받는다");
  const pick = calls.find((c) => c.step === "rc-q-pick")!;
  assert.ok(JSON.parse(pick.user ?? "{}").objectives?.length >= 1 && (pick.system ?? "").includes("학습 목표"), "고르기에 학습 목표를 넘긴다");
  const qs = done.sections.flatMap((s) => done.recaller!.units[s.id].questions ?? []);
  assert.ok(qs.some((q) => q.goal === "가짜 조건을 보고 결과를 판정할 수 있다"), JSON.stringify(qs.map((q) => q.goal)));
}));

test("quiz code rules: OX from one-word pairs (no 반드시, no bare negation), choice pool drops junk and same-meaning options, blanks from decisive words", async () => {
  const { oxDrafts, choicePool, clozeDrafts, buildChoice } = await import("./quiz.ts");
  const card = { id: "t1.1c1", kind: "조건", title: "순환과 교착", weight: "핵심", shape: { form: "rule", premise: "", condition: "자원 유형마다 인스턴스가 하나", result: "교착 상태", boundary: "여러 개면 가능성" },
    evidence: [{ page: 7, quote: "one instance per resource type: deadlock" }], mistakes: [], links: [], takes: [], gives: [] } as never;
  const ox = oxDrafts({ truths: [{ claim: "인스턴스가 하나이면 순환은 교착 상태를 뜻한다", point: "하나" }],
    pairs: [{ right: "자원 유형마다 인스턴스가 하나이면 순환은 교착 상태다", wrong: "자원 유형마다 인스턴스가 여럿이면 순환은 교착 상태다", changed: "하나 → 여럿", from: "조건·경계" },
      { right: "자원 유형마다 인스턴스가 하나이면 순환은 교착 상태다", wrong: "자원 유형마다 인스턴스가 하나이면 순환은 반드시 교착 상태다", changed: "반드시", from: "조건·경계" },
      { right: "자원 유형마다 인스턴스가 하나이면 순환은 교착 상태다", wrong: "자원 유형마다 인스턴스가 하나이면 순환은 교착 상태가 아니다", changed: "부정", from: "조건·경계" }] }, card);
  assert.ok(ox.length >= 2 && ox.every((d) => d.format === "ox" && !/반드시|아니다/.test(d.statement)), JSON.stringify(ox));
  const { pool } = choicePool({ correct: "교착 상태가 확정된다", candidates: [{ text: "교착 상태가 확정되지 않는다", from: "" }, { text: "교착 상태의 가능성만 있다", from: "" }, { text: "가능성만 있는 교착 상태다", from: "" }, { text: "안전 상태가 된다", from: "" }, { text: "구할 수 없다", from: "" }] },
    { fits: true, items: [0, 1, 2, 3, 4].map((n) => ({ n, wrong: true, tempting: 2, sameKind: true, sameAs: n === 2 ? 1 : -1 })) });
  assert.deepEqual(pool.map((p) => p.text).sort(), ["교착 상태의 가능성만 있다", "안전 상태가 된다"].sort());
  assert.equal(buildChoice("?", "정답", pool, "s"), undefined, "오답이 셋 안 되면 만들지 않는다");
  const z = clozeDrafts({ sentence: "자원 유형마다 인스턴스가 하나이면 순환은 교착 상태를 뜻한다", blanks: ["조건", "인스턴스가 하나"] }, card);
  assert.equal(z[0]?.format === "cloze" && z[0].answer, "인스턴스가 하나");
});

test("quiz: OX answers alternate over the material's OX cards and every card gets neighbours from the topic cards", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "all", engine: "recaller", provider: "fake", lab: { digest: true, digestStyle: "plan", digestTopicCards: true, quiz: "luna" } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const material = (await readGenCalls(done.id)).filter((c) => c.step === "rc-q-material").map((c) => JSON.parse(c.user!));
  assert.ok(material.length >= 1 && material.every((u) => Array.isArray(u.neighbors) && u.neighbors.length >= 1), JSON.stringify(material.map((u) => u.neighbors?.length)));
}));

test("quiz formats are planned over the material: close to the mix, kind preferences first, OX answers alternate", async () => {
  const { planFormats } = await import("./quiz.ts");
  const kinds = ["조건", "개념", "조건", "사실", "개념", "조건", "공식", "용어", "조건", "개념"];
  const cards = kinds.map((kind, i) => ({ id: `t${i + 1}.1c1`, kind })) as never[];
  const plan = planFormats(cards);
  const n = (f: string) => [...plan.values()].filter((p) => p.format === f).length;
  assert.equal(n("choice") + n("ox") + n("cloze"), 10);
  assert.ok(n("choice") <= 5 && n("ox") <= 3 && n("cloze") <= 2 && n("cloze") >= 1, JSON.stringify([...plan]));
  const ox = [...plan.values()].filter((p) => p.format === "ox");
  assert.ok(ox.some((p) => p.wantX) && ox.some((p) => !p.wantX));
});

test("quiz formats as cards arrive keep the mix", async () => {
  const { nextFormat } = await import("./quiz.ts");
  const used = { choice: 0, ox: 0, cloze: 0, write: 0 };
  const got = ["조건", "개념", "조건", "사실", "개념", "조건", "공식", "용어", "조건", "개념"].map((kind) => nextFormat({ kind } as never, used));
  assert.deepEqual(used, { choice: 5, ox: 3, cloze: 2, write: 0 }, JSON.stringify(got));
  assert.ok(got.filter((g) => g.format === "ox").some((g) => g.wantX) && got.filter((g) => g.format === "ox").some((g) => !g.wantX));
});

test("학습 목표 줄: 목차 뒤 목표|oN|동사|문장|주제|핵심·보조", async () => {
  const { parseObjectives, ONE_OUTLINE_END } = await import("./digest.ts");
  const got = parseObjectives(["개요|1", "t1|A|B|2||개념", ONE_OUTLINE_END, "목표|o1|판정|사이클과 인스턴스 수로 데드락 여부를 판정할 수 있다|t3, t7|핵심", "목표|o2|떠올리기|네 조건의 이름을 떠올릴 수 있다|t2|보조", "아무 줄"].join("\n"));
  assert.deepEqual(got.map((g) => [g.id, g.verb, g.topics, g.core]), [["o1", "판정", ["t3", "t7"], true], ["o2", "떠올리기", ["t2"], false]]);
});

test("짧은 퀴즈 (lab.quizCount): 서술이 섞이고, 판단 카드가 먼저, OX 설명은 O·X 자리에, 응답의 제어 문자는 지운다", async () => {
  const { nextFormat, QUIZ_MIX_SHORT, quizRank, oxNotesOf, cleanText, writeDrafts } = await import("./quiz.ts");
  const used = { choice: 0, ox: 0, cloze: 0, write: 0 };
  ["조건", "비교", "사실", "절차", "개념", "조건", "원리", "용어", "조건", "비교"].forEach((kind) => nextFormat({ kind } as never, used, QUIZ_MIX_SHORT));
  assert.ok(used.write >= 1 && used.write <= 2 && used.choice >= 3 && used.ox >= 2, JSON.stringify(used));
  assert.ok(quizRank({ kind: "조건" } as never) > quizRank({ kind: "용어" } as never));
  assert.deepEqual(oxNotesOf(["X를 고른 사람에게: 상호 배제는 부정할 수 없다.", "O를 고른 사람에게: 다른 조건과 혼동"]), ["다른 조건과 혼동", "상호 배제는 부정할 수 없다."]);
  assert.equal(cleanText("$R_1, \u001b[?m\\ldots, R_m$"), "$R_1, \\ldots, R_m$");
  assert.equal(cleanText("$\frac{a}{b}$"), "$\\frac{a}{b}$");
  assert.equal(writeDrafts({ stem: "교착 상태란 무엇인가?", answer: "두 프로세스 이상이 서로가 가진 자원을 기다리며 영원히 진행하지 못하는 상태다.", points: ["서로 기다림", "진행 불가"] }).length, 0);
  assert.equal(writeDrafts({ stem: "자원마다 인스턴스가 하나일 때 그래프에 사이클이 있으면 왜 교착 상태라고 단정할 수 있는지 설명하시오.", answer: "인스턴스가 하나면 사이클의 각 프로세스가 기다리는 자원을 다른 누구도 내줄 수 없다. 그래서 사이클은 곧 서로 기다림이다.", points: ["인스턴스 하나", "내줄 다른 인스턴스 없음"] }).length, 1);
});

test("목차 기반 지식 단위: 원문 목차(책갈피 → 쪽 제목)와 개념 줄", async () => {
  const { sourceGroups, parseConcepts } = await import("./digest.ts");
  const pages = [1, 2, 3, 4, 5, 6, 7, 8].map((page) => ({ page, title: ["표지", "Clipping", "Clipping (cont.)", "", "Region Code", "Region Code", "Polygon Clipping", "정리"][page - 1] }));
  const byTitle = sourceGroups(pages, []);
  assert.equal(byTitle?.from, "쪽 제목");
  assert.deepEqual(byTitle?.groups.map((g) => g.pages), [[1], [2, 3, 4], [5, 6], [7], [8]]);
  const byMarks = sourceGroups(pages, [{ title: "A", page: 2 }, { title: "B", page: 5 }, { title: "C", page: 7 }]);
  assert.equal(byMarks?.from, "책갈피");
  assert.deepEqual(byMarks?.groups.map((g) => g.pages), [[1, 2, 3, 4], [5, 6], [7, 8]]);
  assert.equal(sourceGroups(pages.map((p) => ({ ...p, title: "같은 제목" })), []), null, "한 항목이 절반을 넘으면 원문 목차를 쓰지 않는다");
  assert.deepEqual(sourceGroups(pages, [{ title: "A", page: 1 }, { title: "B", page: 3 }, { title: "B", page: 4 }, { title: "C", page: 6 }, { title: "D", page: 8 }])?.groups.map((g) => g.pages), [[1, 2], [3, 4, 5], [6, 7], [8]], "같은 책갈피가 이어지면 한 항목");
  const got = parseConcepts(["개요|1", "t1|절차·알고리즘", "t1-c1|영역 코드(Region Code)|5", "t1-c2|서덜랜드-호지먼|7", "t2|비교·분류"].join("\n"));
  assert.deepEqual(got.concepts.map((c) => [c.id, c.topic, c.name, c.pages]), [["t1-c1", "t1", "영역 코드(Region Code)", [5]], ["t1-c2", "t1", "서덜랜드-호지먼", [7]]]);
  assert.deepEqual(got.kinds, { t1: "절차·알고리즘", t2: "비교·분류" });
  const { parseTopic } = await import("./digest.ts");
  const body = parseTopic("t1", "[t1-b1] 영역 코드: 6비트로 위치를 나타냄. (p.5) {t1-c1}\n[t1-b2] 두 경우: 둘 다 쓰임. (p.5, 7) {t1-c1, t1-c2}\n[t1-b3] 꼬리표 없음: 그대로. (p.7)").body;
  assert.deepEqual(body.map((l) => [l.id, l.text, l.concepts]), [["t1-b1", "6비트로 위치를 나타냄. (p.5)", ["t1-c1"]], ["t1-b2", "둘 다 쓰임. (p.5, 7)", ["t1-c1", "t1-c2"]], ["t1-b3", "그대로. (p.7)", undefined]]);
});

test("프롬프트 점검 (GPT 11/4): 보기는 정말 섞이고, 점수 빠진 보기는 버리고, 빈칸 답은 정확히 같아야 하고, 빈칸에도 물을 지점을 넘긴다", async () => {
  const { shuffleOrder, buildChoice, choicePool, blankMatches } = await import("./quiz.ts");
  // 정답 위치: 시드가 끝 글자만 달라도 네 자리에 고루, 보기와 정답 번호는 맞물린다.
  const at = [0, 0, 0, 0];
  for (let i = 0; i < 400; i++) { const o = shuffleOrder(4, `gen_x:t${i}.1c1`); assert.deepEqual([...o].sort(), [0, 1, 2, 3]); at[o.indexOf(0)]++; }
  assert.ok(at.every((n) => n > 60), JSON.stringify(at));
  for (let i = 0; i < 20; i++) {
    const d = buildChoice("무엇인가?", "정답 보기", [{ text: "오답 하나", from: "" }, { text: "오답 둘", from: "" }, { text: "오답 셋", from: "" }], `s${i}`);
    assert.ok(d && d.format === "choice" && d.options[d.correct] === "정답 보기");
  }
  // 점수 응답에 없는 보기는 틀린 보기로 치지 않는다.
  const c = { correct: "사이클이 있으면 데드락이다", candidates: ["사이클이 없으면 데드락이다", "간선이 있으면 데드락이다", "정점이 있으면 데드락이다"].map((text) => ({ text, from: "" })) };
  const scored = choicePool(c, { fits: true, items: [{ n: 0, wrong: true, tempting: 2, sameKind: true, sameAs: -1 }] });
  assert.deepEqual(scored.pool.map((x) => x.text), ["사이클이 없으면 데드락이다"]);
  // 빈칸: 반대 뜻을 품은 답은 통과하지 않는다(그다음은 같은 뜻 판정 호출).
  assert.equal(blankMatches(["안전 상태"], "불안전 상태"), false);
  assert.equal(blankMatches(["불안전 상태", "unsafe state"], "Unsafe-State"), true);
  assert.equal(blankMatches(["사이클"], ""), false);
});

test("프롬프트 점검 (GPT 11/4): 빈칸 호출도 고른 지점(ask)을 받는다", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "all", engine: "recaller", provider: "fake", lab: { digest: true, digestStyle: "plan", digestTopicCards: true, quiz: "luna", quizCount: 4 } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const cloze = (await readGenCalls(done.id)).filter((c) => c.step === "rc-q-cloze");
  assert.ok(cloze.length >= 1, "빈칸 호출이 있다(가짜 고르기는 4문항이면 빈칸부터)");
  assert.ok(cloze.every((c) => (JSON.parse(c.user ?? "{}") as { ask?: string }).ask?.startsWith("가짜 지점")), "빈칸 호출에 ask");
}));
