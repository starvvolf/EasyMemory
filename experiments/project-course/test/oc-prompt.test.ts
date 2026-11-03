import { test } from "node:test";
import assert from "node:assert/strict";
import { promptParts } from "../lib/oc-engine.ts";

// 캐시가 맞게: 첫 메시지엔 전부, 이어 쓸 땐 바뀐 것만(10/31)
test("컨텍스트 관리자가 조립한 순서 그대로: 고정 → 대화 → 상태 → 파일", () => {
  const io = { context: "ALL", parts: { fixed: "[코스]", turn: "[상태]", recent: "[최근 대화]", since: "", files: [{ key: "a", text: "[파일 a]" }] } } as never;
  assert.deepEqual(promptParts(io), ["[코스]", "[최근 대화]", "[상태]", "[파일 a]"]);
});

test("최근 대화: 마지막 12개, 지금 걸음은 자르지 않고 30개까지", async () => {
  const { splitRecent } = await import("../lib/lesson.ts");
  const ms = Array.from({ length: 40 }, (_, i) => ({ beat: i < 20 ? 1 : 2 }));
  assert.equal(splitRecent(ms, 2).recent.length, 20, "지금 걸음(2) 20개는 통째로");
  assert.equal(splitRecent(ms, 9).recent.length, 12);
  assert.equal(splitRecent(Array.from({ length: 50 }, () => ({ beat: 3 })), 3).recent.length, 30);
});

test("나눈 맥락이 없으면(기본 엔진 모양) 전부 보낸다", () => {
  assert.deepEqual(promptParts({ context: "ALL" } as never, { turns: 3, files: new Map() }), ["ALL"]);
});
