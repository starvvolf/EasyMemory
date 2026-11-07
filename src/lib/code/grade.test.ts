import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bojNumber, gradesFor, needsOf, tierOf } from "./grade.ts";

test("티어: solved.ac level → 이름", () => {
  assert.equal(tierOf(3).tier, "브론즈 III");
  assert.equal(tierOf(8).tier, "실버 III");
  assert.equal(tierOf(11).tier, "골드 V");
  assert.equal(tierOf(30).tier, "루비 I");
  assert.equal(tierOf(0).group, "unrated");
});

test("백준 번호: id·제목·출처·주소에서", () => {
  assert.equal(bojNumber({ id: "cp_boj_1003", title: "x", source: { title: "" } }), "1003");
  assert.equal(bojNumber({ id: "cp_ab12", title: "BOJ 10818번: 최소, 최대", source: { title: "" } }), "10818");
  assert.equal(bojNumber({ id: "cp_ab12", title: "곱셈", source: { title: "바킹독 0x0B 재귀 · 기본 문제 · BOJ 1629" } }), "1629");
  assert.equal(bojNumber({ id: "cp_ab12", title: "합", source: { title: "주제", url: "https://www.acmicpc.net/problem/2042" } }), "2042");
  assert.equal(bojNumber({ id: "cp_seed_pair_sum", title: "합이 X인 두 수", source: { title: "기본 문제" } }), null);
});

test("등급: 한 번 묻고 보관본을 쓴다, 실패해도 던지지 않는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grade-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR; process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    let calls = 0;
    const ok = async () => { calls++; return new Response(JSON.stringify([{ problemId: 10818, level: 3, acceptedUserCount: 170093, averageTries: 2.2193,
      tags: [{ key: "implementation", displayNames: [{ language: "ko", name: "구현" }] }] }])); };
    const g = (await gradesFor(["10818"], ok)).get("10818")!;
    assert.equal(g.tier, "브론즈 III"); assert.deepEqual(g.tags, [{ key: "implementation", name: "구현" }]); assert.equal(g.avgTries, 2.22);
    await gradesFor(["10818"], ok);
    assert.equal(calls, 1, "kept copy is used");
    const down = async () => { throw new Error("offline"); };
    assert.equal((await gradesFor(["10818", "1003"], down)).size, 1, "what is kept still comes back");
  } finally { if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior; await rm(dir, { recursive: true, force: true }); }
});

test("요구 능력: 모범 풀이 코드 → 낮은 단계, 분류·기억 → 높은 단계", () => {
  const reference = `const a = require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);
const n = a[0]; let lo = Infinity, hi = -Infinity;
for (let i = 1; i <= n; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
console.log(lo + " " + hi);`;
  const minmax = needsOf({ reference, tags: [{ key: "math", name: "수학" }, { key: "implementation", name: "구현" }] });
  const ids = minmax.steps.flatMap((s) => s.needs.map((n) => n.id));
  assert.deepEqual(ids, ["io", "var", "cond", "loop", "array", "impl", "math"]);
  assert.equal(minmax.top, 3);
  const fib = needsOf({ reference: "const memo = new Map(); function f(n) { if (n < 2) return n; return f(n-1)+f(n-2); }", tags: [{ key: "dp", name: "다이나믹 프로그래밍" }], knowledge: ["메모이제이션", "점화식"] });
  const dp = fib.steps.find((s) => s.step === 6)!.needs.find((n) => n.id === "dp")!;
  assert.deepEqual(dp.why, ["tag", "memory"]);
  assert.ok(fib.steps.find((s) => s.step === 4)!.needs.some((n) => n.id === "hash" && n.why.includes("code")));
  assert.deepEqual(fib.other, ["점화식"], "a memory name not on the ladder is listed apart");
  assert.equal(fib.top, 6);
});
