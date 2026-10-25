import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFolder, deleteFolder, getKnowledge, importPoints, linkKnowledge, memoryEvents, memoryOverview, memorySummary, mergeKnowledge,
  recordEvent, reviewQueue, saveKnowledge, saveMany, searchKnowledge, setKnowledgeState, similarity, tree, updateFolder } from "./store.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}
const web = (title: string) => ({ kind: "web" as const, title, url: `https://example.com/${encodeURIComponent(title)}` });

test("the same knowledge under another wording is one item; meeting it in a new article is a 'met again'", () => withData(async () => {
  const first = await saveKnowledge({ title: "기준금리", body: "중앙은행이 정하는 금리", folder: "주식/금리", source: web("칼럼 1") });
  assert.equal(first.created, true);
  const again = await saveKnowledge({ title: "기준 금리", source: web("칼럼 2") });
  assert.equal(again.merged, true);
  assert.equal(again.again, true, "a new article is a re-encounter");
  assert.equal(again.item.id, first.item.id);
  assert.equal(again.item.sources.length, 2);
  const same = await saveKnowledge({ title: "기준금리", source: web("칼럼 2") });
  assert.equal(same.again, false, "the same article twice is not a re-encounter");
  const { folders, items } = await tree();
  assert.deepEqual(folders.map((f) => f.name), ["주식", "금리"]);
  assert.equal(items.length, 1);
  assert.ok(similarity("금리 인하", "금리인하") > 0.99);
}));

test("states: asked → 몰랐음, correct → 앎, three days of correct answers graduate, a miss brings it back", () => withData(async () => {
  const { item } = await saveKnowledge({ title: "PER", body: "주가를 주당순이익으로 나눈 값" });
  assert.equal(item.state, "met");
  assert.equal((await recordEvent(item.id, "asked", "PER이 뭐지?")).state, "unknown");
  assert.equal((await recordEvent(item.id, "correct", "", undefined, "2026-10-01T01:00:00Z")).state, "known");
  await recordEvent(item.id, "correct", "", undefined, "2026-10-01T05:00:00Z");
  assert.equal((await recordEvent(item.id, "correct", "", undefined, "2026-10-03T01:00:00Z")).graduated, false, "two days are not enough");
  assert.equal((await recordEvent(item.id, "correct", "", undefined, "2026-10-06T01:00:00Z")).graduated, true);
  assert.equal((await reviewQueue()).length, 0, "a graduated item leaves review");
  const back = await recordEvent(item.id, "wrong", "PBR과 헷갈림");
  assert.equal(back.state, "unknown");
  assert.equal(back.graduated, false);
  assert.equal((await reviewQueue())[0].id, item.id);
  // Meeting it again in another article never erases what is known.
  await recordEvent(item.id, "correct");
  assert.equal((await saveKnowledge({ title: "PER", source: web("칼럼 3") })).item.state, "known");
}));

test("links are the chains; merging folds names, sources, links and the record into one item", () => withData(async () => {
  const [rate, loan, growth] = await saveMany([{ title: "금리 인하" }, { title: "대출 증가" }, { title: "성장주 상승" }]);
  await linkKnowledge(rate.item.id, loan.item.id, "그러면");
  await linkKnowledge(loan.item.id, growth.item.id, "그러면");
  const dup = await saveKnowledge({ title: "성장주 강세", source: web("칼럼 4") });
  await recordEvent(dup.item.id, "wrong", "고리를 못 채움");
  const merged = await mergeKnowledge(growth.item.id, dup.item.id);
  assert.deepEqual(merged.aliases, ["성장주 강세"]);
  assert.equal(merged.stats.wrong, 1);
  assert.equal(merged.state, "unknown");
  const detail = await getKnowledge(loan.item.id);
  assert.equal(detail.links[0].item.title, "성장주 상승");
  assert.equal(detail.backlinks[0].item.title, "금리 인하");
  const events = await memoryEvents({ knowledgeId: growth.item.id });
  assert.ok(events.events.some((e) => e.kind === "wrong"), "the dropped item's record moved over");
  // Saving with links by title makes the linked item when it is missing.
  const chain = await saveKnowledge({ title: "환율 상승", links: [{ title: "수출주 이익 증가", relation: "그러면" }] });
  assert.equal(chain.item.links.length, 1);
}));

test("folders behave like a file tree; deleting one keeps its items", () => withData(async () => {
  const stocks = await createFolder("주식");
  const rates = await createFolder("금리", stocks.id);
  await assert.rejects(updateFolder(stocks.id, { parentId: rates.id }), /자기 안으로/);
  const { item } = await saveKnowledge({ title: "채권 가격", folderId: rates.id });
  await deleteFolder(rates.id);
  const { folders, items } = await tree();
  assert.deepEqual(folders.map((f) => f.name), ["주식"]);
  assert.equal(items.find((i) => i.id === item.id)!.folderId, stocks.id);
}));

