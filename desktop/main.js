// Recaller desktop (배포판): 이 폴더 하나로 돈다. 코드 · 데이터를 어디서 받거나 올리지 않는다.
// 켤 때(로딩 창): 처음 한 번 화면 빌드(next build) → 앱 서버(next start, 127.0.0.1:3000) → 실습 서버(127.0.0.1:4100) → 창.
// 데이터는 이 폴더의 data/(바꾸려면 STUDY_FORGE_DATA_DIR), 실습 데이터는 data/course. 끌 때: 확인 → 실습 서버 · 앱 서버 끄기.
// 코드를 고치면 다음에 켤 때 저절로 다시 빌드한다(src 등이 빌드보다 새로우면). README.md 참고.
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.RECALLER_PORT || 3000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const START_URL = `${ORIGIN}/study`;
const COURSE_ORIGIN = (process.env.PROJECT_COURSE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");
const isWin = process.platform === "win32";
let main = null, splash = null, quitting = false, confirmed = false, course = null, appServer = null;
const killTree = (child) => {
  if (!child || child.exitCode !== null) return;
  try { if (isWin) require("node:child_process").execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else child.kill(); } catch { /* already gone */ }
};

// 데이터: 이 폴더의 data/ (환경 변수로 바꿀 수 있음). 처음 켤 때 만든다.
const DATA = path.resolve(root, process.env.STUDY_FORGE_DATA_DIR || "data");
const COURSE_DATA = path.resolve(process.env.PC_DATA_DIR || path.join(DATA, "course"));
fs.mkdirSync(COURSE_DATA, { recursive: true });
// ChatGPT 로그인 토큰은 암호화해 둔다. 열쇠는 데이터 폴더가 아니라 사용자 홈에(데이터 폴더를 남에게 줘도 토큰은 못 씀).
function tokenKey() {
  if (process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) return process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY.trim();
  const file = path.join(require("node:os").homedir(), ".study-forge", "chatgpt-token-key");
  try { const k = fs.readFileSync(file, "utf8").trim(); if (/^[a-f0-9]{64}$/i.test(k)) return k; } catch { /* new key */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const k = require("node:crypto").randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${k}\n`, { mode: 0o600 });
  return k;
}
const ENV = { ...process.env, FORCE_COLOR: "0", NEXT_TELEMETRY_DISABLED: "1",
  STUDY_FORGE_DATA_DIR: DATA, STUDY_FORGE_AUTH_DIR: process.env.STUDY_FORGE_AUTH_DIR || DATA,
  STUDY_FORGE_LOCAL_EXPERIMENT: "1", STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1", RECALLER_DESKTOP: "1",
  STUDY_FORGE_AUTO_EXECUTOR: process.env.STUDY_FORGE_AUTO_EXECUTOR || "1", STUDY_FORGE_MODEL_PROVIDER: process.env.STUDY_FORGE_MODEL_PROVIDER || "chatgpt",
  STUDY_FORGE_CHATGPT_ENCRYPTION_KEY: tokenKey(),
  PROJECT_COURSE_URL: COURSE_ORIGIN, PROJECT_COURSE_AUTOSTART: "0", PC_DATA_DIR: COURSE_DATA };
// 다른 포트로 켜면(예: 같은 PC에 다른 Recaller가 있을 때) 창 크기 · 저장소 · 한 번만 켜기 자물쇠를 따로 쓴다
if (PORT !== 3000) app.setPath("userData", path.join(app.getPath("appData"), `Recaller-${PORT}`));
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { const w = main || splash; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

/* ---------- small status window while the start steps run ---------- */
const splashHtml = (title) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Recaller</title><style>
body{margin:0;font-family:"Pretendard Variable","Malgun Gothic",system-ui,sans-serif;background:#F2F3F6;color:#17191F;display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 32px;box-sizing:border-box}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 16px;color:#666C78;font-size:14px}
pre{margin:0;background:#fff;border:1px solid #E3E5EA;border-radius:12px;padding:12px 14px;font:12.5px/1.6 Consolas,monospace;height:150px;overflow:auto;white-space:pre-wrap}
</style></head><body><h1>Recaller</h1><p id="t">${title}</p><pre id="log"></pre></body></html>`;
function openSplash(title) {
  splash = new BrowserWindow({ width: 520, height: 340, resizable: false, show: true, title: "Recaller", autoHideMenuBar: true, webPreferences: { sandbox: true } });
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHtml(title)));
}
function splashLine(text) {
  if (!splash || splash.isDestroyed()) return;
  const safe = JSON.stringify(String(text).replace(/\x1b\[[0-9;]*m/g, ""));
  splash.webContents.executeJavaScript(`(() => { const l = document.getElementById("log"); l.textContent += ${safe}; l.scrollTop = l.scrollHeight; })()`).catch(() => {});
}
function splashTitle(text) {
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`document.getElementById("t").textContent = ${JSON.stringify(text)}`).catch(() => {});
}

/* ---------- 시스템 node로 돌리기(Electron의 node가 아니라) · 줄마다 로딩 창에 ---------- */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, shell: isWin, windowsHide: true, env: ENV, ...opts });
    child.stdout.on("data", (d) => splashLine(d.toString()));
    child.stderr.on("data", (d) => splashLine(d.toString()));
    child.on("error", (error) => { splashLine(`\n${error.message}\n`); resolve(1); });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
