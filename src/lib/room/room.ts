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

export type Message = { id: string; at: string; from: "user" | "system" | BotId; text: string; ms?: number; error?: boolean; model?: string };
/** Per bot: which model the CLI runs (empty: the CLI's own default) and, where the CLI has one, how hard it thinks. */
export type BotModel = { model: string; effort: string };
export type RoomSettings = {
  /** Answer length asked for, in characters (a longer answer is cut at 1.5× with "…"). */
  maxChars: number;
  /** Pause before a turn that follows another AI's turn, so a chain can be read as it happens. */
  delaySec: number;
  /** AIs may hand the word to another with @name; at most chainMax such hand-offs after each line of the learner. */
  chain: boolean; chainMax: number;
  models: Record<BotId, BotModel>;
  /** How the room talks: a preset (TONES) or the learner's own words, and 존댓말 or 반말. */
  tone: string; speech: "존댓말" | "반말";
  /** Each AI's character in this room (empty: PERSONAS). */
  personas: Record<BotId, string>;
};
export const TONES: Record<string, string> = {
  "편한 동료": "친한 팀 동료와 메신저로 얘기하듯 편하고 솔직하게. 가끔 가볍게 맞장구치거나 농담해도 된다.",
  "기획 회의": "기획 회의에서처럼 정돈되게, 핵심부터. 결론과 이유가 분명하게.",
  "날카로운 리뷰": "빈틈과 위험을 찾는 리뷰어처럼 날카롭게. 다만 무례하지 않게, 대안도 함께.",
  "멘토": "먼저 해 본 선배처럼 차근차근. 왜 그런지 이해되게 풀어서.",
};
export const PERSONAS: Record<BotId, string> = {
  claude: "생각이 깊고 차분하다. 전제와 숨은 가정을 짚고, 놓친 위험이나 사용자 입장을 챙긴다. 모르는 건 모른다고 한다.",
  codex: "실용적이고 직설적이다. 구현 가능성, 걸리는 시간과 비용, 지금 바로 할 수 있는 다음 행동으로 이야기를 끌고 간다.",
  gemini: "넓게 본다. 다른 서비스나 연구 사례, 새로운 각도의 아이디어를 가져온다.",
};
// Newest models as of 2026-10-25: Claude Code's "opus" alias follows the newest Opus (Opus 5.5); gpt-6.1-sol answered on
// this PC's Codex CLI after its update to 0.164 (docs/DECISIONS.md 2026-10-25).
export const DEFAULT_SETTINGS: RoomSettings = { maxChars: 300, delaySec: 2, chain: true, chainMax: 6, models: { claude: { model: "opus", effort: "" }, codex: { model: "gpt-6.1-sol", effort: "medium" }, gemini: { model: "", effort: "" } },
  tone: "편한 동료", speech: "존댓말", personas: { claude: "", codex: "", gemini: "" } };
export type Room = {
  id: string; title: string; createdAt: string; updatedAt: string;
  bots: BotId[]; readFiles: boolean; messages: Message[];
  /** The bot answering now, and the turns still waiting (shown as "생각 중" and a queue). */
  thinking: BotId | null; pending: BotId[];
  settings?: RoomSettings;
  /** What every turn should know besides the conversation (decisions made elsewhere, deadlines, constraints). */
  memo?: string;
};
/** Settings with defaults filled in (rooms made before settings existed have none). */
export function settingsOf(room: Pick<Room, "settings">): RoomSettings {
  const s = room.settings;
  return { ...DEFAULT_SETTINGS, ...s, models: Object.fromEntries(botIds.map((b) => [b, { ...DEFAULT_SETTINGS.models[b], ...s?.models?.[b] }])) as Record<BotId, BotModel>,
    personas: { ...DEFAULT_SETTINGS.personas, ...s?.personas } };
}

/**
 * How each CLI is started. `{out}` is a file the CLI writes its last message to (codex prints its whole run to stdout);
 * `{flags}` is where the model, effort and file flags go (at the end when absent). The prompt always goes in on stdin,
 * so nothing has to be quoted for the Windows shell. A `bots.json` in the rooms folder overrides any of these, for flag
 * names that change between CLI versions.
 */
