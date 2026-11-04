import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "grec-"));
process.env.PC_FAKE_AI = "1";
const ai = await import("../lib/ai.ts");
const R = await import("../lib/goal-record.ts");

test("목표 정리(11/5): 그 목표 시작 뒤의 대화만 보내고, 근거 구절은 학습자 말과 대조", async () => {
  let sent = "";
  ai.setFakeAi((purpose: string, user: string) => { sent = user; return { summary: "스택을 리스트로 써 봄", steps: ["설명을 들음", "pop 결과를 예측해 맞힘"], learned: [
    { concept: "스택", meaning: "나중에 넣은 것을 먼저 꺼냄", how: "예측해 맞힘", quote: "3" },
    { concept: "IndexError", meaning: "빈 리스트 pop은 오류", how: "예측해 맞힘", quote: "오류가 난다고 했잖아" }] }; });
  const msgs = [
    { role: "user", text: "예전 말", at: "2026-11-05T00:00:00Z" },
    { role: "user", text: "3", at: "2026-11-05T01:00:01Z" },
    { role: "assistant", text: "맞아요", at: "2026-11-05T01:00:02Z" },
    { role: "user", text: "오류가나지", at: "2026-11-05T01:00:03Z" },
  ];
  const rec = await R.recordGoal("run1", { title: "push · pop", done: "넣고 꺼낸다", understood: true, applied: false, at: "2026-11-05T01:00:00Z" }, "bottomup", msgs, (m) => `[${m.role}] ${m.text}`);
  assert.ok(rec);
  assert.ok(!sent.includes("예전 말")); // 목표 시작 전 대화는 안 보냄
  assert.match(sent, /건너뜀\(이해 ✓, 적용 –\)/);
  assert.equal(rec!.status, "건너뜀");
  assert.deepEqual(rec!.learned.map((x) => [x.concept, x.verified]), [["스택", true], ["IndexError", false]]); // 지어낸 구절은 근거 없음으로
  assert.equal((await R.recordsOf("run1")).length, 1);
});
