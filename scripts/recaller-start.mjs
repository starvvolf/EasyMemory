// Start steps of the Recaller app (desktop/main.js runs this with --no-open): get the latest code, install packages only when they changed,
// take the other computer's data, start the local server and open the study screen.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...options });
// Node itself runs without a shell: its path is often "C:\\Program Files\\nodejs\\node.exe", and cmd splits it at the space.
const node = (script, args = []) => spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
const quiet = (command, args) => (spawnSync(command, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32" }).stdout ?? "").trim();

console.log("① 코드 받기");
const before = quiet("git", ["rev-parse", "HEAD"]);
if (run("git", ["pull", "--ff-only"]).status !== 0) console.warn("   코드를 받지 못했어요(인터넷·충돌). 지금 코드로 계속해요.");
const after = quiet("git", ["rev-parse", "HEAD"]);

if (!existsSync(path.join(root, "node_modules")) || (before !== after && quiet("git", ["diff", "--name-only", before, after]).split(/\r?\n/).includes("package-lock.json"))) {
  console.log("② 패키지 설치(바뀐 것이 있어요)");
  if (run("npm", ["install"]).status !== 0) { console.error("   패키지 설치에 실패했어요."); process.exit(1); }
}

console.log("③ 데이터 받기");
const sync = path.join(root, "scripts", "recaller-sync.mjs");
if (node(sync, ["setup"]).status !== 0 || node(sync, ["pull"]).status !== 0) process.exit(1);

console.log("④ 앱 서버 켜기");
if (node(path.join(root, "scripts", "start-server.mjs")).status !== 0) process.exit(1);
const url = "http://127.0.0.1:3000/study";
// The desktop app (desktop/main.js) runs this with --no-open and shows the page in its own window.
if (process.argv.includes("--no-open")) console.log("   준비됐어요.");
else {
  if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
  console.log(`   ${url} 을 열었어요. 이 방법은 개발용이에요. 보통은 Recaller 앱으로 켜고 끕니다.`);
}