export type BotCommand = { cmd: string; args: string[]; readArgs?: string[]; noReadArgs?: string[]; modelArgs?: string[]; effortArgs?: string[]; out?: boolean;
  /** Extra environment for this CLI only (bots.json), e.g. GOOGLE_CLOUD_PROJECT for a Gemini account that needs one. */
  env?: Record<string, string> };
export const DEFAULT_COMMANDS: Record<BotId, BotCommand> = {
  claude: { cmd: "claude", args: ["-p", "--output-format", "text"], modelArgs: ["--model", "{model}"],
    readArgs: ["--allowedTools", "Read,Grep,Glob"], noReadArgs: ["--disallowedTools", "Read,Grep,Glob,Bash,Edit,Write,WebFetch,WebSearch"] },
  codex: { cmd: "codex", args: ["exec", "-c", "mcp_servers.studyforge.enabled=false", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", "{out}", "{flags}", "-"], out: true,
    modelArgs: ["-m", "{model}"], effortArgs: ["-c", "model_reasoning_effort={effort}"] },
  // Gemini CLI no longer signs in personal Google accounts (2026-09, "migrate to the Antigravity suite"); its successor
  // `agy` takes the prompt only as an argument in print mode, so it runs without a shell (see runCli).
  gemini: { cmd: "agy", args: ["-p", "{prompt}", "--output-format", "text", "--disable-slash-commands", "--print-timeout", "110s"], modelArgs: ["--model", "{model}"], effortArgs: ["--effort", "{effort}"] },
};
/** Suggestions shown next to the model field (any name the CLI accepts works; empty keeps the CLI's default). */
export const MODEL_HINTS: Record<BotId, string[]> = {
  claude: ["opus", "sonnet", "haiku", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  codex: ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-astra", "gpt-6-luna"],
  gemini: [],
};
export const EFFORTS: Record<BotId, string[]> = { claude: [], codex: ["low", "medium", "high", "xhigh"], gemini: ["low", "medium", "high"] };
/** The arguments for one turn: the command's own, with model, effort and file flags where `{flags}` stands. */
export function argsFor(command: BotCommand, m: BotModel, readFiles: boolean, out = "") {
  const flags = [
    ...(m.model && command.modelArgs ? command.modelArgs.map((a) => a.replace("{model}", m.model)) : []),
    ...(m.effort && command.effortArgs ? command.effortArgs.map((a) => a.replace("{effort}", m.effort)) : []),
    ...((readFiles ? command.readArgs : command.noReadArgs) ?? []),
  ];
  const base = command.args.map((a) => a.replace("{out}", out));
  const at = base.indexOf("{flags}");
  return at < 0 ? [...base, ...flags] : [...base.slice(0, at), ...flags, ...base.slice(at + 1)];
}

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
export type SettingsChange = Partial<Omit<RoomSettings, "models" | "personas">> & { models?: Partial<Record<BotId, Partial<BotModel>>>; personas?: Partial<Record<BotId, string>> };
export async function updateRoom(id: string, change: { title?: string; bots?: BotId[]; readFiles?: boolean; memo?: string; settings?: SettingsChange; resetSettings?: boolean }) {
  const room = await mustLoad(id);
  if (change.resetSettings) room.settings = undefined;
  if (change.settings) {
    const now = settingsOf(room); const s = change.settings;
    room.settings = { ...now, ...s, models: Object.fromEntries(botIds.map((b) => [b, { ...now.models[b], ...s.models?.[b] }])) as Record<BotId, BotModel>,
      personas: { ...now.personas, ...s.personas } as Record<BotId, string> };
  }
  if (change.memo !== undefined) room.memo = change.memo.slice(0, 3000);
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

const MAKER: Record<BotId, string> = { claude: "Anthropic", codex: "OpenAI", gemini: "Google" };
/**
 * The prompt one turn gets. It reads like a group chat seen from one member: who they are and how they talk, what the
 * room should keep in mind, then the conversation, newest last. The room's name is where the talk started, not a
 * topic to come back to every turn (AIs kept steering back to the title).
 */
export function promptFor(room: Room, bot: BotId, limit = 24) {
  const s = settingsOf(room);
  const others = room.bots.filter((b) => b !== bot);
  const talk = room.messages.filter((m) => m.from !== "system" && !m.error);
  const shown = talk.slice(-limit);
  const skipped = talk.length - shown.length;
  const who = (m: Message) => m.from === "user" ? "사용자" : botName[m.from as BotId];
  const tone = TONES[s.tone] ?? s.tone;
  const handOff = s.chain && others.length
    ? `다른 AI의 생각을 꼭 듣고 싶으면 말 끝에 @${others.map((b) => botName[b]).join(" 또는 @")}처럼 한 명만 불러 넘겨도 된다. 할 말을 다 했거나 사용자에게 묻는 거라면 부르지 않는다.`
    : "";
  return [
    `너는 ${botName[bot]}(${MAKER[bot]})다. 지금 단체 채팅방에서 사용자${others.length ? `, ${others.map((b) => botName[b]).join(", ")}` : ""}와 이야기하고 있다. 사용자는 Recaller라는 AI 학습 앱(지금 이 폴더의 저장소)을 만들고 있는 대학생이다.`,
    "",
    `[너의 결] ${s.personas[bot]?.trim() || PERSONAS[bot]}`,
    `[말투] ${tone} 사용자에게도 다른 AI에게도 ${s.speech}로 말한다.`,
    "[대화하는 법]",
    "- 사람이 채팅하듯 자연스럽게 말한다. 보고서나 발표문처럼 쓰지 않는다. 필요하면 짧은 목록이나 **굵은 글씨**를 써도 된다.",
    "- 가장 최근 말, 특히 사용자의 마지막 말에 반응한다. 대화가 다른 쪽으로 흘렀으면 그 흐름을 따른다.",
    "- 다르게 보면 이유를 들어 분명히 말하고, 동의하면 짧게 하고 새 생각을 보탠다. 이미 나온 말을 되풀이하거나 정리해 주지 않는다.",
    "- 상대를 이름으로 부르거나, 사용자에게 되물어도 된다.",
    `- 길이는 ${s.maxChars}자 안팎. 이름표("${botName[bot]}:")는 붙이지 않는다.`,
    ...(handOff ? [`- ${handOff}`] : []),
    room.readFiles ? "- 근거가 필요하면 저장소의 문서와 코드를 읽어도 된다. 파일은 고치지 않는다." : "- 파일을 열거나 명령을 실행하지 말고 대화만으로 답한다.",
    ...(room.memo?.trim() ? ["", `[이 방에서 알고 있을 것]\n${room.memo.trim()}`] : []),
    "",
    `[방 이름] ${room.title} (대화를 시작한 계기일 뿐, 매번 돌아갈 주제는 아니다)`,
    "[지금까지의 대화]",
    ...(skipped > 0 ? [`(앞의 대화 ${skipped}개는 생략)`] : []),
    ...(shown.length ? shown.map((m) => `${who(m)}: ${m.text.length > 1500 ? `${m.text.slice(0, 1500)}…` : m.text}`) : ["(아직 아무도 말하지 않았다. 방 이름을 보고 가볍게 첫마디를 연다.)"]),
    "",
    `[${botName[bot]} 차례] ${botName[bot]}로서 다음 말만 쓴다.`,
  ].join("\n");
}
/** A name tag the model added anyway ("Claude: …") is taken off. */
export function untag(bot: BotId, text: string) { return text.replace(new RegExp(`^\\s*\\**${botName[bot]}\\**\\s*[:：]\\s*(\\*\\*\\s*)?`, "i"), "").trim(); }
const SUMMARY = "지금까지의 토론을 정리한다. 세 덩어리로, 각 1~3줄: '합의:' 모두 동의한 것, '쟁점:' 아직 갈린 것과 각자의 입장, '사용자가 정할 것:' 결정이 필요한 질문. 다른 말은 쓰지 않는다.";

// ---- running a CLI ------------------------------------------------------------------------------------------------
export type Exec = (bot: BotId, command: BotCommand, prompt: string, signal: AbortSignal) => Promise<string>;
const TURN_MS = 120_000;
async function commands(): Promise<Record<BotId, BotCommand>> {
  try { return { ...DEFAULT_COMMANDS, ...(JSON.parse(await readFile(path.join(roomsDir(), "bots.json"), "utf8")) as Partial<Record<BotId, BotCommand>>) }; }
  catch { return DEFAULT_COMMANDS; }
}
const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
/**
 * What a CLI's error output says, in a line: the message, not the stack trace under it, and for errors with a known
 * remedy, the remedy (Gemini signed in with an account that needs a Google Cloud project, or not signed in at all).
 */
export function explain(stderr: string) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (/no longer supported for Gemini Code Assist for individuals|Antigravity/i.test(stderr))
    return "Gemini CLI는 이제 개인 Google 계정 로그인을 받지 않아요. Antigravity CLI(agy)를 설치해 로그인하면 토론방이 그것을 써요: PowerShell에서 irm https://antigravity.google/cli/install.ps1 | iex 를 실행한 뒤 agy를 한 번 실행해 로그인하세요.";
  if (/authentication required/i.test(stderr)) return "agy 로그인이 필요해요. 터미널에서 agy를 한 번 실행해 Google 계정으로 로그인해 주세요.";
  if (/IneligibleOrProjectId|GOOGLE_CLOUD_PROJECT|requires.*project/i.test(stderr))
    return "Gemini가 이 Google 계정으로는 Cloud 프로젝트가 있어야 한다고 해요. 터미널에서 gemini를 실행해 /auth로 AI Pro를 구독한 개인 계정으로 다시 로그인하거나(학교·회사 계정이면 바꾸기), 그 계정을 써야 하면 RecallerData/rooms/bots.json의 gemini에 \"env\": {\"GOOGLE_CLOUD_PROJECT\": \"프로젝트ID\"}를 넣어 주세요.";
  if (/login|log in|not authenticated|auth/i.test(stderr) && /required|please|expired|missing/i.test(stderr))
    return `로그인이 필요해요. 터미널에서 이 CLI를 한 번 실행해 로그인해 주세요. (${(lines.find((l) => !/^at\s/.test(l)) ?? "").slice(0, 160)})`;
  const message = lines.filter((l) => !/^at\s|^\s*at\s|^file:\/\/|node:internal/.test(l));
  return (message.slice(-3).join(" ") || lines.slice(0, 2).join(" ")).slice(0, 300);
}
/**
 * Runs a CLI with the prompt on stdin, or as the `{prompt}` argument for a CLI that only takes it that way; then no
 * shell is used (the argument goes to the program whole, newlines and quotes included). codex's last message comes
 * from its output file. Plain text back, trimmed.
 */
export const runCli: Exec = async (_bot, command, prompt, signal) => {
  const out = command.out ? path.join(os.tmpdir(), `room-${randomBytes(6).toString("hex")}.txt`) : "";
  const inArgs = command.args.includes("{prompt}");
  // Windows caps a command line near 32,000 characters; the newest part of the conversation is what matters.
  const asArg = prompt.length > 24_000 ? `${prompt.slice(0, 2_000)}\n…\n${prompt.slice(-21_000)}` : prompt;
  const args = command.args.map((a) => (a === "{prompt}" ? asArg : a.replace("{out}", out))).filter((a) => a !== "{flags}");
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    const env = { ...process.env, NO_COLOR: "1", ...command.env };
    try {
      child = inArgs ? spawn(command.cmd, args, { cwd: process.cwd(), windowsHide: true, env })
        : spawn([command.cmd, ...args].map(quote).join(" "), { shell: true, cwd: process.cwd(), windowsHide: true, env });
    } catch (error) { reject(error); return; }
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
      if (code !== 0 && !text) reject(new Error(explain(stderr) || `${command.cmd}가 코드 ${code}로 끝났어요.`));
      else resolve(text);
    });
    child.stdin?.end(inArgs ? "" : prompt);
  });
};

