import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKnowledge, memoryEvents } from "../knowledge/api.ts";
import { findBySource, readProblem, saveProblem, sourceKey } from "./problems.ts";
import { ensureProblemKnowledge, currentAttempt, endAttempt, endIdleAttempts, listProblemsWithKnowledge, recordAsked, recordHint, ATTEMPT_IDLE_MS } from "./service.ts";

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

const made = (url: string, kind: "full" | "blank" = "full") => saveProblem({ title: "랜선 자르기", statement: "s", inputText: "i", outputText: "o", examples: [], tests: [{ input: "1\n", output: "1" }], timeLimitMs: 1000,
  kind, templates: {}, reference: null, knowledge: ["매개 변수 탐색", "자른 개수 세기"], knowledgeBodies: ["답을 정해 놓고 되는지 확인하며 범위를 줄이는 방법", ""], folder: "알고리즘",
  source: { kind: "ai", title: "BOJ 1654", url } });

test("a problem's knowledge comes with its meaning; a meaning the learner wrote is kept", () => withData(async () => {
  const p = await ensureProblemKnowledge(await made("https://www.acmicpc.net/problem/1654"));
  const [param, binary] = await Promise.all(p.knowledgeIds.map(async (id) => (await getKnowledge(id)).item));
  assert.equal(param.body, "답을 정해 놓고 되는지 확인하며 범위를 줄이는 방법");
  assert.equal(binary.body, "", "no meaning given, none made up (and no seed meaning for this name)");
}));

test("the same address is found again (loosely), but not for the other kind", () => withData(async () => {
  assert.equal(sourceKey("https://www.acmicpc.net/problem/1654/"), sourceKey("http://acmicpc.net/problem/1654#top"));
  assert.equal(sourceKey("https://web.archive.org/web/20260418224535id_/https://www.acmicpc.net/problem/1654"), sourceKey("https://web.archive.org/web/20261001000000id_/https://www.acmicpc.net/problem/1654"), "a different archive copy is the same problem");
  assert.equal(await findBySource("https://www.acmicpc.net/problem/1654", "full"), null);
  const first = await made("https://www.acmicpc.net/problem/1654");
  const hit = await findBySource("http://acmicpc.net/problem/1654", "full");
  assert.equal(hit?.id, first.id);
  assert.equal(hit?.count, 1);
  assert.equal(await findBySource("https://www.acmicpc.net/problem/1654", "blank"), null);
  assert.equal(await findBySource("https://www.acmicpc.net/problem/16540", "full"), null);
}));
