// 부족함 원장 한 바퀴(가짜 AI): 판정으로 열림 → 보충 → 맞음으로 채움 → 목표 정리가 이름 · 재확인 문항 → 앱으로 보낼 것(checks · 채움 메모)
// → 다시 확인 틀림 · 맞음 → 그 결과가 앱 사건(틀림 · 맞힘)으로
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(os.tmpdir(), "pc-loop-"));
process.env.PC_DATA_DIR = dir; process.env.PC_FAKE_AI = "1";
const ai = await import("../lib/ai.ts");
const G = await import("../lib/gaps.ts");
const R = await import("../lib/goal-record.ts");
const { pending, markSent } = await import("../lib/sync.ts");
const { loadCourse } = await import("../lib/course.ts");

test("찾기 → 채우기 → 확인 → 정리 → 앱 → 다시 확인 → 앱", async () => {
  const t0 = "2026-11-01T01:00:00.000Z";
  await mkdir(path.join(dir, "goals"), { recursive: true });
  await writeFile(path.join(dir, "goals", "run1.json"), JSON.stringify({ long: { text: "딕셔너리로 단어 세기", spec: "", at: t0 }, mode: "bottomup", map: [], current: null, log: [], survey: null, plan: null, support: null, stuck: null }));
  const goal = { id: "goalA", title: "단어 세기", done: "빈 딕셔너리에 단어 수를 센다" };
  const gp = await G.openGap("run1", { goal, unit: goal, from: "판정", wrong: "없는 키에 += 1을 바로 함", quote: "counts[w] += 1" });
  await G.addRemedy("run1", "goalA", "보충", "딕셔너리 키 확인 → get 기본값");
  await G.fillUnit("run1", "goalA", "counts[w] = counts.get(w, 0) + 1");
  let seenLedger = "";
  ai.setFakeAi((purpose: string, user: string) => {
    if (purpose === "goal-record") { seenLedger = user; return { summary: "단어 세기", steps: ["틀림", "보충", "맞음"], learned: [{ type: "방법", concept: "dict.get 기본값", meaning: "없으면 기본값", how: "직접 써 봄", quote: "counts.get(w, 0)" }],
      gaps: [{ type: "규칙", concept: "없는 키 읽기", wrong: "없는 키를 먼저 읽는 걸 몰랐음", right: "+=는 기존 값을 읽으므로 KeyError", quote: "counts[w] += 1", code: { save: "", from: 0, to: 0 }, ids: [gp!.id], recheck: { q: "scores = {}; scores['kim'] += 10 은 어떻게 될까요?", a: "KeyError. +=가 먼저 scores['kim']을 읽는데 없어서" } }],
      memory: { add: [], update: [], improved: [] } }; }
    if (purpose === "recheck-grade") return user.includes("모르겠") ? { verdict: "incorrect", same_mistake: true, note: "예전과 같아요" } : { verdict: "correct", same_mistake: false, note: "맞아요" };
    throw new Error(purpose);
  });
  const msgs = [{ role: "user", text: "counts[w] += 1", at: "2026-11-01T01:01:00.000Z" }, { role: "assistant", text: "없는 키를 읽으면?", at: "2026-11-01T01:02:00.000Z" }, { role: "user", text: "counts[w] = counts.get(w, 0) + 1", at: "2026-11-01T01:03:00.000Z" }];
  const rec = await R.recordGoal("run1", { ...goal, understood: true, applied: true, at: t0 }, "bottomup", msgs, (m) => `[${m.role}] ${m.text}`, undefined, [], await G.gapsForRecord("run1", "goalA", ["01:02 단어 세기: 일부만 맞음 · 학습자 답: \"counts[w] += 1\""]));
  assert.ok(seenLedger.includes(gp!.id) && seenLedger.includes("판정"), `정리 호출이 원장과 판정 기록을 본다: ${seenLedger.slice(-600)} / rec=${JSON.stringify(rec).slice(0, 300)}`);
  assert.equal(rec!.gaps![0].ids![0], gp!.id);
  await G.mergeRecord("run1", goal, rec!.gaps as never, rec!.to);
  const g = (await G.ledgerOf("run1"))[0];
  assert.equal(g.concept, "없는 키 읽기"); assert.equal(g.status, "세션에서 채움"); assert.ok(g.recheck);

  const run = { id: "run1", chatId: "c1", courseId: "hello-api", createdAt: t0, plan: { start: 1, stages: [1], quick: [], transfer: false, reasons: [], notes: [], minutes: 5 }, current: 1, workspaces: {}, stages: {} } as never;
  const course = await loadCourse("hello-api");
  let p = await pending("run1", course, run);
  const it = p.items.find((x) => x.title === "없는 키 읽기")!;
  assert.equal(it.state, "unknown"); assert.match(it.check!.q, /scores/);
  assert.ok(it.events.some((e) => e.kind === "note" && /채움 확인/.test(e.detail)));
  await markSent("run1", p.items.flatMap((i) => [i.key, ...i.events.map((e) => e.key), ...(i.checkKey ? [i.checkKey] : []), ...(i.mistakeKey ? [i.mistakeKey] : [])]));
  assert.equal((await pending("run1", course, run)).items.length, 0);

  let r = await G.answerRecheck("run1", g.id, "모르겠어요", (x) => G.gradeRecheck(x, "모르겠어요"));
  assert.equal(r.gap!.status, "다시 틀림");
  r = await G.answerRecheck("run1", g.id, "KeyError요, 먼저 읽어서", (x) => G.gradeRecheck(x, "KeyError요, 먼저 읽어서"));
  assert.equal(r.gap!.status, "다시 확인 맞음");
  p = await pending("run1", course, run);
  const kinds = p.items.find((x) => x.title === "없는 키 읽기")!.events.map((e) => e.kind);
  assert.deepEqual(kinds, ["wrong", "correct"], "실습에서 다시 확인한 결과가 앱 사건으로");
});
