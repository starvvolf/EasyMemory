import test from "node:test";
import assert from "node:assert/strict";
import { pickCandidates, type Found } from "./find.ts";

const f = (o: Partial<Found>): Found => ({ title: "t", number: "", url: "", site: "", why: "", level: "", pattern: "", ...o });

test("후보 거르기: 이미 있는 번호·같은 문제·주소 없는 것은 빼고 3개까지", () => {
  const out = pickCandidates([
    f({ title: "A", number: "1000" }), f({ title: "B", url: "https://www.acmicpc.net/problem/2178" }), f({ title: "B again", number: "2178" }),
    f({ title: "C", url: "not a url" }), f({ title: "D", url: "https://school.programmers.co.kr/learn/courses/30/lessons/42586" }),
    f({ title: "E", number: "1260" }), f({ title: "F", number: "7576" }),
  ], new Set(["1000"]));
  assert.deepEqual(out.map((x) => x.title), ["B", "D", "E"]);
  assert.equal(out[0].number, "2178");
  assert.equal(out[2].url, "https://www.acmicpc.net/problem/1260");
});
