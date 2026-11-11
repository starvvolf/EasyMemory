import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonReply } from "./model.ts";

test("JSON 값 안에 ``` 코드 블록이 있어도 통째로 읽고, 울타리에 싸인 답도 읽는다", () => {
  assert.deepEqual(parseJsonReply('{"a":"설명\\n```\\nfor i in r:\\n```"}'), { a: "설명\n```\nfor i in r:\n```" });
  assert.deepEqual(parseJsonReply('```json\n{"b":1}\n```'), { b: 1 });
  assert.deepEqual(parseJsonReply('답이에요: {"c":2}'), { c: 2 });
});
