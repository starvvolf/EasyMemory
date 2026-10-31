import { test } from "node:test";
import assert from "node:assert/strict";
import { promptParts } from "../lib/oc-engine.ts";

// 캐시가 맞게: 첫 메시지엔 전부, 이어 쓸 땐 바뀐 것만(10/31)
test("이어 쓰는 대화에는 안 변하는 계획서와 같은 파일을 다시 붙이지 않는다", () => {
  const ss = { turns: 0, files: new Map<string, string>() };
  const io = (file: string) => ({ context: "ALL", parts: { fixed: "[수업 계획서]", turn: "[지금 하는 순서] 3/9", recent: "[최근 대화]", since: "[지난 질문 뒤]", files: [{ key: "src/a.ts", text: file }] } }) as never;
  const first = promptParts(io("[파일 src/a.ts]\n1| x"), ss);
  assert.deepEqual(first, ["[수업 계획서]", "[지금 하는 순서] 3/9", "[최근 대화]", "[파일 src/a.ts]\n1| x"]);
  ss.turns = 1;
  const same = promptParts(io("[파일 src/a.ts]\n1| x"), ss);
  assert.equal(same.includes("[수업 계획서]"), false);
  assert.equal(same[0], "[지난 질문 뒤]");
  assert.match(same.at(-1)!, /위 대화에 붙인 것과 같음/);
  const changed = promptParts(io("[파일 src/a.ts]\n1| y"), ss);
  assert.equal(changed.at(-1), "[파일 src/a.ts]\n1| y");
});

test("나눈 맥락이 없으면(기본 엔진 모양) 전부 보낸다", () => {
  assert.deepEqual(promptParts({ context: "ALL" } as never, { turns: 3, files: new Map() }), ["ALL"]);
});
