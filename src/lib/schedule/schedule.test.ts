import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDeadline, addTodo, getTimer, listTodos, makeSchedule, pauseTimer, startTimer, stopTimer, updateTodo, week, readSessions } from "./store.ts";
import { recordEvent, saveMany, tree } from "../knowledge/api.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sched-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("the timer counts from its saved start, pauses, and a stop of a minute or more becomes a session", () => withData(async () => {
  const started = await startTimer({ label: "이분 탐색", mode: "pomodoro", targetMin: 25 });
  assert.equal(started.running, true);
  await new Promise((r) => setTimeout(r, 30));
  const paused = await pauseTimer();
  assert.ok(paused.elapsedMs >= 20 && !paused.running);
  const again = await startTimer({ label: "다른 이름" });
  assert.equal(again.label, "이분 탐색", "resuming keeps the session's label");
  assert.equal((await stopTimer()).saved, null, "a few milliseconds are not a session");
  await startTimer({ label: "네트워크" });
  const stopped = await stopTimer(new Date(Date.now() + 26 * 60_000));
  assert.equal(stopped.minutes, 26);
  assert.equal((await readSessions()).length, 1);
  assert.equal((await getTimer()).running, false);
}));

test("a deadline with a folder splits its review items over the days and keeps the last day for going over everything", () => withData(async () => {
  const items = await saveMany(Array.from({ length: 9 }, (_, i) => ({ title: `용어 ${i + 1}`, body: "뜻", folder: "한국사/조선" })));
  for (const r of items) await recordEvent(r.item.id, "asked");
  const folderId = (await tree()).folders.find((f) => f.name === "조선")!.id;
  const now = new Date("2026-10-26T01:00:00Z");
  const d = await addDeadline({ title: "한국사 중간", date: "2026-10-30", folderId });
  const made = await makeSchedule(d.id, now);
  assert.equal(made.days, 4);
  assert.deepEqual(made.todos.map((t) => t.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  assert.match(made.todos[0].text, /조선 지식 3개 보기/);
  assert.match(made.todos.at(-1)!.text, /전체 훑기 \+ 약한 것 몰아 보기/);
  // Making it again replaces the undone ones only.
  await updateTodo(made.todos[0].id, { done: true });
  await makeSchedule(d.id, now);
  assert.equal((await listTodos()).filter((t) => t.deadlineId === d.id).length, 5);
}));

test("a deadline without a folder splits the amount given; the week shows sessions, todos and deadlines by day", () => withData(async () => {
  const now = new Date("2026-10-26T01:00:00Z");
  const d = await addDeadline({ title: "네트워크 강의", date: "2026-11-01", amount: 10, unit: "강" });
  const made = await makeSchedule(d.id, now);
  assert.equal(made.todos[0].text, "네트워크 강의 1~2강");
  await addTodo({ text: "바킹독 0x12 읽기", date: "2026-10-27" });
  const w = await week(undefined, now);
  assert.equal(w.start, "2026-10-26");
  assert.equal(w.days[1].todos.some((t) => t.text === "바킹독 0x12 읽기"), true);
  assert.equal(w.days.find((x) => x.date === "2026-11-01")!.deadlines[0].title, "네트워크 강의");
}));
