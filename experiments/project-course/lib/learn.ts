// 코스 진행: 단계 시작(작업 폴더), 예측, 없애 보기, 검사, 힌트, 설명, 빠르게 넘기기, 실습 서버, 요청 보내기.
// 학습 기록 후보는 학습자가 직접 한 활동에서만 나온다. AI가 정답 줄을 보여 준 뒤의 통과는 "앎"으로 치지 않는다.
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, knowledgeName, loadCourse, solutionDiff, stageFiles, stageOf, type Course, type Stage } from "./course.ts";
import { writeWorkspace } from "./stagegen.ts";
import { runChecks, send, type RunResult } from "./checker.ts";
import { startServer, type Running } from "./proc.ts";
import { AiUnavailable, aiText } from "./ai.ts";
import { WORKSPACES, addCandidates, getRun, saveRun, stageProgress, type Candidate, type Run } from "./store.ts";

export const PORTS = { app: 4100, dev: 4101, check: 4102 };
const now = () => new Date().toISOString();
const err = (status: number, message: string) => Object.assign(new Error(message), { status });

export const workspaceOf = (run: Run, template: string) => run.workspaces[template] ?? path.join(WORKSPACES, `${run.id}-${template}`);
const exists = (p: string) => stat(p).then(() => true, () => false);

function cands(run: Run, course: Course, st: Stage, ids: string[], kind: Candidate["kind"], detail: string, activity: Candidate["evidence"]["activity"], independent: boolean): Candidate[] {
  return [...new Set(ids)].map((id) => ({
    at: now(), runId: run.id, course: course.id, stage: st.n, knowledgeId: id, knowledgeName: knowledgeName(course, id), kind, detail,
    evidence: { activity, independent },
    source: { kind: "project", title: `${course.title} ${st.n}단계 · ${st.title}`, ref: `${course.id}:${id}` },
  }));
}

/* ---------- 단계 시작: 작업 폴더에 시작 상태를 쓴다 ---------- */
export async function workspaceStage(ws: string): Promise<number | null> {
  try { return JSON.parse(await readFile(path.join(ws, ".recaller", "stage.json"), "utf8")).stage ?? null; } catch { return null; }
}
async function markStage(ws: string, n: number, solved = false) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(ws, ".recaller"), { recursive: true });
  await writeFile(path.join(ws, ".recaller", "stage.json"), JSON.stringify({ stage: n, solved, at: now() }));
}

/** 단계로 들어간다. 작업 폴더가 이미 그 단계면 그대로 두고, 다른 단계거나 reset이면 시작 상태로 다시 쓴다(옛 파일은 백업). */
export async function startStage(runId: string, n: number, reset = false) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const ws = workspaceOf(run, st.template);
  let backup: string | null = null;
  const already = (await workspaceStage(ws)) === n && (await exists(path.join(ws, "src")));
  if (!already || reset) {
    await stopDev(runId);
    ({ backup } = await writeWorkspace(ws, await stageFiles(course, n), { typesFrom: path.join(APP_ROOT, "node_modules") }));
    await writeFileReadme(ws, course, st);
    await markStage(ws, n);
  }
  const first = !run.stages[String(n)]?.startedAt;
  const saved = await saveRun(runId, (r) => {
    r.current = n;
    r.workspaces[st.template] = ws;
    const p = stageProgress(r, n);
    p.startedAt ??= now();
  });
  if (first) await addCandidates(cands(saved, course, st, st.knowledge, "met", `${st.n}단계 시작: ${st.title}`, "start", true));
  return { run: saved, workspace: ws, backup, rewritten: !already || reset };
}

async function writeFileReadme(ws: string, course: Course, st: Stage) {
  const { writeFile } = await import("node:fs/promises");
  const parts = course.parts.filter((p) => st.parts.includes(p.id));
  const text = [
    `# ${course.title} — ${st.n}단계: ${st.title}`, "", st.goal, "", st.intro, "",
    "## 고칠 것", st.fix.text, "", `파일: ${st.fix.files.join(", ")}`, "",
    "## 이 단계의 부품", ...parts.map((p) => `- **${p.name}** (${p.files.join(", ")}): ${p.role} 핵심: ${p.core}`), "",
    "## 실행", "Recaller 코스 화면의 [서버 켜기]를 쓰거나, 이 폴더에서:", "", "```", "npm start", "```", "", `서버 주소: http://127.0.0.1:${PORTS.dev}`, "",
    "검사는 코스 화면의 [검사하기]로 한다. 검사는 이 폴더의 서버를 따로 띄우고 따로 만든 DB(.recaller/check.db)로 한다. data/의 DB는 건드리지 않는다.",
  ].join("\n");
  await writeFile(path.join(ws, "README.md"), text.replace(/\n/g, process.platform === "win32" ? "\r\n" : "\n"));
}

