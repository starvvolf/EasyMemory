// Codex 실험판(11/4 사용자 "SDK로 엔진 교체, MCP 추가한 코덱스 실험판 하나 만들어 봐. MCP에는 튜터로서 필요한 기능만").
// 대화 엔진은 PC에 로그인된 Codex CLI를 Codex SDK(@openai/codex-sdk)로 돌린다(ChatGPT 로그인 그대로, API 키 아님).
// Recaller는 ① 대화마다 작업 폴더 · 모델 · 파일 고치기 허락을 정하고 ② MCP 서버(mcp/recaller-tutor.mjs)로 튜터 도구 둘을 붙이고
// ③ 답이 끝나면 대화에서 배운 것을 뽑는다(chat-learned, 근거는 코드가 대조).
// SDK는 깃에 없다: 이 폴더의 .codex-sdk/node_modules/@openai/codex-sdk(PC에 한 번 풀어 둠). codex.exe는 npm 전역 설치를 찾는다(PC_CODEX_PATH로 바꿈).
import path from "node:path";
import os from "node:os";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { DATA, read, update } from "./store.ts";
import { ROOT } from "./course.ts";
import { CHAT_MODELS } from "./agent-chat.ts";

type Role = "user" | "assistant" | "tool" | "error";
type Msg = { id: number; role: Role; text: string; at: string; item?: string; status?: string };
export type CodexChat = { id: string; threadId?: string; workspace?: string; model?: string; edit?: "allow" | "deny"; messages: Msg[]; at: string; usage?: { input: number; cached: number; output: number; ms: number }[] };
type Prefs = { items: { text: string; quote: string; chatId: string; at: string }[] };

const now = () => new Date().toISOString();
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const valid = (id: string) => { if (!/^[a-f0-9]{16}$/.test(id)) throw err(400, "대화 주소가 올바르지 않아요."); return id; };
const dir = () => path.join(DATA, "codex-chat");
const file = (id: string) => path.join(dir(), `${valid(id)}.json`);
const defaultWs = (id: string) => path.join(dir(), "workspaces", valid(id));
const wsOf = (c: CodexChat) => c.workspace || defaultWs(c.id);
const prefsFile = () => path.join(dir(), "preferences.json");
const logFile = () => path.join(dir(), "log.jsonl");
export const MCP_SCRIPT = path.join(ROOT, "mcp", "recaller-tutor.mjs");
const learnKey = (id: string) => `codex-${id}`;

/** 첫 메시지에만 붙는 튜터 안내(Codex의 기본 지시문 위에 덧붙는 것). 짧게, 할 일 위주 */
export const TUTOR_FIRST = `[Recaller 튜터 안내]
이 대화에서 너는 학습자와 함께 코드를 배우고 만드는 튜터다. 한국어 해요체로, ChatGPT에서 대화하듯 자연스럽게 답한다.
학습자가 원하는 진행 방식(직접 해 보기 · 하나씩 · 맡기기)을 따른다. recaller 도구로 학습자의 지난 기록과 정해 둔 진행 방식을 볼 수 있고, 학습자가 앞으로의 진행 방식을 말하면 remember_preference로 남긴다.`;

