// Recaller 튜터 연결 (화면 없는 VS Code 확장). 의존 패키지 없음.
// VS Code → Recaller(127.0.0.1:4100): 보는 파일·줄, 드래그한 부분, 저장 안 한 내용, 빨간 줄, 저장, "튜터에게 묻기"
// Recaller → VS Code: 줄 열고 강조(open), 빈칸 뼈대 넣기(blank, Ctrl+Z로 되돌림), 줄 옆 안내 글(note), 지우기(clear)
// 학습자 작업 폴더(.recaller/stage.json)와 시작 폴더(.recaller/lobby.json, 코스 정하기)에서만 켜진다.
// 튜터 탭 안의 화면이 "이 폴더를 열어 줘"라고 하면(코스 확정·이어 하기) 이 창을 그 폴더로 바꾼다.
const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.RECALLER_COURSE_PORT || 4100);

let root = null;          // 작업 폴더
let runId = null;
let stream = null;        // 명령을 받는 연결
let retryTimer = null;
let reportTimer = null;
let status = null;
let deco = null;
let decoTimer = null;
let lastSent = "";
let dimDeco = null;       // 오늘 안 볼 덩어리: 흐리게
let labelDeco = null;     // 덩어리 이름표
let labelFocusDeco = null;
let focus = null;         // { file, chunks: [{ anchor, label, desc, focus }] }
let panel = null;         // 오른쪽 튜터 탭
let lastEditor = null;    // 튜터 탭을 누르고 있어도 "보던 코드"를 기억
let autoOpened = false;
let myVersion = "0";
let panelOnline = null;   // 튜터 탭이 지금 튜터 화면(true)인지 "꺼져 있어요" 안내(false)인지
let offlineTimer = null;
let updateAsked = false;
let lobby = false;         // 시작 폴더(아직 코스 없음)

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: HOST, port: PORT, method, path: url, agent: false,
      headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
        if (res.statusCode >= 400) reject(new Error((json && json.error) || `${res.statusCode}`)); else resolve(json);
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("시간 초과")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
const inRoot = (doc) => doc && doc.uri.scheme === "file" && !path.relative(root, doc.uri.fsPath).startsWith("..");
const absOf = (file) => path.join(root, ...file.split("/"));

function setStatus(text, tooltip, connected) {
  status.text = text;
  status.tooltip = tooltip;
  vscode.commands.executeCommand("setContext", "recaller.connected", !!connected);
}

/* ---------- 연결 ---------- */
async function connect() {
  clearTimeout(retryTimer);
  if (stream) { stream.destroy(); stream = null; }
  try {
    const hello = await request("POST", "/api/bridge/hello", { root, vscode: vscode.version, version: myVersion });
    runId = hello.runId;
    lobby = !!hello.lobby;
    clearTimeout(offlineTimer);
    if (panel && panelOnline !== true) renderTutor();
    if (hello.update && !updateAsked) {
      updateAsked = true;
      vscode.window.showInformationMessage("Recaller 튜터 연결이 새 버전으로 바뀌었어요. 창을 다시 불러오면 적용돼요.", "다시 불러오기")
        .then((pick) => { if (pick) vscode.commands.executeCommand("workbench.action.reloadWindow"); });
    }
    if (lobby) {
      setStatus("$(mortar-board) Recaller", "코스를 정하는 곳이에요. 누르면 오른쪽에 튜터가 열려요.", false);
      if (!autoOpened && vscode.workspace.getConfiguration("recaller").get("openTutorBeside", true)) { autoOpened = true; openTutor(); }
      retryTimer = setTimeout(connect, 10000); // 코스 프로그램이 꺼지면 알아채려고 가끔 확인
      return;
    }
    setStatus("$(mortar-board) Recaller 연결됨", `튜터와 이어졌어요 (${hello.stage}단계). 누르면 오른쪽에 튜터가 열려요. 코드를 드래그하고 우클릭 → "이건 뭐예요?"`, true);
    if (!autoOpened && vscode.workspace.getConfiguration("recaller").get("openTutorBeside", true)) { autoOpened = true; openTutor(); }
    listen();
    scheduleReport(0);
  } catch (e) {
    setStatus("$(debug-disconnect) Recaller", `튜터 화면(127.0.0.1:${PORT})에 연결하지 못했어요. 프로젝트코스 실험.cmd가 켜져 있는지 확인하세요. (${e.message})`, false);
    goOfflineSoon();
    retryTimer = setTimeout(connect, 4000);
  }
}

