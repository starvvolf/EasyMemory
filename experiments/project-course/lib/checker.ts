// 자동 검사기. 기대값은 코스 데이터(사람이 정함)에 있고, 판정은 이 코드가 한다. AI는 판정하지 않는다.
// 학습자 작업 폴더의 서버를 검사 전용 포트·검사 전용 DB(.recaller/check.db)로 따로 띄워서
// 실제 HTTP 요청을 보내고 SQLite 상태까지 확인한다. 학습자의 개발용 DB(data/)는 건드리지 않는다.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, type Running } from "./proc.ts";
import type { Check, Course, Step } from "./course.ts";

export type Failure = { step: number; request?: string; expected: string; actual: string; note?: string };
export type CheckResult = {
  id: string; title: string; stage: number; kind: string; regression: boolean; target: boolean; ok: boolean;
  failure?: Failure; where?: { file: string; line: number | null }; logHits?: { file: string; line: number }[]; knowledge: string[];
};
export type RunResult = {
  at: string; stage: number; ms: number; started: boolean; startError?: string;
  results: CheckResult[]; passed: number; failed: number; logs: string[];
};

export type Reply = { status: number; headers: Record<string, string>; text: string; json: unknown; timedOut?: boolean; error?: string };

const TIMEOUT = 2000;

/** 실제 HTTP 요청. 연결을 재사용하지 않는다(서버를 껐다 켜도 옛 연결이 남지 않게). */
export function send(port: number, method: string, url: string, opts: { body?: unknown; raw?: string; cookie?: string; timeoutMs?: number }): Promise<Reply> {
  const headers: Record<string, string> = { connection: "close" };
  let payload: string | undefined;
  if (opts.raw !== undefined) { payload = opts.raw; headers["content-type"] = "application/json"; }
  else if (opts.body !== undefined) { payload = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  if (payload !== undefined) headers["content-length"] = String(Buffer.byteLength(payload));
  if (opts.cookie) headers.cookie = opts.cookie;
  const timeout = opts.timeoutMs ?? TIMEOUT;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Reply) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = undefined;
        try { json = text ? JSON.parse(text) : undefined; } catch { /* 글자 응답 */ }
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h[k] = Array.isArray(v) ? v.join("\n") : String(v);
        done({ status: res.statusCode ?? 0, headers: h, text, json });
      });
      res.on("error", (e) => done({ status: 0, headers: {}, text: "", json: undefined, error: e.message }));
    });
    const timer = setTimeout(() => { req.destroy(); done({ status: 0, headers: {}, text: "", json: undefined, timedOut: true }); }, timeout);
    req.on("error", (e) => done({ status: 0, headers: {}, text: "", json: undefined, error: e.message }));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/* ---------- 값 채우기 ---------- */
type Vars = Record<string, unknown>;
function fill(value: unknown, vars: Vars): unknown {
  if (typeof value === "string") {
    const whole = /^\{(\w+)\}$/.exec(value);
    if (whole && whole[1] in vars) return vars[whole[1]];
    return value
      .replace(/\{repeat:([^:}]+):(\d+)\}/g, (_, s: string, n: string) => s.repeat(Number(n)))
      .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}
