// 루트별 실험 서버 (2026-10-31, PS 루트): the engine lab server's way (scripts/run-engine-lab.mjs) for any route, so the
// three knowledge routes (PS, 프로젝트, 글·PDF) can try things at the same time without writing into each other's data.
// The knowledge store keeps its writes in order only inside one server, so two servers must never share a data folder.
//   node scripts/run-lab.mjs --name ps --port 3003 [--data tmp/lab-ps/data] [--dist .next-lab-ps] [--seed] [--env K=V ...]
//   - its own build folder and tsconfig (tsconfig.lab-<name>.json, made here), its own data folder, the same ChatGPT sign-in
//   - --seed: the first time only (the data folder does not exist yet), copy the main app's knowledge/ and code/ in, so the
//     experiment starts from what the learner already has. The main data is only read.
//   - Everything it prints goes to tmp/lab-<name>.log. Restarts after 3 seconds if it stops by itself (as the engine lab).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback; };
const name = opt("name", "");
if (!/^[a-z][a-z0-9-]{1,20}$/.test(name)) { console.error("--name 이 필요해요 (영문 소문자, 예: ps)."); process.exit(1); }
const port = Number(opt("port", "0"));
if (!Number.isInteger(port) || port < 1024 || [3000, 3001, 3002, 4100, 4101].includes(port)) { console.error("--port 가 필요해요 (3000·3001·3002·4100·4101은 이미 쓰는 번호)."); process.exit(1); }
const dataDir = path.resolve(root, opt("data", path.join("tmp", `lab-${name}`, "data")));
const distDir = opt("dist", `.next-lab-${name}`);
const tsconfig = `tsconfig.lab-${name}.json`;
const logFile = path.join(root, "tmp", `lab-${name}.log`);
const extra = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "--env" && /^[A-Z][A-Z0-9_]*=/.test(a) ? [[a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]] : [])));

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
// The main app's data folder, as .env.local names it (read only).
function mainDataDir() {
  try {
    const line = readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).find((l) => /^\s*STUDY_FORGE_DATA_DIR\s*=/.test(l));
    const v = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    return v ? path.resolve(root, v) : path.join(root, ".study-forge-data");
  } catch { return path.join(root, ".study-forge-data"); }
}

mkdirSync(path.join(root, "tmp"), { recursive: true });
const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
const log = (text) => { try { appendFileSync(logFile, text); } catch { /* the log is a help */ } };
const note = (line) => { const text = `[${stamp()}] ${line}\n`; process.stdout.write(text); log(text); };

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  if (args.includes("--seed")) {
    const from = mainDataDir();
    for (const part of ["knowledge", "code"]) {
      const src = path.join(from, part);
      if (existsSync(src)) { cpSync(src, path.join(dataDir, part), { recursive: true }); note(`본 데이터의 ${part}/를 복사했어요 (${src}).`); }
    }
  }
}
if (!existsSync(path.join(root, tsconfig))) {
  writeFileSync(path.join(root, tsconfig), `${JSON.stringify({ "//": `실험 서버 ${name}(${port}, scripts/run-lab.mjs)만 쓰는 설정. next dev가 켤 때 ${distDir} 경로를 여기에 쓴다.`,
    extends: "./tsconfig.json", include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", `${distDir}/types/**/*.ts`, `${distDir}/dev/types/**/*.ts`] }, null, 2)}\n`);
}

const env = {
  ...process.env,
  // Set before Next reads .env.local, so these win over it (Next never overwrites a variable that is already set).
  STUDY_FORGE_DATA_DIR: dataDir,
  RECALLER_NEXT_DIST_DIR: distDir,
  RECALLER_NEXT_TSCONFIG: tsconfig,
  RECALLER_LAB: name,
  STUDY_FORGE_LOCAL_EXPERIMENT: "1",
  STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
  STUDY_FORGE_MODEL_PROVIDER: process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt",
  STUDY_FORGE_CHATGPT_ENCRYPTION_KEY: chatGptTokenKey(),
  ...extra,
};

const portTaken = () => new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
});

let child = null, stopping = false, starts = 0, startedAt = 0, inUse = false;
function start() {
  starts++; startedAt = Date.now(); inUse = false;
  note(`실험 서버 ${name} 시작 (${starts}번째): http://127.0.0.1:${port} · 데이터 ${dataDir} · 기록 ${logFile}${Object.keys(extra).length ? ` · ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}`);
  child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (c) => { process.stdout.write(c); log(c); if (/EADDRINUSE/.test(String(c))) inUse = true; });
  child.stderr.on("data", (c) => { process.stderr.write(c); log(c); if (/EADDRINUSE/.test(String(c))) inUse = true; });
  child.on("exit", (code, signal) => {
    note(`서버가 멈췄어요 (종료 코드 ${code ?? "-"}, 신호 ${signal ?? "-"}).`);
    child = null;
    if (stopping) return;
    if (inUse) { note(`${port}번을 이미 다른 프로그램이 쓰고 있어요.`); process.exit(1); }
    if (Date.now() - startedAt < 60_000) { note(`켜진 지 1분 안에 멈춰서 다시 켜지 않아요. 위의 오류를 확인해 주세요 (${logFile}).`); process.exit(1); }
    if (starts >= 20) { note("너무 자주 멈춰서 다시 켜지 않아요."); process.exit(1); }
    note("3초 뒤 다시 켜요.");
    setTimeout(start, 3000);
  });
}
const stop = () => { stopping = true; if (child) child.kill(); setTimeout(() => process.exit(0), 1500); };
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
if (await portTaken()) { note(`${port}번에 이미 서버가 켜져 있어요: http://127.0.0.1:${port} (이 창은 닫아도 돼요).`); process.exit(1); }
start();
