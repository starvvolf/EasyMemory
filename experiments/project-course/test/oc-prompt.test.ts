import { test } from "node:test";
import assert from "node:assert/strict";
import { promptParts } from "../lib/oc-engine.ts";

// 캐시가 맞게: 첫 메시지엔 전부, 이어 쓸 땐 바뀐 것만(10/31)
test("이어 쓰는 대화: 처음엔 코스·단계 + 대화, 다음엔 그 뒤 화면만, 단계가 바뀌면 단계 설명 다시, 같은 파일은 안 붙임", () => {
  const ss = { turns: 0, files: new Map<string, string>() } as { turns: number; files: Map<string, string>; stage?: number };
  const io = (file: string, n = 1) => ({ n, context: "ALL", parts: { fixed: "[코스]", turn: "[상태]", recent: "[최근 대화]", since: "[지난 질문 뒤 화면]", files: [{ key: "a", text: file }] } }) as never;
  assert.deepEqual(promptParts(io("[파일 a] x"), ss), ["[코스]", "[최근 대화]", "[상태]", "[파일 a] x"]);
  ss.turns = 1;
  assert.deepEqual(promptParts(io("[파일 a] x"), ss).filter(Boolean), ["[지난 질문 뒤 화면]", "[상태]"]);
  assert.deepEqual(promptParts(io("[파일 a] y"), ss).filter(Boolean), ["[지난 질문 뒤 화면]", "[상태]", "[파일 a] y"]);
  assert.equal(promptParts(io("[파일 a] y", 2), ss).filter(Boolean)[0], "[코스]");
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