function listen() {
  const req = http.get({ host: HOST, port: PORT, path: `/api/bridge/events?run=${encodeURIComponent(runId)}`, agent: false, headers: { accept: "text/event-stream" } }, (res) => {
    if (res.statusCode !== 200) { res.resume(); retryTimer = setTimeout(connect, 4000); return; }
    stream = req;
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (data) { try { handle(JSON.parse(data)); } catch (e) { console.error("[recaller]", e); } }
      }
    });
    res.on("end", () => { setStatus("$(debug-disconnect) Recaller", "연결이 끊겼어요. 다시 잇는 중…", false); goOfflineSoon(); retryTimer = setTimeout(connect, 3000); });
  });
  req.on("error", () => { setStatus("$(debug-disconnect) Recaller", "연결이 끊겼어요. 다시 잇는 중…", false); goOfflineSoon(); retryTimer = setTimeout(connect, 3000); });
}

/* ---------- VS Code → 튜터: 지금 상황 ---------- */
function scheduleReport(ms = 500) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(report, ms);
}
async function report() {
  if (!runId) return;
  const ed = vscode.window.activeTextEditor || lastEditor;
  let state = { file: null };
  if (ed && inRoot(ed.document)) {
    const doc = ed.document;
    const sel = ed.selection;
    const errors = vscode.languages.getDiagnostics(doc.uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error && d.code !== 2307 && d.code !== 2580)
      .slice(0, 10).map((d) => ({ line: d.range.start.line + 1, message: d.message }));
    state = {
      file: rel(doc.uri.fsPath), line: sel.active.line + 1,
      selection: sel.isEmpty ? null : { from: sel.start.line + 1, to: sel.end.line + 1, text: doc.getText(sel).slice(0, 4000) },
      dirty: doc.isDirty, text: doc.isDirty ? doc.getText().slice(0, 40000) : null, errors,
    };
  }
  const key = JSON.stringify(state);
  if (key === lastSent) return;
  lastSent = key;
  try { await request("POST", "/api/bridge/state", { runId, ...state }); } catch { /* 다음에 다시 */ }
}

/* ---------- 튜터 → VS Code: 명령 ---------- */
async function openAt(file, line, toLine) {
  const doc = await vscode.workspace.openTextDocument(absOf(file));
  const ed = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One, preserveFocus: !!panel && panel.active });
  const l = Math.max(0, Math.min(doc.lineCount - 1, (line || 1) - 1));
  const end = Math.max(l, Math.min(doc.lineCount - 1, (toLine || line || 1) - 1));
  const range = new vscode.Range(l, 0, end, doc.lineAt(end).text.length);
  ed.selection = new vscode.Selection(l, doc.lineAt(l).firstNonWhitespaceCharacterIndex, l, doc.lineAt(l).firstNonWhitespaceCharacterIndex);
  ed.revealRange(range, vscode.TextEditorRevealType.InCenter);
  return { ed, doc, range };
}
function findLine(doc, anchor, from = 0) {
  for (let i = from; i < doc.lineCount; i++) if (doc.lineAt(i).text.includes(anchor)) return i;
  return -1;
}
function mark(ed, range, note) {
  clearTimeout(decoTimer);
  ed.setDecorations(deco, [{ range, renderOptions: note ? { after: { contentText: `  ← ${note}` } } : undefined }]);
  decoTimer = setTimeout(() => ed.setDecorations(deco, []), 15000);
}

