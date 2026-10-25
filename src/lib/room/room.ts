// 토론방 (2026-10-25): a tiny Discord-like room where the learner talks over plans with Claude, Codex and Gemini.
// Each bot is the CLI already signed in on this computer (claude -p, codex exec, gemini), run one turn at a time with
// the conversation so far, so the usage comes out of the subscriptions those CLIs are signed in with (Claude Max,
// ChatGPT Plus, Google AI Pro) — no API keys. Rooms live in the private data folder; exporting one to 협업/토론
// (the public repository) is the learner's explicit step.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const botIds = ["claude", "codex", "gemini"] as const;
export type BotId = (typeof botIds)[number];
export const botName: Record<BotId, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

export type Message = { id: string; at: string; from: "user" | "system" | BotId; text: string; ms?: number; error?: boolean };
export type Room = {
  id: string; title: string; createdAt: string; updatedAt: string;
  bots: BotId[]; readFiles: boolean; messages: Message[];
  /** The bot answering now, and the turns still waiting (shown as "생각 중" and a queue). */
  thinking: BotId | null; pending: BotId[];
};

/**
 * How each CLI is started. `{out}` is a file the CLI writes its last message to (codex prints its whole run to stdout);
 * the prompt always goes in on stdin, so nothing has to be quoted for the Windows shell. A `bots.json` in the rooms
 * folder overrides any of these, for flag names that change between CLI versions.
 */
