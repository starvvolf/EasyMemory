// 튜터 셸(2026-11-08 사용자 결정 8 "셸을 어디까지 여나요? 오케이"):
// - 작업 폴더 안에서 돌리고 읽기만 하는 명령(코드 실행 · 테스트 · 목록 보기 · git status/diff/log)은 바로 돌린다
// - 설치 · git으로 기록을 바꾸는 명령(commit/push/reset…) · 지우기 · 작업 폴더 밖 · 모르는 명령은 학습자에게 먼저 묻는다([실행] / [안 함])
// - 학습자가 직접 쳐 봐야 할 명령은 튜터가 먼저 돌리지 않는다(도구 설명으로 안내 — 코드로는 알 수 없다)
// 판정은 명령 종류(첫 낱말 · git 하위 명령 · 경로)로만 한다. 특정 문항에 맞춘 목록이 아니라 "기록 · 설치 · 밖을 바꾸는가" 하나로 나눈다.
// 두 엔진 공통: OpenCode는 GOAL_TOOLS로, Codex는 MCP goal-tool로 같은 runGoalTool을 거친다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DATA, read, update } from "./store.ts";

const str = { type: "string" } as const;
const SHELL_NAME = process.platform === "win32" ? "Windows cmd" : "sh";
export const SHELL_TOOL = {
  name: "run_command",
  description: `학습자의 작업 폴더에서 터미널 명령 하나를 돌리고 출력을 본다(${SHELL_NAME}). 코드 실행 · 테스트 · 파일 목록 · git status/diff/log처럼 작업 폴더 안에서 읽거나 돌려 보기만 하는 명령은 바로 돌고 결과가 돌아온다. 설치(npm/pip install 등) · git commit/push/reset 같은 기록을 바꾸는 명령 · 지우기 · 작업 폴더 밖을 건드리는 명령은 학습자에게 먼저 묻는다(화면에 [실행] / [안 함]이 뜬다). 그때는 무엇을 왜 돌리려는지 한 줄 말하고 학습자의 선택을 기다린다. 학습자가 직접 쳐 보며 익히는 게 목표인 명령이나 학습자가 하려던 명령은 먼저 돌리지 말고 학습자에게 쳐 보게 한다. why에는 이 명령으로 무엇을 확인하려는지 한 문장.`,
  properties: { command: str, why: str }, required: ["command", "why"],
} as const;