/* ---------- 지도: 덩어리 이름표 + 오늘 안 볼 곳 흐리게 ---------- */
function applyFocus() {
  for (const ed of vscode.window.visibleTextEditors) {
    if (!focus || !inRoot(ed.document) || rel(ed.document.uri.fsPath) !== focus.file) {
      ed.setDecorations(dimDeco, []); ed.setDecorations(labelDeco, []); ed.setDecorations(labelFocusDeco, []);
      continue;
    }
    const doc = ed.document;
    const starts = focus.chunks.map((c) => ({ c, line: findLine(doc, c.anchor) })).filter((x) => x.line >= 0).sort((a, b) => a.line - b.line);
    const dims = [], labels = [], labelsOn = [];
    starts.forEach((x, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].line - 1 : doc.lineCount - 1;
      if (!x.c.focus && end >= x.line) dims.push(new vscode.Range(x.line, 0, end, doc.lineAt(end).text.length));
      const text = `   ◀ ${x.c.label}${x.c.desc ? ` · ${x.c.desc}` : ""}`;
      const item = { range: new vscode.Range(x.line, 0, x.line, doc.lineAt(x.line).text.length), renderOptions: { after: { contentText: text } } };
      (x.c.focus ? labelsOn : labels).push(item);
    });
    ed.setDecorations(dimDeco, dims);
    ed.setDecorations(labelDeco, labels);
    ed.setDecorations(labelFocusDeco, labelsOn);
  }
}

async function handle(cmd) {
  if (cmd.type === "open") {
    const { ed, range } = await openAt(cmd.file, cmd.line, cmd.toLine);
    if (cmd.highlight !== false) mark(ed, range, cmd.note);
    applyFocus();
  } else if (cmd.type === "note") {
    const { ed } = await openAt(cmd.file, cmd.line);
    const doc = ed.document;
    const l = Math.max(0, cmd.line - 1);
    mark(ed, new vscode.Range(l, 0, l, doc.lineAt(l).text.length), cmd.note);
  } else if (cmd.type === "blank") {
    // 준비된 빈칸 뼈대로 [from, to] 줄을 바꾼다. 편집 기록에 남아 Ctrl+Z로 되돌릴 수 있다.
    const doc = await vscode.workspace.openTextDocument(absOf(cmd.file));
    const a = findLine(doc, cmd.from);
    const b = cmd.to ? findLine(doc, cmd.to, Math.max(0, a)) : a;
    if (a < 0 || b < 0) { vscode.window.showWarningMessage("Recaller: 빈칸을 넣을 자리를 찾지 못했어요. 이미 고친 것 같아요."); report(); return; }
    const indent = doc.lineAt(a).text.match(/^\s*/)[0];
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const text = cmd.text.split("\n").map((l) => (l ? indent + l : l)).join(eol);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(a, 0, b, doc.lineAt(b).text.length), text);
    await vscode.workspace.applyEdit(edit);
    const { ed } = await openAt(cmd.file, a + 1, a + cmd.text.split("\n").length);
    await vscode.window.showTextDocument(ed.document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    applyFocus();
    mark(ed, new vscode.Range(a, 0, a + cmd.text.split("\n").length - 1, 0), cmd.note || "빈칸 ①②③…을 채우고 저장하세요");
  } else if (cmd.type === "focus") {
    focus = { file: cmd.file, chunks: cmd.chunks || [] };
    applyFocus();
  } else if (cmd.type === "clearFocus") {
    focus = null;
    applyFocus();
  } else if (cmd.type === "clear") {
    for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(deco, []);
  } else if (cmd.type === "toast") {
    vscode.window.showInformationMessage(`Recaller: ${cmd.text}`);
  }
  scheduleReport(300);
}

/* ---------- 튜터에게 묻기 (복붙 없이) ---------- */
async function ask() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !inRoot(ed.document) || !runId) { vscode.window.showWarningMessage("Recaller: 작업 폴더의 코드에서 써 주세요."); return; }
  const sel = ed.selection;
  const from = sel.start.line, to = sel.isEmpty ? sel.start.line : sel.end.line;
  const text = sel.isEmpty ? ed.document.lineAt(from).text : ed.document.getText(sel);
  const question = await vscode.window.showInputBox({ title: "튜터에게 묻기", prompt: `${rel(ed.document.uri.fsPath)} ${from + 1}${to > from ? `~${to + 1}` : ""}번째 줄`, placeHolder: "비워 두면 \"이 코드가 뭐 하는 거예요?\"로 물어요" });
  if (question === undefined) return;
  try {
    await request("POST", "/api/bridge/ask", { runId, file: rel(ed.document.uri.fsPath), from: from + 1, to: to + 1, code: text.slice(0, 4000), question: question.trim() });
    vscode.window.setStatusBarMessage("$(check) 튜터에게 보냈어요. Recaller 화면에 답이 와요.", 4000);
  } catch (e) {
    vscode.window.showErrorMessage(`Recaller: 보내지 못했어요 (${e.message})`);
  }
}