/* ---------- Codex 실행 파일 · SDK 찾기 ---------- */
let codexPath: string | null | undefined;
function findCodex() {
  if (codexPath !== undefined) return codexPath;
  const env = process.env.PC_CODEX_PATH?.trim();
  if (env && existsSync(env)) return (codexPath = env);
  const npmGlobal = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex");
  const roots = [path.join(npmGlobal, "node_modules", "@openai", "codex-win32-x64", "vendor"), path.join(npmGlobal, "vendor")];
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const walk = (d: string, depth: number): string | null => {
    let names: string[] = []; try { names = readdirSync(d); } catch { return null; }
    if (names.includes(exe) && depth < 4) return path.join(d, exe);
    for (const n of names) { if (depth < 3) { const hit = walk(path.join(d, n), depth + 1); if (hit) return hit; } }
    return null;
  };
  for (const r of roots) { const hit = walk(r, 0); if (hit) return (codexPath = hit); }
  // 11/4 노트북: npm 전역 대신 VS Code의 Codex 확장(openai.chatgpt-*)에 든 codex.exe를 쓴다(가장 새 버전)
  try {
    const ext = path.join(os.homedir(), ".vscode", "extensions");
    // 버전은 숫자로 비교한다(글자 순서면 26.602가 26.1021보다 커 보임 — 11/5 노트북에서 옛 버전을 고름). 지운 표시(.obsolete)된 것은 뺀다
    let obsolete: Record<string, boolean> = {}; try { obsolete = JSON.parse(readFileSync(path.join(ext, ".obsolete"), "utf8")); } catch { /* 없음 */ }
    const ver = (n: string) => (/^openai\.chatgpt-([\d.]+)/.exec(n)?.[1] ?? "0").split(".").map(Number);
    const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0); return 0; };
    const dirs = readdirSync(ext).filter((n) => /^openai\.chatgpt-/.test(n) && !obsolete[n]).sort((a, b) => cmp(ver(a), ver(b)));
    for (const d of dirs) for (const plat of ["windows-x86_64", "windows-aarch64", "linux-x86_64", "macos-aarch64", "macos-x86_64"]) {
      const p = path.join(ext, d, "bin", plat, exe); if (existsSync(p)) return (codexPath = p);
    }
  } catch { /* VS Code 확장 없음 */ }
  return (codexPath = null);
}
async function sdk() {
  const p = path.join(ROOT, ".codex-sdk", "node_modules", "@openai", "codex-sdk", "dist", "index.js");
  if (!existsSync(p)) throw err(503, "Codex SDK가 없어요(.codex-sdk). Claude에게 설치를 부탁해 주세요.");
  return import(pathToFileURL(p).href) as Promise<{ Codex: new (o: Record<string, unknown>) => { startThread(o: Record<string, unknown>): CodexThread; resumeThread(id: string, o: Record<string, unknown>): CodexThread } }>;
}
type CodexThread = { id: string | null; runStreamed(input: string, o?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<any> }> };

/* Recaller 전용 Codex 설정 폴더(11/5 사용자 "CLAUDE.md 같은 건 안 봐도 되잖아" → 전용 폴더로).
 * 평소 Codex 설정(.codex)의 기억 · 플러그인 · 다른 MCP가 따라오면 학습 대화 중에 개발용 문서를 찾고 입력도 커진다.
 * 로그인은 따로 한 번(로그인 파일을 복사하지 않는다: 한쪽이 갱신되면 다른 쪽이 풀릴 수 있음). 깃 · RecallerData에 안 올라가는 사용자 폴더 아래 */
export const CODEX_HOME = process.env.PC_CODEX_HOME?.trim() || path.join(os.homedir(), ".recaller-codex");
/** Codex keeps each thread as sessions/<yyyy>/<mm>/<dd>/rollout-…-<threadId>.jsonl under CODEX_HOME. */
function hasRollout(threadId: string, dir = path.join(CODEX_HOME, "sessions"), depth = 0): boolean {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return false; }
  for (const n of names) {
    if (n.includes(threadId) && n.endsWith(".jsonl")) return true;
    if (depth < 3 && !n.includes(".") && hasRollout(threadId, path.join(dir, n), depth + 1)) return true;
  }
  return false;
}
const loggedIn = () => existsSync(path.join(CODEX_HOME, "auth.json"));
let loginChild: ReturnType<typeof spawn> | null = null;
/** 전용 폴더로 codex login을 띄운다(브라우저가 열리고 학습자가 직접 로그인) */
export async function login() {
  const exe = findCodex();
  if (!exe) throw err(503, "이 PC에서 Codex(codex.exe)를 찾지 못했어요.");
  if (loggedIn()) return { ok: true, already: true, out: "" };
  await mkdir(CODEX_HOME, { recursive: true });
  if (!loginChild) {
    loginChild = spawn(exe, ["login"], { env: { ...process.env, CODEX_HOME }, windowsHide: true });
    let out = "";
    loginChild.stdout?.on("data", (c) => { out += c; }); loginChild.stderr?.on("data", (c) => { out += c; });
    loginChild.on("exit", () => { loginChild = null; });
    await new Promise((r) => setTimeout(r, 2500));
    const url = /(https:\/\/\S+)/.exec(out)?.[1] ?? null;
    return { ok: true, started: true, url, out: out.slice(0, 600) };
  }
  return { ok: true, started: true, url: null, out: "로그인 창이 이미 열려 있어요." };
}
/** 전용 설정에 다른 MCP 서버가 생겼으면 이 대화에서는 끈다 */
function otherMcpServers() {
  try {
    const t = readFileSync(path.join(CODEX_HOME, "config.toml"), "utf8");
    return [...new Set([...t.matchAll(/^\s*\[mcp_servers\.("?)([^\]".]+)\1\]/gm)].map((m) => m[2]))].filter((n) => n !== "recaller");
  } catch { return []; }
}