async function up(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).status < 500; } catch { return false; } }
function systemNodeMajor() {
  try { return Number(/v(\d+)/.exec(require("node:child_process").execSync("node -v", { encoding: "utf8", windowsHide: true }))?.[1] ?? 0); } catch { return 0; }
}
const nextBin = () => path.join(root, "node_modules", "next", "dist", "bin", "next");
const q = (p) => (isWin ? `"${p}"` : p);

/* ---------- 화면 빌드: 처음 한 번, 그리고 코드가 빌드보다 새로우면 ---------- */
function newestIn(dir, skip = new Set(["node_modules", ".next", "data", "tmp", ".git"])) {
  let t = 0;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of list) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newestIn(p, skip));
    else { try { t = Math.max(t, fs.statSync(p).mtimeMs); } catch { /* gone */ } }
  }
  return t;
}
function needsBuild() {
  let built = 0;
  try { built = fs.statSync(path.join(root, ".next", "BUILD_ID")).mtimeMs; } catch { return true; }
  const code = Math.max(newestIn(path.join(root, "src")), ...["package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"].map((f) => { try { return fs.statSync(path.join(root, f)).mtimeMs; } catch { return 0; } }));
  return code > built;
}

/* ---------- 앱 서버: next start (빌드한 화면) ---------- */
async function startApp() {
  if (await up(`${ORIGIN}/api/local-experiment/status`)) { splashLine(`앱 서버가 이미 켜져 있어요(${PORT}).\n`); return 0; }
  if (!fs.existsSync(nextBin())) { splashLine("앱 패키지가 없어요. 'Recaller 켜기.cmd'로 켜 주세요(처음 한 번 설치해요).\n"); return 1; }
  if (needsBuild()) {
    splashTitle("처음 한 번 화면을 만들어요 · 1분쯤 걸려요");
    splashLine("① 화면 만들기(next build)\n");
    if (await run(q(process.env.RECALLER_NODE || "node"), [q(nextBin()), "build"]) !== 0) { splashLine("\n화면을 만들지 못했어요.\n"); return 1; }
    // 빌드 캐시(약 70MB)는 다음 빌드를 조금 빠르게 할 뿐이라 지운다(배포판은 작게)
    try { fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true }); } catch { /* 남아도 됨 */ }
    splashTitle("켜는 중이에요 · 앱 서버와 실습 서버를 켜요");
  }
  splashLine(`② 앱 서버 켜기(127.0.0.1:${PORT}) · 데이터: ${DATA}\n`);
  appServer = spawn(q(process.env.RECALLER_NODE || "node"), [q(nextBin()), "start", "--hostname", "127.0.0.1", "-p", String(PORT)], { cwd: root, shell: isWin, windowsHide: true, env: ENV });
  appServer.stdout.on("data", (d) => splashLine(d.toString()));
  appServer.stderr.on("data", (d) => splashLine(d.toString()));
  appServer.on("error", (e) => splashLine(`${e.message}\n`));
  for (let i = 0; i < 90; i++) {
    if (appServer.exitCode !== null) { splashLine(`\n앱 서버가 꺼졌어요. ${PORT}번 포트를 다른 프로그램이 쓰고 있지 않은지 확인해 주세요.\n`); return 1; }
    if (await up(`${ORIGIN}/api/local-experiment/status`)) return 0;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 1;
}