/* ---------- 이건 뭐예요? (입력 없이 바로, 물음표 주머니로) ---------- */
async function what() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !inRoot(ed.document) || !runId) { vscode.window.showWarningMessage("Recaller: 작업 폴더의 코드에서 써 주세요."); return; }
  const doc = ed.document;
  let range = ed.selection;
  if (range.isEmpty) {
    const word = doc.getWordRangeAtPosition(range.active, /[\w.$?]+|=>|\?\?/);
    range = word || doc.lineAt(range.active.line).range;
  }
  const code = doc.getText(range);
  try {
    await request("POST", "/api/bridge/ask", { runId, mode: "what", file: rel(doc.uri.fsPath), from: range.start.line + 1, to: range.end.line + 1, code: code.slice(0, 4000) });
    vscode.window.setStatusBarMessage("$(question) 튜터에게 물었어요. Recaller 화면에 답이 와요.", 4000);
  } catch (e) {
    vscode.window.showErrorMessage(`Recaller: 보내지 못했어요 (${e.message})`);
  }
}

/* ---------- 오른쪽 튜터 탭 ---------- */
function themeName() {
  const k = vscode.window.activeColorTheme.kind; // 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight
  return k === 1 || k === 4 ? "light" : "dark";
}
async function openTutor() {
  if (panel) { panel.reveal(vscode.ViewColumn.Two, true); return; }
  panel = vscode.window.createWebviewPanel("recallerTutor", "Recaller 튜터", { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true });
  panel.iconPath = new vscode.ThemeIcon("mortar-board");
  panel.webview.onDidReceiveMessage((m) => {
    if (m && m.retry) connect();
    if (m && typeof m.openFolder === "string") openFolder(m.openFolder);
  });
  panel.onDidDispose(() => { panel = null; panelOnline = null; });
  if (runId || lobby) await renderTutor(); else renderOffline();
}

/** 튜터 화면이 부탁한 폴더로 이 창을 바꾼다. Recaller 폴더(.recaller가 있는 곳)만 연다. */
function openFolder(p) {
  const target = path.resolve(p);
  const ok = ["stage.json", "lobby.json"].some((f) => fs.existsSync(path.join(target, ".recaller", f)));
  if (!ok) { vscode.window.showWarningMessage("Recaller: 열 수 없는 폴더예요."); return; }
  if (root && path.resolve(root).toLowerCase() === target.toLowerCase()) return;
  vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target), { forceReuseWindow: true });
}

/** 튜터 화면(코스 서버의 페이지)을 탭에 띄운다. */
async function renderTutor() {
  if (!panel) return;
  const base = await vscode.env.asExternalUri(vscode.Uri.parse(`http://${HOST}:${PORT}/`));
  const origin = base.toString(true).replace(/\/$/, "");
  const mono = vscode.workspace.getConfiguration("editor").get("fontFamily") || "Consolas, monospace";
  const url = `${origin}/?embed=1&theme=${themeName()}&mono=${encodeURIComponent(mono)}&root=${encodeURIComponent(root)}${runId ? `#/run/${runId}` : "#/home"}`;
  panelOnline = true;
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin} http://127.0.0.1:${PORT} http://localhost:${PORT}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--vscode-editor-background)}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body><iframe id="t" src="${url}" allow="clipboard-read; clipboard-write"></iframe>
<script>const vs=acquireVsCodeApi();window.addEventListener("message",(e)=>{const f=document.getElementById("t");if(!e.data)return;if(e.data.recallerTheme&&f.contentWindow&&e.source!==f.contentWindow)f.contentWindow.postMessage(e.data,"*");if(e.data.recallerOpenFolder&&e.source===f.contentWindow)vs.postMessage({openFolder:String(e.data.recallerOpenFolder)});});</script>
</body></html>`;
}

/** 코스 서버가 꺼져 있을 때: 브라우저 오류 화면 대신 무엇을 하면 되는지 알려 준다. 다시 켜지면 저절로 튜터로 바뀐다. */
function renderOffline() {
  if (!panel) return;
  panelOnline = false;
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body{margin:0;padding:32px 24px;font:13px/1.6 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
h2{font-size:15px;margin:0 0 8px}p{margin:6px 0;color:var(--vscode-descriptionForeground)}
ol{padding-left:20px;margin:12px 0}li{margin:6px 0}
code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 5px;border-radius:3px}
button{margin-top:12px;padding:5px 14px;border:0;border-radius:2px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;font:inherit}
button:hover{background:var(--vscode-button-hoverBackground)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--vscode-charts-yellow);margin-right:6px;animation:b 1.4s infinite}@keyframes b{50%{opacity:.3}}
</style></head><body>
<h2>튜터가 잠시 쉬고 있어요</h2>
<p><span class="dot"></span>Recaller 코스 프로그램이 꺼져 있어서 튜터를 불러오지 못했어요.</p>
<ol>
<li>작업 폴더(<code>recaller-integration\experiments\project-course</code>)의 <code>프로젝트코스 실험.cmd</code>를 더블클릭하세요.</li>
<li>검은 창이 뜨고 몇 초 지나면 여기 튜터가 저절로 다시 나타나요.</li>
</ol>
<p>코드는 그대로 있어요. 걱정하지 않아도 돼요.</p>
<button id="r">다시 연결해 보기</button>
<script>const vs=acquireVsCodeApi();document.getElementById("r").onclick=()=>vs.postMessage({retry:true});</script>
</body></html>`;
}
function goOfflineSoon() {
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(() => { if (panel && panelOnline !== false) renderOffline(); }, 4000);
}

