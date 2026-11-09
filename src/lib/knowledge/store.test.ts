import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFolder, deleteFolder, getKnowledge, importPoints, linkKnowledge, memoryEvents, memoryOverview, memorySummary, mergeKnowledge,
  recordEvent, reviewQueue, reviewStatus, saveKnowledge, saveMany, searchKnowledge, setKnowledgeState, similarity, takeBackWrong, tree, updateFolder, nextReview } from "./store.ts";

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
  assert.deepEqual(await importPoints(points), { added: 1, merged: 0, linked: 0, waiting: 0 });
  assert.deepEqual(await importPoints(points), { added: 0, merged: 0, linked: 0, waiting: 0 });
  const [{ id }] = (await tree()).items;
  assert.equal((await setKnowledgeState(id, { graduated: true })).state, "known");
  assert.equal((await setKnowledgeState(id, { state: "unknown" })).state, "unknown");
}));

test("questions from knowledge: flashcard always, 객관식/OX with others to mix, 빈칸 in a chain; grading needs no model", async () => {
  const { questionsFor, recognizeQuestion, grade } = await import("./questions.ts");
  const base = { aliases: [], folderId: "f", links: [] as Array<{ to: string; relation: string }> };
  const pool = [
    { ...base, id: "a", title: "금리 인하", body: "중앙은행이 기준금리를 낮춤", links: [{ to: "b", relation: "그러면" }] },
    { ...base, id: "b", title: "대출 증가", body: "돈을 빌리는 사람이 늘어남 / 헷갈림: 금리가 내리면 대출이 줄어든다고 생각한다.", aliases: ["대출 확대"], links: [{ to: "c", relation: "그러면" }] },
    { ...base, id: "c", title: "성장주 상승", body: "미래 이익 비중이 큰 주식이 오름" },
  ];
  const qs = questionsFor(pool[1], pool, "s1");
  // 11/9 사용자 "코드가 바로 문제 만들기 X": 뜻 카드 하나만, 헷갈림은 숨긴다.
  assert.deepEqual(qs.map((q) => q.label), ["플래시카드"]);
  assert.equal(qs[0].answer, "돈을 빌리는 사람이 늘어남");
  assert.equal(grade(qs[0], "knew").correct, true);
  const rq = recognizeQuestion(pool[0], "한국은행이 금리를 0.25%p 내렸다", pool);
  assert.equal(rq.label, "알아보기");
  assert.ok(rq.options!.includes("금리 인하"));
});

test("review boxes: a miss comes back tomorrow, each correct answer moves up a box, and only what is due is in the session", () => withData(async () => {
  const { item } = await saveKnowledge({ title: "뷰 업 벡터", body: "y_view 방향을 정한다" });
  const t0 = Date.parse("2026-10-26T10:00:00Z"), DAY = 86_400_000;
  const missed = await recordEvent(item.id, "wrong", "OX를 틀림", undefined, new Date(t0).toISOString());
  assert.equal(missed.review!.box, 0);
  assert.equal(Date.parse(missed.review!.dueAt) - t0, DAY, "a miss is asked again tomorrow, not minutes later");
  assert.equal((await reviewQueue({ dueOnly: true, now: new Date(t0 + DAY - 1000) })).length, 0, "not due before then");
  assert.equal((await reviewQueue({ dueOnly: true, now: new Date(t0 + DAY) })).length, 1);
  let at = t0 + DAY;
  const gaps: number[] = [];
  for (let n = 0; n < 2; n++) {
    const done = await recordEvent(item.id, "correct", "", undefined, new Date(at).toISOString());
    const gap = Date.parse(done.review!.dueAt) - at; gaps.push(gap / DAY); at += gap;
  }
  assert.deepEqual(gaps, [1, 3], "boxes 1 → 3 days, as in PDF practice (then 7, 16, 35)");
  const status = await reviewStatus({ now: new Date(at - 1000) });
  assert.equal(status.due, 0);
  assert.equal(status.next, new Date(at).toISOString(), "the next date is known");
  assert.equal((await reviewQueue({ dueOnly: false })).length, 1, "deadline planning still sees it");
  const again = await recordEvent(item.id, "hint", "힌트 1단계", undefined, new Date(at).toISOString());
  assert.equal(again.review!.box, 0, "a hint sends it back to the first box");
  assert.equal(nextReview(again.review, true, new Date(at)).box, 1);
  assert.equal(nextReview({ ...again.review!, box: 5 }, true, new Date(at)).box, 5, "the last box is the longest wait");
}));
test("내 답도 맞아요 takes the last miss back: as 맞힘 in practice, as nothing right after reading", () => withData(async () => {
  const { item } = await saveKnowledge({ title: "viewing origin", body: "P0" });
  const before = await recordEvent(item.id, "correct", "", undefined, "2026-10-26T09:00:00Z");
  await recordEvent(item.id, "wrong", "주관식", undefined, "2026-10-26T10:00:00Z");
  const fixed = await takeBackWrong(item.id, true, undefined, "2026-10-26T10:00:30Z");
  assert.equal(fixed.stats.wrong, 0);
  assert.equal(fixed.stats.correct, 2);
  assert.equal(fixed.state, "known");
  const kinds = (await memoryEvents({ knowledgeId: item.id })).events.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== "met"), ["correct", "correct"], "the 틀림 line is gone");
  assert.ok(Date.parse(fixed.review!.dueAt) > Date.parse(before.review!.dueAt), "the date moved on, not back to a miss");

  const { item: other } = await saveKnowledge({ title: "z_vp", body: "뷰 평면 위치" });
  await recordEvent(other.id, "wrong", "읽은 직후", undefined, "2026-10-26T10:00:00Z");
  const read = await takeBackWrong(other.id, false, undefined, "2026-10-26T10:01:00Z");
  assert.equal(read.state, "met", "nothing happened to it after all");
  assert.equal(read.review, undefined);
  assert.equal(read.stats.wrong, 0);
}));

