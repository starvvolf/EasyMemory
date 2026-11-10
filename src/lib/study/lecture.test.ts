import { test } from "node:test";
import assert from "node:assert/strict";
import { settleStory } from "./lecture.ts";

const card = (id: string, role: string) => ({ id, ref: id, kind: "개념", title: id, core: role === "메인", shape: null, pages: [1], quotes: [], mistakes: [], takes: [], gives: [], questions: 0, same: [], state: "new", memo: { question: "", line: `${id} 요지`, facts: [], role } });
const map = { sections: [{ id: "t1", title: "가", pages: [1], cards: [card("a", "메인"), card("b", "메인"), card("c", "곁")] }, { id: "t2", title: "나", pages: [2], cards: [card("d", "메인")] }] } as never;

test("강의 줄기: 없는 id는 빼고, 빠진 메인 기억은 그 영역의 장 끝 걸음 앞에", () => {
  const r = settleStory({ problem: "p", chapters: [
    { title: "1", why: "", bridge: "", steps: [{ cards: ["a", "zz"], point: "a" }, { cards: ["zz"], point: "빈 걸음" }, { cards: ["a"], point: "묶기" }] },
    { title: "2", why: "", bridge: "", steps: [{ cards: ["d"], point: "d" }] }] }, map);
  assert.deepEqual(r.chapters[0].steps.map((s) => s.cards), [["a"], ["b"], ["a"]]);
  assert.equal(r.chapters[1].steps.length, 1);
  assert.ok(r.fixes.some((f) => f.includes("zz")) && r.fixes.some((f) => f.includes("b")));
  assert.ok(!r.chapters.flatMap((c) => c.steps.flatMap((s) => s.cards)).includes("c"));
});
