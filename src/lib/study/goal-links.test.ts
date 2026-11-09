import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesOf, nameHits, settleLinks } from "./goal-links.ts";

const card = (id: string, title: string, core = false) => ({ id, title, core, kind: "용어", shape: {} }) as never;
const cards = [card("t3.1c1", "자원 할당 그래프(Resource allocation graph)", true), card("t3.1c2", "요청 간선(Request edge)"), card("t1.1c1", "교착 상태(Deadlock)", true), card("t3.1flow", "흐름: 그래프")];
const goal = { id: "o3", verb: "판정", text: "자원 할당 그래프의 순환과 자원 수를 보고 교착 여부를 판정할 수 있다", topics: ["t3"], core: true, given: "요청 간선 목록" };

test("후보는 목표 주제 안, 흐름 카드 빼고", () => assert.deepEqual(candidatesOf(goal, cards).map((c: { id: string }) => c.id), ["t3.1c1", "t3.1c2"]));
test("이름 맞추기는 괄호 빼고", () => assert.deepEqual(nameHits(goal, cards), ["t3.1c1", "t3.1c2"]));
test("후보 밖은 버리고, 비면 이름 맞춘 것, 목표 밖 핵심", () => {
  const r = settleLinks([goal], cards, [{ goal: "o3", need: ["t1.1c1"], confuse: [] }]);
  assert.deepEqual(r.links[0].need, ["t3.1c1", "t3.1c2"]);
  assert.deepEqual(r.outside, ["t1.1c1"]);
});
