import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-chat-test-"));
process.env.PC_FAKE_AI = "1";
const { newChat, askChat, chatOf, chatView, adjustLearning, chatTool, chatDebug, chatPrompts, saveChatPrompts, restartChat, CHAT_PROMPTS } = await import("../lib/agent-chat.ts");
const { runs } = await import("../lib/store.ts");
const { shapeRequest, SYSTEM } = await import("../lib/oc-engine.ts");
const { CHAT_SYSTEM } = await import("../lib/agent-chat-policy.ts");

test("실험 기록은 진도 기록과 분리되고, 정해진 코스 자료는 없다(11/11 뺌)", async () => {
  const s = await newChat();
  assert.equal((await runs()).runs.length, 0);
  assert.equal(await chatTool(s.id, "get_course_material", {}), "정해진 코스는 없어요.");
  await assert.rejects(chatOf("../runs"), /올바르지/);
});

test("보충 복귀는 새 학습자 답과 실제 인용을 요구하고 같은 답으로 위 칸까지 닫지 못한다", async () => {
  const s = await newChat();
  const run = async () => "설명했어요.";
  await askChat(s.id, "화살표 함수를 모르겠어요", run);
  await adjustLearning(s.id, { action: "support", text: "함수" });
  await adjustLearning(s.id, { action: "support", text: "매개변수" });
  await assert.rejects(adjustLearning(s.id, { action: "support", text: "함 수" }), /이미 보는/);
  const top = (await chatOf(s.id)).support.at(-1)!;
  const firstUser = (await chatOf(s.id)).messages.find((m) => m.role === "user")!.id; // 11/4: 첫 인사 없이 시작하므로 id를 직접 찾는다
  await assert.rejects(adjustLearning(s.id, { action: "return", text: "알았음", supportId: top.id, evidenceMessageId: firstUser, evidence: "화살표 함수를 모르겠어요" }), /연 뒤/);
  await askChat(s.id, "매개변수는 함수가 받는 값의 이름이에요", run);
  const message = (await chatOf(s.id)).messages.filter((m) => m.role === "user").at(-1)!;
  await assert.rejects(adjustLearning(s.id, { action: "observe", text: "이해", kind: "understood", evidenceMessageId: message.id, evidence: "지어낸 답" }), /인용/);
  await adjustLearning(s.id, { action: "observe", text: "매개변수의 역할을 설명함", kind: "understood", evidenceMessageId: message.id, evidence: "함수가 받는 값의 이름" });
  const st = await adjustLearning(s.id, { action: "return", text: "역할을 설명함", supportId: top.id, evidenceMessageId: message.id, evidence: "함수가 받는 값의 이름" });
  assert.equal(st.observations[0].verified, false);
  assert.equal(st.focus, "함수");
  await assert.rejects(adjustLearning(s.id, { action: "return", text: "연속 닫기", supportId: st.support.at(-1)!.id, evidenceMessageId: message.id, evidence: "함수가 받는 값의 이름" }), /연 뒤/);
  await assert.rejects(adjustLearning(s.id, { action: "return", text: "오래된 칸", supportId: top.id, evidenceMessageId: message.id, evidence: "함수가 받는 값의 이름" }), /id가 달라/);
});

test("응답 중 재진입을 막고 스트리밍 메시지와 도구 상태를 저장한다", async () => {
  const s = await newChat();
  let begin!: () => void, finish!: () => void;
  const started = new Promise<void>((r) => { begin = r; });
  const gate = new Promise<void>((r) => { finish = r; });
  const task = askChat(s.id, "함수를 볼래요", async (io) => {
    begin(); await gate;
    await io.learningChat!.execute("adjust_learning", { action: "focus", text: "함수 만들기와 호출" });
    await io.stream!("answer", "함수를 만들면"); await io.stream!("answer", "함수를 만들면 나중에 부를 수 있어요."); io.streamed = true;
    return "함수를 만들면 나중에 부를 수 있어요.";
  });
  await started;
  assert.equal((await chatView(s.id)).busy, true);
  await assert.rejects(askChat(s.id, "새 질문", async () => "실행되면 안 됨"), /답하는 중/);
  await assert.rejects(restartChat(s.id), /답하는 중/);
  finish(); const out = await task;
  assert.equal(out.busy, false);
  assert.equal(out.focus, "함수 만들기와 호출");
  assert.equal(out.messages.filter((m) => m.key).length, 1);
  assert.equal(out.messages.at(-1)!.text, "함수를 만들면 나중에 부를 수 있어요.");
});

