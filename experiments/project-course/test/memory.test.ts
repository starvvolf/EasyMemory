import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(os.tmpdir(), "mem-"));
process.env.PC_DATA_DIR = dir;
process.env.PC_FAKE_AI = "1";
mkdirSync(path.join(dir, "codex-chat"), { recursive: true });
writeFileSync(path.join(dir, "codex-chat", "preferences.json"), JSON.stringify({ items: [{ text: "완성 코드를 한 번에 주지 않기", quote: "한번에 주지마", chatId: "c1", at: "2026-11-05T00:00:00Z" }] }));
const ai = await import("../lib/ai.ts");
const { wrapFake } = await import("./old-record.ts");
const setFake = wrapFake(ai);
const R = await import("../lib/goal-record.ts");
const M = await import("../lib/memory.ts");
const msgs = (t: string) => [{ role: "user", text: t, at: "2026-11-06T01:00:01Z" }];
const goal = (title: string) => ({ title, done: "d", understood: true, applied: true, at: "2026-11-06T01:00:00Z" });

test("학습자 메모리(11/6): 목표 정리 호출이 같이 갱신, 근거는 부족했던 점 이름만, 상태는 코드가", async () => {
  assert.equal((await M.memoryOf())[0].text, "완성 코드를 한 번에 주지 않기"); // 예전 진행 방식 옮김
  let sent = "";
  setFake((_p: string, user: string) => { sent = user; return { summary: "", steps: [], learned: [], gaps: [{ type: "규칙", concept: "return 순서", wrong: "w", right: "r", quote: "" }],
    memory: { add: [{ text: "함수의 반환 흐름이 부족해 보인다", evidence: ["return 순서"] }, { text: "지어낸 것", evidence: ["없는 이름"] }], update: [], improved: [] } }; });
  const r1 = await R.recordGoal("runA", goal("캐시"), null, msgs("해 봤어요"), (m) => m.text);
  assert.match(sent, /\[지금 학습자 메모리\]\n\(아직 없음\)/);
  assert.equal(r1!.memory!.done.length, 1); assert.equal(r1!.memory!.dropped.length, 1);
  const t = (await M.memoryOf()).find((i) => i.kind === "경향")!;
  assert.equal(t.status, "가설");
  // 다른 목표에서 또 보이면 확인
  setFake((_p: string, user: string) => { sent = user; return { summary: "", steps: [], learned: [{ type: "개념", concept: "리스트", meaning: "", how: "", quote: "" }], gaps: [{ type: "규칙", concept: "return 위치", wrong: "w", right: "r", quote: "" }],
    memory: { add: [], update: [{ id: t.id, text: "함수에서 return 위치 · 흐름이 부족해 보인다", evidence: ["return 위치"] }], improved: [] } }; });
  await R.recordGoal("runA", goal("피보나치"), null, msgs("했어요"), (m) => m.text);
  assert.match(sent, new RegExp(`\\[${t.id}\\] 함수의 반환 흐름이 부족해 보인다 \\(가설\\)`));
  const t2 = (await M.memoryOf()).find((i) => i.id === t.id)!;
  assert.equal(t2.status, "확인"); assert.equal(t2.text, "함수에서 return 위치 · 흐름이 부족해 보인다");
  // 학습자가 고친 글은 덮어쓰지 않음, 나아짐은 배운 것 이름이 근거
  await M.editMemory(t.id, { text: "return 흐름 연습 중" });
  setFake(() => ({ summary: "", steps: [], learned: [{ type: "규칙", concept: "return 즉시 종료", meaning: "", how: "", quote: "" }], gaps: [], memory: { add: [], update: [], improved: [{ id: t.id, evidence: ["return 즉시 종료"] }] } }));
  await R.recordGoal("runB", goal("다음"), null, msgs("됐다"), (m) => m.text);
  const t3 = (await M.memoryOf()).find((i) => i.id === t.id)!;
  assert.equal(t3.status, "나아짐"); assert.equal(t3.text, "return 흐름 연습 중");
  assert.match(await M.memoryText(), /완성 코드를 한 번에 주지 않기/);
  assert.doesNotMatch(await M.memoryText(), /return 흐름/); // 나아진 것은 튜터 맥락에서 뺌
  await M.editMemory(t.id, { delete: true });
  assert.equal((await M.memoryOf()).length, 1);
});
