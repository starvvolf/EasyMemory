// 실습 서버 바탕(2026-11-11 정해진 코스 기능을 뺀 뒤): 포트 · 작업 폴더 표시(.recaller/stage.json) · VS Code 열기 · 연결 확장 깔기.
// 예전 단계 진행(단계 시작 · 예측 · 검사 · 힌트 · 실습 서버 · 요청 보내기)은 11/11에 뺐다(git 기록에 있다).
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT } from "./course.ts";
import { getRun, runs } from "./store.ts";

export const PORTS = { app: 4100, dev: 4101, check: 4102 };
const now = () => new Date().toISOString();
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const exists = (p: string) => stat(p).then(() => true, () => false);

/* ---------- 작업 폴더 표시: VS Code 연결 확장은 .recaller/stage.json이 있는 폴더에서만 켜진다 ---------- */
export async function workspaceStage(ws: string): Promise<number | null> {
  try { return JSON.parse(await readFile(path.join(ws, ".recaller", "stage.json"), "utf8")).stage ?? null; } catch { return null; }
}
/** 대화 실습의 작업 폴더에 표시를 둔다(11/5 노트북 "열 수 없는 폴더예요"로 무한 로딩) */
export async function markChatFolder(ws: string) {
  if (await workspaceStage(ws) !== null) return;
  try {
    await mkdir(path.join(ws, ".recaller"), { recursive: true });
    await writeFile(path.join(ws, ".recaller", "stage.json"), JSON.stringify({ stage: 1, solved: false, at: now() }));
  } catch { /* 쓸 수 없는 폴더면 넘어감(연결 확장만 안 켜짐) */ }
}

/* ---------- VS Code로 열기 ---------- */
/* code 명령 한 번 실행 (Windows는 code.cmd라 셸로). 출력과 종료 코드를 돌려준다. */
function codeCli(args: string[], timeoutMs = 60000) {
  return new Promise<{ ok: boolean; out: string; missing?: boolean }>((resolve) => {
    const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    // 11/5 노트북: PATH에 code가 없으면 VS Code 기본 설치 위치의 code.cmd를 쓴다
    const winCode = () => {
      const cands = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "bin", "code.cmd"), process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "bin", "code.cmd")].filter(Boolean) as string[];
      const hit = cands.find((c) => existsSync(c));
      return hit ? `"${hit}"` : "code";
    };
    const child = process.platform === "win32"
      ? spawn(`${winCode()} ${quoted}`, { shell: true, windowsHide: true })
      : spawn("code", args);
    let out = "";
    child.stdout?.on("data", (c) => { out += c; });
    child.stderr?.on("data", (c) => { out += c; });
    const t = setTimeout(() => { child.kill(); resolve({ ok: false, out: "시간 초과" }); }, timeoutMs);
    child.on("error", () => { clearTimeout(t); resolve({ ok: false, out: "", missing: true }); });
    child.on("exit", (code) => { clearTimeout(t); resolve({ ok: code === 0, out, missing: process.platform === "win32" && code === 1 && /not recognized|인식되지/.test(out) }); });
  });
}
const BRIDGE_ID = "recaller-local.recaller-bridge";
const BRIDGE_VSIX = path.join(APP_ROOT, "experiments", "project-course", "vscode-bridge", "recaller-bridge.vsix");
let bridgeChecked = false;
/** 연결 확장을 깔아 둔다(없거나 버전이 다르면). 한 번만 확인. */
export async function bridgeVersion() {
  try { return JSON.parse(await readFile(path.join(path.dirname(BRIDGE_VSIX), "package.json"), "utf8")).version as string; } catch { return "0"; }
}
const newer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return false; };
/** 연결된 확장이 옛 버전이면 새 것을 깔아 두고 true(확장이 "다시 불러오기"를 띄운다). */
export async function updateBridgeIfOld(have: string) {
  const want = await bridgeVersion();
  if (!newer(want, have || "0")) return false;
  bridgeChecked = false;
  const r = await ensureBridge();
  return r.ok;
}
export async function ensureBridge() {
  if (bridgeChecked) return { ok: true, installed: false };
  if (!(await exists(BRIDGE_VSIX))) return { ok: false, installed: false, message: "연결 확장 파일(recaller-bridge.vsix)이 없어요." };
  const want = JSON.parse(await readFile(path.join(path.dirname(BRIDGE_VSIX), "package.json"), "utf8")).version;
  const list = await codeCli(["--list-extensions", "--show-versions"]);
  if (list.missing) return { ok: false, installed: false, missing: true };
  if (list.out.toLowerCase().includes(`${BRIDGE_ID}@${want}`)) { bridgeChecked = true; return { ok: true, installed: false }; }
  const inst = await codeCli(["--install-extension", BRIDGE_VSIX, "--force"], 120000);
  bridgeChecked = inst.ok;
  return { ok: inst.ok, installed: inst.ok, message: inst.ok ? "" : `연결 확장을 설치하지 못했어요: ${inst.out.slice(0, 200)}` };
}

/** VS Code로 열기: 연결 확장을 깔고 그 실습의 작업 폴더를 연다 */
export async function openEditor(runId: string) {
  await getRun(runId);
  const ws = await (await import("./goals.ts")).runWorkspace(runId);
  if (!ws || !(await exists(ws))) throw err(409, "작업 폴더가 아직 없어요.");
  const bridge = await ensureBridge();
  if ((bridge as { missing?: boolean }).missing) return { ok: false, path: ws, message: "VS Code 명령(code)을 찾지 못했어요. VS Code에서 [파일 → 폴더 열기]로 이 경로를 열어 주세요." };
  const opened = await codeCli([ws], 20000);
  return { ok: opened.ok, path: ws, bridgeInstalled: bridge.installed,
    message: opened.ok ? (bridge.installed ? "VS Code에 Recaller 연결 확장을 깔고 열었어요." : "") : `VS Code를 열지 못했어요: ${opened.out.slice(0, 200)}` };
}

/** 폴더 하나를 VS Code로 연다(11/4 Codex 실험판: 그 대화의 작업 폴더) */
export async function openFolderInCode(folder: string) {
  if (!(await exists(folder))) throw err(409, "작업 폴더가 없어요.");
  const opened = await codeCli([folder], 20000);
  return { ok: opened.ok, path: folder, message: opened.ok ? "" : `VS Code를 열지 못했어요(code 명령). VS Code에서 [파일 → 폴더 열기]로 이 경로를 열어 주세요: ${opened.out.slice(0, 160)}` };
}

/** .cmd로 켤 때(PC_OPEN=1): 하던 실습 폴더를 VS Code로, 없으면 브라우저로 튜터 화면을 연다 */
export async function openAtStartup(port: number) {
  const f = await runs();
  const run = f.runs.find((r) => r.id === f.active && (r.chatId || r.codexId)) ?? [...f.runs].reverse().find((r) => r.chatId || r.codexId);
  const folder = run ? await (await import("./goals.ts")).runWorkspace(run.id).catch(() => null) : null;
  const bridge = await ensureBridge();
  const missing = (bridge as { missing?: boolean }).missing;
  if (folder && !missing && (await codeCli([folder], 20000)).ok) { console.log(`VS Code를 열었어요: ${folder}`); return { vscode: true, folder }; }
  const url = `http://127.0.0.1:${port}/`;
  if (process.platform === "win32") spawn(`start "" "${url}"`, { shell: true, windowsHide: true });
  else spawn("xdg-open", [url]).on("error", () => {});
  return { vscode: false, folder };
}