function activate(context) {
  const folder = (vscode.workspace.workspaceFolders || []).find((f) => ["stage.json", "lobby.json"].some((n) => fs.existsSync(path.join(f.uri.fsPath, ".recaller", n))));
  if (!folder) return;
  root = folder.uri.fsPath;
  myVersion = (context.extension && context.extension.packageJSON && context.extension.packageJSON.version) || "0";
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "recaller.openTutor";
  status.show();
  deco = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" },
  });
  dimDeco = vscode.window.createTextEditorDecorationType({ opacity: "0.35" });
  labelDeco = vscode.window.createTextEditorDecorationType({ after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" } });
  labelFocusDeco = vscode.window.createTextEditorDecorationType({ after: { color: new vscode.ThemeColor("textLink.foreground"), fontWeight: "bold" } });
  context.subscriptions.push(
    status, deco, dimDeco, labelDeco, labelFocusDeco,
    vscode.commands.registerCommand("recaller.ask", ask),
    vscode.commands.registerCommand("recaller.what", what),
    vscode.window.onDidChangeVisibleTextEditors(() => applyFocus()),
    vscode.window.onDidChangeActiveColorTheme(() => { if (panel) panel.webview.postMessage({ recallerTheme: themeName() }); }),
    vscode.commands.registerCommand("recaller.reconnect", connect),
    vscode.commands.registerCommand("recaller.openTutor", () => { if (runId || lobby) openTutor(); else connect(); }),
    vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed && inRoot(ed.document)) lastEditor = ed; scheduleReport(); }),
    vscode.window.onDidChangeTextEditorSelection(() => scheduleReport(700)),
    vscode.workspace.onDidChangeTextDocument((e) => { if (inRoot(e.document)) { scheduleReport(1200); applyFocus(); } }),
    vscode.workspace.onDidSaveTextDocument(() => scheduleReport(100)),
    vscode.languages.onDidChangeDiagnostics(() => scheduleReport(800)),
    { dispose: () => { clearTimeout(retryTimer); clearTimeout(reportTimer); if (stream) stream.destroy(); if (panel) panel.dispose(); } },
  );
  if (vscode.window.activeTextEditor && inRoot(vscode.window.activeTextEditor.document)) lastEditor = vscode.window.activeTextEditor;
  setStatus("$(sync~spin) Recaller", "튜터에 연결하는 중…", false);
  connect();
  // 코스 프로그램이 꺼져 있어도 튜터 자리에 안내가 보이게
  setTimeout(() => { if (!panel && !runId && vscode.workspace.getConfiguration("recaller").get("openTutorBeside", true)) { autoOpened = true; openTutor(); } }, 6000);
}
function deactivate() { if (stream) stream.destroy(); }
module.exports = { activate, deactivate };
