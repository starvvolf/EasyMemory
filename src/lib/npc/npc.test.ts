// 가상 학습자(엄격 모드): 길의 판정을 실제 채점기로 재고, 조각 하나만 다른 일곱 명이 예상한 길로 가서 예상한 자리에서 막히는지.
import assert from "node:assert/strict";
import test from "node:test";
import { judge, type TestCase } from "../code/run.ts";
import { ROUTES } from "./map2606.ts";
import { NPCS, play } from "./npc.ts";

// 2606 작은 테스트(손으로): 사이클 · 역방향 간선 · 1과 바로 안 이어진 것 · 아무것도 안 이어짐
const tests: TestCase[] = [
  { input: "8\n6\n1 3\n3 4\n1 6\n6 3\n6 7\n5 8\n", output: "4" },
  { input: "3\n2\n2 1\n3 2\n", output: "2" },
  { input: "5\n0\n", output: "0" },
  { input: "4\n3\n1 2\n2 3\n3 1\n", output: "2" },
  { input: "6\n4\n3 4\n4 1\n6 5\n2 3\n", output: "3" },
];

test("길의 판정을 잰다: A · B · C는 맞음, D(바로 연결된 것만)는 틀림, 틀린 자리 조각은 틀림/시간 초과", async () => {
  const v = async (r: string, pickIt: (s: string) => string) => (await judge("python", ROUTES.find((x) => x.id === r)!.build(pickIt), tests, { timeLimitMs: 1000 })).verdict;
  const right = (slot: string) => ({ init: "syntax.py.list-of-lists", link: "idea.undirected", visit: "idea.mark-visited" } as Record<string, string>)[slot];
  for (const r of ["A", "B", "C"]) assert.equal(await v(r, right), "AC", r);
  assert.equal(await v("D", right), "WA");
  assert.equal(await v("A", (s) => (s === "init" ? "wrong.alias-list" : right(s))), "WA");
  assert.equal(await v("A", (s) => (s === "link" ? "wrong.one-way" : right(s))), "WA");
  assert.equal(await v("A", (s) => (s === "visit" ? "wrong.no-visited" : right(s))), "TLE");
});

test("일곱 명: 예상한 길 · 막힌 자리 · 정답지", async () => {
  const got = Object.fromEntries(await Promise.all(NPCS.map(async (n) => [n.id, await play(n, tests)] as const)));
  assert.equal(got.n1.route, "A"); assert.equal(got.n1.subs.length, 1); assert.equal(got.n1.key.length, 0);
  assert.equal(got.n2.route, "B"); assert.equal(got.n2.key.length, 0);
  assert.equal(got.n3.route, "C"); assert.equal(got.n3.subs.at(-1)!.verdict, "AC");
  assert.equal(got.n4.subs[0].verdict, "TLE"); assert.deepEqual(got.n4.key.map((k) => k.fragment), ["idea.mark-visited"]);
  assert.equal(got.n5.subs[0].verdict, "WA"); assert.deepEqual(got.n5.key.map((k) => k.fragment), ["syntax.py.list-of-lists"]);
  assert.equal(got.n6.subs[0].verdict, "WA"); assert.deepEqual(got.n6.key.map((k) => k.fragment), ["idea.undirected"]);
  assert.equal(got.n7.subs[0].verdict, "WA"); assert.ok(got.n7.key.some((k) => k.fragment === "idea.mark-visited"));
  for (const p of Object.values(got)) assert.equal(p.subs.at(-1)!.verdict, "AC", `${p.npc.name}는 배우고 결국 맞힌다`);
});
