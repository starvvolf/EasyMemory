import { test } from "node:test";
import assert from "node:assert/strict";
import { speedRows, writeSpeed } from "./speed.ts";

test("속도 체크: 출력 속도는 (출력+생각) ÷ (전체−첫 글자), 짧은 호출은 빼고 모델마다 가운데 값", () => {
  assert.equal(writeSpeed({ ms: 4400, first: 3400, out: 117 }), 117);
  assert.equal(writeSpeed({ ms: 3500, first: 3400, out: 120 }), null, "less than 0.3 s of writing says nothing");
  assert.equal(writeSpeed({ ms: 9000, first: 3000, out: 20 }), null, "fewer than 50 tokens says nothing");
  const at = (i: number) => `2026-11-06T00:00:${String(i).padStart(2, "0")}Z`;
  const rows = speedRows([
    { at: at(3), model: "gpt-6.1-terra", ms: 5000, first: 3000, out: 120, purpose: "a" },
    { at: at(2), model: "gpt-6.1-terra", ms: 4000, first: 3000, out: 60, purpose: "a" },
    { at: at(1), model: "gpt-6.1-terra", ms: 6000, first: 4000, out: 200, purpose: "a" },
    { at: at(0), model: "other", ms: 6000, first: 4000, out: 200, purpose: "a" },
  ]);
  assert.equal(rows[0].model, "gpt-6.1-terra", "models with a base come first");
  assert.equal(rows[0].speed, 60);
  assert.equal(rows[0].first, 3);
  assert.deepEqual(rows[0].base, { first: 3.4, speed: 117 });
  assert.equal(rows[1].base, null);
});