/* ---------- 예측 ---------- */
export async function predict(runId: string, n: number, pid: string, choice: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const p = st.predict.find((x) => x.id === pid);
  if (!p) throw err(404, "그런 예측 문제가 없어요.");
  const correct = choice === p.answer;
  const prev = run.stages[String(n)]?.predict?.[pid];
  await saveRun(runId, (r) => { const sp = stageProgress(r, n); sp.predict[pid] ??= { choice, correct, at: now() }; });
  if (!prev) {
    await addCandidates(cands(run, course, st, p.knowledge, correct ? "correct" : "wrong",
      `예측: ${p.q} → "${p.options[choice] ?? "?"}"${correct ? "" : ` (맞는 답: "${p.options[p.answer]}")`}`, "predict", true));
  }
  return { correct, answer: p.answer, why: p.why, first: !prev };
}

/* ---------- 검사 (없애 보기 / 재검사) ---------- */
let checking: Promise<unknown> = Promise.resolve();
export async function check(runId: string, n: number, purpose: "observe" | "check"): Promise<RunResult & { stageOk: boolean; newlyDone: boolean; independent?: boolean }> {
  const job = checking.then(() => checkNow(runId, n, purpose));
  checking = job.catch(() => undefined);
  return job;
}
async function checkNow(runId: string, n: number, purpose: "observe" | "check") {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const ws = workspaceOf(run, st.template);
  if (!(await exists(path.join(ws, "src")))) throw err(409, "작업 폴더가 아직 없어요. 먼저 [작업 폴더 만들기]를 눌러 주세요.");
  const result = await runChecks({ course, stage: n, ws, port: PORTS.check, only: purpose === "observe" ? st.observe.checks : undefined });
  const stageOk = purpose === "check" && result.failed === 0 && result.results.length > 0;
  let newlyDone = false, independent: boolean | undefined;
  const saved = await saveRun(runId, (r) => {
    const sp = stageProgress(r, n);
    if (purpose === "observe") sp.observedAt ??= now();
    else sp.runs.push({ at: result.at, passed: result.passed, failed: result.failed, stageOk });
    if (stageOk && !sp.doneAt) {
      newlyDone = true;
      sp.doneAt = now();
      sp.independent = !sp.hints.some((h) => h.level >= 3) && !sp.skipped;
      independent = sp.independent;
    }
  });
  if (newlyDone) {
    const sp = stageProgress(saved, n);
    const fails = sp.runs.filter((x) => !x.stageOk).length;
    const hints = sp.hints.length;
    const what = st.transfer ? "전이 과제" : `${n}단계`;
    if (independent) {
      await addCandidates(cands(saved, course, st, st.knowledge, "correct",
        `${what}: 직접 고쳐 검사 통과 (통과 전 검사 실패 ${fails}번, 힌트 ${hints}번)`, st.transfer ? "transfer" : "check", true));
    } else {
      await addCandidates(cands(saved, course, st, st.knowledge, "note",
        `${what}: 정답 줄을 본 뒤 통과 — 앎으로 치지 않음. 다음 복습에서 코드 없이 다시 확인`, "check", false));
    }
  }
  return { ...result, stageOk, newlyDone, independent };
}

