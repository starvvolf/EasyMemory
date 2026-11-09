// 공부 · 프로젝트 (2026-10-30, D 스레드, 사용자: "공부 탭에 프로젝트 추가하고 연결해봐").
// 프로젝트 코스 실험 서버(experiments/project-course, 127.0.0.1:4100)와 앱을 잇는 입구. 로컬 실험 모드에서만.
// - status · runs/:id/editor · runs/:id/activate: 코스 서버로 그대로 넘긴다(화면이 다른 포트를 직접 부르지 않게).
// - status에서 코스 서버가 꺼져 있으면 실험 파일을 대신 켠다(10/31 사용자 "필요할 때 켜기"). VS Code는 열지 않는다.
// - sync: 코스 서버에서 "아직 안 보낸 것"을 받아 지식 저장소(knowledge/api.ts의 saveMany·recordEvent)에 넣고,
//   넣은 것의 열쇠를 코스 서버에 돌려준다. 코스 서버는 앱 데이터에 직접 쓰지 않는다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { recordEvent, saveMany } from "@/lib/knowledge/api";

export const runtime = "nodejs";
const COURSE = (process.env.PROJECT_COURSE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");
const runId = z.string().regex(/^\w{4,40}$/);

type SyncEvent = { key: string; kind: "asked" | "wrong" | "hint" | "correct" | "note"; detail: string; at: string };
// kind: 대화 실습의 목표 정리는 여섯 종류(개념·원리·절차·규칙·방법·비교)로 온다(11/6)
type SyncItem = { key: string; title: string; kind: "concept" | "principle" | "procedure" | "rule" | "method" | "compare" | "vocab"; state: "met" | "unknown"; body: string; topicHint: string; events: SyncEvent[];
  /** 틀렸던 코드(11/6): 학습자 저장본에서 잘라 낸 덩어리 → 지식의 mistakes */
  mistake?: { file: string; from: number; to: number; code: string; note: string; ref: string; at: string }; mistakeKey?: string;
  /** 다시 확인 문항(11/8, 실습 부족함 원장) */
  check?: { q: string; a: string; note: string; ref: string; at: string }; checkKey?: string };
type SyncPayload = { runId: string; source: { kind: "code"; title: string; ref: string }; items: SyncItem[] };
type Status = { runs: Array<{ id: string; courseTitle: string; stageTitle: string; current: number; done: number; workspace: string | null; createdAt: string }>; active: string | null; engine?: string; ai?: unknown };

async function course<T>(pathname: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${COURSE}/api/${pathname}`, { method: init?.method ?? "GET", cache: "no-store", signal: AbortSignal.timeout(init?.method === "POST" ? 20000 : 4000),
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await res.json().catch(() => ({}));
  // 옛 코스 서버(지식 연결 전)는 sync 주소를 모른다 → 다시 켜 달라고 말한다
  if (res.status === 404 && pathname.endsWith("/sync")) throw Object.assign(new Error("프로젝트 코스를 껐다가 다시 켜 주세요. 새 연결 기능이 아직 안 들어가 있어요."), { status: 502 });
  if (!res.ok) throw Object.assign(new Error((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? `프로젝트 코스 서버 오류 (${res.status})`), { status: 502 });
  return data as T;
}
// 꺼져 있으면 켜기: 같은 PC의 기본 주소일 때만, 1분에 한 번만(켜지는 데 몇 초 걸린다). PROJECT_COURSE_AUTOSTART=0이면 안 켠다.
let startedAt = 0;
function startCourse(): { starting: boolean; error?: string } {
  if (process.env.PROJECT_COURSE_AUTOSTART === "0" || !/^http:\/\/(127\.0\.0\.1|localhost):4100$/.test(COURSE)) return { starting: false };
  if (Date.now() - startedAt < 60_000) return { starting: true };
  const dir = path.join(process.cwd(), "experiments", "project-course");
  const cmd = path.join(dir, "프로젝트코스 실험.cmd");
  try {
    if (process.platform === "win32") {
      if (!existsSync(cmd)) return { starting: false, error: "실험 파일을 찾지 못했어요." };
      // 실험 파일의 "min" 길: 처음 받기(Node 24·엔진)는 건너뛰고, 작업 표시줄에 내려 둔 창에서 서버만 켠다
      spawn("cmd.exe", ["/d", "/s", "/c", `start "" /min "${cmd}" min`], { cwd: dir, detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, PC_NO_OPEN: "1" } }).unref();
    } else {
      spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/main.ts"], { cwd: dir, detached: true, stdio: "ignore" }).unref();
    }
    startedAt = Date.now();
    return { starting: true };
  } catch (error) {
    return { starting: false, error: (error as Error).message.slice(0, 200) };
  }
}

const offline = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || /fetch failed|ECONNREFUSED/i.test(`${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}`));

/** 한 프로젝트의 안 보낸 것을 지식 저장소에 넣는다. */
async function syncRun(id: string) {
  const p = await course<SyncPayload>(`runs/${id}/sync`);
  if (!p.items.length) return { runId: id, items: 0, created: 0, events: 0 };
  const results = await saveMany(p.items.map((it) => ({ title: it.title.slice(0, 120), kind: it.kind, state: it.state, topicHint: it.topicHint,
    ...(it.body ? { body: it.body.slice(0, 4000) } : {}), ...(it.mistake ? { mistake: it.mistake } : {}), ...(it.check ? { check: it.check } : {}), source: p.source })));
  const keys: string[] = [];
  let events = 0;
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i], saved = results[i]?.item;
    if (!saved) continue;
    keys.push(it.key);
    if (it.mistakeKey) keys.push(it.mistakeKey);
    if (it.checkKey) keys.push(it.checkKey);
    for (const e of it.events) {
      try { await recordEvent(saved.id, e.kind, e.detail, { kind: p.source.kind, title: p.source.title, ref: p.source.ref }, e.at); keys.push(e.key); events++; }
      catch { /* 다음 번에 다시 */ }
    }
  }
  await course(`runs/${id}/sync`, { method: "POST", body: { keys } });
  return { runId: id, items: p.items.length, created: results.filter((r) => r.created).length, events };
}

// 나의 학습 노트(11/10): 실습 서버는 컴퓨터마다 따로라, 각 컴퓨터의 노트를 앱 데이터(RecallerData, 컴퓨터끼리 동기화됨)에
// 컴퓨터 이름별로 둔다. 합치기는 실습 서버가(lib/learner-note.ts combine). 여기는 받아 두고 내주기만.
type LocalNote = { machine: string; at: string; items: unknown[]; env: unknown[] };
const noteFile = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "practice", "learner-notes.json");
async function readNotes(): Promise<{ machines: Record<string, LocalNote> }> {
  try { const d = JSON.parse(await readFile(noteFile(), "utf8")); return { machines: d.machines ?? {} }; } catch { return { machines: {} }; }
}
/** 이 컴퓨터 실습 서버의 노트를 받아 앱 데이터에 넣는다(꺼져 있으면 그대로) */
async function pullNote() {
  const local = await course<LocalNote>("learner-note?local=1").catch(() => null);
  if (!local?.machine || !Array.isArray(local.items)) return;
  const d = await readNotes();
  d.machines[local.machine.slice(0, 80)] = local;
  await mkdir(path.dirname(noteFile()), { recursive: true });
  const tmp = `${noteFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(d), "utf8");
  await rename(tmp, noteFile());
}

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    if (p[0] === "status" && p.length === 1 && m === "GET") {
      try { return NextResponse.json({ online: true, url: COURSE, ...await course<Status>("status") }); }
      catch (error) { if (offline(error)) return NextResponse.json({ online: false, url: COURSE, runs: [], ...startCourse() }); throw error; }
    }
    if (p[0] === "runs" && p[1] && p.length === 3 && m === "POST" && (p[2] === "editor" || p[2] === "activate")) {
      return NextResponse.json(await course(`runs/${runId.parse(p[1])}/${p[2]}`, { method: "POST", body: {} }));
    }
    // 나의 학습 노트: GET learner = 컴퓨터별 노트(실습 서버가 합침), GET learner/view = 화면용 네 칸(실습 서버가 합친 것, 꺼져 있으면 online:false)
    if (p[0] === "learner" && p.length === 1 && m === "GET") return NextResponse.json(await readNotes());
    if (p[0] === "learner" && p[1] === "view" && p.length === 2 && m === "GET") {
      try { await pullNote(); return NextResponse.json({ online: true, ...await course<object>("learner-note") }); }
      catch (error) { if (offline(error)) return NextResponse.json({ online: false }); throw error; }
    }
    // 세션 노트(지나온 목표 길 · 부족함): 기억 탭 실습 갈래가 읽는다(11/9). 코스 서버가 꺼져 있으면 online:false
    if (p[0] === "runs" && p[1] && p.length === 3 && p[2] === "note" && m === "GET") {
      try { return NextResponse.json({ online: true, ...await course<object>(`runs/${runId.parse(p[1])}/note`) }); }
      catch (error) { if (offline(error)) return NextResponse.json({ online: false }); throw error; }
    }
    if (p[0] === "sync" && p.length === 1 && m === "POST") {
      const b = z.object({ runId: runId.optional() }).parse(await boundedJson(request).catch(() => ({})));
      let ids: string[];
      try { ids = b.runId ? [b.runId] : (await course<Status>("status")).runs.map((r) => r.id); }
      catch (error) { if (offline(error)) return NextResponse.json({ online: false, runs: [] }); throw error; }
      await pullNote().catch(() => undefined);
      const runs = [];
      for (const id of ids) runs.push(await syncRun(id).catch((e: Error) => ({ runId: id, items: 0, created: 0, events: 0, error: e.message.slice(0, 200) })));
      return NextResponse.json({ online: true, runs });
    }
    return NextResponse.json({ message: "없는 주소예요." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export const GET = handle;
export const POST = handle;
