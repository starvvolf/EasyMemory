// 프로젝트 코스 실험 서버: http://127.0.0.1:4100
// 코스 정하기(채팅·문답) → 계획 확정 → 단계별 작업 폴더·VS Code·실습 서버·예측·없애 보기·고치기·재검사·기록 후보.
// 앱(3000)·엔진 실험(3002)과 따로 돈다. 실습 서버 4101, 검사용 서버 4102.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, listCourses, loadCourse, knowledgeName, type Course } from "../lib/course.ts";
import { answer, diagnose, getIntake, markConfirmed, normalizePlan, startIntake } from "../lib/intake.ts";
import { PORTS, check, devStatus, explain, hint, openEditor, predict, skip, startDev, startStage, stopDev, tryRequest, workspaceOf, workspaceStage } from "../lib/learn.ts";
import { addRun, candidates, getRun, recordsFile, runs, setActive, type Run } from "../lib/store.ts";
import { aiStatus } from "../lib/ai.ts";
import { killAll, nodeSupport, portFree } from "../lib/proc.ts";
import type { RunResult } from "../lib/checker.ts";
import { installFakeAi } from "../lib/fake-ai.ts";

if (process.env.PC_FAKE_AI === "1") installFakeAi();

const PORT = Number(process.env.PC_PORT || PORTS.app);
const WEB = path.join(ROOT, "web");
const lastCheck = new Map<string, RunResult>();

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("JSON이 아니에요."), { status: 400 }); }
}

/** 화면에 보낼 단계 정보. 예측 정답·힌트 글·정답 코드는 빼고 보낸다. */
function stageView(course: Course, run: Run, n: number) {
  const st = course.stages.find((s) => s.n === n)!;
  const prog = run.stages[String(n)];
  return {
    n: st.n, template: st.template, transfer: !!st.transfer, title: st.title, goal: st.goal, intro: st.intro,
    quick: run.plan.quick.includes(n), breaks: st.breaks ?? [],
    knowledge: st.knowledge.map((id) => ({ id, name: knowledgeName(course, id), essentials: course.knowledge.find((k) => k.id === id)?.essentials ?? "" })),
    parts: course.parts.filter((p) => st.parts.includes(p.id)),
    predict: st.predict.map((p) => ({ id: p.id, q: p.q, options: p.options, done: prog?.predict?.[p.id] ? { ...prog.predict[p.id], answer: p.answer, why: p.why } : null })),
    observe: { text: st.observe.text, checks: st.observe.checks.map((id) => course.checks.find((c) => c.id === id)?.title ?? id) },
    fix: st.fix, explain: { q: st.explain.q, done: prog?.explain ?? null },
    try: st.try,
    checks: course.checks.filter((c) => c.template === st.template && c.stage <= n).map((c) => ({ id: c.id, stage: c.stage, title: c.title, kind: c.kind })),
    progress: prog ?? null,
  };
}
async function runView(run: Run) {
  const course = await loadCourse(run.courseId);
  const cur = course.stages.find((s) => s.n === run.current)!;
  const ws = workspaceOf(run, cur.template);
  const recs = await candidates(run.id);
  const shown = [...run.plan.stages, ...(run.plan.transfer ? course.stages.filter((s) => s.transfer).map((s) => s.n) : [])];
  return {
    id: run.id, course: { id: course.id, title: course.title, stack: course.stack }, plan: run.plan, profile: run.profile ?? null,
    current: run.current, workspace: ws, workspaceStage: await workspaceStage(ws),
    stages: course.stages.map((s) => ({ n: s.n, title: s.title, transfer: !!s.transfer, inPlan: shown.includes(s.n), before: s.n < run.plan.start && !s.transfer,
      quick: run.plan.quick.includes(s.n), status: run.stages[String(s.n)] ? { started: !!run.stages[String(s.n)].startedAt, done: !!run.stages[String(s.n)].doneAt, independent: run.stages[String(s.n)].independent, skipped: !!run.stages[String(s.n)].skipped } : null })),
    stage: stageView(course, run, run.current),
    dev: devStatus(run.id),
    lastCheck: lastCheck.get(`${run.id}:${run.current}`) ?? null,
    records: { file: recordsFile(run.id), count: recs.length, items: recs.filter((r) => r.stage === run.current).slice(-40) },
  };
}
async function summary(run: Run) {
  const course = await loadCourse(run.courseId);
  const recs = await candidates(run.id);
  const byK = new Map<string, { id: string; name: string; met: number; correct: number; wrong: number; hint: number; note: number; independent: boolean; lines: string[] }>();
  for (const r of recs) {
    const k = byK.get(r.knowledgeId) ?? { id: r.knowledgeId, name: r.knowledgeName, met: 0, correct: 0, wrong: 0, hint: 0, note: 0, independent: false, lines: [] };
    if (r.kind in k) (k as unknown as Record<string, number>)[r.kind] += 1;
    if (r.kind === "correct" && r.evidence.activity !== "predict" && r.evidence.independent) k.independent = true;
    k.lines.push(`${r.stage}단계 ${r.kind}: ${r.detail}`);
    byK.set(r.knowledgeId, k);
  }
  const stages = course.stages.map((s) => {
    const p = run.stages[String(s.n)];
    return { n: s.n, title: s.title, transfer: !!s.transfer, before: s.n < run.plan.start && !s.transfer, inPlan: run.plan.stages.includes(s.n) || (!!s.transfer && run.plan.transfer), done: !!p?.doneAt, independent: !!p?.independent, skipped: !!p?.skipped,
      predictRight: p ? Object.values(p.predict).filter((x) => x.correct).length : 0, predictTotal: s.predict.length,
      hints: p?.hints.length ?? 0, maxHint: Math.max(0, ...(p?.hints.map((h) => h.level) ?? [])), failedRuns: p?.runs.filter((r) => !r.stageOk).length ?? 0, explained: !!p?.explain };
  });
  return { course: { id: course.id, title: course.title }, stages, knowledge: [...byK.values()], file: recordsFile(run.id), total: recs.length };
}