/* ---------- 힌트 ---------- */
const HINT_SYSTEM = `너는 백엔드 입문자를 가르치는 튜터다. 학습자가 스스로 고치게 돕는다. 한국어 존댓말로 짧게 답한다.
- 통과 여부는 검사기가 정한다. 너는 맞았다/틀렸다를 단정하지 않는다.
- [정답 참고]는 너만 보는 자료다. 1단계·2단계 힌트에서 그 코드를 그대로 보여 주지 않는다.
- 코드 블록은 꼭 필요할 때만, 3줄 이하.`;
const LEVEL_RULE: Record<1 | 2, string> = {
  1: "힌트 1단계: 방향만. 이 단계 부품·지식 중 어느 것을 다시 보라고 1~2문장. 줄 번호를 짚지 않는다.",
  2: "힌트 2단계: 실패한 검사의 기대와 실제를 근거로, 문제가 되는 파일과 줄(또는 함수)을 짚고 왜 그렇게 되는지 설명한다. 고친 코드는 주지 않는다.",
};
export async function hint(runId: string, n: number, level: 1 | 2 | 3, last?: RunResult) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const sp = run.stages[String(n)];
  const had = new Set((sp?.hints ?? []).map((h) => h.level));
  if (level > 1 && !had.has(level - 1)) throw err(409, `힌트 ${level - 1}단계를 먼저 봐 주세요.`);
  let text = "", source = "prepared";
  if (level === 3) {
    const diff = await solutionDiff(course, n);
    text = `준비된 정답 줄이에요(+ 넣을 줄, - 뺄 줄). 이걸 본 뒤의 통과는 '직접 고침'으로 기록하지 않아요.\n\n${diff.map((d) => `▸ ${d.file}\n${d.diff}`).join("\n\n")}`;
    source = "solution";
  } else {
    const ws = workspaceOf(run, st.template);
    try {
      const files = await Promise.all(st.fix.files.map(async (f) => `[학습자 파일 ${f}]\n${numbered(await readFile(path.join(ws, f), "utf8").catch(() => "(없음)"))}`));
      const failing = (last?.results ?? []).filter((r) => !r.ok).slice(0, 4)
        .map((r) => `- ${r.title}: ${r.failure?.request ?? ""} 기대 ${r.failure?.expected} / 실제 ${r.failure?.actual}${r.where ? ` (후보 ${r.where.file}:${r.where.line})` : ""}`).join("\n");
      const diff = (await solutionDiff(course, n)).map((d) => `${d.file}\n${d.diff}`).join("\n");
      const parts = course.parts.filter((p) => st.parts.includes(p.id)).map((p) => `${p.name}: ${p.role} 핵심: ${p.core} 흔한 실수: ${p.mistake}`).join("\n");
      const user = [`[단계] ${st.n}. ${st.title} — ${st.goal}`, `[고칠 것] ${st.fix.text}`, `[부품]\n${parts}`,
        `[지식] ${st.knowledge.map((k) => knowledgeName(course, k)).join(", ")}`, failing ? `[실패한 검사]\n${failing}` : "[검사] 아직 실패 기록 없음",
        ...files, `[정답 참고 — 학습자에게 그대로 보이지 않는다]\n${diff}`, `[이번에 이미 준 힌트] ${[...had].join(", ") || "없음"}`, LEVEL_RULE[level]].join("\n\n");
      text = await aiText(`hint${level}`, HINT_SYSTEM, user, level === 2);
      source = "ai";
    } catch (error) {
      text = st.hints[String(level) as "1" | "2"];
      source = error instanceof AiUnavailable ? `prepared (${error.code})` : "prepared";
      if (error instanceof AiUnavailable && error.code !== "off") text += `\n\n(AI 힌트를 못 받아 준비된 힌트를 보여 드려요: ${error.message})`;
    }
  }
  await saveRun(runId, (r) => { stageProgress(r, n).hints.push({ level, at: now(), source }); });
  await addCandidates(cands(run, course, st, st.knowledge, "hint", `${st.n}단계 힌트 ${level}단계${level === 3 ? " (정답 줄)" : ""}`, "hint", false));
  return { level, text, source };
}
const numbered = (text: string) => text.split(/\r?\n/).slice(0, 220).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");

/* ---------- 설명하기 ---------- */
export async function explain(runId: string, n: number, text: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw err(400, "설명을 적어 주세요.");
  await saveRun(runId, (r) => { stageProgress(r, n).explain = { text: clean, at: now() }; });
  // 설명의 옳고 그름은 여기서 판정하지 않는다. 메모로 남겨 복습 때 다시 본다.
  await addCandidates(cands(run, course, st, st.explain.knowledge, "note", `내 설명: ${st.explain.q} → ${clean}`, "explain", true));
  return { ok: true };
}

/* ---------- 빠르게 넘기기: 정답 코드로 채운다 ---------- */
export async function skip(runId: string, n: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const sp = run.stages[String(n)];
  const predicted = sp ? st.predict.every((p) => sp.predict[p.id]) : false;
  if (!predicted) throw err(409, "빠르게 넘어가려면 예측 문제를 먼저 풀어 주세요.");
  const ws = workspaceOf(run, st.template);
  await stopDev(runId);
  await writeWorkspace(ws, await stageFiles(course, n, { solved: true }), { typesFrom: path.join(APP_ROOT, "node_modules") });
  await writeFileReadme(ws, course, st);
  await markStage(ws, n, true);
  await saveRun(runId, (r) => { const p = stageProgress(r, n); p.skipped = true; p.doneAt ??= now(); p.independent = false; r.workspaces[st.template] = ws; });
  await addCandidates(cands(run, course, st, st.knowledge, "note", `${n}단계는 예측만 하고 정답 코드로 넘어감`, "skip", false));
  return { ok: true };
}

