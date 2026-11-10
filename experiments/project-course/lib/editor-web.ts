// 앱 안 편집기(2026-11-11 사용자 "기존 방식 남기고 한번 도입해봐" — 브라우저용 VS Code를 내 PC에서 띄워 앱 안에 붙이기):
// VSCodium의 웹 서버판(vscodium-reh-web-<플랫폼>, MIT, 확장 마켓은 Open VSX)을 처음 한 번 받아 두고, 실습을 열면 127.0.0.1:4103에 켜서
// 실습 화면(web/studio.html) 왼쪽 칸에 띄운다. 오른쪽은 지금 튜터 화면 그대로(?embed=1).
// 왜 VSCodium인가(11/11 조사): code-server는 Windows 판이 없고, openvscode-server는 리눅스 판뿐, VS Code의 serve-web은 MS 라이선스 ·
// 켤 때마다 MS에서 서버를 받아 인터넷이 없으면 못 켠다. VSCodium은 Windows용 웹 서버판을 릴리스마다 낸다.
// 원래 방식(내 VS Code + 연결 확장 + 튜터 창)은 그대로 둔다. 이 편집기는 사용자 VS Code와 설정 · 확장을 따로 쓴다(전용 폴더).
// 보안: 127.0.0.1에만, 켤 때마다 새 접속 토큰(파일로 넘김). 토큰 없이는 같은 PC의 다른 웹 페이지가 편집기 · 터미널에 닿을 수 있다.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA } from "./store.ts";

/** 고정 버전(올릴 때는 시험 뒤 여기서). 바꾸려면 PC_EDITOR_WEB_VERSION */
export const VERSION = process.env.PC_EDITOR_WEB_VERSION || "1.109.41146";
export const PORT = Number(process.env.PC_EDITOR_WEB_PORT || 4103);
const HOST = "127.0.0.1";
const platform = () => (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
const arch = () => (process.arch === "arm64" ? "arm64" : "x64");
export const assetName = (v = VERSION) => `vscodium-reh-web-${platform()}-${arch()}-${v}.tar.gz`;
export const assetUrl = (v = VERSION) => process.env.PC_EDITOR_WEB_URL || `https://github.com/VSCodium/vscodium/releases/download/${v}/${assetName(v)}`;
/** 받은 서버를 두는 곳: 저장소 밖(사용자 폴더). 바꾸려면 PC_EDITOR_WEB_HOME */
export const HOME = () => process.env.PC_EDITOR_WEB_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Recaller", "editor-web");
const serverDir = () => path.join(HOME(), `server-${VERSION}`);
/** 이 편집기 전용 설정 · 확장(사용자 VS Code와 섞이지 않게) */
const dataDir = () => path.join(DATA, "editor-web");
const bin = () => path.join(serverDir(), "bin", process.platform === "win32" ? "codium-server.cmd" : "codium-server");
/** 처음 켤 때 깔아 두는 확장(Open VSX). Python 실행 · 디버그와, Pylance 대신 코드 찾기 */
export const EXTENSIONS = ["ms-python.python", "detachhead.basedpyright"];

type Job = { phase: "받는 중" | "확인 중" | "푸는 중" | "확장 까는 중" | "끝" | "실패"; got: number; total: number; error?: string; at: string };
let job: Job | null = null;
let child: ChildProcess | null = null;
let token = "";
let starting: Promise<void> | null = null;

const exists = (p: string) => stat(p).then(() => true, () => false);
export async function installed() { return exists(bin()); }

/** 화면에 보여 줄 상태(받기 전이면 파일 크기도) */
let sizeCache: number | null = null;
export async function status() {
  const ok = await installed();
  if (!ok && sizeCache === null) {
    try { const r = await fetch(assetUrl(), { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) }); sizeCache = Number(r.headers.get("content-length")) || 0; } catch { sizeCache = 0; }
  }
  return { installed: ok, running: !!child && child.exitCode === null, version: VERSION, asset: assetName(), source: assetUrl(), size: ok ? null : sizeCache, job, port: PORT };
}

