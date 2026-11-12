// 튜터 셸(2026-11-08 사용자 결정 8 "셸을 어디까지 여나요? 오케이"):
// - 작업 폴더 안에서 돌리고 읽기만 하는 명령(코드 실행 · 테스트 · 목록 보기 · git status/diff/log)은 바로 돌린다
// - 설치 · git으로 기록을 바꾸는 명령(commit/push/reset…) · 지우기 · 작업 폴더 밖 · 모르는 명령은 학습자에게 먼저 묻는다([실행] / [안 함])
// - 학습자가 직접 쳐 봐야 할 명령은 튜터가 먼저 돌리지 않는다(도구 설명으로 안내 — 코드로는 알 수 없다)
// 판정은 명령 종류(첫 낱말 · git 하위 명령 · 경로)로만 한다. 특정 문항에 맞춘 목록이 아니라 "기록 · 설치 · 밖을 바꾸는가" 하나로 나눈다.
// 두 엔진 공통: OpenCode는 GOAL_TOOLS로, Codex는 MCP goal-tool로 같은 runGoalTool을 거친다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA, read, update } from "./store.ts";

const str = { type: "string" } as const;
const SHELL_NAME = process.platform === "win32" ? "Windows cmd" : "sh";
export const SHELL_TOOL = {
  name: "run_command",
  description: `학습자의 작업 폴더에서 터미널 명령 하나를 돌리고 출력을 본다(${SHELL_NAME}). 코드 실행 · 테스트 · 파일 목록 · git status/diff/log처럼 작업 폴더 안에서 읽거나 돌려 보기만 하는 명령은 바로 돌고 결과가 돌아온다. 설치(npm/pip install 등) · git commit/push/reset 같은 기록을 바꾸는 명령 · 지우기 · 작업 폴더 밖을 건드리는 명령은 학습자에게 먼저 묻는다(화면에 [실행] / [안 함]이 뜬다). 그때는 무엇을 왜 돌리려는지 한 줄 말하고 학습자의 선택을 기다린다. 학습자가 직접 쳐 보며 익히는 게 목표인 명령이나 학습자가 하려던 명령은 먼저 돌리지 말고 학습자에게 쳐 보게 한다. why에는 이 명령으로 무엇을 확인하려는지 한 문장.`,
  properties: { command: str, why: str, background: { type: "boolean", description: "서버처럼 끝나지 않고 계속 도는 명령이면 true(뒤에서 켜 두고 처음 몇 초 출력만 돌려준다. 같은 명령을 다시 켜면 앞의 것은 끈다)" } }, required: ["command", "why", "background"],
} as const;

export type Kind = "auto" | "ask";
export type Pending = { id: string; command: string; why: string; reason: string; at: string; background?: boolean };
export type Ran = { command: string; by: "auto" | "learner-ok" | "learner"; code: number | null; out: string; ms: number; at: string; cwd?: string; told?: boolean };
type ShellState = { pending: Pending | null; history: Ran[]; refused: { command: string; at: string; told?: boolean }[] };
const file = (runId: string) => path.join(DATA, "shell", `${runId}.json`);
const empty = (): ShellState => ({ pending: null, history: [], refused: [] });
export const shellOf = async (runId: string) => read<ShellState>(file(runId), empty());

