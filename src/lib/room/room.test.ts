import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { argsFor, createRoom, DEFAULT_COMMANDS, exportRoom, loadRoom, mentionsOf, promptFor, runRounds, say, setExec, stop, summarize, updateRoom, type BotId } from "./room.ts";

async function withData<T>(run: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "room-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(dir); } finally {
    setExec(null);
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}
// A fake CLI: answers with its name and the last line it was shown, so turn order and context are visible.
const fake = (calls: Array<{ bot: BotId; prompt: string }>) => async (bot: BotId, _c: unknown, prompt: string) => {
  calls.push({ bot, prompt });
  const last = prompt.split("\n").filter((l) => /^(사용자|Claude|Codex|Gemini): /.test(l)).at(-1) ?? "(처음)";
  return `${bot} 답: ${last.slice(0, 30)}`;
};

test("mentions pick who answers, in the order they are named", () => {
  assert.deepEqual(mentionsOf("@코덱스 그리고 @claude 어때?"), ["codex", "claude"]);
  assert.deepEqual(mentionsOf("그냥 말"), []);
  assert.deepEqual(mentionsOf("@제미나이"), ["gemini"]);
});

test("a learner's line gets one answer from each bot, each seeing what was said before it", () => withData(async () => {
  const calls: Array<{ bot: BotId; prompt: string }> = [];
  setExec(async (bot, command, prompt) => {
    if (bot === "codex") {
      const option = command.args.indexOf("mcp_servers.studyforge.enabled=false");
      assert.ok(option > 0);
      assert.equal(command.args[option - 1], "-c", "room Codex skips the optional Study Forge MCP without changing global config");
    } else assert.ok(!command.args.includes("mcp_servers.studyforge.enabled=false"));
    return fake(calls)(bot, command, prompt);
  });
  const room = await createRoom("발표 주장 정하기");
  await (await say(room.id, "검증이 핵심 아님?")).done;
  const after = (await loadRoom(room.id))!;
  assert.deepEqual(after.messages.map((m) => m.from), ["user", "claude", "codex", "gemini"]);
  assert.match(calls[1].prompt, /Claude: claude 답/, "Codex sees Claude's answer");
  assert.match(calls[0].prompt, /\[주제\] 발표 주장 정하기/);
  assert.match(calls[0].prompt, /파일을 열거나/, "files off by default");
  assert.equal(after.thinking, null);
}));

test("named bots alone answer; rounds go around; a summary closes; export writes markdown", () => withData(async (dir) => {
  const calls: Array<{ bot: BotId; prompt: string }> = [];
  setExec(fake(calls));
  const room = await createRoom("속도");
  await (await say(room.id, "@gemini 먼저")).done;
  assert.deepEqual((await loadRoom(room.id))!.messages.map((m) => m.from), ["user", "gemini"]);
  await (await runRounds(room.id, 2)).done;
  assert.equal((await loadRoom(room.id))!.messages.length, 2 + 6);
  await (await summarize(room.id)).done;
  const last = (await loadRoom(room.id))!.messages.at(-1)!;
  assert.equal(last.from, "system");
  assert.match(calls.at(-1)!.prompt, /합의:/);
  const file = await exportRoom(room.id, dir);
  assert.match(await readFile(path.join(dir, file), "utf8"), /# 토론: 속도/);
}));

test("a failing CLI shows as an error line and the next bot still speaks; stop empties the queue", () => withData(async () => {
  setExec(async (bot) => { if (bot === "codex") throw new Error("codex가 없어요"); return `${bot} ok`; });
  const room = await createRoom("오류");
  await (await say(room.id, "시작")).done;
  const messages = (await loadRoom(room.id))!.messages;
  assert.ok(messages.some((m) => m.from === "codex" && m.error && /codex가 없어요/.test(m.text)));
  assert.equal(messages.at(-1)!.from, "gemini");
  const slow: Promise<void>[] = [];
  setExec((_bot, _c, _p, signal) => new Promise<string>((resolve, reject) => { const t = setTimeout(() => resolve("늦은 답"), 5000); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("멈췄어요.")); }); }));
  slow.push((await runRounds(room.id, 3)).done);
  await new Promise((r) => setTimeout(r, 50));
  await stop(room.id);
  await Promise.all(slow);
  const stopped = (await loadRoom(room.id))!;
  assert.equal(stopped.thinking, null);
  assert.equal(stopped.pending.length, 0);
  assert.match(stopped.messages.at(-1)!.text, /멈췄어요/);
}));