/* ---------- 실습 서버: 앱과 같이 켜고 같이 끈다 ---------- */
async function startCourse() {
  if (await up(`${COURSE_ORIGIN}/api/status`)) return;
  const dir = path.join(root, "experiments", "project-course");
  splashLine(`③ 실습 서버 켜기(${COURSE_ORIGIN})\n`);
  // 튜터(OpenCode)는 Node 24가 필요하다: 이 PC의 node가 24 이상이면 그대로, 아니면 켜기 파일이 받아 둔 .node24로. 둘 다 없으면 튜터 없이.
  const node24 = path.join(dir, ".node24", "node_modules", ".bin", isWin ? "node.cmd" : "node");
  const sdk = fs.existsSync(path.join(dir, "node_modules", "@opencode", "sdk", "package.json"));
  const runner = systemNodeMajor() >= 24 ? "node" : fs.existsSync(node24) ? q(node24) : null;
  const useOc = sdk && !!runner;
  course = spawn(useOc ? runner : "node", ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/main.ts"],
    { cwd: dir, shell: isWin, windowsHide: true, stdio: "ignore", env: { ...ENV, PC_NO_OPEN: "1", PC_OPEN: "", PC_PORT: new URL(COURSE_ORIGIN).port } });
  course.on("error", () => { course = null; });
  splashLine(`   뒤에서 켜요(${useOc ? "튜터 포함" : "튜터 없이: OpenCode가 없어요"}).\n`);
}
function stopCourse() {
  killTree(course);
  course = null;
}

/* ---------- 글 → PDF (11/9 사용자 "웹 글을 자료로, 이미지 포함을 고른 경우만 페이지 그대로"): 글만일 때는 앱 서버가 만든
   HTML(글자만, 바깥 주소 없음)을 이 창에서 PDF로 인쇄한다. 이 PC 안에서만(127.0.0.1, 임의 포트 + 토큰을 tmp/print-port에). ---------- */
const crypto = require("node:crypto");
const http = require("node:http");
let printServer = null;
function startPrintService() {
  const token = crypto.randomBytes(16).toString("hex");
  const noWeb = session.fromPartition("recaller-print");
  // 인쇄 창은 인터넷에 나가지 않는다: data: 주소만
  noWeb.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith("data:") }));
  printServer = http.createServer((req, res) => {
    const fail = (code, msg) => { res.writeHead(code, { "content-type": "text/plain; charset=utf-8" }); res.end(msg); };
    if (req.method !== "POST" || req.url !== "/pdf" || req.headers["x-print-token"] !== token) return fail(403, "no");
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on("end", async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { session: noWeb, javascript: false, sandbox: true } });
      try {
        await win.loadURL("data:text/html;charset=utf-8;base64," + Buffer.from(body, "utf8").toString("base64"));
        const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "default" } });
        res.writeHead(200, { "content-type": "application/pdf" }); res.end(pdf);
      } catch (error) { fail(500, String(error && error.message || error)); }
      finally { if (!win.isDestroyed()) win.destroy(); }
    });
  });
  printServer.listen(0, "127.0.0.1", () => {
    try { fs.mkdirSync(path.join(root, "tmp"), { recursive: true }); fs.writeFileSync(path.join(root, "tmp", "print-port"), JSON.stringify({ port: printServer.address().port, token })); } catch { /* 글 → PDF만 안 됨 */ }
  });
}
function stopPrintService() {
  try { fs.unlinkSync(path.join(root, "tmp", "print-port")); } catch { /* gone */ }
  if (printServer) { printServer.close(); printServer = null; }
}

/* ---------- closing asks first (X, Ctrl+Q, menu) ---------- */
async function askQuit(win) {
  if (confirmed) return true;
  const { response } = await dialog.showMessageBox(win, { type: "question", buttons: ["끝내기", "취소"], defaultId: 0, cancelId: 1, noLink: true,
    title: "Recaller", message: "Recaller를 끝낼까요?", detail: "공부 기록을 저장하고 서버(앱 · 실습)를 꺼요. 데이터는 이 컴퓨터의 data 폴더에 남아요." });
  confirmed = response === 0;
  return confirmed;
}

/* ---------- window size and position are remembered between runs ---------- */
const boundsFile = () => path.join(app.getPath("userData"), "window.json");
function savedBounds() { try { return JSON.parse(fs.readFileSync(boundsFile(), "utf8")); } catch { return null; } }
function saveBounds(w) { try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...w.getNormalBounds(), maximized: w.isMaximized() })); } catch { /* keep going */ } }

// The window has no separate title bar: the app's own top bar (tabs) sits in it and Windows draws ㅁ x on top, in the
// app's ground color. The page styles that bar when <html data-shell="desktop"> (src/app/study/dejipgi.css).
const BAR_HEIGHT = 40;
const barColors = () => nativeTheme.shouldUseDarkColors ? { color: "#0F1115", symbolColor: "#E9EBEF" } : { color: "#F2F3F6", symbolColor: "#17191F" };