function pick(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const key of dotted.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
const show = (v: unknown) => (v === undefined ? "(없음)" : typeof v === "string" ? JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}…` : v) : JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) || (typeof a === "number" && typeof b === "string" && String(a) === b);
function describe(reply: Reply) {
  if (reply.timedOut) return `응답 없음 (${TIMEOUT / 1000}초 기다림)`;
  if (reply.error) return `연결 실패: ${reply.error}`;
  const body = reply.text ? ` ${reply.text.length > 160 ? `${reply.text.slice(0, 157)}…` : reply.text}` : "";
  return `${reply.status}${body}`;
}

/** 응답이 기대와 맞는지. 처음 어긋난 것 하나를 돌려준다. */
function compareReply(reply: Reply, expect: NonNullable<Step["expect"]>): { expected: string; actual: string } | null {
  if (reply.timedOut || reply.error) return { expected: expect.status ? `${expect.status} 응답` : "응답", actual: describe(reply) };
  if (expect.status !== undefined && reply.status !== expect.status) return { expected: `상태 ${expect.status}`, actual: `상태 ${describe(reply)}` };
  for (const [name, pattern] of Object.entries(expect.header ?? {})) {
    const got = reply.headers[name.toLowerCase()];
    if (got === undefined || !new RegExp(pattern, "i").test(got)) return { expected: `헤더 ${name}: /${pattern}/`, actual: got === undefined ? `${name} 헤더 없음` : `${name}: ${got}` };
  }
  for (const name of expect.noHeader ?? []) {
    if (reply.headers[name.toLowerCase()] !== undefined) return { expected: `${name} 헤더 없음`, actual: `${name}: ${reply.headers[name.toLowerCase()]}` };
  }
  for (const key of expect.has ?? []) {
    if (pick(reply.json, key) === undefined) return { expected: `본문에 ${key}`, actual: describe(reply) };
  }
  if (expect.length !== undefined) {
    const len = Array.isArray(reply.json) ? reply.json.length : undefined;
    if (len !== expect.length) return { expected: `목록 ${expect.length}개`, actual: len === undefined ? `목록이 아님: ${describe(reply)}` : `목록 ${len}개` };
  }
  for (const [key, want] of Object.entries(expect.json ?? {})) {
    const got = pick(reply.json, key);
    if (!same(got, want)) return { expected: `${key} = ${show(want)}`, actual: `${key} = ${show(got)}` };
  }
  const matches = (item: unknown, want: Record<string, unknown>) => Object.entries(want).every(([k, v]) => same(pick(item, k), v));
  if (expect.some) {
    const list = Array.isArray(reply.json) ? reply.json : [];
    if (!list.some((x) => matches(x, expect.some!))) return { expected: `목록에 ${show(expect.some)}인 항목`, actual: `없음 (${list.length}개 중)` };
  }
  if (expect.none) {
    const list = Array.isArray(reply.json) ? reply.json : [];
    const hit = list.find((x) => matches(x, expect.none!));
    if (hit) return { expected: `목록에 ${show(expect.none)}인 항목이 없어야 함`, actual: `있음: ${show(hit)}` };
  }
  return null;
}

function compareRows(rows: Record<string, unknown>[], expect: NonNullable<Step["expect"]>): { expected: string; actual: string } | null {
  if (expect.rows !== undefined && rows.length !== expect.rows) return { expected: `행 ${expect.rows}개`, actual: `행 ${rows.length}개${rows[0] ? `: ${show(rows[0])}` : ""}` };
  const row = rows[0];
  for (const [k, v] of Object.entries(expect.row ?? {})) {
    if (!row || !same(row[k], v)) return { expected: `${k} = ${show(v)}`, actual: row ? `${k} = ${show(row[k])}` : "행 없음" };
  }
  for (const [k, v] of Object.entries(expect.rowNot ?? {})) {
    if (row && same(row[k], v)) return { expected: `${k} ≠ ${show(v)}`, actual: `${k} = ${show(row[k])}` };
  }
  for (const [k, pattern] of Object.entries(expect.rowMatch ?? {})) {
    if (!row || !new RegExp(pattern).test(String(row[k]))) return { expected: `${k}가 /${pattern}/ 꼴`, actual: row ? `${k} = ${show(row[k])}` : "행 없음" };
  }
  return null;
}

/* ---------- 파일:줄 후보 ---------- */
export async function locate(ws: string, where?: { file: string; anchor: string }) {
  if (!where) return undefined;
  try {
    const lines = (await readFile(path.join(ws, where.file), "utf8")).split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(where.anchor));
    return { file: where.file, line: i >= 0 ? i + 1 : null };
  } catch {
    return { file: where.file, line: null };
  }
}
/** 서버 로그(오류 스택)에 나온 작업 폴더 파일 위치. */
function logLocations(logs: string[], ws: string) {
  const out: { file: string; line: number }[] = [];
  const norm = ws.replace(/\\/g, "/");
  for (const line of logs) {
    for (const m of line.replace(/\\/g, "/").matchAll(/(?:file:\/\/\/?)?([^\s()]*?\/src\/[^\s():]+\.ts):(\d+)/g)) {
      const abs = m[1].replace(/^\/(?=[A-Za-z]:)/, "");
      const rel = abs.startsWith(norm) ? abs.slice(norm.length + 1) : abs.slice(abs.indexOf("src/"));
      if (!out.some((x) => x.file === rel && x.line === Number(m[2]))) out.push({ file: rel, line: Number(m[2]) });
    }
  }
  return out.slice(0, 3);
}

/* ---------- 실행 ---------- */
export function checksFor(course: Course, stage: number, only?: string[]) {
  const st = course.stages.find((s) => s.n === stage);
  if (!st) throw new Error(`${stage}단계가 없어요.`);
  return course.checks.filter((c) => c.template === st.template && c.stage <= stage && (!only || only.includes(c.id)));
}

export async function runChecks(opts: { course: Course; stage: number; ws: string; port: number; only?: string[] }): Promise<RunResult> {
  const t0 = Date.now();
  const st = opts.course.stages.find((s) => s.n === opts.stage)!;
  const checks = checksFor(opts.course, opts.stage, opts.only);
  const authFrom = opts.course.auth[st.template] ?? 99;
  const authOn = opts.stage >= authFrom;
  const dbPath = path.join(opts.ws, ".recaller", "check.db");
  await mkdir(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await rm(dbPath + suffix, { force: true, maxRetries: 10, retryDelay: 200 });

  const logs: string[] = [];
  const boot = () => startServer({ cwd: opts.ws, port: opts.port, env: { DB_PATH: dbPath }, onLog: (l) => logs.push(l) });
  let server: Running = await boot();
  const out: RunResult = { at: new Date().toISOString(), stage: opts.stage, ms: 0, started: true, results: [], passed: 0, failed: 0, logs };

  const startFailed = async () => {
    if (!server.exited) return null;
    const hits = logLocations(logs, opts.ws);
    return `서버가 켜지지 않았어요 (종료 코드 ${server.exited.code}).${hits[0] ? ` 오류 위치: ${hits[0].file}:${hits[0].line}` : ""}\n${logs.slice(-12).join("\n")}`;
  };
  try {
    const err = await startFailed();
    if (err) {
      out.started = false; out.startError = err;
      for (const c of checks) out.results.push(await baseResult(c, opts, false, { step: 0, expected: "서버가 켜짐", actual: "서버가 켜지지 않음" }));
      out.failed = checks.length;
      return out;
    }
    const run = randomBytes(3).toString("hex");
    const jars: Record<string, string> = {};
    let actorError = "";
    if (authOn) {
      for (const name of ["A", "B"]) {
        const username = `${name.toLowerCase()}${run}`;
        await send(opts.port, "POST", "/signup", { body: { username, password: "pass1234" } });
        const login = await send(opts.port, "POST", "/login", { body: { username, password: "pass1234" } });
        const cookie = login.headers["set-cookie"]?.split(";")[0];
        if (login.status === 200 && cookie) jars[name] = cookie;
        else actorError ||= `검사용 사용자 ${name}의 가입·로그인이 실패했어요 (${describe(login)}). 4단계 코드(가입·로그인)를 먼저 확인하세요.`;
      }
    }

    for (const check of checks) {
      const vars: Vars = { run };
      const before = logs.length;
      let failure: Failure | undefined;
      for (let i = 0; i < check.steps.length && !failure; i++) {
        const step = check.steps[i];
        const actor = step.as === undefined ? (authOn ? "A" : null) : step.as;
        if (actor && (actor === "A" || actor === "B") && !jars[actor] && authOn) {
          failure = { step: i + 1, expected: `${actor}로 로그인된 상태`, actual: actorError || "로그인 실패" };
          break;
        }
        const cookie = actor ? jars[actor] : undefined;
        if (step.restart) {
          await server.stop();
          server = await boot();
          const e = await startFailed();
          if (e) failure = { step: i + 1, expected: "서버가 다시 켜짐", actual: e };
          continue;
        }
        if (step.seed) {
          for (let k = 1; k <= step.seed.count; k++) {
            const r = await send(opts.port, "POST", "/posts", { body: fill(step.seed.body, { ...vars, i: k }), cookie });
            if (r.status !== 201) { failure = { step: i + 1, request: "POST /posts (준비)", expected: "201", actual: describe(r), note: `글 ${step.seed.count}개를 준비하다 ${k}번째에서 실패` }; break; }
          }
          continue;
        }
        if (step.db) {
          const params = (fill(step.params ?? [], vars) as unknown[]).map((p) => (typeof p === "string" && /^\d+$/.test(p) ? Number(p) : p)) as (string | number)[];
          let rows: Record<string, unknown>[] = [];
          try {
            const db = new DatabaseSync(dbPath, { readOnly: true } as never);
            try { rows = db.prepare(step.db).all(...params) as Record<string, unknown>[]; } finally { db.close(); }
          } catch (error) {
            failure = { step: i + 1, request: `DB: ${step.db}`, expected: "DB 조회", actual: `조회 실패: ${(error as Error).message}` };
            break;
          }
          const bad = compareRows(rows, fill(step.expect ?? {}, vars) as NonNullable<Step["expect"]>);
          if (bad) failure = { step: i + 1, request: `DB: ${step.db} [${params.join(", ")}]`, ...bad };
          continue;
        }
        if (step.req) {
          const [method, rawUrl] = step.req.split(" ");
          const url = String(fill(rawUrl, vars));
          const reply = await send(opts.port, method, url, { body: step.body === undefined ? undefined : fill(step.body, vars), raw: step.raw, cookie });
          if (actor && reply.headers["set-cookie"] && !(actor === "A" || actor === "B")) {
            const c = reply.headers["set-cookie"].split(";")[0];
            if (!c.endsWith("=")) jars[actor] = c;
          }
          const who = actor ? `(${actor}) ` : "(로그인 없이) ";
          const reqText = `${authOn ? who : ""}${method} ${url}${step.raw !== undefined ? ` 본문 ${step.raw}` : step.body !== undefined ? ` ${JSON.stringify(fill(step.body, vars)).slice(0, 120)}` : ""}`;
          const bad = step.expect ? compareReply(reply, fill(step.expect, vars) as NonNullable<Step["expect"]>) : null;
          if (bad) { failure = { step: i + 1, request: reqText, ...bad }; break; }
          for (const [name, from] of Object.entries(step.save ?? {})) {
            vars[name] = from.startsWith("body.") ? pick(reply.json, from.slice(5)) : reply.headers[from.replace(/^header\./, "")];
          }
        }
      }
      if (server.exited && !failure) failure = { step: 0, expected: "서버가 계속 켜져 있음", actual: `검사 중 서버가 꺼짐 (코드 ${server.exited.code})` };
      const result = await baseResult(check, opts, !failure, failure);
      if (failure) result.logHits = logLocations(logs.slice(before), opts.ws);
      out.results.push(result);
      if (server.exited) { server = await boot(); }
    }
  } finally {
    await server.stop();
    out.passed = out.results.filter((r) => r.ok).length;
    out.failed = out.results.length - out.passed;
    out.ms = Date.now() - t0;
  }
  return out;
}

async function baseResult(check: Check, opts: { stage: number; ws: string }, ok: boolean, failure?: Failure): Promise<CheckResult> {
  return {
    id: check.id, title: check.title, stage: check.stage, kind: check.kind, regression: check.stage < opts.stage, target: !!check.target,
    ok, failure, where: await locate(opts.ws, check.where), knowledge: check.knowledge,
  };
}
