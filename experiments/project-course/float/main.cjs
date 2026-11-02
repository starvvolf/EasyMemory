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

const LOGF = process.env.PC_FLOAT_LOG || path.join(os.tmpdir(), "recaller-float.log");
const log = (t) => { try { fs.appendFileSync(LOGF, `${new Date().toISOString()} [창] ${t}\n`); } catch { /* */ } };
process.on("uncaughtException", (e) => log(`오류: ${e && e.stack || e}`));
const COURSE = (process.env.PC_COURSE || "http://127.0.0.1:4100").replace(/\/$/, "");
const WIDTH = 440, PILL = 60, TOP = 64, BOTTOM = 40, EDGE = 14, FADED = 0.22;

app.setName("Recaller 튜터 창");
if (!app.requestSingleInstanceLock()) app.quit();

let onTop = true, win = null, shownUrl = "", state = null, fails = 0, faded = false, vs = { fg: 0, wins: [] };

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
  let buf = "", errs = 0, first = true;
  ps.stderr.setEncoding("utf8");
  ps.stderr.on("data", (d) => { if (errs++ < 20) log(`PowerShell: ${String(d).slice(0, 400)}`); });
  ps.stdout.setEncoding("utf8");
  ps.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith("{")) { try { vs = JSON.parse(line); vs.wins = [].concat(vs.wins || []); if (first) { first = false; log(`VS Code 창 ${vs.wins.length}개: ${vs.wins.map((w) => w.t).join(" | ")}`); } place(); } catch (e) { log(`읽기 실패: ${e.message}`); } }
    }
  });
  ps.on("exit", () => { if (!app.isQuitting) setTimeout(watchVsCode, 2000); });
  app.on("before-quit", () => { app.isQuitting = true; ps.kill(); });
}

/* ---------- 창 ---------- */
// 작업 폴더 이름은 "<진행 기록 id>-<템플릿>"(예: 58d01294b7-hello)이고 VS Code 제목에 들어 있다 → 앞에 있는 VS Code가 어느 기록인지 안다
const runOfTitle = (t) => (/\b([0-9a-f]{10})-[a-z]+\b/.exec(t || "") || [])[1] || null;
const pageUrl = (runId) => `${COURSE}/?embed=1&float=1&theme=dark#/run/${runId}`;
let followed = 0; // 따라다니는 VS Code 창

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
  // 앞에 있는 VS Code(작업 폴더 창)를 따라간다. 다른 프로그램이 앞이면 마지막에 따라가던 창
  const ours = vs.wins.filter((w) => runOfTitle(w.t));
  const target = ours.find((w) => w.h === vs.fg) || ours.find((w) => w.h === followed) || null;
  if (target) {
    followed = target.h;
    const url = pageUrl(runOfTitle(target.t));
    if (url !== shownUrl) { shownUrl = url; win.loadURL(url); }
  }
  if (!target) { if (!win.isVisible() && shownUrl) { const a = screen.getPrimaryDisplay().workArea; win.setBounds({ x: a.x + a.width - WIDTH - EDGE, y: a.y + TOP, width: WIDTH, height: a.height - TOP - BOTTOM }); win.showInactive(); } return; }
  if (target.m) { if (win.isVisible()) win.hide(); return; }
  // 다른 데(다른 모니터 등)를 눌러도 사라지지 않는다(11/2 사용자). 대신 VS Code나 이 창이 앞에 있을 때만 "항상 위",
  // 그 밖에는 보통 창이 되어 다른 프로그램이 위로 오면 그 밑으로 간다.
  const front = vs.fg === target.h || win.isFocused();
  if (front !== onTop) { onTop = front; win.setAlwaysOnTop(front, "floating"); }
  const r = process.platform === "win32" ? screen.screenToDipRect(null, { x: target.x, y: target.y, width: target.w, height: target.hh }) : { x: target.x, y: target.y, width: target.w, height: target.hh };
  // 크기 셋(11/2): 기본(오른쪽 세로) · 펼침(VS Code의 3분의 2, 코드 설명) · 띠(타이핑하는 동안 한 줄)
  const size = state.size || "normal";
  const w = size === "wide" ? Math.round(Math.min(920, Math.max(WIDTH, r.width * 0.68))) : WIDTH;
  const hgt = size === "pill" ? PILL : Math.max(320, Math.round(r.height - TOP - BOTTOM));
  const b = { x: Math.round(r.x + r.width - w - EDGE), y: Math.round(r.y + TOP), width: w, height: hgt };
  const now = win.getBounds();
  if (Math.abs(now.x - b.x) + Math.abs(now.y - b.y) + Math.abs(now.height - b.height) + Math.abs(now.width - b.width) > 2) win.setBounds(b);
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
    const r = await fetch(`${COURSE}/api/float?w=1`, { signal: AbortSignal.timeout(2000) });
    state = await r.json();
    fails = 0;
  } catch {
    if (++fails > 40) app.quit();
    return;
  }
  if (!state.open || !state.runId) { app.quit(); return; }
  if (!win) create();
  // VS Code 작업 폴더 창을 아직 못 찾았으면 서버가 말한 기록으로
  if (!shownUrl) { shownUrl = pageUrl(state.runId); win.loadURL(shownUrl); }
  fade(false); // 흐리게 하던 것(19:47 안)은 접기로 바꿈
  place();
}

app.whenReady().then(() => {
  log(`켜짐 (${COURSE})`);
  watchVsCode();
  poll();
  setInterval(poll, 250);
});
app.on("window-all-closed", () => {});