function openMain() {
  const b = savedBounds() || { width: 1280, height: 860 };
  main = new BrowserWindow({ ...b, minWidth: 420, minHeight: 500, title: "Recaller", show: false, autoHideMenuBar: true, backgroundColor: barColors().color,
    titleBarStyle: "hidden", titleBarOverlay: { ...barColors(), height: BAR_HEIGHT },
    webPreferences: { contextIsolation: true, sandbox: true } });
  if (b.maximized) main.maximize();
  // Pages of the local app stay in the window; anything else (ChatGPT sign-in, links) opens in the normal browser,
  // and the sign-in still lands on the local server, so the window just needs a reload afterwards.
  // The project course server (127.0.0.1:4100: notes, new project) is local too, so it opens in a Recaller window.
  const local = (url) => url.startsWith(ORIGIN + "/") || url.startsWith(COURSE_ORIGIN + "/") || url === COURSE_ORIGIN;
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (local(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 1180, height: 820, autoHideMenuBar: true, title: "Recaller", webPreferences: { contextIsolation: true, sandbox: true } } };
    shell.openExternal(url); return { action: "deny" };
  });
  main.webContents.on("will-navigate", (event, url) => { if (!local(url)) { event.preventDefault(); shell.openExternal(url); } });
  main.webContents.on("dom-ready", () => main.webContents.executeJavaScript('document.documentElement.dataset.shell = "desktop"').catch(() => {}));
  nativeTheme.on("updated", () => { if (main && !main.isDestroyed()) main.setTitleBarOverlay({ ...barColors(), height: BAR_HEIGHT }); });
  main.once("ready-to-show", () => { main.show(); if (splash && !splash.isDestroyed()) splash.close(); splash = null; });
  main.on("close", (event) => {
    if (confirmed || quitting) { saveBounds(main); return; }
    event.preventDefault();
    void askQuit(main).then((ok) => { if (ok) app.quit(); });
  });
  main.on("closed", () => { main = null; });
  main.loadURL(START_URL);
}

const menu = Menu.buildFromTemplate([
  { label: "Recaller", submenu: [
    { label: "다시 불러오기", accelerator: "CmdOrCtrl+R", click: () => main && main.webContents.reload() },
    { label: "처음 화면", click: () => main && main.loadURL(START_URL) },
    { type: "separator" },
    { label: "브라우저로 열기", click: () => shell.openExternal(main ? main.webContents.getURL() : START_URL) },
    { label: "데이터 폴더 열기", click: () => shell.openPath(DATA) },
    { type: "separator" },
    { label: "끝내기", accelerator: "CmdOrCtrl+Q", click: () => { if (main) main.close(); else app.quit(); } },
  ] },
  { label: "보기", submenu: [
    { role: "zoomIn", label: "크게" }, { role: "zoomOut", label: "작게" }, { role: "resetZoom", label: "원래 크기" },
    { role: "togglefullscreen", label: "전체 화면" },
    { type: "separator" }, { role: "toggleDevTools", label: "개발자 도구" },
  ] },
]);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(menu);
  openSplash("켜는 중이에요 · 앱 서버와 실습 서버를 켜요");
  const code = await startApp();
  if (code !== 0) {
    splashTitle("켜지 못했어요. 아래 기록을 확인해 주세요.");
    return;
  }
  await startCourse();
  startPrintService();
  openMain();
});

// 창 닫기 = Recaller 끝내기: 화면이 하던 것을 남기고, 실습 서버 · 앱 서버를 끄고 끝낸다.
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // 11/11 (B): 화면이 하던 것을 먼저 남긴다(알고리즘 문제를 풀던 중이면 문제 한 장). 창은 아직 보여서 "남기는 중" 미니 탭이 보인다. 4초까지만 기다린다.
  const page = main && !main.isDestroyed() ? main : null;
  const flush = page ? Promise.race([page.webContents.executeJavaScript("window.__recallerBeforeQuit ? window.__recallerBeforeQuit().then((n) => (n ? new Promise((r) => setTimeout(r, 900)) : null)) : null").catch(() => null), new Promise((r) => setTimeout(r, 4000))]) : Promise.resolve();
  void flush.then(() => shutDown());
});
function shutDown() {
  if (main && !main.isDestroyed()) { saveBounds(main); main.destroy(); }
  stopPrintService();
  openSplash("끝내는 중이에요 · 서버를 꺼요");
  splashLine("① 실습 서버 끄기\n");
  stopCourse();
  splashLine("② 앱 서버 끄기\n");
  killTree(appServer); appServer = null;
  setTimeout(() => app.exit(0), 600);
}
app.on("window-all-closed", () => { if (!quitting) app.quit(); });
// The loading window closed before the app opened (it failed): nothing to save, just stop what was started.
app.on("will-quit", () => { stopCourse(); killTree(appServer); });
process.on("uncaughtException", (error) => { dialog.showErrorBox("Recaller", String(error && error.stack || error)); });
