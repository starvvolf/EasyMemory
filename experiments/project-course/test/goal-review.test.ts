// 목표 한 칸 총정리(11/12): 목표 정리가 review를 같이 받아 저장, 진행 중 정리는 따로(기록 · 메모리에 안 넣음), 끝나면 지움
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("목표 정리 총정리 · 진행 중 정리", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-review-"));
  process.env.PC_DATA_DIR = dir; process.env.PC_FAKE_AI = "1";
  await mkdir(path.join(dir, "goals"), { recursive: true });
  const { setFakeAi } = await import("../lib/ai.ts");
  let calls = 0;
  setFakeAi((purpose) => { if (purpose !== "goal-record") return ""; calls++; return { summary: "s", steps: [], cards: [], memory: { add: [], update: [], improved: [] },
    review: { aim: "지출을 파일에 쌓으려 했어요.", why: "write에는 문자열 하나", story: [
      { text: "write에 세 값을 따로 넣었다가 TypeError가 났어요.", code: "", result: "", weak: { size: "big", title: "write는 문자열 하나", state: "몰라요", lesson: "write()는 글 하나를 받아요.\n\n```\nf.write(\"a\")\n```" } },
      { text: "", code: "", result: "", weak: { size: "none", title: "", state: "", lesson: "" } },
      { text: "다시 해 봤어요.", code: "", result: "", weak: { size: "small", title: "", state: "", lesson: "제목 없는 카드" } }] } }; });
  const R = await import("../lib/goal-record.ts");
  const goal = { title: "파일에 덧붙이기", done: "", understood: false, applied: false, at: "2026-11-01T00:00:00Z" };
  const msgs = [{ role: "user", text: "write에 세 개 넣으면 안 돼?", at: "2026-11-01T00:01:00Z" }, { role: "assistant", text: "문자열 하나만 받아요", at: "2026-11-01T00:01:10Z" }];
  const show = (m: { role: string; text: string }) => `${m.role}: ${m.text}`;
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  const o = await R.ongoingOf("r1");
  assert.equal(o?.goal, "파일에 덧붙이기");
  assert.equal(o?.review?.story.length, 2, "글 없는 문단은 버림");
  assert.equal(o?.review?.story[0].weak?.size, "big");
  assert.match(o?.review?.story[0].weak?.lesson ?? "", /\n\n```/, "설명의 문단 · 코드 블록은 살림");
  assert.equal(o?.review?.story[1].weak, undefined, "제목 없는 카드는 버림");
  assert.equal((await R.recordsOf("r1")).length, 0, "진행 중은 기록에 안 들어감");
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  assert.equal(calls, 1, "새 말이 없으면 진행 중 정리를 다시 안 부름");
  const rec = await R.recordGoal("r1", { ...goal, understood: true, applied: true }, null, msgs, show);
  assert.equal(rec?.review?.aim, "지출을 파일에 쌓으려 했어요.");
  assert.equal(await R.ongoingOf("r1"), null, "끝나 정리되면 진행 중 정리는 지움");
});

test("총정리 문단 코드: 기록에 있는 코드 · 결과만 남김", async () => {
  const R = await import("../lib/goal-record.ts");
  const corpus = "a = input()\nprint(a + b)\nTypeError: x".replace(/\s+/g, "");
  const r = R.cleanReview({ aim: "x", why: "", story: [
    { text: "t1", code: "a = input()\nprint(a + b)  # 이어 붙음", result: "TypeError: x", weak: { size: "none", title: "", state: "", lesson: "" } },
    { text: "t2", code: "print(int('5') + 3)", result: "지어낸 결과", weak: { size: "none", title: "", state: "", lesson: "" } }] }, corpus)!;
  assert.equal(r.story[0].code, "a = input()\nprint(a + b)  # 이어 붙음"); assert.equal(r.story[0].result, "TypeError: x");
  assert.equal(r.story[1].code, undefined, "기록에 없는 코드는 버림"); assert.equal(r.story[1].result, undefined, "기록에 없는 결과는 버림");
});
