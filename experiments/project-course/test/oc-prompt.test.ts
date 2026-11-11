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

test("나눈 맥락이 없으면(기본 엔진 모양) 전부 보낸다", () => {
  assert.deepEqual(promptParts({ context: "ALL" } as never, { turns: 3, files: new Map() }), ["ALL"]);
});
