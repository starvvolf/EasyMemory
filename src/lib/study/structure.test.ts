import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStructure } from "./structure.ts";

const ids = ["t1c1", "t1c2", "t2c1", "t2c2", "t3c1"];
test("cards go to one group, missing ones to 그 밖, cycles and empty groups are fixed", () => {
  const r = checkStructure({
    groups: [
      { id: "g1", name: "교착 상태", parent: "", cards: [1], explain: "" },
      { id: "g2", name: "발생 조건", parent: "g1", cards: [2, 3, 2, 9], explain: "" },
      { id: "g3", name: "고리 A", parent: "g4", cards: [], explain: "" },
      { id: "g4", name: "고리 B", parent: "g3", cards: [4], explain: "" },
      { id: "g5", name: "빈 묶음", parent: "", cards: [], explain: "" },
    ],
    edges: [{ a: "g4", b: "g2", type: "막음", why: "조건을 깸" }, { a: "g1", b: "g2", type: "씀", why: "" }, { a: "g2", b: "g5", type: "씀", why: "" }, { a: "g4", b: "g2", type: "엉뚱", why: "" }],
  }, ids);
  const of = (id: string) => r.groups.find((g) => g.id === id);
  assert.deepEqual(of("g2")?.cards, ["t1c2", "t2c1"]);
  assert.deepEqual(of("g_rest")?.cards, ["t3c1"]);
  assert.equal(of("g5"), undefined);
  const roots = r.groups.filter((g) => !g.parent).map((g) => g.id);
  assert.ok(roots.includes("g3") || roots.includes("g4"));
  assert.deepEqual(r.edges.map((e) => `${e.a}>${e.b}>${e.type}`), ["g4>g2>막음"]);
});

test("a head card names its group and is not also a member; versus pairs are kept", () => {
  const r = checkStructure({
    groups: [
      { id: "g1", name: "그래프", parent: "", head: 1, cards: [1, 2, 3], members: "부분", explain: "" },
      { id: "g2", name: "판정", parent: "", head: 0, cards: [4, 5], members: "엉뚱", explain: "" },
    ],
    edges: [], pairs: [], versus: [{ a: 4, b: 5, on: "인스턴스 수" }, { a: 4, b: 4, on: "" }],
  }, ids);
  const g1 = r.groups.find((g) => g.id === "g1")!, g2 = r.groups.find((g) => g.id === "g2")!;
  assert.equal(g1.head, "t1c1");
  assert.deepEqual(g1.cards, ["t1c2", "t2c1"]);
  assert.equal(g1.members, "부분");
  assert.equal(g2.members, undefined);
  assert.equal(g2.head, undefined);
  assert.deepEqual(r.versus, [{ a: "t2c2", b: "t3c1", on: "인스턴스 수" }]);
  assert.equal(r.groups.find((g) => g.id === "g_rest"), undefined);
});

test("a big box: split, in order, or kept — only when every card is used once", async () => {
  const { applyBox } = await import("./structure.ts");
  const mk = (): import("./structure.ts").StructGroup[] => [{ id: "g1", name: "원 생성", parent: "", cards: ["a", "b", "c", "d"], members: "묶음", explain: "" }];
  let gs = mk();
  assert.equal(applyBox(gs, gs[0], { mode: "나누기", reason: "", parts: [{ name: "방정식", link: "", order: false, cards: [1, 2] }, { name: "중점", link: "", order: true, cards: [4, 3] }] }), true);
  assert.deepEqual(gs.map((g) => [g.id, g.parent, g.cards.join(""), g.members ?? ""]), [["g1", "", "", "종류"], ["g1_1", "g1", "ab", ""], ["g1_2", "g1", "dc", "순서"]]);
  gs = mk();
  assert.equal(applyBox(gs, gs[0], { mode: "차례로", reason: "", parts: [{ name: "문제", link: "x", order: false, cards: [1] }, { name: "해결", link: "문제를 받아", order: false, cards: [2, 3, 4] }] }), true);
  assert.equal(gs[0].members, "순서"); assert.equal(gs[1].link, undefined); assert.equal(gs[2].link, "문제를 받아");
  gs = mk();
  assert.equal(applyBox(gs, gs[0], { mode: "나누기", reason: "", parts: [{ name: "x", link: "", order: false, cards: [1, 2] }, { name: "y", link: "", order: false, cards: [2, 3] }] }), false);
  assert.deepEqual(gs[0].cards, ["a", "b", "c", "d"]); assert.equal(gs.length, 1);
  gs = mk();
  assert.equal(applyBox(gs, gs[0], { mode: "그대로", reason: "", parts: [{ name: "", link: "", order: false, cards: [3, 1, 2, 4] }] }), true);
  assert.deepEqual(gs[0].cards, ["c", "a", "b", "d"]);
});