/* ---------- 나누기 ---------- */
const GIT_READ = new Set(["status", "diff", "log", "show", "blame", "ls-files", "rev-parse", "shortlog", "describe", "grep", "reflog"]);
const INSTALLERS = /^(npm|pnpm|yarn|bun|pip|pip3|poetry|uv|conda|apt|apt-get|brew|choco|winget|scoop|cargo|gem|go|dotnet|composer)$/i;
const INSTALL_SUB = /^(i|install|add|ci|update|upgrade|uninstall|remove|rm|un|get|link|publish|init|create)$/i;
const CHANGES = /^(rm|rmdir|del|erase|rd|mv|move|ren|rename|cp|copy|xcopy|robocopy|chmod|chown|mkdir|md|touch|sudo|su|shutdown|reboot|format|reg|setx|taskkill|kill|pkill|curl|wget|ssh|scp|powershell|pwsh|cmd|bash|sh|start|explorer|code|open|Remove-Item|Set-Content|Out-File|New-Item|Invoke-WebRequest)$/i;
/** 작업 폴더 안에서 돌리고 보기만 하는 것: 언어 실행기 · 테스트 · 목록 · 읽기 */
const RUNS = /^(node|npx|tsx|ts-node|deno|python|python3|py|pytest|java|javac|go|cargo|rustc|gcc|g\+\+|clang|make|dotnet|ruby|php|sqlite3|ls|dir|tree|cat|type|head|tail|more|wc|echo|pwd|cd|where|which|find|findstr|grep|rg|sort|diff|fc|git|npm|pnpm|yarn|bun|pip|pip3|tsc|eslint|prettier|jest|vitest|mocha)$/i;

