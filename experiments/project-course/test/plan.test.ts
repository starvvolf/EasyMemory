// 코스 정하기의 계획은 코드가 정한다: 진단과 수준에 따라 시작 단계·빠르게 갈 단계가 정해진다.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCourse } from "../lib/course.ts";
import { makePlan, normalizePlan } from "../lib/intake.ts";

const course = await loadCourse("board-api");
const all = course.intake.diagnose.map((d) => d.id);

test("다 모르면 1단계부터 모두 직접", () => {
  const p = makePlan(course, { level: 0 }, { right: [], wrong: all });
  assert.equal(p.start, 1);
  assert.deepEqual(p.stages, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p.quick, []);
  assert.ok(p.transfer);
});
test("앞 단계를 알면 건너뛰고, 직접 하는 단계는 둘 이상(5·6은 남김)", () => {
  const p = makePlan(course, { level: 3 }, { right: all, wrong: [] });
  assert.equal(p.start, 5);
  assert.deepEqual(p.stages, [5, 6]);
});
test("문법만 아는 사람은 맞혀도 빠르게로 보내지 않는다", () => {
  const p = makePlan(course, { level: 0 }, { right: all, wrong: [] });
  assert.equal(p.start, 1);
  assert.deepEqual(p.quick, []);
});
test("중간을 모르면 그 앞까지만 건너뛰고 뒤의 아는 단계는 빠르게", () => {
  const p = makePlan(course, { level: 2 }, { right: ["d1", "d2", "d4", "d5", "d6"], wrong: ["d3"] });
  assert.equal(p.start, 3);
  assert.deepEqual(p.quick, [4]);
});
test("화면에서 바꾼 계획은 범위 안으로 정리", () => {
  const base = makePlan(course, { level: 0 }, { right: [], wrong: all });
  const p = normalizePlan(course, { start: 4, quick: [2, 4, 5, 99], transfer: false }, base);
  assert.equal(p.start, 4);
  assert.deepEqual(p.quick, [5]);
  assert.equal(p.transfer, false);
});
