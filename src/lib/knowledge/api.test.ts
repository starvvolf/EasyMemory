// 바깥 입구(api.ts)의 약속을 지키는지 확인한다: 무엇을 내보내는지, 받는 값, 돌려주는 모양.
// 이 테스트가 깨지면 코드 문제(A)·생성 엔진(C)·일정·에이전트 툴 쪽이 깨진다는 뜻이다. 고치기 전에 스레드분담 3장을 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as api from "./api.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-api-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("api.ts exports every promised name (adding is fine; removing or renaming breaks other threads)", () => {
  const promised = ["saveKnowledge", "saveMany", "recordEvent", "searchKnowledge", "getKnowledge", "memoryEvents", "memoryOverview",
    "memorySummary", "reviewQueue", "reviewStatus", "tree", "dayOf", "linkKnowledge", "setKnowledgeState",
    "questionsFor", "grade", "QUESTION_LABEL", "getSource", "listSources"];
  for (const name of promised) assert.ok(name in api, `api.ts must export ${name}`);
  // Functions keep at least their required parameters (the optional ones may grow).
  assert.ok(api.recordEvent.length >= 2, "recordEvent(id, kind, detail?, source?, at?)");
  assert.ok(api.linkKnowledge.length >= 3, "linkKnowledge(fromId, toId, relation)");
  assert.ok(api.setKnowledgeState.length >= 2, "setKnowledgeState(id, patch)");
});

test("the code-problem contract: saveMany with a code source, then recordEvent and memoryEvents by item", () => withData(async () => {
  const source = { kind: "code" as const, title: "가진 카드 확인하기", ref: "code:p1" };
  const [a, b] = await api.saveMany([
    { title: "이분 탐색", folder: "알고리즘/이분 탐색", body: "정렬된 범위를 반씩 줄여 찾는다", source },
    { title: "탐색 범위의 경계", folder: "알고리즘/이분 탐색", source },
  ]);
  assert.equal(a.created, true);
  assert.equal(typeof a.item.id, "string");
  assert.deepEqual(a.item.sources.map((s) => ({ kind: s.kind, ref: s.ref })), [{ kind: "code", ref: "code:p1" }]);
  assert.equal(b.item.state, "met");

  const at = "2026-10-28T03:00:00.000Z";
  const after = await api.recordEvent(a.item.id, "wrong", "틀린 제출", source, at);
  assert.equal(after.state, "unknown", "틀림 → 몰랐음");
  assert.ok(after.review?.dueAt, "틀림 puts the item into review");

  const { events, text } = await api.memoryEvents({ knowledgeId: a.item.id, kinds: ["wrong"], limit: 5 });
  assert.equal(events.length, 1);
  const [e] = events;
  assert.deepEqual({ kind: e.kind, detail: e.detail, at: e.at, title: e.title, ref: e.source?.ref }, { kind: "wrong", detail: "틀린 제출", at, title: "이분 탐색", ref: "code:p1" });
  assert.equal(typeof text, "string");

  const hits = await api.searchKnowledge("이분", { limit: 3 });
  assert.equal(hits[0].id, a.item.id);
  assert.ok(["글자", "비슷한 말"].includes(hits[0].by));
}));

test("the schedule contract: tree, reviewQueue and dayOf", () => withData(async () => {
  const [x] = await api.saveMany([{ title: "누적 합", folder: "알고리즘/누적 합" }]);
  await api.recordEvent(x.item.id, "hint", "", undefined, "2026-10-27T00:00:00.000Z");
  const { folders, items } = await api.tree();
  assert.ok(folders.some((f) => f.name === "누적 합"));
  assert.deepEqual(Object.keys(items[0]).sort(), ["dueAt", "folderId", "graduated", "id", "lastAt", "line", "links", "state", "title", "updatedAt", "weak"].sort());
  const queue = await api.reviewQueue({ dueOnly: true, now: new Date("2026-10-29T00:00:00.000Z") });
  assert.deepEqual(queue.map((q) => q.id), [x.item.id]);
  const status = await api.reviewStatus({ now: new Date("2026-10-29T00:00:00.000Z") });
  assert.equal(status.due, 1);
  assert.equal(api.dayOf("2026-10-27T16:00:00.000Z"), "2026-10-28", "days are Korean days by default (UTC+9)");
}));

test("the agent contract: getKnowledge, links, state, memory text and questions without a model", () => withData(async () => {
  const [rate, loan] = await api.saveMany([{ title: "기준금리", body: "중앙은행이 정하는 금리", folder: "경제" }, { title: "대출 금리", body: "은행이 빌려줄 때 받는 이자율", folder: "경제" }]);
  await api.linkKnowledge(rate.item.id, loan.item.id, "올리면 오른다");
  await api.setKnowledgeState(loan.item.id, { state: "known" });
  const detail = await api.getKnowledge(rate.item.id);
  assert.equal(detail.path, "경제");
  assert.equal(detail.links[0].item.id, loan.item.id);
  assert.ok(Array.isArray(detail.events));
  assert.match((await api.memoryOverview()).text, /\[전체\] 지식 2개/);
  assert.match((await api.memorySummary("경제")).text, /기준금리/);

  const qs = api.questionsFor(detail.item, [detail.item, (await api.getKnowledge(loan.item.id)).item]);
  const card = qs.find((q) => q.kind === "flashcard");
  assert.ok(card, "a flashcard is always there");
  assert.equal(card.knowledgeId, rate.item.id);
  assert.equal(card.label, api.QUESTION_LABEL.flashcard);
  assert.equal(api.grade(card, "알았어요").correct, true);
  assert.deepEqual(await api.listSources(), []);
  assert.equal(await api.getSource("src_0000000000000000"), null);
}));
