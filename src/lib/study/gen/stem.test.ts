import { test } from "node:test";
import assert from "node:assert/strict";
import { addMore, fillGroups, memoryCard, missingPages, settlePlan } from "./stem.ts";

const plan = { areas: [{ name: "선", question: "?" }, { name: "원", question: "?" }], memories: [
  { name: "DDA", kind: "절차" as const, role: "메인" as const, area: 1, pages: [5, 6, 99] },
  { name: "DDA", kind: "절차" as const, role: "메인" as const, area: 1, pages: [7] },
  { name: "중점 원", kind: "절차" as const, role: "메인" as const, area: 9, pages: [10] },
] };
test("줄기 다듬기: 같은 이름은 하나로(쪽 합침), 없는 영역은 앞 기억 영역, 입력 밖 쪽은 뺌", () => {
  const p = settlePlan(plan, [1, 5, 6, 7, 8, 10]);
  assert.deepEqual(p.memories.map((m) => [m.name, m.area, m.pages]), [["DDA", 1, [5, 6, 7]], ["중점 원", 1, [10]]]);
  assert.deepEqual(missingPages(p, [1, 5, 6, 7, 8, 10]), [1, 8]);
  const more = addMore(p, { areas: [], memories: [{ name: "DDA", kind: "절차", role: "메인", area: 1, pages: [8] }] }, [1, 5, 6, 7, 8, 10]);
  assert.deepEqual(more.memories[0].pages, [5, 6, 7, 8]);
});
test("채우기 묶음: 쪽이 넘치면 끊고 기억은 쪼개지 않는다", () => {
  const g = fillGroups([{ pages: [1, 2, 3] }, { pages: [4, 5] }, { pages: [6, 7, 8] }, { pages: [9] }], 6);
  assert.deepEqual(g.map((x) => x.length), [2, 2]);
});
test("기억 → 카드: 모양을 따라 종류를 맞추고 근거 쪽은 묶음 쪽만, 메인은 핵심", () => {
  const c = memoryCard("t1.m1", "메인", { memory: "t1-b1", title: "브레젠험", kind: "개념", question: "q", line: "l", idea: "", shape: { form: "procedure", steps: [{ action: "a", input: "", output: "" }, { action: "b", input: "", output: "" }] },
    facts: ["p0 = 2dy - dx"], details: [], evidence: [{ page: 3, quote: "x" }, { page: 50, quote: "y" }], mistakes: [], takes: [], gives: [], figure: null }, [3, 4]);
  assert.equal(c.kind, "절차"); assert.equal(c.weight, "핵심"); assert.deepEqual(c.evidence, [{ page: 3, quote: "x" }]); assert.deepEqual(c.memo?.facts, ["p0 = 2dy - dx"]);
});
