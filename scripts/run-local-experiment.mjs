import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { startTabletProxy } from "./tablet-proxy.mjs";

// ChatGPT tokens are stored encrypted (required on Windows). The key lives in the user's home folder,
// not next to the tokens in the project data folder, and stays the same across runs.
function chatGptTokenKey() {
  const given = process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY?.trim();
  if (given) return given;
  const file = path.join(homedir(), ".study-forge", "chatgpt-token-key");
  if (existsSync(file)) {
    const stored = readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(stored)) return stored;
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows keeps the user-profile ACL. */ }
  return key;
}

// 서버가 혼자 죽으면 다시 켠다 (2026-11-05 A 앱 한 바퀴 점검): 켜진 채로 코드를 받을 때(git pull) next dev가 두 번 꺼졌고,
// 로그가 없어 이유도 몰랐다. 출력은 tmp/server.log에 남기고, 끄기(recaller-stop.mjs)가 표시한 경우가 아니면 다시 켠다
// (10분 안에 5번까지).
const logFile = path.join(process.cwd(), "tmp", "server.log");
const stopMark = path.join(process.cwd(), "tmp", "server-stopping");
mkdirSync(path.dirname(logFile), { recursive: true });
try { if (statSync(logFile).size > 5_000_000) writeFileSync(logFile, ""); } catch { /* new log */ }
try { rmSync(stopMark, { force: true }); } catch { /* none */ }
const note = (line) => { try { appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`); } catch { /* log is best effort */ } };
const env = {
  ...process.env,
  STUDY_FORGE_LOCAL_EXPERIMENT: "1",
  STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
  // In-app generation with the signed-in ChatGPT account (docs/DECISIONS.md 2026-09-30). Set to 0 to keep
  // the MCP chat executor only.
  STUDY_FORGE_AUTO_EXECUTOR: process.env.STUDY_FORGE_AUTO_EXECUTOR ?? "1",
  STUDY_FORGE_MODEL_PROVIDER: process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt",
  STUDY_FORGE_CHATGPT_ENCRYPTION_KEY: chatGptTokenKey(),
};

// 태블릿 모드: a paired-device gate on the home network (scripts/tablet-proxy.mjs). Set STUDY_FORGE_TABLET=0 to turn off.
const tablet = process.env.STUDY_FORGE_TABLET === "0" ? null : startTabletProxy({ projectRoot: process.cwd() });

const restarts = [];
function startNext() {
  note("앱 서버 켜기");
  const out = openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1"],
    { cwd: process.cwd(), env, stdio: ["ignore", out, out] });
  child.on("exit", (code, signal) => {
    const stopping = existsSync(stopMark);
    note(`앱 서버가 꺼졌어요 (코드 ${code}, 신호 ${signal ?? "-"})${stopping ? " — 끄기" : ""}`);
    const now = Date.now();
    while (restarts.length && now - restarts[0] > 10 * 60_000) restarts.shift();
    if (!stopping && restarts.length < 5) { restarts.push(now); note("3초 뒤 다시 켜요"); setTimeout(startNext, 3000); return; }
    try { rmSync(stopMark, { force: true }); } catch { /* none */ }
    process.exitCode = code ?? 1;
    if (tablet) tablet.close();
    process.exit(process.exitCode);
  });
}
startNext();