/**
 * Which CLIs run here, and from where: the name on PATH first, then the places installers put them on Windows (the
 * server may have started before an install changed PATH). Checked at most once a minute.
 */
let available: { at: number; bots: Record<BotId, boolean>; paths: Record<BotId, string>; why: Record<BotId, string> } | null = null;
export async function availability(check: (cmd: string) => Promise<string | null> = versionOk) {
  if (available && Date.now() - available.at < 60_000) return available;
  const cmds = await commands();
  const home = process.env.USERPROFILE || os.homedir();
  const places = (cmd: string) => process.platform === "win32" && !/[\\/]/.test(cmd)
    ? [cmd, path.join(home, ".local", "bin", `${cmd}.exe`), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm", `${cmd}.cmd`)] : [])]
    : [cmd];
  const found = await Promise.all(botIds.map(async (b) => {
    let why = "";
    for (const place of places(cmds[b].cmd)) { const problem = await check(place); if (problem === null) return [b, place, ""] as const; why ||= problem; }
    return [b, "", why] as const;
  }));
  available = { at: Date.now(), bots: Object.fromEntries(found.map(([b, p]) => [b, Boolean(p)])) as Record<BotId, boolean>,
    paths: Object.fromEntries(found.map(([b, p]) => [b, p])) as Record<BotId, string>, why: Object.fromEntries(found.map(([b, , w]) => [b, w])) as Record<BotId, string> };
  return available;
}
/** null when `cmd --version` works, else what went wrong (shown on the member list). */
function versionOk(cmd: string) {
  return new Promise<string | null>((resolve) => {
    let err = "";
    const child = spawn(`${quote(cmd)} --version`, { shell: true, windowsHide: true });
    child.stderr?.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); resolve("15초 안에 답이 없어요"); }, 15_000);
    child.on("error", (e) => { clearTimeout(timer); resolve(e.message); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? null : (err.trim().split("\n").at(-1) || `코드 ${code}`).slice(0, 160)); });
  });
}

