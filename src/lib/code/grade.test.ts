import { test } from "node:test";
import assert from "node:assert/strict";
import { needsOf } from "./grade.ts";
import { checkKnown, checkSelf } from "../assist/code-level.ts";

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

test("난이도 검사: 찾은 등급은 그 사이트 형식 + 페이지 주소가 있어야 남는다, 자체 판단은 다섯 중 하나", () => {
  assert.deepEqual(checkKnown({ site: "solved.ac", rating: "실버 III", from: "https://www.teferi.net/ps/problems/boj/1004" }), { site: "solved.ac", rating: "실버 III", from: "https://www.teferi.net/ps/problems/boj/1004", by: "web" });
  assert.deepEqual(checkKnown({ site: "백준", rating: "골드 IV" }, "memory"), { site: "solved.ac", rating: "골드 IV", from: "", by: "memory" }, "what the model knows needs no page");
  assert.equal(checkKnown({ site: "solved.ac", rating: "실버 쯤", from: "https://x.kr" }).site, "", "not the tier shape");
  assert.equal(checkKnown({ site: "solved.ac", rating: "실버 III", from: "" }).site, "", "found on the web but no page it was read from");
  assert.equal(checkKnown({ site: "프로그래머스", rating: "Lv. 2", from: "https://school.programmers.co.kr/x" }).rating, "Lv. 2");
  assert.equal(checkSelf({ level: "어려움", why: "" }).level, "중급");
  assert.deepEqual(checkSelf({ level: "중급", why: "w", abilities: ["dp", "dp", "io"] }).abilities, ["dp"]);
});
