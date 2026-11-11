import { test } from "node:test";
import assert from "node:assert/strict";
import { addMore, fillGroups, firstLine, parsePlan, memoryCard, memoryCardQA, missingPages, settlePlan } from "./stem.ts";

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
test("질문 하나 · 답 하나 카드 (11/11): 답 원문은 memo.answer, 목록 줄은 첫 줄, 자세히는 more, 모양은 사실 한 칸", () => {
  const c = memoryCardQA("t1.m2", "메인", { memory: "t1-b2", title: "브레젠험", kind: "절차", question: "다음 화소를 어떻게 정하나?", answer: "1. 결정 변수 $p_0 = 2dy - dx$\n2. $p_k < 0$이면 y 그대로", more: ["유도"],
    evidence: [{ page: 3, quote: "x" }], mistakes: [], takes: [], gives: [], figure: null }, [3]);
  assert.equal(c.kind, "절차"); assert.equal(c.memo.answer?.split("\n").length, 2); assert.equal(c.memo.line, "결정 변수 $p_0 = 2dy - dx$"); assert.deepEqual(c.memo.details, ["유도"]);
  assert.equal(c.shape.form, "fact");
  assert.equal(firstLine("| 대상 | 기준 |\n|---|---|\n| A | B |"), ""); assert.equal(firstLine("두 가지다.\n| A | B |"), "두 가지다.");
});
test("줄 형식 줄기 읽기 (11/12 lab.planLines): 영역·기억 줄, 쪽 범위, 건너뛴 영역 번호, 모르는 모양은 개념", () => {
  const p = parsePlan(["설명", "영역|1|선 그리기|직선을 어떻게?", "영역|3|원 그리기|원은?", "기억|1|절차(알고리즘)|메인|5-7, 9|DDA", "- 기억|3|공식|바탕|21|원의 방정식", "기억|3|이상한모양|이상한역할|p.22|대칭성"].join("\n"));
  assert.deepEqual(p.areas.map((a) => a.name), ["선 그리기", "원 그리기"]);
  assert.deepEqual(p.memories.map((m) => [m.name, m.area, m.kind, m.role, m.pages]), [["DDA", 1, "절차", "메인", [5, 6, 7, 9]], ["원의 방정식", 2, "공식", "바탕", [21]], ["대칭성", 2, "개념", "메인", [22]]]);
  assert.deepEqual(parsePlan("없음"), { areas: [], memories: [] });
});
