// 4개 축: 목표 (자료를 넣으면 지식이 따라옴, 여러 목표에 걸침, 목표별 복습, 과목 동기화) and 주제 정리 (fake model).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { runClassify } from "./classify.ts";
import { acceptSuggestion, createGoal, daysLeft, goalOverview, goalItemIds, goalReview, goalsOfItems, listMaterials, setGoalSource, sourceKey, syncSubjects,
  unplacedMaterials, updateGoal } from "./goals.ts";
import { getKnowledge, recordEvent, saveMany, tree, updateKnowledge } from "./store.ts";

async function withData(run: (calls: ModelRequest[]) => Promise<void>, reply?: (r: ModelRequest) => unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-goals-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const calls: ModelRequest[] = [];
  setFakeModelResponder((r) => { calls.push(r); return JSON.stringify(reply ? reply(r) : {}); });
  try { await run(calls); } finally {
    setFakeModelResponder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
const pdf = (title: string, ref: string) => ({ kind: "pdf" as const, title, ref });
const code = (title: string, id: string) => ({ kind: "code" as const, title, ref: `code:${id}` });

test("a 자료 in a goal brings its items; one item can be in two goals; review is scoped by goal", () => withData(async () => {
  const [bin, lb] = await saveMany([{ title: "이분 탐색", source: code("가진 카드 확인하기", "p1") }, { title: "lower_bound", source: code("가진 카드 확인하기", "p1") }]);
  const [proj] = await saveMany([{ title: "원근 투영", source: pdf("그래픽스 03", "deck1:c1") }]);
  await saveMany([{ title: "이분 탐색", source: pdf("자료구조 05", "deck2:c4") }]);

  const coding = await createGoal({ name: "코테 준비" });
  await setGoalSource(coding.id, { key: sourceKey(code("가진 카드 확인하기", "p1")), kind: "code", title: "가진 카드 확인하기" }, true);
  const ds = await createGoal({ name: "자료구조", date: "2026-11-20" });
  await setGoalSource(ds.id, { key: sourceKey(pdf("자료구조 05", "")), kind: "pdf", title: "자료구조 05" }, true);

  assert.deepEqual((await goalItemIds(coding.id)).sort(), [bin.item.id, lb.item.id].sort());
  assert.deepEqual(await goalItemIds(ds.id), [bin.item.id], "met in the class PDF too: the same one item");
  assert.deepEqual((await goalsOfItems())[bin.item.id].sort(), [coding.id, ds.id].sort());
  assert.deepEqual((await goalsOfItems())[proj.item.id], []);

  await recordEvent(bin.item.id, "wrong", "", undefined, "2026-10-27T00:00:00.000Z");
  await recordEvent(proj.item.id, "wrong", "", undefined, "2026-10-27T00:00:00.000Z");
  const r = await goalReview(ds.id, { dueOnly: true, now: new Date("2026-10-29T00:00:00.000Z") });
  assert.deepEqual(r.queue.map((q) => q.title), ["이분 탐색"], "그래픽스 is not in 자료구조's review");
  assert.equal(r.status.due, 1);

  const over = await goalOverview(new Date("2026-10-28T03:00:00.000Z"));
  assert.equal(over[0].name, "자료구조", "a goal with a date comes first");
  assert.equal(over[0].daysLeft, 23);
  assert.equal(over[0].counts.unknown, 1);
  await updateGoal(ds.id, { closed: true });
  assert.equal((await goalOverview()).at(-1)!.name, "자료구조", "a closed goal goes last and keeps its items");
  assert.deepEqual(await goalItemIds(ds.id), [bin.item.id]);
}));

test("자료 without a goal, a suggestion accepted makes the goal; the study screen's subjects become goals", () => withData(async () => {
  await saveMany([{ title: "PER", source: { kind: "web", title: "주식 기초", url: "https://ex.com/per" } }, { title: "원근 투영", source: pdf("그래픽스 03", "deck1:c1") }]);
  assert.equal((await unplacedMaterials()).length, 2);
  const { suggestGoals } = await import("./goals.ts");
  await suggestGoals([{ key: "web:https://ex.com/per", goalId: "", name: "주식 공부", reason: "주식 글" }]);
  const goal = await acceptSuggestion("web:https://ex.com/per", "주식 기초", "web");
  assert.equal(goal.name, "주식 공부");
  assert.equal((await listMaterials()).find((m) => m.key === "web:https://ex.com/per")!.goals[0], goal.id);

  await syncSubjects([{ name: "컴퓨터그래픽스", exam: "2026-10-20" }], [{ subject: "컴퓨터그래픽스", title: "그래픽스 03" }]);
  const g = (await goalOverview()).find((x) => x.name === "컴퓨터그래픽스")!;
  assert.equal(g.date, "2026-10-20");
  assert.equal(g.counts.total, 1);
  assert.deepEqual(await unplacedMaterials(), []);
  assert.equal(daysLeft({ date: "2026-10-29" }, new Date("2026-10-28T16:00:00.000Z")), 0, "Korean day: 10/29 01:00 KST is the day itself");
}));

test("주제 정리: one call sorts new items into one topic tree with a 종류, keeps hand-placed ones, suggests goals for 자료", () => withData(async (calls) => {
  const [a, b, c] = await saveMany([
    { title: "이분 탐색", folder: "바킹독/0x13", source: code("가진 카드", "p1") },
    { title: "원근 투영", topicHint: "그래픽스 03 / 투영", source: pdf("그래픽스 03", "deck1:c1") },
    { title: "abandon", body: "버리다", topicHint: "읽은 글", source: { kind: "web", title: "영단어 30", url: "https://ex.com/voca" } },
  ]);
  const [mine] = await saveMany([{ title: "PER", source: { kind: "web", title: "주식 기초", url: "https://ex.com/per" } }]);
  const fld = (await tree()).folders.find((f) => f.name === "바킹독")!;
  await updateKnowledge(mine.item.id, { folderId: fld.id });
  const result = await runClassify();
  assert.equal(calls.length, 1, "one call for the batch and the 자료");
  assert.match(calls[0].user, /힌트: 그래픽스 03 \/ 투영/);
  assert.equal(result.sorted, 4);
  assert.equal(result.left, 0);
  const pathOfItem = async (id: string) => (await getKnowledge(id)).path;
  assert.equal(await pathOfItem(a.item.id), "CS / 알고리즘 / 탐색");
  assert.equal(await pathOfItem(b.item.id), "CS / 그래픽스 / 투영");
  assert.equal((await getKnowledge(c.item.id)).item.kind, "vocab");
  assert.equal(await pathOfItem(mine.item.id), "바킹독", "moved by hand: stays");
  assert.equal((await getKnowledge(mine.item.id)).item.kind, "concept", "left out by the model: still gets a 종류");
  assert.equal((await getKnowledge(b.item.id)).item.topicHint, undefined);
  assert.ok(!(await tree()).folders.some((f) => f.name === "0x13"), "the emptied source folder is gone");
  const mats = await listMaterials();
  assert.equal(mats.find((m) => m.key === "pdf:그래픽스 03")!.suggestion!.name, "컴퓨터그래픽스");
  assert.deepEqual(await runClassify(), { sorted: 0, suggested: 0, left: 0, calls: 0 }, "each item is sorted once");
}, (r) => {
  const items = r.user.split("[정리할 지식]\n")[1].split("\n\n")[0].split("\n");
  const n = (t: string) => items.findIndex((l) => l.includes(`. ${t}`));
  const mats = r.user.split("[목표가 없는 자료]\n")[1].split("\n");
  const m = (t: string) => mats.findIndex((l) => l.includes(t));
  return { items: [{ n: n("이분 탐색"), topic: "CS/알고리즘/탐색", kind: "procedure" }, { n: n("원근 투영"), topic: "CS / 그래픽스 / 투영", kind: "concept" }, { n: n("abandon"), topic: "어학/영어/어휘", kind: "vocab" }],
    materials: [{ m: m("그래픽스 03"), goalId: "", name: "컴퓨터그래픽스", reason: "그래픽스 강의" }] };
}));

test("어휘: words with the same meaning are asked both ways and never offered as the same knowledge", async () => {
  const { questionsFor } = await import("./questions.ts");
  const base = { aliases: [], folderId: "f", links: [] as Array<{ to: string; relation: string }>, kind: "vocab" as const };
  const pool = [{ ...base, id: "a", title: "abandon", body: "버리다" }, { ...base, id: "b", title: "acquire", body: "얻다" }, { ...base, id: "c", title: "adapt", body: "적응하다" }];
  const qs = questionsFor(pool[0], pool, "s");
  assert.deepEqual(qs.map((q) => q.kind), ["flashcard", "short", "choice"]);
  assert.equal(qs[1].answer, "abandon");
  assert.ok(qs[2].options!.includes("abandon") && qs[2].options!.every((o) => /^[a-z]+$/.test(o)), "options are words, not meanings");
});