test("search finds by letters first and by look-alike names, without a model; memory has three levels", () => withData(async () => {
  await saveMany([
    { title: "이분 탐색", body: "정렬된 배열에서 절반씩 버리며 찾기", folder: "알고리즘/탐색" },
    { title: "lower_bound", body: "x 이상이 처음 나오는 위치", folder: "알고리즘/탐색" },
    { title: "투 포인터", body: "두 위치를 옮기며 구간 보기", folder: "알고리즘" },
    { title: "기준금리", folder: "주식/금리" },
  ]);
  const hits = await searchKnowledge("이분탐색");
  assert.equal(hits[0].title, "이분 탐색");
  assert.equal(hits[0].by, "글자");
  assert.equal((await searchKnowledge("절반"))[0].title, "이분 탐색", "body text is searched too");
  assert.equal((await searchKnowledge("lower bound"))[0].title, "lower_bound");
  const fuzzy = await searchKnowledge("투포인터 기법");
  assert.equal(fuzzy[0].title, "투 포인터");
  const lb = hits.length ? (await searchKnowledge("lower_bound"))[0] : null;
  await recordEvent(lb!.id, "hint", "경계에서 막힘");
  const overview = await memoryOverview();
  assert.match(overview.text, /\[전체\] 지식 4개/);
  assert.match(overview.text, /- 알고리즘: 3개/);
  assert.match(overview.text, /\[약한 것\] lower_bound/);
  const summary = await memorySummary("알고리즘");
  assert.match(summary.text, /lower_bound \[몰랐음\] · 틀림 0 힌트 1/);
  assert.equal(summary.items.length, 3, "a folder's summary includes its sub-folders");
  assert.match((await memoryEvents({ kinds: ["hint"] })).text, /lower_bound · 힌트 받음: 경계에서 막힘/);
}));

test("PDF knowledge points come in once as 만남; the learner can graduate or reset an item by hand", () => withData(async () => {
  const points = [{ ref: "deck1:p1", title: "TCP", essentials: ["신뢰성 있는 전송"], folder: "네트워크/전송 계층", material: "네트워크 3장", page: 12 }];
  assert.deepEqual(await importPoints(points), { added: 1, merged: 0 });
  assert.deepEqual(await importPoints(points), { added: 0, merged: 0 });
  const [{ id }] = (await tree()).items;
  assert.equal((await setKnowledgeState(id, { graduated: true })).state, "known");
  assert.equal((await setKnowledgeState(id, { state: "unknown" })).state, "unknown");
}));

test("questions from knowledge: flashcard always, 객관식/OX with others to mix, 빈칸 in a chain; grading needs no model", async () => {
  const { questionsFor, recognizeQuestion, grade } = await import("./questions.ts");
  const base = { aliases: [], folderId: "f", links: [] as Array<{ to: string; relation: string }> };
  const pool = [
    { ...base, id: "a", title: "금리 인하", body: "중앙은행이 기준금리를 낮춤", links: [{ to: "b", relation: "그러면" }] },
    { ...base, id: "b", title: "대출 증가", body: "돈을 빌리는 사람이 늘어남", aliases: ["대출 확대"], links: [{ to: "c", relation: "그러면" }] },
    { ...base, id: "c", title: "성장주 상승", body: "미래 이익 비중이 큰 주식이 오름" },
  ];
  const qs = questionsFor(pool[1], pool, "s1");
  assert.deepEqual(qs.map((q) => q.label), ["플래시카드", "객관식", "OX", "빈칸"]);
  const blank = qs.find((q) => q.kind === "blank")!;
  assert.match(blank.prompt, /금리 인하 —그러면→ \( \? \) —그러면→ 성장주 상승/);
  assert.equal(grade(blank, "대출확대").correct, true, "aliases count");
  assert.equal(grade(blank, "대출 증가함").correct, true, "a close spelling counts");
  assert.equal(grade(blank, "환율").correct, false);
  const choice = qs.find((q) => q.kind === "choice")!;
  assert.equal(choice.options!.length, 3);
  assert.equal(grade(choice, "돈을 빌리는 사람이 늘어남").correct, true);
  assert.equal(grade(qs[0], "knew").correct, true);
  const rq = recognizeQuestion(pool[0], "한국은행이 금리를 0.25%p 내렸다", pool);
  assert.equal(rq.label, "알아보기");
  assert.ok(rq.options!.includes("금리 인하"));
});