test("long conversations keep the latest turns in full and say how many were left out", () => {
  const room = { id: "room_000000000000", title: "t", createdAt: "", updatedAt: "", bots: ["claude", "codex"] as BotId[], readFiles: true, thinking: null, pending: [],
    messages: Array.from({ length: 30 }, (_, i) => ({ id: String(i), at: "", from: "user" as const, text: `말 ${i}` })) };
  const p = promptFor(room, "claude");
  assert.match(p, /앞의 대화 6개 생략/);
  assert.match(p, /사용자: 말 29/);
  assert.doesNotMatch(p, /사용자: 말 5\n/);
  assert.match(p, /저장소\)의 문서와 코드를 읽어도/);
});

test("AIs hand the word on with @name, a few times at most, with a pause; answers are kept short", () => withData(async () => {
  const calls: Array<{ bot: BotId; prompt: string; at: number }> = [];
  // Claude names Codex, Codex names Gemini, Gemini names Claude … a loop the hand-off limit has to end.
  const nextOf: Record<BotId, string> = { claude: "@Codex", codex: "@제미나이", gemini: "@claude" };
  setExec(async (bot, _c, prompt) => { calls.push({ bot, prompt, at: Date.now() }); return `${bot} 생각 ${"가".repeat(800)} ${nextOf[bot]} 어때?`; });
  const room = await createRoom("손넘기기");
  await updateRoom(room.id, { settings: { chainMax: 3, delaySec: 0.05, maxChars: 100 } });
  await (await say(room.id, "@claude 시작")).done;
  const after = (await loadRoom(room.id))!;
  assert.deepEqual(after.messages.map((m) => m.from), ["user", "claude", "codex", "gemini", "claude"], "three hand-offs, then it stops");
  assert.ok(after.messages[1].text.length <= 160 && after.messages[1].text.endsWith("… @Codex"), `cut at 1.5× the length, keeping the hand-off: ${after.messages[1].text.slice(-20)}`);
  assert.match(calls[0].prompt, /100자 이내/);
  assert.match(calls[0].prompt, /@Codex 또는 @Gemini/);
  assert.ok(calls[1].at - calls[0].at >= 40, "waits between AI turns");
  // In rounds, naming someone does not add turns.
  calls.length = 0;
  await (await runRounds(room.id, 1)).done;
  assert.deepEqual(calls.map((c) => c.bot), ["claude", "codex", "gemini"]);
}));

test("model and effort flags go where the command wants them", () => {
  const codex = argsFor(DEFAULT_COMMANDS.codex, { model: "gpt-5", effort: "high" }, false, "/tmp/o.txt");
  assert.deepEqual(codex, ["exec", "-c", "mcp_servers.studyforge.enabled=false", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", "/tmp/o.txt", "-m", "gpt-5", "-c", "model_reasoning_effort=high", "-"]);
  const claude = argsFor(DEFAULT_COMMANDS.claude, { model: "", effort: "" }, true);
  assert.deepEqual(claude, ["-p", "--output-format", "text", "--allowedTools", "Read,Grep,Glob"]);
  assert.deepEqual(argsFor(DEFAULT_COMMANDS.gemini, { model: "gemini-2.5-pro", effort: "" }, false), ["-m", "gemini-2.5-pro"]);
});
