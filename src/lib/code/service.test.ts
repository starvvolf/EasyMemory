import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKnowledge, memoryEvents } from "../knowledge/store.ts";
import { readProblem } from "./problems.ts";
import { currentAttempt, endAttempt, endIdleAttempts, listProblemsWithKnowledge, recordAsked, recordHint, ATTEMPT_IDLE_MS } from "./service.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-svc-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("this attempt's hints wait in the attempt, so the tutor never calls them 지난번; they reach the record when it ends", () => withData(async () => {
  const [first] = await listProblemsWithKnowledge();
  const problem = await readProblem(first.id);
  const kid = problem.knowledgeIds[0];
  await recordHint(problem.id, 1);
  await recordAsked(problem.id, "while 조건이 왜 st < en이지?");
  await recordHint(problem.id, 2);
  assert.deepEqual((await currentAttempt(problem.id)).map((e) => e.kind), ["hint", "asked", "hint"]);
  const before = (await getKnowledge(kid)).item;
  assert.equal(before.stats.hint + before.stats.asked, 0, "nothing in the knowledge record while solving");
  assert.equal((await memoryEvents({ knowledgeId: kid, kinds: ["hint", "asked"] })).events.length, 0, "so the tutor's 'earlier misses' stay empty");

  await endAttempt(problem.id, { kind: "note", detail: "힌트 2번 받고 통과" });
  const after = (await getKnowledge(kid)).item;
  assert.equal(after.stats.hint, 2);
  assert.equal(after.stats.asked, 1);
  assert.equal(after.state, "unknown");
  assert.deepEqual((await memoryEvents({ knowledgeId: kid })).events.map((e) => e.kind).filter((k) => k !== "met").reverse(), ["hint", "asked", "hint", "note"]);
  assert.equal((await currentAttempt(problem.id)).length, 0, "a new attempt starts empty");
}));

test("an attempt left for two hours ends as it stands; ending one with nothing in it writes nothing", () => withData(async () => {
  const [first] = await listProblemsWithKnowledge();
  const problem = await readProblem(first.id);
  assert.deepEqual(await endAttempt(problem.id), { recorded: 0 });
  await recordHint(problem.id, 1);
  await endIdleAttempts(Date.now() + 60_000);
  assert.equal((await currentAttempt(problem.id)).length, 1, "a short pause keeps the attempt");
  await endIdleAttempts(Date.now() + ATTEMPT_IDLE_MS + 60_000);
  assert.equal((await currentAttempt(problem.id)).length, 0);
  assert.equal((await getKnowledge(problem.knowledgeIds[0])).item.stats.hint, 1);
}));
