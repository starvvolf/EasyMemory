import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchKnowledge } from "../knowledge/api.ts";
import { findBySource, readProblem, readProblemMeta, savePreparing, saveProblem, setPreparing, sourceKey, submit } from "./problems.ts";
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

test("이번 풀이의 힌트·물어봄은 풀이 동안 모였다가 끝나면 비워진다; 11/8부터 기억에는 쓰지 않는다", () => withData(async () => {
  const [first] = await listProblemsWithKnowledge();
  const problem = await readProblem(first.id);
  await recordHint(problem.id, 1);
  await recordAsked(problem.id, "while 조건이 왜 st < en이지?");
  await recordHint(problem.id, 2);
  assert.deepEqual((await currentAttempt(problem.id)).map((e) => e.kind), ["hint", "asked", "hint"]);
  assert.deepEqual(await endAttempt(problem.id, { kind: "note", detail: "힌트 2번 받고 통과" }), { recorded: 0, ended: 4 });
  assert.equal((await currentAttempt(problem.id)).length, 0, "a new attempt starts empty");
  assert.equal((await searchKnowledge("이분 탐색")).length, 0, "the problem's concept names are not memories");
}));

test("an attempt left for two hours ends as it stands", () => withData(async () => {
  const [first] = await listProblemsWithKnowledge();
  const problem = await readProblem(first.id);
  await recordHint(problem.id, 1);
  await endIdleAttempts(Date.now() + 60_000);
  assert.equal((await currentAttempt(problem.id)).length, 1, "a short pause keeps the attempt");
  await endIdleAttempts(Date.now() + ATTEMPT_IDLE_MS + 60_000);
  assert.equal((await currentAttempt(problem.id)).length, 0);
}));

const made = (url: string, kind: "full" | "blank" = "full") => saveProblem({ title: "랜선 자르기", statement: "s", inputText: "i", outputText: "o", examples: [], tests: [{ input: "1\n", output: "1" }], timeLimitMs: 1000,
  kind, templates: {}, reference: null, knowledge: ["매개 변수 탐색", "자른 개수 세기"], knowledgeBodies: ["답을 정해 놓고 되는지 확인하며 범위를 줄이는 방법", ""], folder: "알고리즘",
  source: { kind: "ai", title: "BOJ 1654", url } });

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

test("바로 열기: a preparing problem runs its examples, refuses a submit, and the full one replaces it under the same id", () => withData(async () => {
  const pending = await savePreparing({ title: "BOJ 1번: A+B", statement: "두 수의 합", inputText: "a b", outputText: "a+b", examples: [{ input: "1 2\n", output: "3" }],
    folder: "알고리즘", source: { kind: "ai", title: "BOJ 1 A+B", url: "https://www.acmicpc.net/problem/1" }, from: "1" });
  const code = "a, b = map(int, input().split())\nprint(a + b)";
  const ran = await submit(pending.id, "python", code, "example").catch((e: Error) => e);
  assert.ok(!(ran instanceof Error) || /실행기/.test(ran.message), "examples run while preparing");
  await assert.rejects(submit(pending.id, "python", code, "submit"), /만드는 중/);
  await setPreparing(pending.id, { from: "1", since: pending.preparing!.since, error: "테스트를 못 만듦" });
  await assert.rejects(submit(pending.id, "python", code, "submit"), /다시 시도/);
  await saveProblem({ id: pending.id, title: "BOJ 1번: A+B", statement: "s", inputText: "i", outputText: "o", examples: pending.examples, tests: [{ input: "2 3\n", output: "5" }], timeLimitMs: 1000,
    kind: "full", templates: {}, reference: null, knowledge: ["사칙연산"], folder: "알고리즘", source: pending.source });
  const done = await readProblemMeta(pending.id);
  assert.equal(done.preparing, undefined, "the full problem is no longer preparing");
  assert.equal(done.hiddenTests, 1);
  await setPreparing(pending.id, { from: "1", since: "x", error: "late" });
  assert.equal((await readProblemMeta(pending.id)).preparing, undefined, "a late failure does not mark a finished problem");
}));
