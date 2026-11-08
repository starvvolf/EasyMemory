// 문제집 채우기: fake network (archive page). 강의 풀이는 11/9부터 쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { htmlToText, parseBojPage, type Fetcher } from "./archive.ts";
import { CHAPTERS, chapters, fillProblem, problemIdOf } from "./bakingdog.ts";

const ARCHIVE = "https://web.archive.org/web/20260426085615id_/https://www.acmicpc.net/problem/7785";
const BOJ_HTML = `<html><title>7785번: 회사에 있는 사람</title><body><span id="problem_title">회사에 있는 사람</span>
<div id="problem_description"><p>현재 회사에 있는 모든 사람을 구하는 프로그램을 작성하시오.</p></div>
<div id="problem_input"><p>첫째 줄에 n이 주어진다. (2 &le; n &le; 10<sup>6</sup>)</p></div><div id="problem_output"><p>사전 순의 역순으로 출력한다.</p></div>
<pre id="sample-input-1">4
Baha enter
Askar enter
Baha leave
Artem enter
</pre><pre id="sample-output-1">Askar
Artem
</pre></body></html>`;

function fetcherWith(o: { archive?: boolean }): Fetcher {
  return async (url) => {
    const u = String(url);
    if (u.startsWith("https://archive.org/wayback/available")) return Response.json({ archived_snapshots: o.archive === false ? {} : { closest: { available: true, status: "200", timestamp: "20260426085615" } } });
    if (u === ARCHIVE) return new Response(BOJ_HTML);
    return new Response("", { status: 404 });
  };
}
async function withData(run: () => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-bd-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { await run(); } finally { if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior; await rm(dir, { recursive: true, force: true }); }
}

test("the built-in list is the workbook: chapters, categories, numbers and solution addresses only", () => {
  const ch = CHAPTERS.find((c) => c.chapter === "0x15");
  assert.ok(ch);
  assert.equal(ch.title, "해시");
  assert.deepEqual(ch.problems[0], { category: "연습 문제", recommended: false, number: "7785", title: "회사에 있는 사람", solution: "https://raw.githubusercontent.com/encrypted-def/basic-algo-lecture/master/0x15/solutions/7785.cpp" });
  assert.ok(CHAPTERS.every((c) => c.problems.every((p) => Object.keys(p).join() === "category,recommended,number,title,solution")), "no problem text or code in the list");
});

test("an archived Baekjoon page is read by its ids, exponents kept", () => {
  const p = parseBojPage(BOJ_HTML, ARCHIVE);
  assert.ok(p);
  assert.equal(p.title, "회사에 있는 사람");
  assert.match(p.inputText, /2 ≤ n ≤ 10\^6/);
  assert.deepEqual(p.examples, [{ input: "4\nBaha enter\nAskar enter\nBaha leave\nArtem enter\n", output: "Askar\nArtem\n" }]);
  assert.equal(htmlToText("a<br>b"), "a\nb");
});

test("filling (11/9): no lecture solution — opened at once from the original, the full problem made in the background with the mistakes to catch", () => withData(async () => {
  let given: Record<string, unknown> = {};
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const make = (async (input: Record<string, unknown>) => { given = input; await gate; return { id: input.id, check: {} }; }) as never;
  const opened = await fillProblem("7785", { fetcher: fetcherWith({}), make }, { avoid: ["정렬하지 않고 출력 (사전 역순이 아님)"] });
  assert.equal(opened.id, problemIdOf("7785"));
  assert.ok((opened as { preparing?: unknown }).preparing, "readable at once, the hidden tests still being made");
  assert.equal(opened.title, "BOJ 7785번: 회사에 있는 사람");
  assert.equal(given.id, "cp_boj_7785");
  assert.equal(given.human, undefined, "the lecture's solution is not used");
  assert.equal(given.folder, "알고리즘/해시");
  assert.deepEqual(given.mutantsHint, ["정렬하지 않고 출력 (사전 역순이 아님)"]);
  assert.deepEqual((given.original as { examples: unknown[] }).examples, [{ input: "4\nBaha enter\nAskar enter\nBaha leave\nArtem enter\n", output: "Askar\nArtem\n" }]);
  release();
  await new Promise((r) => setTimeout(r, 20));
  const row = (await chapters()).find((c) => c.chapter === "0x15")!.problems.find((p) => p.number === "7785")!;
  assert.deepEqual([row.fill?.status, row.fill?.problemId], ["ready", "cp_boj_7785"]);
}));

test("no archived original: not made, and the reason is kept for the list; a failed make is kept on the opened problem", () => withData(async () => {
  const never = (async () => { throw new Error("must not be called"); }) as never;
  await assert.rejects(fillProblem("7785", { fetcher: fetcherWith({ archive: false }), make: never }), /아카이브에서 이 문제의 원문을 찾지 못했어요/);
  let row = (await chapters()).find((c) => c.chapter === "0x15")!.problems.find((p) => p.number === "7785")!;
  assert.equal(row.fill?.status, "failed");
  const { CodeError, readProblemMeta } = await import("./problems.ts");
  await fillProblem("7785", { fetcher: fetcherWith({}), make: (async () => { throw new CodeError(422, "모범 풀이를 확인하지 못해서 저장하지 않았어요"); }) as never });
  await new Promise((r) => setTimeout(r, 20));
  assert.match((await readProblemMeta("cp_boj_7785")).preparing?.error ?? "", /모범 풀이를 확인하지 못해서/);
  row = (await chapters()).find((c) => c.chapter === "0x15")!.problems.find((p) => p.number === "7785")!;
  assert.match(row.fill?.reason ?? "", /모범 풀이/);
}));
