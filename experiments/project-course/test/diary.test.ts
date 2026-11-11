// 실습 일지(11/12): 장면 기록 → AI 한 번 → 한 줄 · 흐름(근거 번호) · 남은 것. 근거 번호 · 꼬리표 검사, 새 기록 없으면 다시 안 부름.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("실습 일지: 장면 기록을 번호 붙여 넘기고, 받은 흐름을 검사해 저장한다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-diary-"));
  process.env.PC_DATA_DIR = dir; process.env.PC_FAKE_AI = "1"; process.env.PC_DIARY = "0";
  await mkdir(path.join(dir, "goals"), { recursive: true });
  const R = "abc123";
  await writeFile(path.join(dir, "runs.json"), JSON.stringify({ runs: [{ id: R, courseId: "chat", chatId: "c1", createdAt: "2026-11-12T00:00:00Z", plan: {}, current: 1, workspaces: {}, stages: {} }], active: R }));
  const snap = (cur: string | null) => ({ long: "할 일 앱", mode: null, map: [], current: cur ? { title: cur, done: "", phase: "① 이해" } : null, support: null, survey: null, plan: null, stuck: null, memory: [], edit: null, autoCheck: true, records: 0 });
  const step = (n: number, trigger: object, reply: string, cur: string | null, changes: string[] = []) => ({ n, at: `2026-11-12T00:0${n}:00Z`, endAt: `2026-11-12T00:0${n}:30Z`, trigger, reply, tools: [], usage: null, changes, state: snap(cur) });
  const steps = [
    step(1, { kind: "message", label: "학습자", text: "할 일 앱 만들고 싶어" }, "좋아요, 먼저 목록부터 만들어 봐요.", "목록 만들기", ["현재 목표: 목록 만들기"]),
    step(2, { kind: "message", label: "학습자", text: "split 괄호 없어도 되지 않아?" }, "split은 메서드라서 괄호를 붙여야 실행돼요.", "목록 만들기"),
    step(3, { kind: "button", label: "해 봤어요", text: "판정: 맞음" }, "잘했어요.", "목록 만들기"),
  ];
  await writeFile(path.join(dir, "goals", `${R}.timeline.jsonl`), steps.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const { setFakeAi } = await import("../lib/ai.ts");
  let seen = "", calls = 0;
  setFakeAi((purpose, user) => { if (purpose !== "diary") return ""; calls++; seen = user; return { line: "할 일 앱 목록까지 만듦", story: [
    { g: 0, tag: "목표", doing: "시작", text: "할 일 앱 목록 만들기로 시작함" }, { g: 2, tag: "알게 됨", text: "split 괄호 헷갈렸음 → 메서드는 괄호 붙여야 실행" },
    { g: 999, tag: "해냄", text: "근거 번호가 없는 것" }, { g: 4, tag: "아무거나", text: "꼬리표가 틀린 것" }], left: ["저장하기"] }; });
  const D = await import("../lib/diary.ts");
  const d = await D.writeDiary(R, "시험");
  assert.ok(d);
  assert.match(seen, /\[0\] 나: 할 일 앱 만들고 싶어/);
  assert.match(seen, /== 현재 목표: 목록 만들기/);
  assert.equal(d!.story.length, 3, "꼬리표가 틀린 것은 버림");
  assert.equal(d!.story[2].g, null, "없는 근거 번호는 null");
  assert.deepEqual(d!.left, ["저장하기"]);
  // 새 기록이 없으면 다시 안 부른다
  await D.writeDiary(R, "다시");
  assert.equal(calls, 1);
  assert.equal((await D.diaryOf(R))!.line, "할 일 앱 목록까지 만듦");
});
