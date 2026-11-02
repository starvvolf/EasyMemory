// 튜터 창 (11/2): VS Code 창 오른쪽 안쪽에 붙어 따라다니는 항상-위 창. 코스 서버(lib/float.ts)가 띄운다.
// - VS Code 창 위치는 PowerShell 하나가 0.2초마다 Windows에 물어 한 줄(JSON)씩 알려 준다(설치 없음).
// - VS Code나 이 창이 앞에 있을 때만 보이고, VS Code를 내리면 같이 숨는다.
// - VS Code에서 타이핑하는 동안(코스 서버가 알려 줌)은 흐려지고 클릭이 뒤의 코드로 통과한다. 📌 고정이면 안 흐려진다.
// - 코스 서버가 "닫기"라고 하거나 10초 넘게 연락이 안 되면 스스로 꺼진다.
const { app, BrowserWindow, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const COURSE = (process.env.PC_COURSE || "http://127.0.0.1:4100").replace(/\/$/, "");
const WIDTH = 440, TOP = 64, BOTTOM = 40, EDGE = 14, FADED = 0.22;

app.setName("Recaller 튜터 창");
if (!app.requestSingleInstanceLock()) app.quit();

let win = null, shownUrl = "", state = null, fails = 0, faded = false, vs = { fg: 0, wins: [] };

/* ---------- VS Code 창 위치 (Windows) ---------- */
const PS = String.raw`
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class RW {
  public delegate bool P(IntPtr h, IntPtr l);
  public struct R { public int L, T, Ri, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[RW]::SetProcessDPIAware() | Out-Null
$ids = @{}; $tick = 0
while ($true) {
  if ($tick % 10 -eq 0) { $ids = @{}; Get-Process -Name Code -ErrorAction SilentlyContinue | ForEach-Object { $ids[[uint32]$_.Id] = 1 } }
  $tick++
  $list = New-Object System.Collections.ArrayList
  $cb = [RW+P]{ param($h, $l)
    if ([RW]::IsWindowVisible($h)) {
      $p = [uint32]0; [RW]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      if ($ids.ContainsKey($p)) {
        $sb = New-Object System.Text.StringBuilder 512; [RW]::GetWindowText($h, $sb, 512) | Out-Null; $t = $sb.ToString()
        if ($t -like "*Visual Studio Code*") {
          $r = New-Object RW+R; [RW]::GetWindowRect($h, [ref]$r) | Out-Null
          [void]$list.Add([ordered]@{ h = [int64]$h; t = $t; x = $r.L; y = $r.T; w = $r.Ri - $r.L; hh = $r.B - $r.T; m = [RW]::IsIconic($h) })
        }
      }
    }
    $true }
  [RW]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  $o = [ordered]@{ fg = [int64][RW]::GetForegroundWindow(); wins = @($list) }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  Start-Sleep -Milliseconds 200
}
`;
function watchVsCode() {
  if (process.platform !== "win32") return;
  const file = path.join(os.tmpdir(), "recaller-float-watch.ps1");
  fs.writeFileSync(file, "﻿" + PS);
  const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
  let buf = "";
  ps.stdout.setEncoding("utf8");
  ps.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith("{")) { try { vs = JSON.parse(line); vs.wins = [].concat(vs.wins || []); place(); } catch { /* 다음 줄 */ } }
    }
  });
  ps.on("exit", () => { if (!app.isQuitting) setTimeout(watchVsCode, 2000); });
  app.on("before-quit", () => { app.isQuitting = true; ps.kill(); });
}

/* ---------- 창 ---------- */
const folderOf = (ws) => (ws ? path.basename(String(ws).replace(/\\/g, "/").replace(/\/$/, "")) : "");
const pageUrl = (s) => `${COURSE}/?embed=1&float=1&theme=dark&root=${encodeURIComponent(s.workspace || "")}#/run/${s.runId}`;

function create() {
  win = new BrowserWindow({ width: WIDTH, height: 720, frame: false, alwaysOnTop: true, show: false, resizable: true, minimizable: false, maximizable: false,
    title: "Recaller 튜터", backgroundColor: "#1f1f1f", webPreferences: { contextIsolation: true, sandbox: true } });
  win.setAlwaysOnTop(true, "floating");
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(COURSE)) shell.openExternal(url); return { action: "deny" }; });
  win.on("closed", () => { win = null; app.quit(); });
}

/** VS Code 창(이 진행 기록의 작업 폴더가 제목에 든 것)을 찾아 그 오른쪽 안쪽에 붙인다 */
function place() {
  if (!win || !state) return;
  const name = folderOf(state.workspace);
  const target = vs.wins.find((w) => name && w.t.includes(name)) || vs.wins.find((w) => w.h === vs.fg);
  if (!target) { if (!win.isVisible() && shownUrl) { const a = screen.getPrimaryDisplay().workArea; win.setBounds({ x: a.x + a.width - WIDTH - EDGE, y: a.y + TOP, width: WIDTH, height: a.height - TOP - BOTTOM }); win.showInactive(); } return; }
  if (target.m) { if (win.isVisible()) win.hide(); return; }
  const front = vs.fg === target.h || win.isFocused();
  if (!front) { if (win.isVisible()) win.hide(); return; }
  const r = process.platform === "win32" ? screen.screenToDipRect(null, { x: target.x, y: target.y, width: target.w, height: target.hh }) : { x: target.x, y: target.y, width: target.w, height: target.hh };
  const b = { x: Math.round(r.x + r.width - WIDTH - EDGE), y: Math.round(r.y + TOP), width: WIDTH, height: Math.max(320, Math.round(r.height - TOP - BOTTOM)) };
  const now = win.getBounds();
  if (Math.abs(now.x - b.x) + Math.abs(now.y - b.y) + Math.abs(now.height - b.height) > 2 || now.width !== WIDTH) win.setBounds(b);
  if (!win.isVisible()) win.showInactive();
}

function fade(on) {
  if (!win || on === faded) return;
  faded = on;
  win.setOpacity(on ? FADED : 1);
  win.setIgnoreMouseEvents(on, { forward: true });
}

async function poll() {
  try {
    const r = await fetch(`${COURSE}/api/float`, { signal: AbortSignal.timeout(2000) });
    state = await r.json();
    fails = 0;
  } catch {
    if (++fails > 40) app.quit();
    return;
  }
  if (!state.open || !state.runId) { app.quit(); return; }
  if (!win) create();
  const url = pageUrl(state);
  if (url !== shownUrl) { shownUrl = url; win.loadURL(url); }
  fade(!!state.editing);
  place();
}

app.whenReady().then(() => {
  watchVsCode();
  poll();
  setInterval(poll, 250);
});
app.on("window-all-closed", () => {});