type Handler = (req: IncomingMessage, m: RegExpExecArray, url: URL) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/status$/, async () => {
    const f = await runs();
    return { node: nodeSupport(), ai: await aiStatus(), active: f.active ?? null, ports: PORTS,
      runs: await Promise.all(f.runs.slice(-10).reverse().map(async (r) => ({ id: r.id, course: r.courseId, createdAt: r.createdAt, current: r.current, start: r.plan.start, done: Object.values(r.stages).filter((s) => s.doneAt).length }))) };
  }],
  ["GET", /^\/api\/courses$/, async () => (await listCourses()).map((c) => ({ id: c.id, title: c.title, summary: c.summary, stack: c.stack, audience: c.audience, stages: c.stages.map((s) => ({ n: s.n, title: s.title, goal: s.goal, transfer: !!s.transfer })) }))],

  ["POST", /^\/api\/intake$/, async (req) => { const b = await body(req); return startIntake(b.mode === "script" ? "script" : b.mode === "ai" ? "ai" : undefined); }],
  ["GET", /^\/api\/intake\/(\w+)$/, async (_q, m) => getIntake(m[1])],
  ["POST", /^\/api\/intake\/(\w+)\/answer$/, async (req, m) => { const b = await body(req); return answer(m[1], { text: typeof b.text === "string" ? b.text : undefined, choice: Array.isArray(b.choice) ? b.choice.map(Number) : undefined }); }],
  ["POST", /^\/api\/intake\/(\w+)\/diagnose$/, async (req, m) => { const b = await body(req); return diagnose(m[1], (b.answers ?? {}) as Record<string, number>); }],
  ["POST", /^\/api\/intake\/(\w+)\/confirm$/, async (req, m) => {
    const b = await body(req);
    const it = await getIntake(m[1]);
    if (it.confirmedRun) return { runId: it.confirmedRun };
    if (!it.plan) throw Object.assign(new Error("계획이 아직 없어요."), { status: 409 });
    const course = await loadCourse(it.courseId);
    const plan = normalizePlan(course, (b.plan ?? {}) as never, it.plan);
    const run: Run = { id: randomBytes(5).toString("hex"), courseId: course.id, createdAt: new Date().toISOString(), intakeId: it.id,
      profile: { ...it.profile, requests: it.requests, diag: it.diag }, plan, current: plan.start, workspaces: {}, stages: {} };
    await addRun(run);
    await markConfirmed(it.id, run.id, plan);
    await startStage(run.id, plan.start);
    return { runId: run.id };
  }],

  ["GET", /^\/api\/runs\/(\w+)$/, async (_q, m) => runView(await getRun(m[1]))],
  ["POST", /^\/api\/runs\/(\w+)\/activate$/, async (_q, m) => { await getRun(m[1]); await setActive(m[1]); return { ok: true }; }],
  ["GET", /^\/api\/runs\/(\w+)\/summary$/, async (_q, m) => summary(await getRun(m[1]))],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/start$/, async (req, m) => { const b = await body(req); const out = await startStage(m[1], Number(m[2]), !!b.reset); return { workspace: out.workspace, backup: out.backup, rewritten: out.rewritten }; }],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/predict$/, async (req, m) => { const b = await body(req); return predict(m[1], Number(m[2]), String(b.pid), Number(b.choice)); }],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/check$/, async (req, m) => {
    const b = await body(req);
    const out = await check(m[1], Number(m[2]), b.purpose === "observe" ? "observe" : "check");
    lastCheck.set(`${m[1]}:${m[2]}`, out);
    return out;
  }],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/hint$/, async (req, m) => { const b = await body(req); const lvl = Number(b.level); if (![1, 2, 3].includes(lvl)) throw Object.assign(new Error("힌트는 1~3단계예요."), { status: 400 }); return hint(m[1], Number(m[2]), lvl as 1 | 2 | 3, lastCheck.get(`${m[1]}:${m[2]}`)); }],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/explain$/, async (req, m) => { const b = await body(req); return explain(m[1], Number(m[2]), String(b.text ?? "")); }],
  ["POST", /^\/api\/runs\/(\w+)\/stage\/(\d+)\/skip$/, async (_q, m) => skip(m[1], Number(m[2]))],
  ["POST", /^\/api\/runs\/(\w+)\/dev\/start$/, async (_q, m) => startDev(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/dev\/stop$/, async (_q, m) => stopDev(m[1])],
  ["GET", /^\/api\/runs\/(\w+)\/dev$/, async (_q, m) => devStatus(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/try$/, async (req, m) => tryRequest(m[1], (await body(req)) as never)],
  ["POST", /^\/api\/runs\/(\w+)\/editor$/, async (_q, m) => openEditor(m[1])],
];

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      for (const [method, re, fn] of routes) {
        const m = re.exec(url.pathname);
        if (m && req.method === method) { json(res, 200, await fn(req, m, url)); return; }
      }
      json(res, 404, { error: "없는 주소예요." });
      return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); res.end(); return; }
    const data = await readFile(path.join(WEB, file));
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? ((error as { code?: string }).code === "ENOENT" ? 404 : 500);
    if (status === 500) console.error(error);
    json(res, status, { error: (error as Error).message });
  }
});

const shutdown = () => { killAll(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("exit", () => killAll());

if (!(await portFree(PORT))) {
  console.error(`${PORT}번 포트를 이미 쓰고 있어요. 코스 서버가 이미 켜져 있으면 http://127.0.0.1:${PORT} 을 여세요.`);
  process.exit(1);
}
server.listen(PORT, "127.0.0.1", () => {
  const n = nodeSupport();
  console.log(`프로젝트 코스 실험: http://127.0.0.1:${PORT}  (창을 닫으면 실습 서버도 같이 꺼져요)`);
  if (!n.ok) console.log(n.message);
});
