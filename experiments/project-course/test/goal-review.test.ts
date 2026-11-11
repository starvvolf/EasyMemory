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
    review: { aim: "지출을 파일에 쌓으려 했어요.", scenes: [{ title: "세 값을 어떻게 한 줄로 쓸까요?", body: "write에 세 값을 따로 넣었다가 TypeError가 났어요." }, { title: "", body: "제목 없는 것" }], reached: "두 줄 저장까지 했어요.", weak: [{ gap: "확인되지 않았어요", seen: "x" }] } }; });
  const R = await import("../lib/goal-record.ts");
  const goal = { title: "파일에 덧붙이기", done: "", understood: false, applied: false, at: "2026-11-01T00:00:00Z" };
  const msgs = [{ role: "user", text: "write에 세 개 넣으면 안 돼?", at: "2026-11-01T00:01:00Z" }, { role: "assistant", text: "문자열 하나만 받아요", at: "2026-11-01T00:01:10Z" }];
  const show = (m: { role: string; text: string }) => `${m.role}: ${m.text}`;
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  const o = await R.ongoingOf("r1");
  assert.equal(o?.goal, "파일에 덧붙이기");
  assert.equal(o?.review?.scenes.length, 1, "제목 없는 장면은 버림");
  assert.equal(o?.review?.weak.length, 0, "흐린 부족한 점은 버림");
  assert.equal((await R.recordsOf("r1")).length, 0, "진행 중은 기록에 안 들어감");
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  assert.equal(calls, 1, "새 말이 없으면 진행 중 정리를 다시 안 부름");
  const rec = await R.recordGoal("r1", { ...goal, understood: true, applied: true }, null, msgs, show);
  assert.equal(rec?.review?.aim, "지출을 파일에 쌓으려 했어요.");
  assert.equal(await R.ongoingOf("r1"), null, "끝나 정리되면 진행 중 정리는 지움");
});
