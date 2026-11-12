import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, groupOf, thinkOf } from "./flash-stats.ts";

test("groupOf: 최근 기록으로 무리를 정한다", () => {
  assert.equal(groupOf([]), "unseen");
  assert.equal(groupOf(["x"]), "stuck");
  assert.equal(groupOf(["o", "x", "x"]), "stuck");
  assert.equal(groupOf(["o", "x", "o", "x", "o"]), "shaky");
  assert.equal(groupOf(["x", "x", "o", "o"]), "learned");
  assert.equal(groupOf(["o", "o", "o"]), "solid");
  assert.equal(groupOf(["x", "o"]), "shaky");
});

test("analyze: 카드마다 · 회차마다", () => {
  const ev = (at: string, kind: string, detail: string, ref = "g:t1.m1") => ({ at, kind, detail, refs: [ref] });
  const s = analyze(["g:t1.m1", "g:t1.m2", "g:t1.m3"], [
    ev("2026-11-13T01:00:00Z", "wrong", "플래시카드: 몰랐어요 · 생각 10초"),
    ev("2026-11-13T01:00:30Z", "correct", "플래시카드: 알았어요 · 생각 4초", "g:t1.m2"),
    ev("2026-11-13T02:00:00Z", "asked", "강의에서 헷갈림: 거리에 비례한다고 봄"),
    ev("2026-11-13T03:00:00Z", "correct", "플래시카드: 알았어요 · 생각 20초"),
    ev("2026-11-13T03:00:10Z", "met", "본 것만"),
  ]);
  const a = s.cards["g:t1.m1"];
  assert.deepEqual(a.seq, ["x", "x", "o"]);
  assert.equal(a.tries, 3); assert.equal(a.wrong, 2); assert.equal(a.think, 15);
  assert.deepEqual(a.notes, ["강의에서 헷갈림: 거리에 비례한다고 봄"]);
  assert.equal(s.cards["g:t1.m3"].group, "unseen");
  assert.deepEqual(s.rounds.map((r) => [r.n, r.known]), [[2, 1], [1, 1]]);
  assert.equal(thinkOf("플래시카드: 알았어요"), null);
});