export type BotCommand = { cmd: string; args: string[]; readArgs?: string[]; noReadArgs?: string[]; out?: boolean };
export const DEFAULT_COMMANDS: Record<BotId, BotCommand> = {
  claude: { cmd: "claude", args: ["-p", "--output-format", "text"], readArgs: ["--allowedTools", "Read,Grep,Glob"], noReadArgs: ["--disallowedTools", "Read,Grep,Glob,Bash,Edit,Write,WebFetch,WebSearch"] },
  codex: { cmd: "codex", args: ["exec", "-c", "mcp_servers.studyforge.enabled=false", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", "{out}", "-"], out: true },
  gemini: { cmd: "gemini", args: [] },
};

const roomsDir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "rooms");
const idPattern = /^room_[a-f0-9]{12}$/;
const fileOf = (id: string) => { if (!idPattern.test(id)) throw new RoomError(400, "방 ID가 올바르지 않습니다."); return path.join(roomsDir(), `${id}.json`); };
export class RoomError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

async function save(room: Room) {
  room.updatedAt = new Date().toISOString();
  await mkdir(roomsDir(), { recursive: true });
  const tmp = `${fileOf(room.id)}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(room, null, 2), { mode: 0o600 });
  await rename(tmp, fileOf(room.id));
}
export async function loadRoom(id: string): Promise<Room | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as Room; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listRooms() {
  let names: string[] = [];
  try { names = (await readdir(roomsDir())).filter((n) => /^room_[a-f0-9]{12}\.json$/.test(n)); } catch { return []; }
  const rooms = await Promise.all(names.map((n) => loadRoom(n.slice(0, -5)).catch(() => null)));
  return rooms.filter((r): r is Room => Boolean(r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, messages: r.messages.length, working: Boolean(r.thinking) }));
}
export async function createRoom(title: string, bots: BotId[] = [...botIds], readFiles = false) {
  const now = new Date().toISOString();
  const room: Room = { id: `room_${randomBytes(6).toString("hex")}`, title: title.trim().slice(0, 120) || "새 토론", createdAt: now, updatedAt: now, bots, readFiles, messages: [], thinking: null, pending: [] };
  await save(room);
  return room;
}
export async function updateRoom(id: string, change: { title?: string; bots?: BotId[]; readFiles?: boolean }) {
  const room = await mustLoad(id);
  if (change.title !== undefined) room.title = change.title.trim().slice(0, 120) || room.title;
  if (change.bots) room.bots = botIds.filter((b) => change.bots!.includes(b));
  if (change.readFiles !== undefined) room.readFiles = change.readFiles;
  await save(room);
  return room;
}
async function mustLoad(id: string) { const room = await loadRoom(id); if (!room) throw new RoomError(404, "방을 찾을 수 없습니다."); return room; }
const message = (from: Message["from"], text: string, extra: Partial<Message> = {}): Message => ({ id: randomBytes(5).toString("hex"), at: new Date().toISOString(), from, text, ...extra });

// ---- who speaks -------------------------------------------------------------------------------------------------
const MENTIONS: Array<[RegExp, BotId]> = [[/@(claude|클로드)/i, "claude"], [/@(codex|코덱스|gpt)/i, "codex"], [/@(gemini|제미나이|제미니)/i, "gemini"]];
/** Bots named in a message (@claude, @코덱스 …), in the order they appear. */
export function mentionsOf(text: string): BotId[] {
  return MENTIONS.map(([re, id]) => ({ id, at: text.search(re) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at).map((m) => m.id);
}

/** The prompt one turn gets: who it is, the room's rules, the topic, and the conversation (the latest part, in full). */
export function promptFor(room: Room, bot: BotId, limit = 24) {
  const others = room.bots.filter((b) => b !== bot).map((b) => botName[b]).join(", ") || "없음";
  const shown = room.messages.filter((m) => m.from !== "system").slice(-limit);
  const skipped = room.messages.filter((m) => m.from !== "system").length - shown.length;
  const who = (m: Message) => m.from === "user" ? "사용자" : botName[m.from as BotId];
  return [
    `너는 ${botName[bot]}다. 이 방은 사용자와 AI 여럿(${botName[bot]}, ${others})이 사용자의 프로젝트(Recaller, 이 저장소) 기획을 함께 토론하는 채팅방이다.`,
    "규칙: 3~4문장으로 짧게 대화체로 쓴다(제목·목록 없이). 직전 발언에 바로 반응한다. 동의만 하지 말고 근거를 들어 반박하거나 보완하고, 새 관점이 있으면 하나 더한다. 사용자의 말이 있으면 그것을 먼저 다룬다. 다른 AI의 이름을 불러도 된다.",
    room.readFiles ? "근거가 필요하면 현재 폴더(저장소)의 문서와 코드를 읽어도 된다. 파일은 고치지 않는다." : "파일을 열거나 명령을 실행하지 말고 대화만으로 답한다.",
    "",
    `[주제] ${room.title}`,
    "[대화]",
    ...(skipped > 0 ? [`(앞의 대화 ${skipped}개 생략)`] : []),
    ...(shown.length ? shown.map((m) => `${who(m)}: ${m.text.length > 1500 ? `${m.text.slice(0, 1500)}…` : m.text}`) : ["(아직 없음. 주제에 대한 첫 의견을 낸다.)"]),
    "",
    `[${botName[bot]} 차례] 네 말만 쓴다.`,
  ].join("\n");
}
const SUMMARY = "지금까지의 토론을 정리한다. 세 덩어리로, 각 1~3줄: '합의:' 모두 동의한 것, '쟁점:' 아직 갈린 것과 각자의 입장, '사용자가 정할 것:' 결정이 필요한 질문. 다른 말은 쓰지 않는다.";

// ---- running a CLI ------------------------------------------------------------------------------------------------
export type Exec = (bot: BotId, command: BotCommand, prompt: string, signal: AbortSignal) => Promise<string>;
const TURN_MS = 120_000;
async function commands(): Promise<Record<BotId, BotCommand>> {
  try { return { ...DEFAULT_COMMANDS, ...(JSON.parse(await readFile(path.join(roomsDir(), "bots.json"), "utf8")) as Partial<Record<BotId, BotCommand>>) }; }
  catch { return DEFAULT_COMMANDS; }
}
const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
/** Runs a CLI with the prompt on stdin; codex's last message comes from its output file. Plain text back, trimmed. */
export const runCli: Exec = async (_bot, command, prompt, signal) => {
  const out = command.out ? path.join(os.tmpdir(), `room-${randomBytes(6).toString("hex")}.txt`) : "";
  const args = command.args.map((a) => a.replace("{out}", out));
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    try { child = spawn([command.cmd, ...args].map(quote).join(" "), { shell: true, cwd: process.cwd(), windowsHide: true, env: { ...process.env, NO_COLOR: "1" } }); }
    catch (error) { reject(error); return; }
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; if (stdout.length > 200_000) stdout = stdout.slice(-200_000); });
    child.stderr?.on("data", (d) => { stderr += d; if (stderr.length > 20_000) stderr = stderr.slice(-20_000); });
    const kill = () => { try { if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }); else child.kill("SIGTERM"); } catch { /* gone */ } };
    const timer = setTimeout(() => { kill(); reject(new Error(`${Math.round(TURN_MS / 1000)}초 안에 답이 없어 건너뛰었어요.`)); }, TURN_MS);
    signal.addEventListener("abort", () => { kill(); reject(new Error("멈췄어요.")); }, { once: true });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", async (code) => {
      clearTimeout(timer);
      let text = stdout;
      if (out) { try { text = await readFile(out, "utf8"); } catch { /* fall back to stdout */ } await rm(out, { force: true }).catch(() => undefined); }
      text = text.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (code !== 0 && !text) reject(new Error(stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300) || `${command.cmd}가 코드 ${code}로 끝났어요.`));
      else resolve(text);
    });
    child.stdin?.end(prompt);
  });
};

/** Which CLIs answer `--version` here (checked at most once a minute). */
let available: { at: number; bots: Record<BotId, boolean> } | null = null;
export async function availability(exec: (cmd: string) => Promise<boolean> = versionOk) {
  if (available && Date.now() - available.at < 60_000) return available.bots;
  const cmds = await commands();
  const entries = await Promise.all(botIds.map(async (b) => [b, await exec(cmds[b].cmd)] as const));
  available = { at: Date.now(), bots: Object.fromEntries(entries) as Record<BotId, boolean> };
  return available.bots;
}
function versionOk(cmd: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(`${quote(cmd)} --version`, { shell: true, windowsHide: true });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 15_000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

// ---- turns ------------------------------------------------------------------------------------------------------
type Worker = { queue: Array<BotId | "summary">; working: boolean; abort?: AbortController };
const workers: Map<string, Worker> = ((globalThis as { __roomWorkers?: Map<string, Worker> }).__roomWorkers ??= new Map<string, Worker>());
let exec: Exec = runCli;
/** Tests swap the CLI runner for a fake. */
export function setExec(next: Exec | null) { exec = next ?? runCli; }

async function work(id: string) {
  const w = workers.get(id)!;
  if (w.working) return;
  w.working = true;
  try {
    while (w.queue.length) {
      const turn = w.queue.shift()!;
      const room = await mustLoad(id);
      const bot: BotId = turn === "summary" ? (room.bots[0] ?? "claude") : turn;
      if (turn !== "summary" && !room.bots.includes(bot)) continue;
      room.thinking = bot; room.pending = w.queue.filter((t): t is BotId => t !== "summary"); await save(room);
      const cmds = await commands();
      const command = { ...cmds[bot], args: [...cmds[bot].args, ...((room.readFiles ? cmds[bot].readArgs : cmds[bot].noReadArgs) ?? [])] };
      const prompt = turn === "summary" ? `${promptFor(room, bot, 60).split("\n[" + botName[bot] + " 차례]")[0]}\n\n${SUMMARY}` : promptFor(room, bot);
      w.abort = new AbortController();
      const started = Date.now();
      let said: Message;
      try {
        const text = await exec(bot, command, prompt, w.abort.signal);
        said = message(turn === "summary" ? "system" : bot, turn === "summary" ? `정리 (${botName[bot]})\n${text}` : text || "(빈 답)", { ms: Date.now() - started });
      } catch (error) {
        said = message(bot, `답하지 못했어요: ${error instanceof Error ? error.message : String(error)}`, { ms: Date.now() - started, error: true });
      }
      const after = await mustLoad(id);
      after.messages.push(said);
      after.thinking = null; after.pending = w.queue.filter((t): t is BotId => t !== "summary");
      await save(after);
      if (w.abort.signal.aborted) break;
    }
  } finally {
    w.working = false; w.queue = []; w.abort = undefined;
    const room = await loadRoom(id);
    if (room && (room.thinking || room.pending.length)) { room.thinking = null; room.pending = []; await save(room); }
  }
}
function enqueue(id: string, turns: Array<BotId | "summary">) {
  const w = workers.get(id) ?? { queue: [], working: false };
  workers.set(id, w);
  w.queue.push(...turns);
  return work(id);
}

/** The learner says something. Named bots answer, in order; otherwise each bot in the room answers once. */
export async function say(id: string, text: string) {
  const room = await mustLoad(id);
  const clean = text.trim().slice(0, 4000);
  if (!clean) throw new RoomError(400, "보낼 말이 없어요.");
  room.messages.push(message("user", clean));
  await save(room);
  const named = mentionsOf(clean).filter((b) => room.bots.includes(b));
  const w = workers.get(id);
  // While an automatic run goes on, the line joins the conversation and the next speaker answers it.
  const done = w?.working && !named.length ? Promise.resolve() : enqueue(id, named.length ? named : room.bots);
  return { room, done };
}
/** Bots take turns for a number of rounds (each bot speaks once per round). */
export async function runRounds(id: string, rounds: number) {
  const room = await mustLoad(id);
  const n = Math.max(1, Math.min(10, Math.floor(rounds)));
  const done = enqueue(id, Array.from({ length: n }, () => room.bots).flat());
  return { room, done };
}
export async function summarize(id: string) { await mustLoad(id); return { done: enqueue(id, ["summary"]) }; }
export async function stop(id: string) {
  const w = workers.get(id);
  // A running worker writes the stopped turn and clears the room itself; saving here too would race it and drop that line.
  if (w?.working) { w.queue = []; w.abort?.abort(); return mustLoad(id); }
  const room = await mustLoad(id);
  room.thinking = null; room.pending = []; await save(room);
  return room;
}

/** The room as markdown, for 협업/토론 (the public repository: only the conversation, which the learner chose to export). */
export function markdown(room: Room) {
  const who = (m: Message) => m.from === "user" ? "사용자" : m.from === "system" ? "정리" : botName[m.from];
  return [`# 토론: ${room.title}`, "", `- 날짜: ${room.createdAt.slice(0, 10)}`, `- 참여: 사용자, ${room.bots.map((b) => botName[b]).join(", ")}`, "",
    ...room.messages.map((m) => `**${who(m)}**${m.ms ? ` (${(m.ms / 1000).toFixed(0)}초)` : ""}: ${m.text.replace(/\n/g, "  \n")}`), ""].join("\n\n").replace(/\n{3,}/g, "\n\n");
}
export async function exportRoom(id: string, root = process.cwd()) {
  const room = await mustLoad(id);
  const slug = room.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "토론";
  const file = path.join(root, "협업", "토론", `${room.createdAt.slice(0, 10).replace(/-/g, "")}_${slug}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, markdown(room));
  return path.relative(root, file);
}
