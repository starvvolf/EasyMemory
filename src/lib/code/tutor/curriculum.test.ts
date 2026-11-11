// 커리큘럼 하나로 (11/11): 모든 패턴이 칸에 있고, 배우는 순서는 먼저 알 것이 앞에 오고, 필수는 52개(있는 것 + 들어올 것).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGED, OPTIONAL, ORDERED, placeOf, PREREQ, STEPS, UNPLACED } from "./curriculum.ts";
import { PATTERNS } from "./patterns.ts";

test("모든 패턴이 커리큘럼 칸에 있고 한 번씩만, 필수는 자료구조 15 + 알고리즘 37 = 52", () => {
  assert.deepEqual(UNPLACED, []);
  const placed = STEPS.flatMap((s) => s.patterns);
  assert.equal(new Set(placed).size, placed.length);
  for (const id of [...placed, ...OPTIONAL, ...Object.keys(MERGED)]) assert.ok(PATTERNS.some((p) => p.id === id), id);
  const count = (track: "ds" | "algo") => STEPS.filter((s) => s.track === track).reduce((n, s) => n + s.patterns.length + s.planned.length, 0);
  assert.equal(count("ds"), 15); assert.equal(count("algo"), 37);
  assert.equal(STEPS.length, 12);
});

test("배우는 순서: 먼저 알 것이 늘 앞에, 합쳐진 것은 없고 선택은 맨 뒤", () => {
  const ids = ORDERED.map((p) => p.id);
  for (const [id, pre] of Object.entries(PREREQ)) for (const r of pre) if (ids.includes(id)) assert.ok(ids.indexOf(r) < ids.indexOf(id), `${r} → ${id}`);
  assert.ok(ids.indexOf("graph-adj") < ids.indexOf("tree-walk"), "트리 돌기는 인접 리스트 뒤(칸 순서로는 앞이지만)");
  for (const id of Object.keys(MERGED)) assert.ok(!ids.includes(id));
  assert.deepEqual(ids.slice(-OPTIONAL.length).sort(), [...OPTIONAL].sort());
  assert.equal(ids[0], "fast-io");
});

test("자리 찾기: 갈래 › 칸 › 패턴, 합쳐진 것은 합쳐진 곳으로", () => {
  const p = placeOf("two-pointer")!;
  assert.equal(`${p.trackName} › ${p.stepName} › ${p.name}`, "알고리즘 › 범위 좁혀 찾기 › 두 손가락 밀기 (투 포인터)");
  assert.deepEqual(p.prereqs.map((r) => r.id), ["sort-key"]);
  assert.equal(placeOf("visited")?.mergedInto, PATTERNS.find((x) => x.id === "bfs-distance")?.name);
  assert.equal(placeOf("stack-match")?.trackName, "자료구조");
});
