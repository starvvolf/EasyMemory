// 튜터 창 (11/2 사용자: "VS Code 안에 붙이지 말고 앱 쪽 화면으로, VS Code와 같이 움직이고 항상 위, 코드 만질 땐 반투명")
// - 코스 서버가 작은 Electron 창(float/main.cjs)을 띄운다. 창은 VS Code 창을 따라다니고(항상 위),
//   VS Code에서 타이핑하는 동안은 흐려지고 클릭이 뒤로 통과한다.
// - 창은 이 서버를 0.25초마다 물어본다(GET /api/float). 같은 PC 안이라 렉이 없다.
// - Electron은 앱 데스크톱 폴더(desktop/node_modules/electron)의 것을 빌려 쓴다. 없으면 이 기능은 꺼지고 예전처럼 VS Code 탭.
// - 끄기: PC_FLOAT=0
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { appendFileSync } from "node:fs";
import { APP_ROOT, ROOT } from "./course.ts";
import { DATA } from "./store.ts";

const LOG = () => path.join(DATA, "float.log");
const log = (t: string) => { try { appendFileSync(LOG(), `${new Date().toISOString()} [서버] ${t}\n`); } catch { /* */ } };

// size: 학습자가 고른 크기(기본 / 펼침). 타이핑하는 동안은 고정이 아니면 한 줄 띠(pill)로 접힌다(11/2: 흐리게 대신 접기)
type Size = "normal" | "wide";
type Float = { open: boolean; runId: string | null; pinned: boolean; editingAt: number; lastPoll: number; spawnedAt: number; size: Size };
const f: Float = { open: false, runId: null, pinned: false, editingAt: 0, lastPoll: 0, spawnedAt: 0, size: "normal" };
const FADE_MS = 2000;

export function electronPath(): string | null {
  const dir = path.join(APP_ROOT, "desktop", "node_modules", "electron");
  try {
    const exe = path.join(dir, "dist", readFileSync(path.join(dir, "path.txt"), "utf8").trim());
    return existsSync(exe) ? exe : null;
  } catch { return null; }
}
export const floatOn = () => process.env.PC_FLOAT !== "0" && process.platform === "win32" && !!electronPath();
/** 창이 살아 있나(최근 3초 안에 물어봤나) */
export const floatAlive = () => Date.now() - f.lastPoll < 3000;

function ensureWindow(port: number) {
  if (floatAlive() || Date.now() - f.spawnedAt < 15000) return;
  const exe = electronPath();
  if (!exe) return;
  f.spawnedAt = Date.now();
  const env: Record<string, string | undefined> = { ...process.env, PC_COURSE: `http://127.0.0.1:${port}`, PC_FLOAT_LOG: LOG() };
  delete env.ELECTRON_RUN_AS_NODE;
  log(`튜터 창 띄움: ${exe}`);
  try {
    const child = spawn(exe, [path.join(ROOT, "float", "main.cjs")], { detached: true, stdio: "ignore", windowsHide: false, env });
    child.on("error", (e) => log(`띄우기 실패: ${e.message}`));
    child.on("exit", (code) => log(`튜터 창 꺼짐 (${code})`));
    child.unref();
  } catch (e) { log(`띄우기 실패: ${(e as Error).message}`); }
}

/** 이 진행 기록으로 튜터 창을 연다. 쓸 수 없으면 false(그러면 VS Code 탭을 쓴다). */
export function openFloat(runId: string, port: number) {
  if (!floatOn()) return false;
  f.open = true; f.runId = runId;
  ensureWindow(port);
  return true;
}
/** 확장에게: 튜터 창을 쓰는 중이면 VS Code 탭을 저절로 열지 않는다 */
export const floatInUse = () => floatOn() && f.open;

/** 튜터 창이 물으면(fromWindow) 살아 있다고 적는다. 화면·점검에서 물을 때는 그대로 */
export function poll(fromWindow = false) {
  if (fromWindow) f.lastPoll = Date.now();
  const editing = !f.pinned && Date.now() - f.editingAt < FADE_MS;
  return { open: f.open, runId: f.runId, pinned: f.pinned, editing, size: editing ? "pill" : f.size, alive: floatAlive(), available: floatOn() };
}
export function setFloat(b: { open?: unknown; pinned?: unknown; runId?: unknown; size?: unknown; wake?: unknown }, port: number) {
  if (typeof b.pinned === "boolean") f.pinned = b.pinned;
  if (b.size === "normal" || b.size === "wide") { f.size = b.size; f.editingAt = 0; }
  if (b.wake === true) f.editingAt = 0;
  if (typeof b.runId === "string" && /^\w{4,40}$/.test(b.runId)) f.runId = b.runId;
  if (b.open === true && f.runId) return { ...poll(), started: openFloat(f.runId, port) };
  if (b.open === false) f.open = false;
  return poll();
}
/** VS Code에서 글자를 쳤다(확장이 알려 줌) → 2초 동안 흐리게 */
export function typing() { f.editingAt = Date.now(); }
/** 저장·튜터가 새 말을 함 → 바로 진하게 */
export function wake() { f.editingAt = 0; }
