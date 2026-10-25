import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRoom, exportRoom, loadRoom, mentionsOf, promptFor, runRounds, say, setExec, stop, summarize, type BotId } from "./room.ts";

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
  setExec(fake(calls));
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