test("뜻 카드: 이름을 앞에 단 설명은 이름을 떼고 보여 준다", async () => {
  const { meaningOf, questionsFor } = await import("./questions.ts");
  const item = { aliases: [] as string[], links: [] as Array<{ to: string; relation: string }>, id: "a", title: "z_vp", body: "z_vp — 뷰 평면의 위치를 정하는 스칼라 / 헷갈림: 거리로 생각한다.", folderId: "f1" };
  assert.equal(meaningOf(item), "뷰 평면의 위치를 정하는 스칼라");
  assert.equal(questionsFor(item, [item], "1")[0].answer, "뷰 평면의 위치를 정하는 스칼라");
});

test("PDF points: 냄 → 받음 become 고리, the wiring and the repeated name leave the text, no file-name folder", () => withData(async () => {
  const card = (id: string, title: string, line: string) => ({ ref: `deck1:${id}`, title, essentials: [line, "헷갈림: 순서"], folder: "3D뷰잉_좌표계/관찰 좌표", material: "3D뷰잉_좌표계", page: 1 });
  const points = [
    card("n", "view-plane normal vector (N)", "view-plane normal vector (N) — 뷰 평면의 법선 ⟨받음: - / 냄: N⟩"),
    card("v", "view-up vector (V)", "위쪽 방향을 정하는 벡터 ⟨받음: - / 냄: V⟩"),
    card("uvn", "uvn 좌표계", "1) n = N/|N| 2) u = V × n 3) v = n × u ⟨받음: view-plane normal (N), view-up vector (V) / 냄: u, v, n⟩"),
    card("m", "관찰 변환 행렬", "u, v, n을 행으로 쓴다 ⟨받음: u, v, n / 냄: M⟩"),
  ];
  const first = await importPoints(points);
  assert.equal(first.added, 4);
  assert.equal(first.linked, 3, "N → uvn and V → uvn by name, uvn → 행렬 by what it gives");
  const { folders, items } = await tree();
  assert.deepEqual(folders, [], "no folder named after the file: 주제 정리 places the points (classify.ts)");
  assert.equal((await getKnowledge(items[0].id)).item.topicHint, "3D뷰잉 좌표계 / 관찰 좌표", "where it came in is kept as a hint");
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  const n = await getKnowledge(byTitle["view-plane normal vector (N)"].id);
  assert.equal(n.item.body, "뷰 평면의 법선\n헷갈림: 순서", "no wiring, no name in front");
  assert.equal(n.links[0].item.title, "uvn 좌표계");
  const uvn = await getKnowledge(byTitle["uvn 좌표계"].id);
  assert.deepEqual(uvn.links.map((l) => [l.item.title, l.relation]), [["관찰 변환 행렬", "냄: u"]]);
  assert.equal((await importPoints(points)).linked, 0, "running again changes nothing");
  // A card that takes the normal "N" is fed by the card named "…(N)", not by the one that gives the unit vector "n".
  const up = card("up", "view-up vector (V)", "V를 N에 수직인 평면에 투영 ⟨받음: N / 냄: 조정된 V⟩");
  await importPoints([...points.slice(0, 1), up, ...points.slice(1)]);
  const fed = await getKnowledge((await tree()).items.find((i) => i.title === "view-up vector (V)")!.id);
  assert.deepEqual(fed.backlinks.map((l) => l.item.title).sort(), ["view-plane normal vector (N)"]);
}));

