import { test } from "node:test";
import assert from "node:assert/strict";
import { promptParts } from "../lib/oc-engine.ts";

// 캐시가 맞게: 첫 메시지엔 전부, 이어 쓸 땐 바뀐 것만(10/31)
test("이어 쓰는 대화: 처음엔 코스·단계 + 지금까지 대화, 다음엔 그 뒤 대화만, 단계가 바뀌면 단계 설명 다시, 같은 파일은 안 붙임", () => {
  const ss = { turns: 0, files: new Map<string, string>() } as { turns: number; files: Map<string, string>; stage?: number };
  const io = (file: string, n = 1) => ({ n, context: "ALL", parts: { fixed: "[코스][이번 단계]", turn: "[학습자 상태][지금 위치]", recent: "[지금까지 화면의 대화]", since: "[지난번 뒤 화면의 대화]", files: [{ key: "src/a.ts", text: file }] } }) as never;
  const first = promptParts(io("[파일 src/a.ts]\n1| x"), ss);
  assert.deepEqual(first, ["[코스][이번 단계]", "[지금까지 화면의 대화]", "[학습자 상태][지금 위치]", "[파일 src/a.ts]\n1| x"]);
  ss.turns = 1;
  const same = promptParts(io("[파일 src/a.ts]\n1| x"), ss).filter(Boolean);
  assert.equal(same.includes("[코스][이번 단계]"), false);
  assert.equal(same[0], "[지난번 뒤 화면의 대화]");
  assert.match(same.at(-1)!, /위 대화에 붙인 것과 같음/);
  const changed = promptParts(io("[파일 src/a.ts]\n1| y"), ss);
  assert.equal(changed.at(-1), "[파일 src/a.ts]\n1| y");
  const next = promptParts(io("[파일 src/a.ts]\n1| y", 2), ss).filter(Boolean);
  assert.equal(next[0], "[코스][이번 단계]", "2단계로 넘어가면 단계 설명을 다시");
});

test("나눈 맥락이 없으면(기본 엔진 모양) 전부 보낸다", () => {
  assert.deepEqual(promptParts({ context: "ALL" } as never, { turns: 3, files: new Map() }), ["ALL"]);
});
