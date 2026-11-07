// 튜터 브라우저(11/8 결정 8 "브라우저는 MCP 쓰는 거, 오케이"): 학습자 컴퓨터 안의 페이지(localhost)를 보이지 않는 창으로 열고
// 제목 · 상태 · 화면 글 · 눌러 볼 것들 · 콘솔 메시지 · 화면 사진을 JSON 한 줄로 내보낸 뒤 끝난다. 코스 서버(lib/browse.ts)가 부른다.
// 웹 글을 주소로 가져오는 기능은 만들지 않는다(사용자 결정) → 주소 검사는 lib/browse.ts가 하고, 여기서도 한 번 더 막는다.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const url = process.env.PC_BROWSE_URL || "";
const waitMs = Math.min(10000, Math.max(0, Number(process.env.PC_BROWSE_WAIT) || 1200));
const shot = process.env.PC_BROWSE_SHOT || "";
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
const done = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); app.exit(0); };
if (!LOCAL.test(url)) { process.stdout.write(JSON.stringify({ error: "내 컴퓨터 안 주소(localhost)만 열 수 있어요" }) + "\n"); process.exit(0); }

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "recaller-browse-")));
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  const consoleMsgs = [];
  let status = null, failed = null;
  // 페이지가 밖으로 나가는 요청(외부 스크립트 · 이미지 등)은 막지 않지만, 주 문서는 localhost만
  session.defaultSession.webRequest.onCompleted({ urls: ["*://*/*"] }, (d) => { if (d.resourceType === "mainFrame") status = d.statusCode; });
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { offscreen: false, sandbox: true, contextIsolation: true, javascript: true } });
  win.webContents.on("console-message", (_e, level, message, line, source) => { if (consoleMsgs.length < 40) consoleMsgs.push(`${["log", "warn", "error", "error"][level] || "log"}: ${String(message).slice(0, 300)}${source ? ` (${path.basename(String(source))}:${line})` : ""}`); });
  win.webContents.on("did-fail-load", (_e, code, desc, u, isMain) => { if (isMain) failed = `${desc} (${code})`; });
  win.webContents.on("will-navigate", (e, u) => { if (!LOCAL.test(u)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const timer = setTimeout(() => done({ error: "20초 안에 페이지가 안 열렸어요", console: consoleMsgs }), 20000);
  try { await win.loadURL(url); } catch (e) { /* did-fail-load에서 잡음 */ }
  if (failed) { clearTimeout(timer); return done({ error: `페이지를 열지 못했어요: ${failed}`, console: consoleMsgs }); }
  await new Promise((r) => setTimeout(r, waitMs));
  let info = {};
  try {
    info = await win.webContents.executeJavaScript(`(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const t = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "").trim().replace(/\\s+/g, " ").slice(0, 60);
      const items = [...document.querySelectorAll("a, button, input, select, textarea, [role=button]")].filter(vis).slice(0, 40)
        .map((el) => el.tagName.toLowerCase() + (el.type && el.tagName === "INPUT" ? "[" + el.type + "]" : "") + (el.id ? "#" + el.id : "") + " " + t(el));
      return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : "").slice(0, 5000), controls: items };
    })()`);
  } catch (e) { info = { error: `페이지 내용을 못 읽었어요: ${e.message}` }; }
  let shotFile = null;
  if (shot) { try { const img = await win.webContents.capturePage(); fs.writeFileSync(shot, img.toPNG()); shotFile = shot; } catch { /* 사진은 없어도 된다 */ } }
  clearTimeout(timer);
  done({ status, ...info, console: consoleMsgs, shot: shotFile });
});
