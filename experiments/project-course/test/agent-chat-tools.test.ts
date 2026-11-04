import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-tool-flow-"));
process.env.PC_FAKE_AI = "1";
const { askChat, newChat, chatView, stopChat } = await import("../lib/agent-chat.ts");
const { toolProgress } = await import("../lib/tool-progress.ts");
const { CHAT_TOOL_CASES } = await import("../lib/agent-chat-testcases.ts");

test("테스트지는 노출된 7개 도구·학습 조정 5종·관찰 3종을 모두 포함한다", () => {
  const calls = CHAT_TOOL_CASES.flatMap((c) => c.calls);
  assert.deepEqual([...new Set(calls.map((c) => c.name))].sort(), ["read", "glob", "grep", "run_snippet", "get_learning_state", "get_course_material", "adjust_learning"].sort());
  assert.deepEqual([...new Set(calls.filter((c) => c.name === "adjust_learning").map((c) => c.args.action))].sort(), ["goal", "focus", "support", "return", "observe"].sort());
  assert.deepEqual([...new Set(calls.filter((c) => c.args.action === "observe").map((c) => c.args.kind))].sort(), ["understood", "confused", "misconception"].sort());
});

test("도구 실행 중 화면 조회에 진행이 보이고 안내·결과·설명이 순서대로 남는다", async () => {
  const s = await newChat();
  let start!: () => void, done!: () => void;
  const started = new Promise<void>((r) => { start = r; });
  const gate = new Promise<void>((r) => { done = r; });
  const task = askChat(s.id, "실행해 줘", async (io) => {
    await io.stream!("before", "예시를 실행해 볼게요."); io.streamed = true;
    await io.progress!(toolProgress("p1", "run_snippet", {}, "running")); start(); await gate;
    await io.progress!(toolProgress("p1", "run_snippet", {}, "completed"));
    await io.stream!("after", "실행 결과는 8이에요."); return "실행 결과는 8이에요.";
  });
  await started;
  const during = await chatView(s.id);
  assert.equal(during.busy, true);
  assert.equal(during.messages.find((m) => m.progress)?.progress?.status, "running");
  done(); const out = await task;
  assert.equal(out.busy, false);
  assert.deepEqual(out.messages.map((m) => m.text), ["실행해 줘", "예시를 실행해 볼게요.", "코드 실행 · 완료", "실행 결과는 8이에요."]);
});

test("실패·중단 뒤 진행 중 표시가 남지 않고 늦게 도착한 이전 답은 무시한다", async () => {
  const s = await newChat();
  await askChat(s.id, "실패 시험", async (io) => { await io.progress!(toolProgress("failed", "read", {}, "running")); throw new Error("시험 오류"); });
  assert.equal((await chatView(s.id)).messages.find((m) => m.progress)?.progress?.status, "failed");
  let begin!: () => void, finish!: () => void;
  const started = new Promise<void>((r) => { begin = r; }); const gate = new Promise<void>((r) => { finish = r; });
  let late!: (key: string, text: string) => Promise<void>;
  const task = askChat(s.id, "중단 시험", async (io) => { late = io.stream!; await io.progress!(toolProgress("cancel", "grep", {}, "running")); begin(); await gate; return ""; });
  await started; await stopChat(s.id); finish(); await task;
  await late("late", "오래된 답변");
  const out = await chatView(s.id);
  assert.equal(out.messages.find((m) => m.progress?.id === "cancel")?.progress?.status, "cancelled");
  assert.ok(!out.messages.some((m) => m.progress?.status === "running" || m.text === "오래된 답변"));
});

test("실제 OpenCode와 가짜 모델로 테스트지 20문항의 모든 도구·성공·실패 경로를 호출한다", { timeout: 180000, skip: Number(process.versions.node.split(".")[0]) < 24 }, async () => {
  const source = `
    import assert from 'node:assert/strict';
    import { newChat, askChat, adjustLearning, chatDebug } from './lib/agent-chat.ts';
    import { CHAT_TOOL_CASES } from './lib/agent-chat-testcases.ts';
    try {
      for (const c of CHAT_TOOL_CASES) {
        const s = await newChat();
        if (c.setup === 'support') {
          await askChat(s.id, '준비: 함수를 보다가 매개변수에서 막혔어요', async () => '매개변수를 보충해요.');
          await adjustLearning(s.id, {action:'focus',text:'함수'});
          await adjustLearning(s.id, {action:'support',text:'매개변수'});
        }
        const out = await askChat(s.id, '[도구시험:' + c.id + '] ' + c.question);
        const debug = await chatDebug(s.id);
        const events = debug.trace.toolEvents ?? [];
        const running = events.filter(e => e.status === 'running');
        const ended = events.filter(e => e.status !== 'running');
        assert.deepEqual(running.map(e => e.tool), c.calls.map(e => e.name), c.id + ' 호출 목록');
        assert.deepEqual(ended.map(e => e.status), c.statuses ?? c.calls.map(() => 'completed'), c.id + ' 종료 상태 ' + JSON.stringify(events));
        assert.equal(out.busy, false);
        assert.ok(!out.messages.some(m => m.progress?.status === 'running'), c.id + ' 남은 실행 상태');
        assert.ok(!out.messages.some(m => m.role === 'error'), c.id + ' 엔진 오류 ' + JSON.stringify(out.messages));
        for (const event of running) {
          const position = out.messages.findIndex(m => m.progress?.id === event.id);
          assert.ok(out.messages.slice(0, position).some(m => m.role === 'assistant' && m.key), c.id + ' 도구 전 안내 순서');
        }
        const modelTools = debug.trace.requests[0]?.body.tools.map(t => t.function.name).sort();
        assert.deepEqual(modelTools, ['adjust_learning','get_course_material','get_learning_state','glob','grep','read','run_snippet'].sort(), c.id + ' 허용 도구');
        const outputs = JSON.stringify(debug.trace.requests.at(-1)?.body.messages.filter(m => m.role === 'tool'));
        if (c.id === 'T01') assert.match(outputs, /sendJson/);
        if (c.id === 'T02') assert.match(outputs, /hello.ts/);
        if (c.id === 'T03') assert.match(outputs, /sendJson/);
        if (c.id === 'T04') assert.ok(out.messages.some(m => m.text.includes('[ 4, 8 ]')));
        if (c.id === 'T06') assert.match(outputs, /src\\/app.ts/);
        if (c.id === 'T07') assert.equal(out.goal, 'HTTP 요청과 응답 이해하기');
        if (c.id === 'T08') assert.equal(out.focus, '함수 만들기와 호출');
        if (c.id === 'T09' || c.id === 'N04' || c.id === 'N05') assert.equal(out.support.length, 1);
        if (c.id === 'T10') { assert.equal(out.support.length, 0); assert.equal(out.focus, '함수'); }
        if (['T11','T12','T13'].includes(c.id)) { assert.equal(out.observations.length, 1); assert.equal(out.observations[0].verified, false); }
        if (c.id === 'N03') assert.equal(out.observations.length, 0);
        console.log('CASE_OK ' + c.id + ' ' + running.map(e => e.tool).join(','));
      }
      console.log('ALL_20_TOOL_CASES_OK'); process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
  `;
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module"], { cwd: new URL("..", import.meta.url), env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(output)); }, 160000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); }); child.on("exit", (code) => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end(source);
  });
  assert.equal(result.code, 0, result.output); assert.match(result.output, /ALL_20_TOOL_CASES_OK/);
  console.log(result.output.split("\n").filter((line) => line.startsWith("CASE_OK")).join("\n"));
});
