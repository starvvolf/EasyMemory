// 엔진 실험 서버 (2026-10-28, 협업/스레드분담_20261028.md): a second local server for the engine thread (C), so engine
// experiments never stop or mix with the main app (127.0.0.1:3000) the other threads use.
//   - http://127.0.0.1:3002 (3001 is the tablet gate), its own build folder .next-engine, its own tsconfig
//     (tsconfig.engine.json), its own data folder tmp/engine-data (PDFs to try: tmp/engine-data/mcp-sources).
//   - The same ChatGPT sign-in as the main app (the sign-in lives in .study-forge-data/chatgpt-auth, not the data folder).
//   - Everything it prints, and why it stopped, goes to tmp/engine-lab.log. If the server stops by itself it is started
//     again after 3 seconds; closing the window stops it for good.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_PORT = 3002;
const dataDir = process.env.RECALLER_ENGINE_DATA_DIR?.trim() || path.join(root, "tmp", "engine-data");
const logFile = path.join(root, "tmp", "engine-lab.log");

// The same key the main server uses for the encrypted ChatGPT tokens (scripts/run-local-experiment.mjs).
function chatGptTokenKey() {
  const given = process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY?.trim();
  if (given) return given;
  const file = path.join(homedir(), ".study-forge", "chatgpt-token-key");
  if (existsSync(file)) { const stored = readFileSync(file, "utf8").trim(); if (/^[a-f0-9]{64}$/i.test(stored)) return stored; }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows keeps the user-profile ACL. */ }
  return key;
}

mkdirSync(path.join(dataDir, "mcp-sources"), { recursive: true });
const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
const log = (text) => { try { appendFileSync(logFile, text); } catch { /* the log is a help */ } };
const note = (line) => { const text = `[${stamp()}] ${line}\n`; process.stdout.write(text); log(text); };
const env = {
  ...process.env,
  // Set before Next reads .env.local, so these win over it (Next never overwrites a variable that is already set).
  STUDY_FORGE_DATA_DIR: dataDir,
  RECALLER_NEXT_DIST_DIR: ".next-engine",
  STUDY_FORGE_LOCAL_EXPERIMENT: "1",
  STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
  STUDY_FORGE_AUTO_EXECUTOR: process.env.STUDY_FORGE_AUTO_EXECUTOR ?? "1",
  STUDY_FORGE_MODEL_PROVIDER: process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt",
  STUDY_FORGE_CHATGPT_ENCRYPTION_KEY: chatGptTokenKey(),
};

let child = null, stopping = false, starts = 0;
function start() {
  starts++;
  note(`엔진 실험 서버 시작 (${starts}번째): http://127.0.0.1:${ENGINE_PORT}/lab/gen · 데이터 ${dataDir} · 기록 ${logFile}`);
  child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(ENGINE_PORT)],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (c) => { process.stdout.write(c); log(c); });
  child.stderr.on("data", (c) => { process.stderr.write(c); log(c); });
  child.on("exit", (code, signal) => {
    note(`서버가 멈췄어요 (종료 코드 ${code ?? "-"}, 신호 ${signal ?? "-"}).`);
    child = null;
    if (stopping) return;
    if (starts >= 20) { note("너무 자주 멈춰서 다시 켜지 않아요. tmp/engine-lab.log를 확인해 주세요."); process.exit(1); }
    note("3초 뒤 다시 켜요.");
    setTimeout(start, 3000);
  });
}
const stop = () => { stopping = true; if (child) child.kill(); setTimeout(() => process.exit(0), 1500); };
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
start();
