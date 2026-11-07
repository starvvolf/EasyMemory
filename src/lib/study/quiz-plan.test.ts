import { test } from "node:test";
import assert from "node:assert/strict";
import { planQuiz, sameAnswer } from "./quiz-plan.ts";
import type { MaterialMap } from "./material-map.ts";
import type { Structure } from "./structure.ts";

const card = (id: string, kind: string, core = false) => ({ id, ref: id, kind, title: id, core, shape: { form: "term", name: id, definition: `${id} 뜻` }, pages: [1], quotes: [], mistakes: [], takes: [], gives: [], questions: 0, same: [], state: "new" });
const map = { id: "gen_x", title: "t", status: "done", pages: 3, chains: [], topics: [], counts: {}, sections: [
  { id: "t1", title: "a", pages: [1], cards: [card("t1.1c1", "절차", true), card("t1.1c2", "공식", true), card("t1.1c3", "공식", true)] },
  { id: "t2", title: "b", pages: [2], cards: [card("t2.1c1", "용어", true), card("t2.1c2", "용어", true)] },
  { id: "t3", title: "c", pages: [3], cards: [card("t3.1c1", "사실")] }] } as unknown as MaterialMap;
const structure = { groups: [
  { id: "g1", name: "브레젠험", parent: "", head: "t1.1c1", cards: ["t1.1c2", "t1.1c3"], members: "순서", explain: "" },
  { id: "g2", name: "용어", parent: "", cards: ["t2.1c1", "t2.1c2", "t3.1c1"], members: "묶음", explain: "" }],
  versus: [{ a: "t2.1c1", b: "t2.1c2", on: "x" }], edges: [], pairs: [], fixes: [] } as unknown as Structure;

test("구조 단위 출제 계획: 차례 상자는 한 문제, 대비 쌍, 주제마다 하나, 용어는 플래시카드", () => {
  const p = planQuiz(map, structure);
  const seq = p.items.find((x) => x.unit === "차례")!;
  assert.deepEqual(seq.cards, ["t1.1c1", "t1.1c2", "t1.1c3"]);
  assert.equal(seq.form, "short");
  assert.ok(p.items.some((x) => x.unit === "대비"));
  assert.equal(p.coveredTopics, 3);
  assert.equal(p.flashcards.length, 2);
  assert.equal(p.items.length + p.later.length, 3);
});
test("답 맞추기", () => {
  assert.ok(sameAnswer("choice", "2", "2번"));
  assert.ok(!sameAnswer("choice", "2", "3"));
  assert.ok(sameAnswer("order", "3,1,2", "3, 1, 2"));
  assert.ok(sameAnswer("ox", "X", "x"));
  assert.ok(sameAnswer("short", "(21, 11)", "(21,11)"));
});
test("답 맞추기: 빼기 기호·문장으로 쓴 답", () => {
  assert.ok(sameAnswer("short", "(A,B,C,D)=(3,2,6,-6)", "(3,2,6,−6)"));
  assert.ok(sameAnswer("short", "거부, 요청 간선", "순환이 생기므로 요청을 거부한다. P2 → R2는 요청 간선이다."));
  assert.ok(!sameAnswer("short", "허용, 할당 간선", "요청을 거부한다. 요청 간선이다."));
});
