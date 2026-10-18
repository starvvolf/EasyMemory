import test from "node:test";
import assert from "node:assert/strict";
import { deckDisplayTitle } from "../src/app/study/dejipgi-app.js";

const a = { id: "gen_" + "a".repeat(32), title: "가짜 강의 · 기출형" };
const b = { id: "gen_" + "b".repeat(32), title: a.title };
test("unique and legacy titles remain unchanged", () => {
  assert.equal(deckDisplayTitle(a, [a]), a.title);
  const old = { id: "legacy", title: a.title };
  assert.equal(deckDisplayTitle(old, [old, a]), old.title);
});
test("duplicate generated titles have stable distinct display labels without changing data", () => {
  const peers = [a, b], before = JSON.stringify(peers);
  assert.equal(deckDisplayTitle(a, peers), a.title + " · 자료 aaaaaaaa");
  assert.equal(deckDisplayTitle(b, peers), b.title + " · 자료 bbbbbbbb");
  assert.equal(JSON.stringify(peers), before);
  assert.equal(deckDisplayTitle(a, [...peers].reverse()), deckDisplayTitle(a, peers));
});
test("short identifier collisions use the full identifier", () => {
  const c = { id: "gen_" + "a".repeat(8) + "c".repeat(24), title: a.title };
  assert.equal(deckDisplayTitle(a, [a, c]), a.title + " · 자료 " + a.id.slice(4));
  assert.notEqual(deckDisplayTitle(a, [a, c]), deckDisplayTitle(c, [a, c]));
});
