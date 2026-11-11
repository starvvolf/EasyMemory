import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("대화 장부: 원문 그대로 덧붙이고, 문제·번호로 시간순으로 돌려준다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "talk-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const { appendTalk, readTalk } = await import("./talk.ts");
    const long = "가".repeat(9000);
    await appendTalk({ problemId: "cp_x", number: "1260", kind: "질문", q: "이거 아니에요?", a: "그건 아니에요. 지어 낸 답이에요.", selection: "x = 1", code: "print(1)", verdict: "WA" });
    await appendTalk({ problemId: "cp_x", number: "1260", kind: "힌트", q: "힌트 2단계", a: long });
    await appendTalk({ problemId: "cp_y", kind: "오류 설명", q: "NameError", a: "이름이 없어요." });
    const mine = await readTalk({ problemId: "cp_x" });
    assert.deepEqual(mine.map((t) => t.kind), ["질문", "힌트"]);
    assert.equal(mine[0].q, "이거 아니에요?"); assert.equal(mine[0].verdict, "WA"); assert.equal(mine[0].selection, "x = 1");
    assert.equal(mine[1].a.length, 8000, "넉넉히 8000자까지");
    assert.equal((await readTalk({ number: "1260" })).length, 2);
    assert.equal((await readTalk({ problemId: "cp_y" }))[0].number, undefined, "번호를 모르면 비움");
  } finally { process.env.STUDY_FORGE_DATA_DIR = prior; }
});

test("대화 요약 확인: 빈 칸은 버리고, 코드 덩어리는 빼고, 길이는 자른다", async () => {
  const { checkNote } = await import("./talk.ts");
  assert.equal(checkNote({ need: "", gave: "x" }), null);
  assert.deepEqual(checkNote({ need: " for에 정수를 넣으면 될 줄 알았어요 ", gave: "range(t)를 써요 ```py\nfor i in range(t): pass\n```" }), { need: "for에 정수를 넣으면 될 줄 알았어요", gave: "range(t)를 써요" });
  assert.equal(checkNote({ need: "가".repeat(200), gave: "나" })!.need.length, 80);
});

test("튜터 대화 캐시: 앞선 대화는 처음부터 전부, 한도를 넘을 때만 앞에서 20개씩 덜어 냄", async () => {
  const { keepFrom } = await import("../../assist/code-ai.ts");
  assert.equal(keepFrom(Array(60).fill(500)), 0);
  assert.equal(keepFrom(Array(100).fill(1000)), 60);
  assert.equal(keepFrom([]), 0);
});
