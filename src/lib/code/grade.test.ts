import { test } from "node:test";
import assert from "node:assert/strict";
import { needsOf } from "./grade.ts";
import { checkLevel } from "../assist/code-level.ts";

test("요구 능력: 모범 풀이 코드 → 낮은 단계, AI가 고른 칸·기억 → 높은 단계", () => {
  const reference = `const a = require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);
const n = a[0]; let lo = Infinity, hi = -Infinity;
for (let i = 1; i <= n; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
console.log(lo + " " + hi);`;
  const minmax = needsOf({ reference, picked: ["impl", "없는칸"] });
  assert.deepEqual(minmax.steps.flatMap((s) => s.needs.map((n) => n.id)), ["io", "var", "cond", "loop", "array", "impl"], "an id not on the ladder is dropped");
  assert.equal(minmax.top, 3);
  const fib = needsOf({ reference: "const memo = new Map(); function f(n) { if (n < 2) return n; return f(n-1)+f(n-2); }", picked: ["dp"], knowledge: ["메모이제이션", "점화식"] });
  assert.deepEqual(fib.steps.find((s) => s.step === 6)!.needs.find((n) => n.id === "dp")!.why, ["ai", "memory"]);
  assert.ok(fib.steps.find((s) => s.step === 4)!.needs.some((n) => n.id === "hash" && n.why.includes("code")));
  assert.deepEqual(fib.other, ["점화식"]);
  assert.equal(fib.top, 6);
  assert.ok(!needsOf({ picked: ["io"] }).steps.some((s) => s.needs.some((n) => n.why.includes("ai"))), "the model may not pick steps 1~2");
});

test("난이도 검사: 알려진 등급은 그 사이트 형식이어야 남는다", () => {
  assert.deepEqual(checkLevel({ known: { site: "solved.ac", rating: "실버 III" }, self: { level: "중급", why: "w" }, abilities: ["dp", "dp", "io"] }).known, { site: "solved.ac", rating: "실버 III" });
  assert.deepEqual(checkLevel({ known: { site: "solved.ac", rating: "실버 쯤" }, self: { level: "중급", why: "" } }).known, { site: "", rating: "" });
  assert.deepEqual(checkLevel({ known: { site: "프로그래머스", rating: "Lv. 2" }, self: { level: "기초", why: "" } }).known.rating, "Lv. 2");
  assert.equal(checkLevel({ known: { site: "", rating: "" }, self: { level: "어려움", why: "" } }).self.level, "중급");
  assert.deepEqual(checkLevel({ known: { site: "", rating: "" }, self: { level: "중급", why: "" }, abilities: ["dp", "dp", "io"] }).abilities, ["dp"]);
});