test("old FSRS schedules read as the first box; saving what is already there keeps 최근 순", () => withData(async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const dir = path.join(process.env.STUDY_FORGE_DATA_DIR!, "knowledge");
  await mkdir(dir, { recursive: true });
  const old = { id: "k_old", title: "이분 탐색", body: "반씩 줄여 찾기", folderId: null, state: "unknown", graduated: false, aliases: [], links: [], sources: [],
    stats: { asked: 0, wrong: 1, hint: 0, correct: 0, correctDays: [] }, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", lastAt: "2026-10-26T00:00:00.000Z",
    review: { algorithm: "fsrs", dueAt: "2026-10-26T12:00:00.000Z", stability: 0.2, repetitions: 1, lapses: 0, state: "learning", lastReviewAt: "2026-10-26T11:00:00.000Z" } };
  await writeFile(path.join(dir, "store.json"), JSON.stringify({ version: 1, folders: [], items: [old] }), "utf8");
  const { item } = await getKnowledge("k_old");
  assert.deepEqual(item.review, { algorithm: "leitner", box: 0, dueAt: "2026-10-26T12:00:00.000Z", lastReviewAt: "2026-10-26T11:00:00.000Z", repetitions: 1, lapses: 0 });
  const again = await saveKnowledge({ title: "이분 탐색" });
  assert.equal(again.item.lastAt, "2026-10-26T00:00:00.000Z", "nothing new, so it does not jump to the top");
  const more = await saveKnowledge({ title: "이분 탐색", aliases: ["Binary Search"] });
  assert.notEqual(more.item.lastAt, "2026-10-26T00:00:00.000Z");
}));

test("an article's ask lands on an existing item only with its body (2026-11-05 품질 점검)", () => withData(async () => {
  const general = await saveKnowledge({ title: "시간 복잡도", body: "입력 크기에 따라 연산 횟수가 느는 정도." });
  const again = await saveKnowledge({ title: "시간 복잡도", body: "인접 리스트 BFS는 O(V+E)다.", ask: "인접 리스트로 구현한 BFS의 시간 복잡도는?" });
  assert.equal(again.item.id, general.item.id);
  assert.equal(again.item.ask, undefined, "the ask was for another body; the card would show the general definition as its answer");
  const fresh = await saveKnowledge({ title: "방문 표시", body: "큐에 넣을 때 표시한다.", ask: "방문 표시는 언제 하는가?" });
  assert.equal(fresh.item.ask, "방문 표시는 언제 하는가?");
}));

test("a close name with a swapped part is another item; one that only adds is the same (2026-11-05)", () => withData(async () => {
  const deque = await saveKnowledge({ title: "[점검] 지연 측정용 덱", body: "양쪽 끝에서 넣고 뺀다." });
  const heap = await saveKnowledge({ title: "[점검] 지연 측정용 힙", body: "부모가 자식보다 작거나 같다." });
  assert.notEqual(heap.item.id, deque.item.id);
  const tcp3 = await saveKnowledge({ title: "TCP 3-way handshake" });
  assert.notEqual((await saveKnowledge({ title: "TCP 4-way handshake" })).item.id, tcp3.item.id);
  const dfs = await saveKnowledge({ title: "깊이 우선 탐색 알고리즘" });
  assert.equal((await saveKnowledge({ title: "깊이 우선 탐색 알고리즘들" })).item.id, dfs.item.id);
}));
