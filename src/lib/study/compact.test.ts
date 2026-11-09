import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompact } from "./compact.ts";

test("카드는 한 기억에만, 빠진 카드는 혼자 기억, 없는 번호는 뺌", () => {
  const r = checkCompact({ areas: [{ name: "선", question: "?" }], memories: [
    { name: "브레젠험", kind: "알고리즘", role: "메인", area: 1, question: "q", line: "l", steps: ["a", "b"], cards: [1, 2, 9] },
    { name: "겹침", kind: "이상한", role: "?", area: 5, question: "", line: "", steps: [], cards: [2] },
  ] }, ["c1", "c2", "c3"], ["가", "나", "다"]);
  assert.equal(r.memories.length, 2);
  assert.deepEqual(r.memories[0].cards, ["c1", "c2"]);
  assert.deepEqual(r.memories[1], { id: "m2", name: "다", kind: "개념", role: "메인", area: 0, question: "", line: "", steps: [], cards: ["c3"] });
  assert.ok(r.fixes.some((f) => f.includes("없는 카드 9")) && r.fixes.some((f) => f.includes("빈 기억")));
});
