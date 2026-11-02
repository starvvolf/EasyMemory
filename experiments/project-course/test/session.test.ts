// 학습 진행 엔진 바탕(11/3): 걸음 → 행동, 임시 학습 스택, 학습 사건
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-session-"));
const { actionOfBeat, closeDetours, enterBeat, events, getSession, pushDetour, record, MAX_DETOUR } = await import("../lib/session.ts");

test("걸음 종류 → 행동", () => {
  assert.equal(actionOfBeat({ kind: "predict" }), "verify");
  assert.equal(actionOfBeat({ kind: "fix" }), "guide");
  assert.equal(actionOfBeat({ kind: "explain" }), "summarize");
  assert.equal(actionOfBeat({ kind: "say", actions: [{ do: "start_dev,try" }] }), "demo");
  assert.equal(actionOfBeat({ kind: "say", actions: [{ do: "next" }] }), "explain");
  assert.equal(actionOfBeat({ kind: "say" }, true), "summarize");
});

test("임시 학습: 쌓고, 깊으면 알리고, 돌아가면 처음 들어온 곳", async () => {
  const id = "r1";
  await enterBeat(id, 1, 4, "guide", "고치기");
  for (let i = 1; i <= MAX_DETOUR; i++) assert.equal((await pushDetour(id, { topic: `질문 ${i}`, reason: "질문", returnBeat: 4, returnLabel: "고치기" })).deep, false);
  assert.equal((await pushDetour(id, { topic: "질문 4", reason: "질문", returnBeat: 4, returnLabel: "고치기" })).deep, true);
  const back = await closeDetours(id);
  assert.equal(back?.returnLabel, "고치기");
  assert.equal((await getSession(id)).detours.length, 0);
  // 걸음이 바뀌면 임시 학습은 닫힌다
  await pushDetour(id, { topic: "또", reason: "질문", returnBeat: 4, returnLabel: "고치기" });
  await enterBeat(id, 1, 5, "summarize", "정리");
  const s = await getSession(id);
  assert.equal(s.detours.length, 0);
  assert.equal(s.activity.type, "summarize");
});

test("학습 사건: 덧붙이고 누가 했는지 남긴다", async () => {
  await record({ runId: "r2", stage: 1, type: "code_edit", actor: "agent", detail: "튜터가 고침" });
  await record({ runId: "r2", stage: 1, type: "application", actor: "user", concepts: ["h-status"], detail: "직접 고침" });
  const ev = await events("r2");
  assert.deepEqual(ev.map((e) => [e.type, e.actor]), [["code_edit", "agent"], ["application", "user"]]);
  assert.ok(ev.every((e) => e.id && e.at));
});

test("레벨(내부): 해냄 2번이면 오르고, 버거움 2번이면 내림", async () => {
  const { stageOutcome, getSession, knownSkip } = await import("../lib/session.ts");
  const id = "lv";
  await stageOutcome(id, { mode: "self", hints: 0, byTutor: false });
  assert.equal((await getSession(id)).level, 0);
  await stageOutcome(id, { mode: "self", hints: 1, byTutor: false });
  assert.equal((await getSession(id)).level, 1);
  await stageOutcome(id, { mode: "auto", hints: 0, byTutor: true });
  await stageOutcome(id, { mode: "self", hints: 3, byTutor: false });
  assert.equal((await getSession(id)).level, 0);
  // 처음(L0)에서 "알아요" 세 번이면 줄 읽기(L1)
  assert.equal(await knownSkip(id), false); assert.equal(await knownSkip(id), false); assert.equal(await knownSkip(id), true);
});

test("재개 요약: 20분 넘게 쉬었을 때만, 사실만 골라서, 본 뒤에는 안 보임", async () => {
  const { record, recap, recapSeen } = await import("../lib/session.ts");
  const id = "rc";
  await record({ runId: id, stage: 1, type: "question", actor: "user", detail: "query가 뭐예요?" });
  await record({ runId: id, stage: 1, type: "execution", actor: "system", detail: "검사(저장): 1/2 통과" });
  await record({ runId: id, stage: 1, type: "application", actor: "user", detail: "단계 검사 통과 · 직접 고침" });
  const names = { stageTitle: () => "이름 불러 인사하기", nowLabel: "2단계 · 방명록" };
  assert.equal(await recap(id, names), null);
  const r = await recap(id, names, Date.now() + 21 * 60 * 1000);
  assert.ok(r);
  assert.match(r.text, /1단계 "이름 불러 인사하기"/);
  assert.match(r.text, /query가 뭐예요/);
  assert.match(r.text, /기대와 달랐던 적: 1번/);
  assert.match(r.text, /2단계 · 방명록/);
  await recapSeen(id);
  assert.equal(await recap(id, names, Date.now() + 21 * 60 * 1000), null);
});
