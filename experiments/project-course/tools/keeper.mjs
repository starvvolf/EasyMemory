// 코스 서버 지킴이(11/3, 사용자 "내가 cmd를 다시 안 켜도 계속 실험 가능하게"):
// 코스 서버(4100)를 켜 두고, 꺼지면 다시 켜고, .data/control/restart 파일이 바뀌면 껐다 켠다.
// 원격 세션은 PC 폴더에 git pull 한 뒤 이 파일만 건드리면 새 코드로 다시 켜진다.
// 상태는 .data/control/status.json, 서버 출력은 .data/control/server.log
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CTL = path.join(ROOT, ".data", "control");
mkdirSync(CTL, { recursive: true });
const RESTART = path.join(CTL, "restart");
const STATUS = path.join(CTL, "status.json");
const LOG = path.join(CTL, "server.log");
if (!existsSync(RESTART)) writeFileSync(RESTART, "");

const win = process.platform === "win32";
const node24 = path.join(ROOT, ".node24", "node_modules", ".bin", win ? "node.cmd" : "node");
const useOc = existsSync(node24) && existsSync(path.join(ROOT, "node_modules", "@opencode", "sdk", "package.json"));
const st = { keeperPid: process.pid, startedAt: new Date().toISOString(), server: null, restarts: 0, lastReason: "", lastExit: null };
const save = () => { try { writeFileSync(STATUS, JSON.stringify(st, null, 1)); } catch { /* */ } };
const log = (t) => { try { appendFileSync(LOG, `[${new Date().toISOString()}] [지킴이] ${t}\n`); } catch { /* */ } };

/** 4100·4101·4102에 남은 서버만 끈다(3000 앱은 건드리지 않는다) */
function freePorts() {
  if (!win) return;
  try {
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      "Get-NetTCPConnection -State Listen -LocalPort 4100,4101,4102 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"], { stdio: "ignore", timeout: 15000 });
  } catch { /* */ }
}

let child = null;
let stopping = false;
function start(reason) {
  freePorts();
  // 서버 로그가 너무 커지지 않게: 2MB 넘으면 비운다
  try { if (statSync(LOG).size > 2_000_000) writeFileSync(LOG, ""); } catch { /* */ }
  log(`서버 켬 (${reason})`);
  const args = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/main.ts"];
  // .data/control/env.json: 원격 실험용 환경 값(예: {"PC_OLDER_LIMIT": "2500"}). 다시 켤 때마다 읽는다
  let extra = {};
  try { extra = JSON.parse(readFileSync(path.join(CTL, "env.json"), "utf8")); } catch { /* 없으면 그대로 */ }
  child = spawn(useOc ? node24 : process.execPath, args, { cwd: ROOT, env: { ...process.env, ...extra, PC_NO_OPEN: "1", PC_OPEN: "" }, shell: useOc && win, windowsHide: true });
  if (Object.keys(extra).length) log(`환경 값: ${JSON.stringify(extra)}`);
  child.stdout.on("data", (d) => appendFileSync(LOG, d));
  child.stderr.on("data", (d) => appendFileSync(LOG, d));
  st.server = { pid: child.pid, startedAt: new Date().toISOString(), engine: useOc ? "node24+OpenCode" : `node ${process.version}` };
  st.lastReason = reason; save();
  child.on("exit", (code) => {
    st.lastExit = { code, at: new Date().toISOString() }; st.server = null; save();
    log(`서버 꺼짐 (코드 ${code})`);
    child = null;
    if (!stopping) setTimeout(() => start("꺼져서 다시"), 3000);
  });
}
function restart(reason) {
  st.restarts++;
  if (!child) return start(reason);
  stopping = true;
  const c = child;
  c.once("exit", () => { stopping = false; start(reason); });
  if (win) { try { execFileSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" }); } catch { c.kill(); } } else c.kill();
}

let mark = statSync(RESTART).mtimeMs;
setInterval(() => {
  try {
    const m = statSync(RESTART).mtimeMs;
    if (m !== mark) { mark = m; const why = readFileSync(RESTART, "utf8").trim().slice(0, 200) || "다시 켜기 요청"; restart(why); }
  } catch { /* */ }
}, 2000);
start("지킴이 시작");
process.on("SIGINT", () => { stopping = true; child?.kill(); process.exit(0); });