export type Kind = "auto" | "ask";
export type Pending = { id: string; command: string; why: string; reason: string; at: string };
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
  if (/`|\$\(|%[A-Za-z_]+%|\$env:|\$\{/.test(c)) return { kind: "ask", reason: "다른 명령 · 환경 값을 끼워 넣는 명령이에요" };
  if (/(^|[^0-9&])>{1,2}(?!&)/.test(c.replace(/>\s*(nul|NUL|\/dev\/null)\b/g, ""))) return { kind: "ask", reason: "출력을 파일로 쓰는 명령이에요" };
  const parts = c.split(/\s*(?:&&|\|\||;|\||&)\s*/).filter(Boolean);
  for (const p of parts) {
    const words = p.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const first = (words[0] ?? "").replace(/^["']|["']$/g, "");
    const head = path.basename(first).replace(/\.(exe|cmd|bat)$/i, "");
    const args = words.slice(1).map((w) => w.replace(/^["']|["']$/g, ""));
    // 작업 폴더 밖 경로
    const root = path.resolve(ws);
    for (const a of args) {
      if (/^-/.test(a) || /^https?:/i.test(a)) continue;
      const looksPath = path.isAbsolute(a) || /^~[\\/]?/.test(a) || /(^|[\\/])\.\.([\\/]|$)/.test(a) || /^[A-Za-z]:/.test(a);
      if (!looksPath) continue;
      if (/^[A-Za-z]:/.test(a) && !a.replace(/\\/g, "/").toLowerCase().startsWith(root.replace(/\\/g, "/").toLowerCase())) return { kind: "ask", reason: `작업 폴더 밖(${a})을 건드려요` };
      const abs = path.resolve(root, a.replace(/^~/, process.env.USERPROFILE ?? process.env.HOME ?? "~"));
      if (abs !== root && !abs.startsWith(root + path.sep)) return { kind: "ask", reason: `작업 폴더 밖(${a})을 건드려요` };
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
      if (/^-m$/.test(args[0] ?? "") && /^pip$/i.test(args[1] ?? "")) return { kind: "ask", reason: "패키지를 설치 · 제거해요" };
      if (INSTALL_SUB.test(sub)) return { kind: "ask", reason: "패키지를 설치 · 제거해요" };
    }
    if (/^(python|python3|py)$/i.test(head) && args[0] === "-m" && /^(pip|venv|ensurepip)$/i.test(args[1] ?? "")) return { kind: "ask", reason: "패키지 · 가상환경을 바꿔요" };
    if (CHANGES.test(head)) return { kind: "ask", reason: `${head}은(는) 파일 · 시스템을 바꾸거나 밖으로 나가요` };
    if (!RUNS.test(head)) return { kind: "ask", reason: `처음 보는 명령(${head})이에요` };
  }
  return { kind: "auto", reason: "" };
}

/* ---------- 돌리기 ---------- */
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
/** 모델 · 화면에 보낼 출력: 앞뒤를 남기고 가운데를 줄인다 */
export function clip(out: string, n = 4000) {
  const t = out.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  return t.length <= n ? t : `${t.slice(0, n * 0.3)}\n… (${t.length - n}자 줄임) …\n${t.slice(-n * 0.7)}`;
}
const result = (r: { code: number | null; out: string }) => `종료 코드 ${r.code ?? "없음"}\n${clip(r.out) || "(출력 없음)"}`;
const remember = (runId: string, ran: Ran) => update<ShellState>(file(runId), empty(), (s) => { s.history.push({ ...ran, out: clip(ran.out, 1500) }); if (s.history.length > 50) s.history.splice(0, s.history.length - 50); });

/** 모델이 부른 run_command */
export async function runCommandTool(runId: string, ws: string | undefined, input: Record<string, unknown>): Promise<string> {
  const command = String(input.command ?? "").trim().slice(0, 2000), why = String(input.why ?? "").trim().slice(0, 300);
  if (!ws) return "작업 폴더가 없어 명령을 돌릴 수 없어요.";
  if (!command) return "command가 비었어요.";
  const s = await shellOf(runId);
  if (s.pending) return `학습자가 아직 \`${s.pending.command}\` 실행 여부를 고르지 않았어요. 고를 때까지 기다린다.`;
  const c = classify(command, ws);
  if (c.kind === "ask") {
    await update<ShellState>(file(runId), empty(), (st) => { st.pending = { id: Math.random().toString(36).slice(2, 10), command, why, reason: c.reason, at: new Date().toISOString() }; });
    return `학습자에게 먼저 묻는 명령이에요(${c.reason}). 화면에 [실행] / [안 함]을 띄웠어요. 답에서는 무엇을 왜 돌리려는지 한 줄로 말하고 이번 답을 마친다. 학습자가 고르면 결과를 알려 준다.`;
  }
  const r = await exec(command, ws);
  await remember(runId, { command, by: "auto", code: r.code, out: r.out, ms: r.ms, at: new Date().toISOString() });
  return result(r);
}

/** 학습자가 [실행] / [안 함]을 골랐을 때. 실행했으면 튜터에게 넘길 말을 돌려준다 */
export async function decide(runId: string, ws: string | undefined, id: string, ok: boolean): Promise<{ say: string | null; label: string; text: string }> {
  const s = await shellOf(runId);
  const p = s.pending;
  if (!p || p.id !== id) return { say: null, label: "명령", text: "이미 처리한 요청이에요" };
  await update<ShellState>(file(runId), empty(), (st) => { st.pending = null; if (!ok) st.refused.push({ command: p.command, at: new Date().toISOString() }); });
  if (!ok || !ws) return { say: null, label: "명령 안 함", text: p.command };
  // 설치는 오래 걸릴 수 있어 학습자가 허락한 명령은 3분까지
  const r = await exec(p.command, ws, 180_000);
  await remember(runId, { command: p.command, by: "learner-ok", code: r.code, out: r.out, ms: r.ms, at: new Date().toISOString() });
  return { say: `[명령 실행함 — 학습자가 허락] \`${p.command}\`\n${result(r)}\n\n이 결과를 보고 이어 가 주세요.`, label: "명령 실행", text: `${p.command} → 종료 코드 ${r.code ?? "없음"}` };
}

/** 학습자가 VS Code 터미널에서 친 명령(확장이 보냄, 작업 폴더 안만) */
export async function learnerRan(runId: string, b: { command?: unknown; exitCode?: unknown; cwd?: unknown; output?: unknown }) {
  const command = String(b.command ?? "").trim().slice(0, 2000);
  if (!command) return { ok: false };
  const ran: Ran = { command, by: "learner", code: typeof b.exitCode === "number" ? b.exitCode : null, out: clip(String(b.output ?? ""), 3000), ms: 0, at: new Date().toISOString(), cwd: String(b.cwd ?? "").slice(0, 200), told: false };
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
