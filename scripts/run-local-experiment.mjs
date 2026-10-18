import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const child = spawn(process.execPath, [
  path.join(process.cwd(), "node_modules/next/dist/bin/next"),
  "dev",
  "--hostname",
  "127.0.0.1",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STUDY_FORGE_LOCAL_EXPERIMENT: "1",
    STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
    // In-app generation with the signed-in ChatGPT account (docs/DECISIONS.md 2026-09-30). Set to 0 to keep
    // the MCP chat executor only.
    STUDY_FORGE_AUTO_EXECUTOR: process.env.STUDY_FORGE_AUTO_EXECUTOR ?? "1",
    STUDY_FORGE_MODEL_PROVIDER: process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt",
    STUDY_FORGE_CHATGPT_ENCRYPTION_KEY: chatGptTokenKey(),
  },
  stdio: "inherit",
});

// 태블릿 모드: a paired-device gate on the home network (scripts/tablet-proxy.mjs). Set STUDY_FORGE_TABLET=0 to turn off.
const tablet = process.env.STUDY_FORGE_TABLET === "0" ? null : startTabletProxy({ projectRoot: process.cwd() });

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
  if (tablet) tablet.close();
  process.exit(process.exitCode);
});