test("실험 지시문은 기존 수업 지시문과 분리되고 오류 뒤 다시 대화할 수 있다", async () => {
  const req = shapeRequest({ instructions: SYSTEM + "\n# Your Model\nold" }, true, true);
  assert.equal(req.instructions, CHAT_SYSTEM);
  assert.equal(req.reasoning.effort, "low");
  const s = await newChat();
  await askChat(s.id, "질문", async () => { throw new Error("가짜 엔진 오류"); });
  assert.equal((await chatView(s.id)).busy, false);
  assert.equal((await chatOf(s.id)).messages.at(-1)!.role, "error");
  let recent = "";
  await askChat(s.id, "다시 질문", async (io) => { recent = io.parts!.recent; return "다시 답했어요"; });
  assert.match(recent, /가짜 엔진 오류/);
});

test("OpenCode 가짜 모델이 실제 학습 도구를 호출하고 답을 저장한다", { timeout: 60000, skip: Number(process.versions.node.split(".")[0]) < 24 }, async () => {
  const source = `
    import assert from 'node:assert/strict';
    import { newChat, askChat, chatDebug } from './lib/agent-chat.ts';
    try {
      const s = await newChat();
      const out = await askChat(s.id, '학습 도구 연결 시험');
      assert.equal(out.focus, '학습 도구 연결 확인');
      assert.equal(out.busy, false);
      assert.ok(out.messages.some(m => m.role === 'tool' && m.text.includes('학습 도구 연결 확인')));
      assert.ok(out.messages.some(m => m.role === 'assistant' && m.key));
      assert.ok(!out.messages.some(m => m.role === 'error'), JSON.stringify(out.messages));
      const debug = await chatDebug(s.id);
      assert.ok(debug.trace.requests.length >= 2, '도구 전후 실제 요청을 각각 저장');
      assert.ok(debug.trace.requests[0].body.messages[0].content.includes('AI 튜터'));
      assert.ok(debug.trace.requests[0].body.tools.some(t => t.function.name === 'adjust_learning'));
      assert.ok(debug.trace.requests[1].body.messages.some(m => m.role === 'tool'));
      assert.ok(!JSON.stringify(debug.trace).includes('authorization'));
      console.log('OPENCODE_CHAT_TOOLS_OK'); process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
  `;
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module"], { cwd: new URL("..", import.meta.url), env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`가짜 모델 연결 시간 초과: ${output}`)); }, 50000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end(source);
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /OPENCODE_CHAT_TOOLS_OK/);
});

test("프롬프트 편집은 다음 질문에 적용하고 세션을 바꾸되 대화를 유지한다", async () => {
  const s = await newChat();
  let first = "", second = "";
  await askChat(s.id, "첫 질문", async (io) => { first = io.sessKey!; return "첫 답변"; });
  try {
    await saveChatPrompts({ system: "편집한 튜터 지시", fixed: "편집한 코스 맥락", turn: "상태: {state}\n번호: {messageId}" });
    await askChat(s.id, "두 번째 질문", async (io) => {
      second = io.sessKey!;
      assert.equal(io.learningChat!.system, "편집한 튜터 지시");
      assert.match(io.parts!.turn, /번호: \d+/);
      assert.match(io.parts!.recent, /첫 답변/);
      await io.learningChat!.capture!({ instructions: io.learningChat!.system, input: [{ role: "user", content: "두 번째 질문" }] });
      return "새 지시로 답변";
    });
    assert.notEqual(first, second);
    const debug = await chatDebug(s.id);
    assert.equal(debug.trace!.question, "두 번째 질문");
    assert.equal(debug.trace!.requests[0].body.instructions, "편집한 튜터 지시");
    assert.ok(debug.layout.length > 0);
    const blank = shapeRequest({ instructions: SYSTEM }, false, "");
    assert.equal(blank.instructions, "");
  } finally { await saveChatPrompts(CHAT_PROMPTS); }
});

test("코스 재시작은 이전 기록을 보존하고 상태·코드 폴더를 새로 만들며 편집 프롬프트는 유지한다", async () => {
  const s = await newChat();
  await askChat(s.id, "기존 대화", async () => "기존 답");
  await adjustLearning(s.id, { action: "support", text: "변수 보충" });
  try {
    await saveChatPrompts({ ...CHAT_PROMPTS, system: "재시작 뒤에도 유지할 지시" });
    const fresh = await restartChat(s.id);
    assert.notEqual(fresh.id, s.id);
    assert.notEqual(fresh.workspace, s.workspace);
    assert.equal(fresh.support.length, 0);
    assert.equal(fresh.observations.length, 0);
    assert.equal(fresh.messages.filter((m) => m.role === "user").length, 0);
    assert.ok((await chatOf(s.id)).messages.some((m) => m.text === "기존 대화"));
    assert.equal((await chatPrompts()).system, "재시작 뒤에도 유지할 지시");
    await assert.rejects(saveChatPrompts({ system: "x" }), /프롬프트/);
    await assert.rejects(saveChatPrompts({ ...CHAT_PROMPTS, fixed: "x".repeat(40001) }), /40,000/);
  } finally { await saveChatPrompts(CHAT_PROMPTS); }
});
