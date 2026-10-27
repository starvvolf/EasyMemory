// Keeps the Recaller data folder (made problems, registered PDFs, notes, study records) in the private
// RecallerData repository, so the desktop and the laptop take turns with one history (협업/두컴퓨터에서_쓰기.md).
//   node scripts/recaller-sync.mjs setup   clone RecallerData beside this project and point .env.local at it
//   node scripts/recaller-sync.mjs pull    take the other computer's changes (run before starting the app)
//   node scripts/recaller-sync.mjs push    save this computer's changes (run after stopping the app)
// Sign-in tokens never go there: they stay in this project's .study-forge-data/chatgpt-auth.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "https://github.com/starvvolf/RecallerData.git";
const envFile = path.join(projectRoot, ".env.local");

function configuredDir() {
  if (process.env.STUDY_FORGE_DATA_DIR?.trim()) return process.env.STUDY_FORGE_DATA_DIR.trim();
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, "utf8").split(/\r?\n/).find((row) => /^\s*STUDY_FORGE_DATA_DIR\s*=/.test(row));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : null;
}
const defaultDir = () => path.resolve(projectRoot, "..", "RecallerData");

function git(dir, args, { quiet = false } = {}) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: quiet ? "pipe" : ["ignore", "inherit", "inherit"] });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}
function fail(message) { console.error(`\n[데이터 동기화] ${message}`); process.exit(1); }

/** Saves local changes as one commit (nothing to do when unchanged). */
function commitLocal(dir) {
  if (!git(dir, ["status", "--porcelain"], { quiet: true }).out) return false;
  git(dir, ["add", "-A"]);
  return git(dir, ["-c", "user.name=Recaller", "-c", "user.email=recaller@localhost", "commit", "-q", "-m", `data: ${os.hostname()} ${new Date().toISOString()}`]).ok;
}
/**
 * Takes the other computer's commits. On a clash the other side wins line by line; study records are one-line files,
 * and the study screen merges them again with this browser's copy (newer save per material wins), so nothing studied is lost.
 */
function pullRemote(dir) {
  if (!git(dir, ["pull", "--no-rebase", "--no-edit", "-X", "theirs", "origin", "main"]).ok) {
    git(dir, ["merge", "--abort"], { quiet: true });
    fail("다른 컴퓨터의 데이터를 받지 못했어요. 인터넷 연결과 GitHub 로그인을 확인해 주세요. 이 컴퓨터 데이터는 그대로 있어요.");
  }
}

const command = process.argv[2];
let dir = configuredDir();

// A data folder that already has files but is not a RecallerData clone (a test data folder set in .env.local):
// nothing to sync — say so and let the app start with it, instead of trying to clone over it.
const nonEmpty = (d) => { try { return readdirSync(d).length > 0; } catch { return false; } };
if (dir && ["setup", "pull", "push"].includes(command) && !existsSync(path.join(dir, ".git")) && nonEmpty(dir)) {
  console.log(`[데이터 동기화] ${dir} 는 RecallerData 저장소가 아니라서(테스트용 데이터 폴더) 동기화를 건너뛰어요. 다른 컴퓨터와 데이터가 공유되지 않아요.`);
  process.exit(0);
}

if (command === "setup") {
  dir = dir ?? defaultDir();
  if (!existsSync(path.join(dir, ".git"))) {
    console.log(`[데이터 동기화] RecallerData를 ${dir}에 받아요…`);
    const clone = spawnSync("git", ["clone", REMOTE, dir], { stdio: "inherit" });
    if (clone.status !== 0) fail("RecallerData를 받지 못했어요. GitHub에 로그인돼 있는지 확인해 주세요(비공개 저장소).");
  }
  if (!configuredDir()) {
    const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    const line = `STUDY_FORGE_DATA_DIR=${dir}`;
    if (text && !text.endsWith("\n")) appendFileSync(envFile, "\n");
    appendFileSync(envFile, `# 만든 문제·PDF·풀이 기록은 비공개 RecallerData 저장소에 둔다(scripts/recaller-sync.mjs)\n${line}\n`);
    console.log(`[데이터 동기화] .env.local에 ${line} 을 넣었어요.`);
  }
  console.log("[데이터 동기화] 준비됐어요.");
} else if (command === "pull" || command === "push") {
  if (!dir || !existsSync(path.join(dir, ".git"))) fail("데이터 저장소가 아직 없어요. 먼저 `node scripts/recaller-sync.mjs setup`을 실행해 주세요.");
  const saved = commitLocal(dir);
  pullRemote(dir);
  if (command === "push" || saved) {
    if (!git(dir, ["push", "-q", "origin", "HEAD:main"]).ok) fail("데이터를 올리지 못했어요. 다음에 끝낼 때 다시 올라가요(이 컴퓨터 데이터는 그대로 있어요).");
  }
  console.log(`[데이터 동기화] ${command === "pull" ? "다른 컴퓨터의 데이터를 받았어요" : "이 컴퓨터의 데이터를 올렸어요"}.`);
} else {
  fail("사용법: node scripts/recaller-sync.mjs setup|pull|push");
}