export function codexStatus() {
  const exe = findCodex();
  return { codex: exe, home: CODEX_HOME, loggedIn: loggedIn(), sdk: existsSync(path.join(ROOT, ".codex-sdk", "node_modules", "@openai", "codex-sdk")), mcp: existsSync(MCP_SCRIPT), node: process.execPath };
}

/* ---------- 대화 저장 ---------- */
const active = new Map<string, AbortController>();
export async function chatOf(id: string) { const c = await read<CodexChat | null>(file(id), null); if (!c) throw err(404, "대화를 찾지 못했어요."); return c; }
export async function view(id: string) {
  const c = await chatOf(id);
  const { learnedOf } = await import("./chat-learned.ts");
  const learned = (await learnedOf(learnKey(id))).items.map((x) => ({ concept: x.concept, kind: x.kind, meaning: x.meaning, quote: x.quote }));
  return { ...c, workspace: wsOf(c), busy: active.has(id), models: CHAT_MODELS, model: c.model ?? CHAT_MODELS[0].id, edit: c.edit ?? null, learned, status: codexStatus() };
}
export async function list() {
  await mkdir(dir(), { recursive: true });
  const out = [];
  for (const n of readdirSync(dir()).filter((f) => /^[a-f0-9]{16}\.json$/.test(f))) {
    const c = await read<CodexChat | null>(path.join(dir(), n), null); if (!c) continue;
    const first = c.messages.find((m) => m.role === "user")?.text ?? "";
    out.push({ id: c.id, title: first.replace(/\s+/g, " ").slice(0, 60) || "새 대화", at: c.messages.at(-1)?.at ?? c.at, busy: active.has(c.id) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
export async function create() {
  const id = randomBytes(8).toString("hex");
  await mkdir(defaultWs(id), { recursive: true });
  const c: CodexChat = { id, messages: [], at: now() };
  await update<CodexChat>(file(id), c, () => c);
  return view(id);
}
const push = (c: CodexChat, role: Role, text: string, extra: Partial<Msg> = {}) => { const m: Msg = { id: (c.messages.at(-1)?.id ?? 0) + 1, role, text, at: now(), ...extra }; c.messages.push(m); return m; };

export async function setOptions(id: string, b: Record<string, unknown>) {
  const c = await chatOf(id);
  if (active.has(id)) throw err(409, "답하는 중에는 바꿀 수 없어요.");
  let ws: string | undefined;
  if (b.workspace !== undefined) {
    const p = String(b.workspace).trim().replace(/^"(.*)"$/, "$1");
    if (!p || !path.isAbsolute(p)) throw err(400, "폴더의 전체 경로를 적어 주세요.");
    if (!existsSync(p)) throw err(400, "그 폴더를 찾지 못했어요.");
    ws = path.resolve(p);
  }
  if (b.model !== undefined && !CHAT_MODELS.some((m) => m.id === b.model)) throw err(400, "고를 수 없는 모델이에요.");
  if (b.edit !== undefined && b.edit !== "allow" && b.edit !== "deny") throw err(400, "edit는 allow 또는 deny예요.");
  await update<CodexChat>(file(id), c, (x) => {
    if (ws !== undefined) { if (ws === defaultWs(id)) delete x.workspace; else x.workspace = ws; delete x.threadId; } // 폴더가 바뀌면 Codex 대화도 새로(앞 대화는 첫 메시지에 붙임)
    if (b.model !== undefined) { if (b.model === CHAT_MODELS[0].id) delete x.model; else x.model = String(b.model); }
    if (b.edit !== undefined) x.edit = b.edit as "allow" | "deny";
  });
  return view(id);
}

/* ---------- 질문 하나 ---------- */
function label(item: any): string {
  switch (item?.type) {
    case "command_execution": return `명령 실행${item.status === "in_progress" ? " · 진행 중" : item.status === "failed" ? " · 실패" : " · 완료"}\n${String(item.command ?? "").slice(0, 300)}${item.aggregated_output ? `\n→ ${String(item.aggregated_output).slice(-600)}` : ""}`;
    case "file_change": return `파일 ${item.status === "failed" ? "고치기 실패" : "고침"}\n${(item.changes ?? []).map((c: any) => `${({ add: "새 파일", delete: "지움", update: "고침" } as Record<string, string>)[c.kind] ?? c.kind}: ${c.path}`).join("\n")}`;
    case "mcp_tool_call": return `Recaller 도구 ${item.tool}${item.status === "in_progress" ? " · 진행 중" : item.status === "failed" ? ` · 실패 ${item.error?.message ?? ""}` : " · 완료"}`;
    case "web_search": return `웹 검색: ${item.query}`;
    case "todo_list": return `할 일\n${(item.items ?? []).map((t: any) => `${t.completed ? "☑" : "☐"} ${t.text}`).join("\n")}`;
    case "error": return `오류: ${item.message}`;
    default: return "";
  }
}

/** ext.context: 제품 대화(11/4)가 매 차례 붙이는 학습 목표 맥락 */
export async function ask(id: string, text: string, ext?: { context?: () => Promise<string>; noLearned?: boolean }) {
  const q = String(text ?? "").trim();
  if (!q || q.length > 12000) throw err(400, "질문은 1~12,000자로 적어 주세요.");
  if (active.has(id)) throw err(409, "아직 답하는 중이에요.");
  const c0 = await chatOf(id);
  const exe = findCodex();
  if (!exe) throw err(503, "이 PC에서 Codex(codex.exe)를 찾지 못했어요. npm 전역에 @openai/codex가 있는지, 또는 PC_CODEX_PATH를 확인해 주세요.");
  if (!loggedIn()) throw err(401, "Recaller 전용 Codex 로그인이 필요해요. 대화창 위 [Codex 로그인]을 눌러 주세요(처음 한 번).");
  const { Codex } = await sdk();
  const ac = new AbortController(); active.set(id, ac);
  await update<CodexChat>(file(id), c0, (c) => { push(c, "user", q); });
  void run(id, q, exe, Codex, ac, ext);
  return view(id);
}

async function run(id: string, q: string, exe: string, Codex: any, ac: AbortController, ext?: { context?: () => Promise<string>; noLearned?: boolean }) {
  const t0 = Date.now();
  const log: Record<string, unknown> = { at: now(), chatId: id };
  try {
    const c = await chatOf(id);
    const ws = wsOf(c);
    const prefs = (await read<Prefs>(prefsFile(), { items: [] })).items.slice(-8);
    const off = Object.fromEntries(otherMcpServers().map((n) => [n, { enabled: false }]));
    const codex = new Codex({
      codexPathOverride: exe,
      // rg 같은 Codex 도구가 PATH에서 보이게(SDK가 원래 하는 일. 경로를 직접 줘서 우리가 붙인다)
      env: { ...process.env, CODEX_HOME, PATH: `${path.join(path.dirname(exe), "..", "path")}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}` },
      // Recaller 도구는 승인 없이(approval never에서 MCP 호출이 거절되던 것, 11/4 첫 시험). 키: mcp_servers.<id>.default_tools_approval_mode
      config: { mcp_servers: { ...off, recaller: { command: process.execPath, args: [MCP_SCRIPT], default_tools_approval_mode: "approve", env: { RECALLER_URL: `http://127.0.0.1:${process.env.PC_PORT ?? 4100}`, RECALLER_CHAT: id, RECALLER_WS: ws } } } },
    });
    const opts = { workingDirectory: ws, skipGitRepoCheck: true, model: c.model ?? CHAT_MODELS[0].id, modelReasoningEffort: "low",
      sandboxMode: c.edit === "allow" ? "workspace-write" : "read-only", approvalPolicy: "never", networkAccessEnabled: false, webSearchMode: "disabled" };
    // 11/5: 이어 갈 Codex 대화 기록(rollout)이 지금 CODEX_HOME에 없으면 새 대화로 연다. 11/5 전용 설정 폴더(~/.recaller-codex)로
    // 옮기기 전 대화나 다른 PC에서 시작한 대화는 threadId만 남아 "thread/resume failed: no rollout found"로 끝나던 것.
    // 새로 열 때는 아래에서 앞 대화를 붙이므로 맥락은 이어진다.
    if (c.threadId && !hasRollout(c.threadId)) { log.resumeLost = c.threadId; await update<CodexChat>(file(id), c, (x) => { delete x.threadId; }); delete c.threadId; }
    const fresh = !c.threadId;
    const thread = fresh ? codex.startThread(opts) : codex.resumeThread(c.threadId!, opts);
    // 새 Codex 대화면 튜터 안내 + (폴더를 바꿔 새로 열었으면) 앞 대화를 붙인다. 정해 둔 진행 방식은 매번 맨 앞에
    const prior = c.messages.slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant").slice(-30).map((m) => `[${m.role === "user" ? "학습자" : "튜터"}] ${m.text.slice(0, 2000)}`).join("\n\n");
    const pref = prefs.length ? `[학습자가 정해 둔 진행 방식]\n${prefs.map((p) => `- ${p.text}`).join("\n")}\n\n` : "";
    const editLine = c.edit === "allow" ? "" : "[파일 고치기] 학습자가 아직 허락하지 않았다. 고칠 곳과 코드를 알려 주고 학습자가 직접 고치게 한다.\n\n";
    const goal = ext?.context ? `${await ext.context()}\n\n` : "";
    const input = `${fresh ? `${TUTOR_FIRST}\n\n${prior ? `[앞 대화]\n${prior}\n\n` : ""}` : ""}${pref}${goal}${editLine}[학습자] ${q}`;
    log.fresh = fresh; log.model = opts.model; log.sandbox = opts.sandboxMode; log.inputChars = input.length;
    const { events } = await thread.runStreamed(input, { signal: ac.signal });
    const rows = new Map<string, number>(); // Codex item id → 우리 메시지 id
    for await (const ev of events) {
      if (ev.type === "thread.started") await update<CodexChat>(file(id), c, (x) => { x.threadId = ev.thread_id; });
      else if (ev.type === "item.started" || ev.type === "item.updated" || ev.type === "item.completed") {
        const it = ev.item; if (!it || it.type === "reasoning") continue;
        const role: Role = it.type === "agent_message" ? "assistant" : "tool";
        const textNow = it.type === "agent_message" ? String(it.text ?? "") : label(it);
        if (!textNow) continue;
        await update<CodexChat>(file(id), c, (x) => {
          const mid = rows.get(it.id); const m = mid ? x.messages.find((y) => y.id === mid) : undefined;
          if (m) { m.text = textNow; m.status = it.status; } else rows.set(it.id, push(x, role, textNow, { item: it.type, status: it.status }).id);
        });
      } else if (ev.type === "turn.completed") {
        const u = ev.usage ?? {};
        const use = { input: u.input_tokens ?? 0, cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0, ms: Date.now() - t0 };
        log.usage = use;
        await update<CodexChat>(file(id), c, (x) => { (x.usage ??= []).push(use); });
      } else if (ev.type === "turn.failed" || ev.type === "error") {
        const msg = ev.error?.message ?? ev.message ?? "알 수 없는 오류";
        log.error = msg;
        await update<CodexChat>(file(id), c, (x) => { push(x, "error", msg); });
      }
    }
  } catch (e) {
    const msg = ac.signal.aborted ? "멈췄어요." : (e as Error).message.slice(0, 1500);
    log.error = msg;
    await update<CodexChat>(file(id), await chatOf(id), (x) => { push(x, ac.signal.aborted ? "tool" : "error", msg); }).catch(() => {});
  } finally {
    active.delete(id);
    log.ms = Date.now() - t0;
    await mkdir(dir(), { recursive: true }).catch(() => {});
    await appendFile(logFile(), JSON.stringify(log) + "\n").catch(() => {});
    // 배운 것 뽑기(답이 끝난 뒤, 새 대화만). 끄기 PC_CHAT_LEARNED=0
    // 제품 대화는 질문마다 뽑지 않고 목표가 끝날 때 정리한다(11/5, noLearned)
    if (process.env.PC_CHAT_LEARNED !== "0" && !ext?.noLearned) {
      const c = await chatOf(id).catch(() => null);
      if (c) await (await import("./chat-learned.ts")).extractLearned(learnKey(id), c.messages.filter((m) => m.role === "user" || m.role === "assistant")).catch(() => null);
    }
  }
}
/** 이 대화의 작업 폴더를 VS Code로 연다(11/4 사용자 "맞는 작업 폴더가 안 열리는 것 같은데") */
export async function openInCode(id: string) { const c = await chatOf(id); return (await import("./learn.ts")).openFolderInCode(wsOf(c)); }
export function stop(id: string) { active.get(id)?.abort(); return view(id); }

/* ---------- MCP 도구가 부르는 것(튜터로서 필요한 것만) ---------- */
/** 학습자 기록: 지난 대화들에서 뽑은 배운 것 · 헷갈린 것 + 정해 둔 진행 방식 */
export async function learnerProfile(id: string) {
  valid(id);
  const { learnedOf } = await import("./chat-learned.ts");
  const ld = path.join(DATA, "agent-chat", "learned");
  const names = (() => { try { return readdirSync(ld).filter((f) => f.endsWith(".json")); } catch { return []; } })();
  const all: { concept: string; kind: string; meaning: string; at: string }[] = [];
  for (const n of names) for (const x of (await learnedOf(n.replace(/\.json$/, ""))).items) all.push(x);
  const by = new Map<string, { kinds: Set<string>; meaning: string; last: string }>();
  for (const x of all) { const k = x.concept; const v = by.get(k) ?? { kinds: new Set(), meaning: x.meaning, last: x.at }; v.kinds.add(x.kind); if (x.at > v.last) v.last = x.at; by.set(k, v); }
  const ko: Record<string, string> = { asked: "물어봄", confused: "헷갈림", misconception: "틀리게 앎", explained: "자기 말로 설명", applied: "직접 써 봄" };
  const lines = [...by].sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 40).map(([k, v]) => `- ${k} (${[...v.kinds].map((x) => ko[x] ?? x).join(", ")}, ${v.last.slice(0, 10)}): ${v.meaning}`);
  const prefs = (await read<Prefs>(prefsFile(), { items: [] })).items.slice(-10).map((p) => `- ${p.text}`);
  return `[학습자가 정해 둔 진행 방식]\n${prefs.join("\n") || "- (없음)"}\n\n[지난 학습 기록 — 대화에서 뽑은 것, 최근 순]\n${lines.join("\n") || "- (없음)"}`;
}
/** 진행 방식 기억: 근거는 이 대화의 학습자 말에서 그대로 옮긴 구절이어야 한다 */
export async function rememberPreference(id: string, b: Record<string, unknown>) {
  const c = await chatOf(id);
  const textIn = String(b.text ?? "").trim().slice(0, 200), quote = String(b.quote ?? "").trim();
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  if (!textIn) throw err(400, "기억할 진행 방식을 적어 주세요.");
  if (quote.length < 2 || !c.messages.some((m) => m.role === "user" && norm(m.text).includes(norm(quote)))) throw err(400, "quote는 이 대화에서 학습자가 한 말을 그대로 옮긴 구절이어야 해요.");
  await update<Prefs>(prefsFile(), { items: [] }, (p) => { p.items.push({ text: textIn, quote, chatId: id, at: now() }); });
  return `기억했어요: ${textIn}`;
}
