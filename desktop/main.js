// Recaller desktop: the one way to run Recaller (2026-11-05, 사용자 "electron recaller앱만 실행하면 전부 되게").
// The app itself is the web app served by the local server (127.0.0.1:3000), so code changes show on reload (Ctrl+R).
// Start (loading window): code, packages, data, app server (scripts/recaller-start.mjs), then the 실습 course server
// (127.0.0.1:4100, experiments/project-course/tools/keeper.mjs, kept as this app's child). Close (X or Ctrl+Q): asks
// first, then stops the course server and the app server and sends this computer's data (scripts/recaller-stop.mjs).
// Experiment servers (lab/) are not part of this. See desktop/README.md.
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ORIGIN = "http://127.0.0.1:3000";
const START_URL = `${ORIGIN}/study`;
const COURSE_ORIGIN = (process.env.PROJECT_COURSE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");
const isWin = process.platform === "win32";
let main = null, splash = null, quitting = false, confirmed = false, course = null;

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

/* ---------- run a project script with the system node (not Electron's) ---------- */
function runScript(script, args = []) {
  return new Promise((resolve) => {
    // shell is needed on Windows to find node on PATH; quote the script path in case the folder has spaces.
    const file = path.join(root, "scripts", script);
    const child = spawn("node", [isWin ? `"${file}"` : file, ...args], { cwd: root, shell: isWin, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } });
    child.stdout.on("data", (d) => splashLine(d.toString()));
    child.stderr.on("data", (d) => splashLine(d.toString()));
    child.on("error", (error) => { splashLine(`\n${error.message}\n`); resolve(1); });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/* ---------- 실습 course server: started with the app, stopped with it ---------- */
async function up(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).status < 500; } catch { return false; } }
async function startCourse() {
  if (process.env.PROJECT_COURSE_AUTOSTART === "0" || await up(`${COURSE_ORIGIN}/api/status`)) return;
  const dir = path.join(root, "experiments", "project-course");
  if (!fs.existsSync(path.join(dir, "tools", "keeper.mjs"))) return;
  splashLine("⑤ 실습 코스 서버 켜기\n");
  course = spawn("node", [isWin ? `"${path.join(dir, "tools", "keeper.mjs")}"` : path.join(dir, "tools", "keeper.mjs")], { cwd: dir, shell: isWin, windowsHide: true, stdio: "ignore", env: { ...process.env, PC_NO_OPEN: "1" } });
  course.on("error", () => { course = null; });
  // 11/9 사용자 "실습서버 안기다리기": 켜지는 것을 기다리지 않고 창을 연다(전에는 최대 10초). 실습 탭이 열 때 확인한다.
  splashLine("   뒤에서 켜요(실습 탭을 열 때 확인해요).\n");
}
function stopCourse() {
  if (!course || course.exitCode !== null) return;
  try { if (isWin) require("node:child_process").execFileSync("taskkill", ["/PID", String(course.pid), "/T", "/F"], { stdio: "ignore" }); else course.kill(); } catch { /* already gone */ }
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
    title: "Recaller", message: "Recaller를 끝낼까요?", detail: "공부 기록을 저장하고, 서버를 끄고, 이 컴퓨터의 데이터를 올려요." });
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
    { label: "데이터 폴더 열기", click: () => shell.openPath(path.resolve(root, "..", "RecallerData")) },
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
  openSplash("켜는 중이에요 · 코드와 데이터를 받고 서버를 켜요");
  const code = await runScript("recaller-start.mjs", ["--no-open"]);
  if (code !== 0) {
    splashTitle("켜지 못했어요. 아래 기록을 확인해 주세요.");
    return;
  }
  await startCourse();
  // After 'scripts/recaller-data.mjs archive' (데이터 보관하고 새로 시작): the window's own storage held old records too.
  const fresh = path.join(root, "tmp", "fresh-start");
  if (fs.existsSync(fresh)) {
    splashLine("⑥ 새로 시작: 창에 남은 예전 기록 비우기\n");
    await session.defaultSession.clearStorageData({ storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"] }).catch(() => {});
    try { fs.unlinkSync(fresh); } catch { /* next start clears again */ }
  }
  startPrintService();
  openMain();
});

// Closing the window = 'Recaller 끝내기': stop the server and send this computer's data, then quit.
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
  openSplash("끝내는 중이에요 · 서버를 끄고 데이터를 올려요");
  splashLine("① 실습 코스 서버 끄기\n");
  stopCourse();
  runScript("recaller-stop.mjs").then(async (stopped) => {
    if (stopped !== 0) {
      splashTitle("데이터를 올리지 못했어요. 다음에 켤 때 다시 시도해요.");
      await new Promise((r) => setTimeout(r, 3500));
    }
    app.exit(0);
  });
}
app.on("window-all-closed", () => { if (!quitting) app.quit(); });
// The loading window closed before the app opened (it failed): nothing to save, just stop what was started.
app.on("will-quit", () => stopCourse());
process.on("uncaughtException", (error) => { dialog.showErrorBox("Recaller", String(error && error.stack || error)); });