/* ---------- 실습 서버 (학습자가 직접 써 보는 서버, data/의 DB) ---------- */
const dev = new Map<string, { run: Running; template: string }>();
export function devStatus(runId: string) {
  const d = dev.get(runId);
  if (!d) return { running: false as const };
  return { running: !d.run.exited, port: d.run.port, template: d.template, startedAt: d.run.startedAt, exited: d.run.exited, logs: d.run.logs.slice(-200) };
}
export async function startDev(runId: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, run.current);
  const ws = workspaceOf(run, st.template);
  if (!(await exists(path.join(ws, "src")))) throw err(409, "작업 폴더가 아직 없어요.");
  for (const [id] of dev) await stopDev(id);
  const r = await startServer({ cwd: ws, port: PORTS.dev });
  dev.set(runId, { run: r, template: st.template });
  jars.delete(runId);
  return devStatus(runId);
}
export async function stopDev(runId: string) {
  const d = dev.get(runId);
  if (d) { await d.run.stop(); dev.delete(runId); }
  return { running: false };
}

const jars = new Map<string, Record<string, string>>();
export async function tryRequest(runId: string, input: { method: string; path: string; body?: unknown; raw?: string; as?: string }) {
  const d = dev.get(runId);
  if (!d || d.run.exited) throw err(409, "실습 서버가 꺼져 있어요. [서버 켜기]를 먼저 눌러 주세요.");
  const method = String(input.method || "GET").toUpperCase();
  if (!/^(GET|POST|PATCH|PUT|DELETE)$/.test(method)) throw err(400, "메서드가 이상해요.");
  const url = String(input.path || "/");
  if (!url.startsWith("/")) throw err(400, "주소는 /로 시작해요.");
  const jar = jars.get(runId) ?? {};
  jars.set(runId, jar);
  const actor = input.as && /^[A-Z]$/.test(input.as) ? input.as : undefined;
  const reply = await send(PORTS.dev, method, url, { body: input.body, raw: input.raw, cookie: actor ? jar[actor] : undefined, timeoutMs: 3000 });
  const setCookie = reply.headers["set-cookie"];
  if (actor && setCookie) {
    const c = setCookie.split(";")[0];
    if (c.endsWith("=")) delete jar[actor]; else jar[actor] = c;
  }
  return { request: `${actor ? `(${actor}) ` : ""}${method} ${url}`, status: reply.status, timedOut: !!reply.timedOut, error: reply.error, headers: reply.headers, body: reply.text, actors: Object.keys(jar) };
}

/* ---------- VS Code로 열기 ---------- */
/* code 명령 한 번 실행 (Windows는 code.cmd라 셸로). 출력과 종료 코드를 돌려준다. */
function codeCli(args: string[], timeoutMs = 60000) {
  return new Promise<{ ok: boolean; out: string; missing?: boolean }>((resolve) => {
    const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    const child = process.platform === "win32"
      ? spawn(`code ${quoted}`, { shell: true, windowsHide: true })
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

/** VS Code로 열기: 연결 확장을 깔고, 작업 폴더와 이번 단계의 첫 파일을 연다. */
export async function openEditor(runId: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, run.current);
  const ws = workspaceOf(run, st.template);
  if (!(await exists(ws))) throw err(409, "작업 폴더가 아직 없어요.");
  const bridge = await ensureBridge();
  if ((bridge as { missing?: boolean }).missing) return { ok: false, path: ws, message: "VS Code 명령(code)을 찾지 못했어요. VS Code에서 [파일 → 폴더 열기]로 이 경로를 열어 주세요. (VS Code 설치 때 'PATH에 추가'를 켜면 자동으로 열려요)" };
  const first = path.join(ws, st.fix.files[0] ?? "src/server.ts");
  const opened = await codeCli([ws, "--goto", `${first}:1`], 20000);
  return {
    ok: opened.ok, path: ws, bridgeInstalled: bridge.installed,
    message: opened.ok ? (bridge.installed ? "VS Code에 Recaller 연결 확장을 깔고 열었어요." : "") : `VS Code를 열지 못했어요: ${opened.out.slice(0, 200)}`,
  };
}