// ---- turns ------------------------------------------------------------------------------------------------------
/** A turn: a bot answering (by the round, the learner's line, or another bot's @), or the closing summary. */
type Turn = { bot: BotId; kind: "turn" | "summary"; after: "user" | "bot" };
type Worker = { queue: Turn[]; working: boolean; abort?: AbortController; mode: "chat" | "rounds"; handOffs: number; lastPrompt?: { bot: BotId; prompt: string; at: string } };
const workers: Map<string, Worker> = ((globalThis as { __roomWorkers?: Map<string, Worker> }).__roomWorkers ??= new Map<string, Worker>());
let exec: Exec = runCli;
/** Tests swap the CLI runner for a fake. */
export function setExec(next: Exec | null) { exec = next ?? runCli; }
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => { if (ms <= 0) return resolve(); const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
const workerOf = (id: string) => { const w = workers.get(id) ?? { queue: [], working: false, mode: "chat" as const, handOffs: 0 }; workers.set(id, w); return w; };
const pendingOf = (w: Worker) => w.queue.filter((t) => t.kind === "turn").map((t) => t.bot);

async function work(id: string) {
  const w = workerOf(id);
  if (w.working) return;
  w.working = true;
  w.abort = new AbortController();
  try {
    while (w.queue.length && !w.abort.signal.aborted) {
      const turn = w.queue.shift()!;
      const room = await mustLoad(id);
      const s = settingsOf(room);
      if (turn.kind === "turn" && !room.bots.includes(turn.bot)) continue;
      const bot = turn.kind === "summary" ? (room.bots[0] ?? "claude") : turn.bot;
      room.thinking = bot; room.pending = pendingOf(w); await save(room);
      // After another AI spoke, wait a moment so the room can be read as it goes (and the learner can step in).
      if (turn.after === "bot") { await pause(s.delaySec * 1000, w.abort.signal); if (w.abort.signal.aborted) break; }
      const cmds = await commands();
      const where = (await availability()).paths[bot] || cmds[bot].cmd;
      const command: BotCommand = { ...cmds[bot], cmd: where, args: argsFor(cmds[bot], s.models[bot], room.readFiles, "{out}") };
      const current = await mustLoad(id);
      const prompt = turn.kind === "summary" ? `${promptFor(current, bot, 60).split(`\n[${botName[bot]} 차례]`)[0]}\n\n${SUMMARY}` : promptFor(current, bot);
      w.lastPrompt = { bot, prompt, at: new Date().toISOString() };
      const started = Date.now();
      let said: Message;
      let named: BotId | undefined;
      try {
        let text = untag(bot, await exec(bot, command, prompt, w.abort.signal));
        named = mentionsOf(text).find((b) => b !== bot);
        // Cut a long answer, keeping the hand-off it ended with.
        if (turn.kind === "turn" && text.length > s.maxChars * 1.5) text = `${text.slice(0, Math.round(s.maxChars * 1.5)).trimEnd()}…${named ? ` @${botName[named]}` : ""}`;
        said = message(turn.kind === "summary" ? "system" : bot, turn.kind === "summary" ? `정리 (${botName[bot]})\n${text}` : text || "(빈 답)", { ms: Date.now() - started, ...(s.models[bot].model ? { model: s.models[bot].model } : {}) });
      } catch (error) {
        said = message(bot, `답하지 못했어요: ${error instanceof Error ? error.message : String(error)}`, { ms: Date.now() - started, error: true });
      }
      const after = await mustLoad(id);
      after.messages.push(said);
      // A hand-off: in conversation (not in rounds), an AI that names another gives it the next turn, a few times at most.
      if (turn.kind === "turn" && !said.error && w.mode === "chat" && s.chain && w.handOffs < s.chainMax && !w.abort.signal.aborted) {
        const next = named && after.bots.includes(named) ? named : undefined;
        if (next && !w.queue.some((t) => t.kind === "turn" && t.bot === next)) { w.queue.unshift({ bot: next, kind: "turn", after: "bot" }); w.handOffs++; }
      }
      after.thinking = null; after.pending = pendingOf(w);
      await save(after);
    }
  } finally {
    w.working = false; w.queue = []; w.abort = undefined;
    const room = await loadRoom(id);
    if (room && (room.thinking || room.pending.length)) { room.thinking = null; room.pending = []; await save(room); }
  }
}
function enqueue(id: string, turns: Turn[]) {
  const w = workerOf(id);
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
  const w = workerOf(id);
  w.handOffs = 0;
  // While AIs are talking, the line joins the conversation and the next speaker answers it.
  if (w.working && !named.length) return { room, done: Promise.resolve() };
  if (!w.working) w.mode = "chat";
  const turns = (named.length ? named : room.bots).map((bot, i): Turn => ({ bot, kind: "turn", after: i === 0 ? "user" : "bot" }));
  return { room, done: enqueue(id, turns) };
}
/** Bots take turns for a number of rounds (each bot speaks once per round); hand-offs by @ are off meanwhile. */
export async function runRounds(id: string, rounds: number) {
  const room = await mustLoad(id);
  const n = Math.max(1, Math.min(10, Math.floor(rounds)));
  const w = workerOf(id);
  w.mode = "rounds";
  const turns = Array.from({ length: n }, () => room.bots).flat().map((bot, i): Turn => ({ bot, kind: "turn", after: i === 0 ? "user" : "bot" }));
  return { room, done: enqueue(id, turns) };
}
export async function summarize(id: string) { await mustLoad(id); return { done: enqueue(id, [{ bot: "claude", kind: "summary", after: "user" }]) }; }
export async function stop(id: string) {
  const w = workers.get(id);
  // A running worker writes the stopped turn and clears the room itself; saving here too would race it and drop that line.
  if (w?.working) { w.queue = []; w.abort?.abort(); return mustLoad(id); }
  const room = await mustLoad(id);
  room.thinking = null; room.pending = []; await save(room);
  return room;
}

/** Empties the conversation (the room, its settings and memo stay). */
export async function clearRoom(id: string) {
  await stop(id);
  const w = workers.get(id); if (w) { w.queue = []; w.handOffs = 0; }
  const room = await mustLoad(id);
  room.messages = []; room.thinking = null; room.pending = [];
  await save(room);
  return room;
}
export async function deleteRoom(id: string) {
  await stop(id).catch(() => undefined);
  workers.delete(id);
  await rm(fileOf(id), { force: true });
}
/** What a bot would be sent now, and what was last sent (to see how the prompt is put together). */
export async function promptPreview(id: string, bot: BotId) {
  const room = await mustLoad(id);
  return { next: promptFor(room, bot), last: workers.get(id)?.lastPrompt ?? null };
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