/** 명령 하나를 바로 돌릴지 물을지. 이유는 학습자에게 보이는 말 */
export function classify(command: string, ws: string): { kind: Kind; reason: string } {
  const c = command.trim().replace(/\s*2>&1/g, "");
  if (!c) return { kind: "ask", reason: "빈 명령" };
  // 따옴표 안(코드 조각 등)의 ; > | 는 명령 구분 · 파일 쓰기가 아니다(11/8 실측: node -e "…;…"를 처음 보는 명령으로 봄)
  // cmd는 "…"만, sh는 '…'도 따옴표다. sh의 "…" 안 $( ) · `는 실행되므로 그건 따로 본다
  const win = process.platform === "win32";
  const masked = c.replace(win ? /"[^"]*"/g : /"[^"]*"|'[^']*'/g, (q) => `"${"x".repeat(Math.max(0, q.length - 2))}"`);
  if (!win && /`|\$\(/.test(c.replace(/'[^']*'/g, ""))) return { kind: "ask", reason: "다른 명령을 끼워 넣는 명령이에요" };
  if (win && /%[A-Za-z_][A-Za-z0-9_]*%/.test(c)) return { kind: "ask", reason: "환경 값을 끼워 넣는 명령이에요" };
  if (/(^|[^0-9&=])>{1,2}(?!&)/.test(masked.replace(/>\s*(nul|NUL|\/dev\/null)\b/g, ""))) return { kind: "ask", reason: "출력을 파일로 쓰는 명령이에요" };
  // 나누기는 가린 글에서 자리를 찾고 원래 글에서 자른다
  const parts: string[] = []; { let from = 0; const re = /\s*(?:&&|\|\||;|\||&)\s*/g; let m: RegExpExecArray | null; while ((m = re.exec(masked))) { parts.push(c.slice(from, m.index)); from = m.index + m[0].length; } parts.push(c.slice(from)); }
  for (const p of parts.filter((x) => x.trim())) {
    const words = p.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const first = (words[0] ?? "").replace(/^["']|["']$/g, "");
    const head = path.basename(first).replace(/\.(exe|cmd|bat)$/i, "");
    const args = words.slice(1).map((w) => w.replace(/^["']|["']$/g, ""));
    // 작업 폴더 밖 경로
    const P = win ? path.win32 : path; // 경로 규칙은 그 OS 것으로(시험에서 Windows를 흉내 낼 때도 맞게)
    const root = P.resolve(ws);
    for (const a of args) {
      if (/^-/.test(a) || /^https?:/i.test(a)) continue;
      if (win && /^\/[A-Za-z?][-:A-Za-z0-9]{0,3}$/.test(a)) continue; // Windows 옵션(dir /b, findstr /i …)은 경로가 아니다(11/8 실측)
      // Windows: path.isAbsolute는 "/orders\")" · "\\" · /c:"java.home" 같은 조각도 절대 경로로 본다(11/12 실습 시뮬 오탐).
      // 드라이브(C:…) · UNC(\\서버) · 깨끗한 \폴더 경로만 경로로 본다. / 로 시작하는 건 옵션이나 주소 조각이다
      const rooted = win ? /^\\\\[^\\]/.test(a) || /^\\[A-Za-z0-9_.-]+(\\[A-Za-z0-9_. -]+)*\\?$/.test(a) : path.isAbsolute(a);
      const looksPath = rooted || /^~[\\/]?/.test(a) || /(^|[\\/])\.\.([\\/]|$)/.test(a) || /^[A-Za-z]:/.test(a);
      if (!looksPath) continue;
      if (/^[A-Za-z]:/.test(a) && !a.replace(/\\/g, "/").toLowerCase().startsWith(root.replace(/\\/g, "/").toLowerCase())) return { kind: "ask", reason: `작업 폴더 밖(${a})을 건드려요` };
      const abs = P.resolve(root, a.replace(/^~/, process.env.USERPROFILE ?? process.env.HOME ?? "~"));
      const low = (x: string) => (win ? x.toLowerCase() : x);
      if (abs !== root && !low(abs).startsWith(low(root + P.sep))) return { kind: "ask", reason: `작업 폴더 밖(${a})을 건드려요` };
    }
    if (path.isAbsolute(first) || first.includes("..")) return { kind: "ask", reason: "작업 폴더 밖 프로그램을 돌려요" };
    if (head.toLowerCase() === "git") {
      // 작업 폴더가 자기 저장소가 아니면 git은 바깥(위 폴더의) 저장소를 본다 → 밖을 건드리는 것과 같다
      if (!existsSync(path.join(root, ".git")) && !/^(init|--version|version|help)$/.test(args.find((x) => !x.startsWith("-")) ?? "")) return { kind: "ask", reason: "작업 폴더가 자기 git 저장소가 아니라 바깥 저장소를 봐요" };
      const sub = args.find((a) => !a.startsWith("-")) ?? "";
      if (sub === "branch" && args.every((a) => a === "branch" || /^-(a|v|vv|r|-list|-show-current)$/.test(a))) continue;
      if (sub === "remote" && args.every((a) => a === "remote" || a === "-v")) continue;
      if (sub === "stash" && args[1] === "list") continue;
      if (GIT_READ.has(sub)) continue;
      return { kind: "ask", reason: `git ${sub || ""}은(는) 저장소 기록이나 파일을 바꿔요`.replace("git  ", "git ") };
    }
    if (INSTALLERS.test(head)) {
      const sub = args.find((a) => !a.startsWith("-")) ?? "";
      if (INSTALL_SUB.test(sub)) return { kind: "ask", reason: /^(pip|pip3|conda|apt|apt-get|brew|choco|winget|scoop)$/i.test(head) || args.includes("-g") || args.includes("--global") ? "패키지를 이 컴퓨터 전체에 설치 · 제거해요(작업 폴더 밖)" : "패키지를 작업 폴더에 설치 · 제거해요" };
    }
    if (/^(python|python3|py)$/i.test(head) && args[0] === "-m" && /^(pip|venv|ensurepip)$/i.test(args[1] ?? "")) return { kind: "ask", reason: /pip/i.test(args[1] ?? "") ? "패키지를 이 컴퓨터의 파이썬 전체에 설치 · 제거해요(작업 폴더 밖)" : "가상환경을 만들어요" };
    if (CHANGES.test(head)) return { kind: "ask", reason: `${head}은(는) 파일 · 시스템을 바꾸거나 밖으로 나가요` };
    if (!RUNS.test(head)) return { kind: "ask", reason: `처음 보는 명령(${head})이에요` };
  }
  return { kind: "auto", reason: "" };
}

/* ---------- 돌리기 ---------- */
/** npm · pnpm · yarn · bun은 작업 폴더에 package.json이 없으면 위 폴더의 package.json에 설치한다(11/8 실측: 실습 코스 폴더에 들어감)
 *  → 설치 전에 작업 폴더에 빈 package.json을 만든다. 만들었으면 알릴 말 */
async function ownPackageJson(command: string, ws: string): Promise<string> {
  if (!/(^|&&|;|\|)\s*(npm|pnpm|yarn|bun)(\.cmd)?\s+(i|install|add|ci|uninstall|remove|rm|un|update|link)\b/i.test(command)) return "";
  const f = path.join(ws, "package.json");
  if (existsSync(f)) return "";
  await writeFile(f, JSON.stringify({ name: path.basename(ws).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "") || "workspace", private: true }, null, 2) + "\n");
  return "(작업 폴더에 package.json이 없어 빈 package.json을 먼저 만들었어요 — 위 폴더에 설치되지 않게)\n";
}
const SECRET = /TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|SESSION/i;
export function exec(command: string, ws: string, ms = 60_000): Promise<{ code: number | null; out: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));
    const ch = spawn(command, { cwd: ws, shell: true, windowsHide: true, env: { ...env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } });
    let out = "";
    const add = (b: Buffer) => { out += b.toString("utf8"); if (out.length > 200_000) out = out.slice(-100_000); };
    ch.stdout.on("data", add); ch.stderr.on("data", add);
    const timer = setTimeout(() => { out += `\n(${Math.round(ms / 1000)}초가 지나 멈췄어요)`; ch.kill(); }, ms);
    ch.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: `실행하지 못했어요: ${e.message}`, ms: Date.now() - t0 }); });
    ch.on("close", (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0 }); });
  });
}
/** 뒤에서 켜 둔 명령(서버 등): 진행 기록마다. 같은 명령을 다시 켜면 앞의 것을 끈다. 코스 서버가 꺼지면 같이 끈다 */
const bg = new Map<string, Map<string, ReturnType<typeof spawn>>>();
function killTree(ch: ReturnType<typeof spawn>) {
  if (ch.exitCode !== null || !ch.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true }); else { try { process.kill(-ch.pid); } catch { ch.kill(); } }
}
process.on("exit", () => { for (const m of bg.values()) for (const ch of m.values()) killTree(ch); });
export function execBackground(runId: string, command: string, ws: string, firstMs = 3000): Promise<{ code: number | null; out: string; ms: number; running: boolean }> {
  const t0 = Date.now();
  const mine = bg.get(runId) ?? new Map(); bg.set(runId, mine);
  const old = mine.get(command); if (old) killTree(old);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));
  const ch = spawn(command, { cwd: ws, shell: true, windowsHide: true, detached: process.platform !== "win32", env: { ...env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  mine.set(command, ch);
  let out = "";
  const add = (b: Buffer) => { if (out.length < 20_000) out += b.toString("utf8"); };
  ch.stdout?.on("data", add); ch.stderr?.on("data", add);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (running: boolean, code: number | null) => { if (settled) return; settled = true; resolve({ code, out, ms: Date.now() - t0, running }); };
    ch.on("close", (code) => { if (mine.get(command) === ch) mine.delete(command); finish(false, code); });
    ch.on("error", (e) => { out += `실행하지 못했어요: ${e.message}`; finish(false, null); });
    setTimeout(() => finish(true, null), firstMs);
  });
}
export function stopBackground(runId: string) { const m = bg.get(runId); if (!m) return 0; const n = m.size; for (const ch of m.values()) killTree(ch); m.clear(); return n; }
const bgResult = (r: { code: number | null; out: string; running: boolean }) => r.running ? `뒤에서 켜 두었어요(계속 도는 중). 처음 ${Math.round(3)}초 출력:\n${clip(r.out, 2000) || "(출력 없음)"}` : `곧바로 끝났어요(종료 코드 ${r.code ?? "없음"})\n${clip(r.out) || "(출력 없음)"}`;

/** 모델 · 화면에 보낼 출력: 앞뒤를 남기고 가운데를 줄인다 */
export function clip(out: string, n = 4000) {
  const t = out.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  return t.length <= n ? t : `${t.slice(0, n * 0.3)}\n… (${t.length - n}자 줄임) …\n${t.slice(-n * 0.7)}`;
}
const result = (r: { code: number | null; out: string }) => `종료 코드 ${r.code ?? "없음"}\n${clip(r.out) || "(출력 없음)"}`;
const remember = async (runId: string, ran: Ran) => {
  // 확인된 환경(11/10 학습 노트): "docker 없음" · "node 22.13.0" 같은 사실은 코드가 결과에서 알아낸다
  await (await import("./learner-note.ts")).noteEnv(ran.command, ran.code, ran.out).catch(() => null);
  // 학습 기록(11/11): 학습자가 친 명령이 실패하면 "오류" 한 줄(무슨 명령 · 첫 오류 줄)
  if (ran.code !== null && ran.code !== 0) {
    const first = ran.out.split("\n").map((l) => l.trim()).find((l) => /error|오류|not found|not recognized|Traceback|Exception/i.test(l)) ?? ran.out.trim().split("\n").at(-1) ?? "";
    const goal = (await (await import("./goals.ts")).goalsOf(runId).catch(() => null))?.current?.title ?? "";
    await (await import("./history.ts")).add({ run: runId, goal, kind: "오류", name: ran.command.split(/\s+/).slice(0, 2).join(" "), result: first, where: ran.command });
  }
  return update<ShellState>(file(runId), empty(), (s) => { s.history.push({ ...ran, out: clip(ran.out, 1500) }); if (s.history.length > 50) s.history.splice(0, s.history.length - 50); });
};

/** 모델이 부른 run_command */
/** 명령으로 파일 내용을 쓰는가(11/12 실습 시뮬: 파일 고치기 도구가 없던 튜터가 셸로 파일을 쓰다 긴 명령이 잘림).
 * 글을 직접 돌려 쓰기(echo … > · cat > · here-string) · PowerShell Set-Content · Add-Content · Out-File · [IO.File]::Write… · tee · sed -i · node/python 한 줄로 파일 쓰기 */
export function writesFile(command: string) {
  const c = command.replace(/>\s*(nul|NUL|\$null|\/dev\/null)\b/g, "").replace(/2>&1/g, "");
  // > 돌리기는 글을 직접 써 넣는 것(echo · cat · printf · type · Write-Output · 문자열 · here-string)만. 프로그램 출력 저장(node a.js > out.txt)은 예전처럼 묻는다
  return /(^|[|;&]\s*)(echo|printf|cat|type|Write-Output|@["']|["'])[^|;&]*?(^|[^0-9&=>-])>{1,2}(?!&)\s*\S/i.test(c.replace(/"[^"]*"|'[^']*'/g, '""').replace(/^\s+/, ""))
    || /\b(Set-Content|Add-Content|Out-File)\b/i.test(c)
    || /\[(System\.)?IO\.File\]::(Write|Append)/i.test(c)
    || /(^|[|;&]\s*)tee\b/.test(c) || /\bsed\s+(-\w*\s+)*-i\b/.test(c)
    || /\bwriteFile(Sync)?\s*\(|\bappendFile(Sync)?\s*\(|\bopen\s*\([^)]*['"][wa]\+?['"]|\.write_text\s*\(/.test(c);
}
/** 쓰기 명령을 막을 때 튜터에게 돌려줄 말. edit: 이 대화에서 파일 고치기 도구를 쓸 수 있나(모르면 undefined) */
export const WRITE_BLOCKED = (edit?: boolean) => edit === true
  ? "명령으로는 파일 내용을 쓰지 않아요(긴 명령은 잘려요). 파일은 파일 고치기 도구(edit · write)로 만들고 고친다."
  : edit === false
    ? "이 대화는 파일 고치기를 허락받지 않아 명령으로도 파일을 쓸 수 없어요. 코드를 채팅에 보여 주고 학습자가 직접 넣게 한다. 학습자가 대신 써 주길 바라면 \"파일 고치기 허락을 켜면 바로 써 드릴 수 있어요\"라고 한 줄로 알린다."
    : "명령으로는 파일 내용을 쓰지 않아요. 파일 고치기가 허락돼 있으면 파일 고치기 도구(edit · write · write_workspace_file)로 쓰고, 아니면 코드를 채팅에 보여 주고 학습자가 직접 넣게 한다.";
export async function runCommandTool(runId: string, ws: string | undefined, input: Record<string, unknown>, opts: { edit?: boolean } = {}): Promise<string> {
  const command = String(input.command ?? "").trim().slice(0, 2000), why = String(input.why ?? "").trim().slice(0, 300);
  if (!ws) return "작업 폴더가 없어 명령을 돌릴 수 없어요.";
  if (!command) return "command가 비었어요.";
  const s = await shellOf(runId);
  if (s.pending) return `학습자가 아직 \`${s.pending.command}\` 실행 여부를 고르지 않았어요. 고를 때까지 기다린다.`;
  if (writesFile(command)) return WRITE_BLOCKED(opts.edit);
  const c = classify(command, ws);
  if (c.kind === "ask") {
    await update<ShellState>(file(runId), empty(), (st) => { st.pending = { id: Math.random().toString(36).slice(2, 10), command, why, reason: c.reason, at: new Date().toISOString(), ...(input.background === true ? { background: true } : {}) }; });
    return `학습자에게 먼저 묻는 명령이에요(${c.reason}). 화면에 [실행] / [안 함]을 띄웠어요. 답에서는 무엇을 왜 돌리려는지 한 줄로 말하고 이번 답을 마친다. 학습자가 고르면 결과를 알려 준다.`;
  }
  const pre = await ownPackageJson(command, ws);
  if (input.background === true) {
    const b = await execBackground(runId, command, ws);
    await remember(runId, { command: `${command} (뒤에서)`, by: "auto", code: b.code, out: b.out, ms: b.ms, at: new Date().toISOString() });
    return pre + bgResult(b);
  }
  const r = await exec(command, ws);
  await remember(runId, { command, by: "auto", code: r.code, out: r.out, ms: r.ms, at: new Date().toISOString() });
  return pre + result(r);
}

/** 학습자가 [실행] / [안 함]을 골랐을 때. 실행했으면 튜터에게 넘길 말을 돌려준다 */
export async function decide(runId: string, ws: string | undefined, id: string, ok: boolean): Promise<{ say: string | null; label: string; text: string }> {
  const s = await shellOf(runId);
  const p = s.pending;
  if (!p || p.id !== id) return { say: null, label: "명령", text: "이미 처리한 요청이에요" };
  await update<ShellState>(file(runId), empty(), (st) => { st.pending = null; if (!ok) st.refused.push({ command: p.command, at: new Date().toISOString(), told: true }); });
  // [안 함]도 튜터에게 한 번 알린다(11/9 시험: 거절 뒤 튜터가 아무 말이 없어 학습자가 막힘)
  if (!ok) return { say: `[명령 안 함] 학습자가 \`${p.command}\` 실행을 거절했어요. 같은 명령을 다시 돌리려 하지 말고, 이 명령 없이 지금 목표를 이어 갈 길(필요하면 계획을 그에 맞게 고치기)을 짧게 제안하거나, 학습자가 직접 쳐 보고 싶은 거라면 무엇을 치면 되는지 알려 주세요.`, label: "명령 안 함", text: p.command };
  if (!ws) return { say: null, label: "명령 안 함", text: p.command };
  // 설치는 오래 걸릴 수 있어 학습자가 허락한 명령은 3분까지
  const pre = await ownPackageJson(p.command, ws);
  if (p.background) {
    const b = await execBackground(runId, p.command, ws);
    await remember(runId, { command: `${p.command} (뒤에서)`, by: "learner-ok", code: b.code, out: b.out, ms: b.ms, at: new Date().toISOString() });
    return { say: `[명령 실행함 — 학습자가 허락] \`${p.command}\`\n${pre}${bgResult(b)}\n\n이 결과를 보고 이어 가 주세요.`, label: "명령 실행", text: `${p.command} → ${b.running ? "뒤에서 도는 중" : `종료 코드 ${b.code ?? "없음"}`}` };
  }
  const r = await exec(p.command, ws, 180_000);
  await remember(runId, { command: p.command, by: "learner-ok", code: r.code, out: r.out, ms: r.ms, at: new Date().toISOString() });
  return { say: `[명령 실행함 — 학습자가 허락] \`${p.command}\`\n${pre}${result(r)}\n\n이 결과를 보고 이어 가 주세요.`, label: "명령 실행", text: `${p.command} → 종료 코드 ${r.code ?? "없음"}` };
}

/** 학습자가 VS Code 터미널에서 친 명령(확장이 보냄, 작업 폴더 안만) */
export async function learnerRan(runId: string, b: { command?: unknown; exitCode?: unknown; cwd?: unknown; output?: unknown }) {
  const command = String(b.command ?? "").trim().slice(0, 2000);
  if (!command) return { ok: false };
  const ran: Ran = { command, by: "learner", code: typeof b.exitCode === "number" ? b.exitCode : null, out: clip(String(b.output ?? ""), 3000), ms: 0, at: new Date().toISOString(), cwd: String(b.cwd ?? "").slice(0, 200), told: false };
  await (await import("./learner-note.ts")).noteEnv(ran.command, ran.code, ran.out).catch(() => null);
  await update<ShellState>(file(runId), empty(), (s) => { s.history.push(ran); if (s.history.length > 50) s.history.splice(0, s.history.length - 50); });
  return { ok: true };
}
/** 판정용: 어느 때 뒤로 학습자가 친 명령과 결과 */
export async function learnerRunsSince(runId: string, since: string) {
  return (await shellOf(runId)).history.filter((r) => r.by === "learner" && r.at >= since);
}
const ranLine = (r: Ran) => `\`${r.command}\`${r.cwd ? ` (폴더 ${r.cwd})` : ""} → 종료 코드 ${r.code ?? "모름"}\n${clip(r.out, 1500) || "(출력 없음)"}`;
/** 매 차례 맥락: 학습자가 거절한 명령 · 터미널에서 친 명령은 한 번만 알린다(최근 5개) */
export async function shellContext(runId: string): Promise<string> {
  const s = await shellOf(runId);
  const fresh = s.refused.filter((r) => !r.told);
  const typed = s.history.filter((r) => r.by === "learner" && !r.told).slice(-5);
  if (!fresh.length && !typed.length && !s.pending) return "";
  if (fresh.length || typed.length) await update<ShellState>(file(runId), empty(), (st) => { for (const r of st.refused) r.told = true; for (const r of st.history) if (r.by === "learner") r.told = true; });
  return [s.pending ? `[명령] \`${s.pending.command}\` 실행 여부를 학습자가 고르는 중이다.` : "",
    ...fresh.map((r) => `[명령] 학습자가 \`${r.command}\` 실행을 거절했다. 다시 돌리려 하지 말고 다른 길을 찾거나 학습자에게 직접 쳐 보게 한다.`),
    typed.length ? `[터미널 — 지난 차례 뒤 학습자가 VS Code 터미널에서 직접 친 명령]\n${typed.map(ranLine).join("\n\n")}` : ""].filter(Boolean).join("\n");
}