/** 받기 → sha256 확인 → 풀기 → 확장 깔기. 뒤에서 돌고 status().job으로 진행을 본다 */
export function install(): Job {
  if (job && job.phase !== "끝" && job.phase !== "실패") return job;
  job = { phase: "받는 중", got: 0, total: 0, at: new Date().toISOString() };
  void doInstall().catch((e) => { job = { ...(job ?? { got: 0, total: 0, at: "" }), phase: "실패", error: String((e as Error)?.message ?? e).slice(0, 300), at: new Date().toISOString() }; });
  return job;
}
async function doInstall() {
  await mkdir(HOME(), { recursive: true });
  const tgz = path.join(HOME(), `${assetName()}.part`);
  const r = await fetch(assetUrl(), { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`받지 못했어요(HTTP ${r.status})`);
  job!.total = Number(r.headers.get("content-length")) || 0;
  const hash = createHash("sha256");
  const out = createWriteStream(tgz);
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk); job!.got += chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
  }
  await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
  job!.phase = "확인 중";
  // VSCodium은 파일마다 <이름>.sha256을 같이 낸다("해시  파일이름")
  const sum = await fetch(`${assetUrl()}.sha256`, { redirect: "follow" }).then((x) => (x.ok ? x.text() : ""), () => "");
  const want = sum.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const got = hash.digest("hex");
  if (!/^[0-9a-f]{64}$/.test(want)) throw new Error("확인용 해시(.sha256)를 받지 못했어요. 다시 시도해 주세요.");
  if (want !== got) { await rm(tgz, { force: true }); throw new Error("받은 파일이 원본과 달라요(해시 불일치). 다시 받아 주세요."); }
  job!.phase = "푸는 중";
  const tmp = `${serverDir()}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  // Windows 10 이상은 tar.exe가 들어 있다
  await run("tar", ["-xzf", tgz, "-C", tmp], 300_000);
  if (!(await exists(path.join(tmp, "bin", path.basename(bin()))))) throw new Error("풀었는데 서버 실행 파일이 없어요.");
  await rm(serverDir(), { recursive: true, force: true });
  await rename(tmp, serverDir());
  await rm(tgz, { force: true });
  job!.phase = "확장 까는 중";
  await installExtensions();
  job!.phase = "끝"; job!.at = new Date().toISOString();
}

/** .cmd는 cmd.exe로만 돈다: cmd /d /s /c ""a" "b c"" (빈칸 · 특수 문자가 든 인자만 따옴표) */
export function cmdLine(cmd: string, args: string[]) {
  const q = (a: string) => (/[\s&()^|<>"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return `"${[`"${cmd}"`, ...args.map(q)].join(" ")}"`;
}
function spawnAny(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && /\.cmd$/i.test(cmd)) return spawn("cmd.exe", ["/d", "/s", "/c", cmdLine(cmd, args)], { windowsVerbatimArguments: true, windowsHide: true, env });
  return spawn(cmd, args, { windowsHide: true, env });
}
function run(cmd: string, args: string[], ms: number, env?: NodeJS.ProcessEnv) {
  return new Promise<{ ok: boolean; out: string }>((res) => {
    const ch = spawnAny(cmd, args, env);
    let out = "";
    ch.stdout?.on("data", (d) => { out += d; }); ch.stderr?.on("data", (d) => { out += d; });
    const t = setTimeout(() => { killTree(ch); res({ ok: false, out: `${out}\n(시간 초과)` }); }, ms);
    ch.on("error", (e) => { clearTimeout(t); res({ ok: false, out: String(e) }); });
    ch.on("exit", (code) => { clearTimeout(t); res({ ok: code === 0, out }); });
  });
}
function killTree(ch: ChildProcess) {
  if (!ch.pid || ch.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true });
  else ch.kill("SIGTERM");
}

/** 공통 인자: 전용 데이터 · 확장 폴더 */
export function baseArgs() {
  return ["--server-data-dir", dataDir(), "--extensions-dir", path.join(dataDir(), "extensions")];
}
/** 우리 연결 확장(고친 버전이면 다시) + Open VSX 확장. 실패해도 편집기는 켠다(코드 찾기 · 디버그만 덜 됨) */
export async function installExtensions() {
  const vsix = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vscode-bridge", "recaller-bridge.vsix");
  const notes: string[] = [];
  if (await exists(vsix)) { const r = await run(bin(), [...baseArgs(), "--install-extension", vsix, "--force"], 120_000); if (!r.ok) notes.push(`연결 확장: ${r.out.slice(-200)}`); }
  for (const id of EXTENSIONS) { const r = await run(bin(), [...baseArgs(), "--install-extension", id], 180_000); if (!r.ok) notes.push(`${id}: ${r.out.slice(-160)}`); }
  return notes;
}

/** 연결 확장을 고쳤으면(버전이 바뀌면) 켜기 전에 다시 깐다 */
async function bridgeUpToDate() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vscode-bridge");
  const want = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8").catch(() => "{}")).version ?? "";
  const mark = path.join(dataDir(), "bridge-version");
  if (!want || (await readFile(mark, "utf8").catch(() => "")) === want) return;
  const r = await run(bin(), [...baseArgs(), "--install-extension", path.join(dir, "recaller-bridge.vsix"), "--force"], 120_000);
  if (r.ok) await writeFile(mark, want);
}

/**
 * 이 편집기에만 쓰는 설정(Machine 설정 — 사용자 VS Code에는 안 닿는다).
 * 튜터는 옆 칸에 있으니 VS Code 안 튜터 탭 · 떠 있는 창은 끈다. 처음 쓰는 사람을 위해 안내 화면 · 신뢰 묻기를 끈다.
 */
export const MACHINE_SETTINGS = {
  "recaller.openTutorBeside": false,
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.enableExperiments": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "python.languageServer": "None",
  "terminal.integrated.defaultProfile.windows": "PowerShell",
  "editor.minimap.enabled": false,
  "files.autoSave": "off",
};
async function writeSettings() {
  const f = path.join(dataDir(), "data", "Machine", "settings.json");
  await mkdir(path.dirname(f), { recursive: true });
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(await readFile(f, "utf8")); } catch { /* 처음 */ }
  await writeFile(f, JSON.stringify({ ...cur, ...MACHINE_SETTINGS }, null, 2));
}

/** 서버 인자(토큰은 파일로 — 명령 줄에 안 남게) */
export function serverArgs(tokenFile: string) {
  return ["--host", HOST, "--port", String(PORT), "--connection-token-file", tokenFile, "--disable-workspace-trust", ...baseArgs()];
}

/** 켜져 있지 않으면 켠다. 켜질 때까지(최대 30초) 기다린다 */
export async function ensureRunning() {
  if (child && child.exitCode === null && token) return;
  if (starting) return starting;
  starting = (async () => {
    if (!(await installed())) throw Object.assign(new Error("앱 안 편집기를 아직 받지 않았어요."), { status: 409 });
    await mkdir(dataDir(), { recursive: true });
    await writeSettings();
    await bridgeUpToDate();
    token = randomBytes(24).toString("hex");
    const tokenFile = path.join(dataDir(), "token");
    await writeFile(tokenFile, token, { mode: 0o600 });
    const ch = spawnServer(serverArgs(tokenFile));
    child = ch;
    let log = "";
    ch.stdout?.on("data", (d) => { log = (log + d).slice(-4000); });
    ch.stderr?.on("data", (d) => { log = (log + d).slice(-4000); });
    ch.on("exit", () => { if (child === ch) { child = null; token = ""; } });
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      if (ch.exitCode !== null) throw new Error(`편집기가 켜지다 꺼졌어요: ${log.slice(-300)}`);
      const ok = await fetch(`http://${HOST}:${PORT}/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.status < 500, () => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    killTree(ch);
    throw new Error(`편집기가 30초 안에 켜지지 않았어요: ${log.slice(-300)}`);
  })().finally(() => { starting = null; });
  return starting;
}
function spawnServer(args: string[]) {
  // 우리 연결 확장이 "앱 안 편집기"인 줄 알게(튜터 탭 · 떠 있는 창 안 띄움)
  const env = { ...process.env, RECALLER_EMBEDDED: "1", RECALLER_COURSE_PORT: process.env.PORT || "4100" };
  return spawnAny(bin(), args, env);
}
export function stop() { if (child) killTree(child); child = null; token = ""; }
process.on("exit", stop);

/** 폴더 주소: Windows 경로 C:\a\b → /C:/a/b (VS Code 웹의 folder= 는 원격 쪽 경로) */
export function folderParam(folder: string) {
  const p = folder.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(p) ? `/${p}` : p;
}
/** 실습 폴더를 연 편집기 주소(토큰 포함 — 실습 화면에만 준다) */
export async function urlFor(folder: string) {
  await ensureRunning();
  return `http://${HOST}:${PORT}/?tkn=${token}&folder=${encodeURIComponent(folderParam(folder))}`;
}
