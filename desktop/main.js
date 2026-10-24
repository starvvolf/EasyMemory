// Recaller desktop: a thin window around the local study app. The app itself is still the web app served by the
// local server (127.0.0.1:3000), so code changes show on reload (Ctrl+R) without rebuilding this shell.
// Start: the same steps as 'Recaller 시작' (code, packages, data, server). Close: the same as 'Recaller 끝내기'
// (stop the server, send this computer's data). See desktop/README.md.
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ORIGIN = "http://127.0.0.1:3000";
const START_URL = `${ORIGIN}/study`;
const isWin = process.platform === "win32";
let main = null, splash = null, quitting = false;

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

/* ---------- window size and position are remembered between runs ---------- */
const boundsFile = () => path.join(app.getPath("userData"), "window.json");
function savedBounds() { try { return JSON.parse(fs.readFileSync(boundsFile(), "utf8")); } catch { return null; } }
function saveBounds(w) { try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...w.getNormalBounds(), maximized: w.isMaximized() })); } catch { /* keep going */ } }

function openMain() {
  const b = savedBounds() || { width: 1280, height: 860 };
  main = new BrowserWindow({ ...b, minWidth: 420, minHeight: 500, title: "Recaller", show: false, autoHideMenuBar: true, backgroundColor: "#F2F3F6",
    webPreferences: { contextIsolation: true, sandbox: true } });
  if (b.maximized) main.maximize();
  // Pages of the local app stay in the window; anything else (ChatGPT sign-in, links) opens in the normal browser,
  // and the sign-in still lands on the local server, so the window just needs a reload afterwards.
  const local = (url) => url.startsWith(ORIGIN + "/");
  main.webContents.setWindowOpenHandler(({ url }) => { if (local(url)) return { action: "allow" }; shell.openExternal(url); return { action: "deny" }; });
  main.webContents.on("will-navigate", (event, url) => { if (!local(url)) { event.preventDefault(); shell.openExternal(url); } });
  main.once("ready-to-show", () => { main.show(); if (splash && !splash.isDestroyed()) splash.close(); splash = null; });
  main.on("close", () => saveBounds(main));
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
    { label: "끝내기", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
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
  openMain();
});

// Closing the window = 'Recaller 끝내기': stop the server and send this computer's data, then quit.
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  if (main && !main.isDestroyed()) { saveBounds(main); main.destroy(); }
  openSplash("끝내는 중이에요 · 서버를 끄고 데이터를 올려요");
  runScript("recaller-stop.mjs").then(async (stopped) => {
    if (stopped !== 0) {
      splashTitle("데이터를 올리지 못했어요. 다음에 켤 때 다시 시도해요.");
      await new Promise((r) => setTimeout(r, 3500));
    }
    app.exit(0);
  });
});
app.on("window-all-closed", () => { if (!quitting) app.quit(); });
process.on("uncaughtException", (error) => { dialog.showErrorBox("Recaller", String(error && error.stack || error)); });
