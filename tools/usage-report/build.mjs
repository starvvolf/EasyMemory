#!/usr/bin/env node
// 토큰 사용량 보기 (2026-10-31): 실행 기록을 모아 한 장짜리 HTML(그래프·표)로 만든다. 모델 호출 없음, 의존성 없음.
// 읽는 곳(데이터 폴더마다): study-gen/gen_*/calls/*.json(PDF 엔진), study-gen/web-trials/wt_*.json(웹 글 실험),
// assist-log.jsonl(지식·코드·프로젝트 도우미). 쓰는 곳: tmp/usage-report.html (git에 안 올라감).
// 사용: node tools/usage-report/build.mjs [데이터 폴더 ...] [--out 파일] [--open]
//       node tools/usage-report/build.mjs --serve [--open] [데이터 폴더 ...]
//   --serve: 127.0.0.1:3091(RECALLER_USAGE_PORT)에 작은 서버를 띄워, 화면이 10초마다 바뀐 기록만 다시 받아 그린다.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const open = bool("--open");
const serve = bool("--serve");
const out = path.resolve(flag("--out") || path.join(root, "tmp", "usage-report.html"));
const TOOL = "recaller-usage-report";

/** The data folders: the ones given, else every place this repo's servers write to. */
function defaultDirs() {
  const dirs = [path.join(root, ".study-forge-data"), path.join(root, "experiments", "project-course", ".study-forge-data"), path.join(root, "tmp", "engine-data")];
  try {
    const env = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const key of ["STUDY_FORGE_DATA_DIR", "RECALLER_ENGINE_DATA_DIR"]) {
      const m = new RegExp(`^${key}=(.*)$`, "m").exec(env);
      if (m && m[1].trim()) {
        const d = m[1].trim().replace(/^"|"$/g, "");
        dirs.push(d);
        // 엔진 실험 서버(3002)는 같은 tmp 밑 engine-data에 쓴다.
        dirs.push(path.join(path.dirname(d), "engine-data"));
      }
    }
  } catch { /* no .env.local */ }
  return dirs;
}
const candidateDirs = [...new Set((args.length ? args : defaultDirs()).map((d) => path.resolve(d)))];

const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// 파일마다 (수정 시각, 크기)가 같으면 전에 읽은 값을 다시 쓴다. 서버 모드에서 10초마다 훑어도 바뀐 파일만 읽는다.
const fileCache = new Map();
let stamps = [];
function cached(file, parse) {
  let st;
  try { st = statSync(file); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}`;
  stamps.push(`${file}|${key}`);
  const hit = fileCache.get(file);
  if (hit && hit.key === key) return hit.value;
  let value = null;
  try { value = parse(readFileSync(file, "utf8")); } catch { /* broken file: skip */ }
  fileCache.set(file, { key, value });
  return value;
}
const readJson = (f) => cached(f, JSON.parse);
const readLog = (f) => cached(f, (text) => text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  .sort((a, b) => String(a.at).localeCompare(String(b.at))));

/** Walk every data folder once. Returns the report data and a version that changes when any record file changes. */
function scan() {
  stamps = [];
  const dirs = candidateDirs.filter((d) => existsSync(d));
  const rows = [];   // one per call
  const runs = {};   // run id -> { title, kind, dir }
  const push = (r) => {
    rows.push({ t: r.at, k: r.kind, run: r.run, p: r.purpose, m: r.model || "?", e: r.effort || "", ms: num(r.ms), ft: num(r.firstTextMs), ok: r.ok ? 1 : 0,
      i: num(r.usage?.inputTokens), c: num(r.usage?.cachedInputTokens), w: num(r.usage?.cacheWriteTokens), o: num(r.usage?.outputTokens), rs: num(r.usage?.reasoningTokens),
      u: r.usage ? 1 : 0, f: r.fake ? 1 : 0, src: r.src });
  };
  let files = 0;
  for (const dir of dirs) {
    const src = dir;
    // PDF 엔진: 실행 하나 = gen_* 폴더 하나.
    const gen = path.join(dir, "study-gen");
    for (const id of ls(gen).filter((n) => n.startsWith("gen_"))) {
      const state = readJson(path.join(gen, id, "state.json"));
      const input = state?.input ?? {};
      const pages = Array.isArray(input.pageNumbers) && input.pageNumbers.length ? ` p.${Math.min(...input.pageNumbers)}–${Math.max(...input.pageNumbers)}` : "";
      const fake = input.provider === "fake";
      runs[id] = { title: `${input.fileName || id}${pages}`, kind: "PDF 엔진", origin: input.origin === "study" ? "공부 화면" : "실험실", fake: fake ? 1 : 0, src };
      for (const f of ls(path.join(gen, id, "calls")).filter((n) => n.endsWith(".json"))) {
        const c = readJson(path.join(gen, id, "calls", f)); files++;
        if (!c) continue;
        push({ at: c.startedAt || state?.createdAt, kind: "pdf", run: id, purpose: c.step, model: c.model, effort: c.effort, ms: c.ms, firstTextMs: c.firstTextMs, ok: c.ok, usage: c.usage, fake: fake || c.model === "fake", src });
      }
    }
    // 웹 글 실험: 파일 하나 = 실험 하나, 방법(A·B·C·D)마다 따로 센다.
    const wt = path.join(gen, "web-trials");
    for (const f of ls(wt).filter((n) => /^wt_.*\.json$/.test(n))) {
      const t = readJson(path.join(wt, f)); files++;
      if (!t) continue;
      const id = f.replace(/\.json$/, "");
      runs[id] = { title: t.title || t.url || id, kind: "웹 글 실험", origin: "실험실", fake: 0, src };
      for (const c of t.calls ?? []) {
        // 실험 파일에는 호출별 모델이 없다: 실험 기본값(gpt-6.1-terra · low)으로 본다.
        push({ at: t.createdAt, kind: "web", run: id, purpose: `web:${c.method}:${c.step}`, model: c.model || "gpt-6.1-terra", effort: c.effort || "low", ms: c.ms, firstTextMs: c.ttft, ok: c.ok, usage: c.usage, src });
      }
    }
    // 도우미 호출: 한 줄에 호출 하나. 실행 id가 없어서, 같은 갈래 호출이 3분 안에 이어지면 한 실행으로 묶는다.
    for (const log of [path.join(dir, "assist-log.jsonl")]) {
      if (!existsSync(log)) continue;
      files++;
      const lines = readLog(log) ?? [];
      const last = {};
      for (const l of lines) {
        const area = areaOf(l.purpose);
        const at = Date.parse(l.at);
        let run = last[area];
        if (!run || at - run.end > 3 * 60_000) {
          run = last[area] = { id: `as_${area}_${l.at}`, end: at };
          runs[run.id] = { title: `${area} 도우미 ${fmtLocal(l.at)}`, kind: "도우미", origin: "앱", fake: 0, src, guessed: 1 };
        }
        run.end = Math.max(run.end, at + num(l.ms));
        const t = l.tokens;
        // 10/31 오전 판정 시험이 "decisions"를 모델 이름 그대로 ChatGPT에 보내 실패한 줄: Decisions API 호출이 아니다.
        const model = /^decisions/.test(l.model ?? "") ? `${l.model} (옛 시험·Decisions 아님)` : l.model;
        push({ at: l.at, kind: "assist", run: run.id, purpose: l.purpose, model, effort: l.effort, ms: l.ms, firstTextMs: l.firstTextMs, ok: l.ok,
          usage: t ? { inputTokens: t.in, cachedInputTokens: t.cached, outputTokens: t.out, reasoningTokens: t.reasoning } : undefined, src });
      }
    }
  }
  const version = createHash("sha1").update(dirs.join("\n") + "\n" + stamps.sort().join("\n")).digest("hex").slice(0, 12);
  return { version, data: { builtAt: new Date().toISOString(), version, dirs, files, rows, runs } };
}
function fmtLocal(iso) { const d = new Date(iso); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function areaOf(purpose = "") {
  if (/^project-course:/.test(purpose)) return "프로젝트";
  if (/^code:/.test(purpose)) return "코드 문제";
  if (/^knowledge:(map|extract)$/.test(purpose) || /^web:/.test(purpose)) return "웹 글";
  if (/^(knowledge|note):/.test(purpose)) return "지식 저장소";
  return "PDF";
}

const viewHtml = () => readFileSync(path.join(here, "view.html"), "utf8");
const openUrl = (target) => execFile(process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", target] : [target]);

function buildOnce() {
  const { data } = scan();
  const html = viewHtml().replace("/*__DATA__*/null", () => JSON.stringify(data).replace(/</g, "\\u003c"));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`읽은 폴더 ${data.dirs.length}개, 파일 ${data.files}개, 호출 ${data.rows.length}건 → ${out}`);
  if (!data.dirs.length) console.log("기록 폴더를 못 찾았어요. node tools/usage-report/build.mjs <데이터 폴더> 처럼 폴더를 직접 주세요.");
  if (open) openUrl(out);
}

// ---------- serve mode ----------
// 앱(3000)·실험 서버(3003 등)와 겹치지 않게 3091부터. 이미 이 도구가 떠 있으면 브라우저만 연다.
const RESERVED = new Set([3000, 3001, 3002, 3003]);
function startServer() {
  const first = Number(process.env.RECALLER_USAGE_PORT) || 3091;
  let last = { version: "", data: null, body: "" };
  const current = () => {
    const s = scan();
    if (s.version !== last.version) last = { version: s.version, data: s.data, body: JSON.stringify(s.data) };
    return last;
  };
  const tryPort = async (port, left) => {
    if (RESERVED.has(port)) return tryPort(port + 1, left);
    if (await isOurs(port)) {
      console.log(`토큰 사용량 보기가 이미 http://127.0.0.1:${port}/ 에 떠 있어요. 브라우저만 엽니다.`);
      if (open) openUrl(`http://127.0.0.1:${port}/`);
      return;
    }
    const server = http.createServer((req, res) => handle(req, res, port, current));
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && left > 0) tryPort(port + 1, left - 1);
      else { console.error(`서버를 못 띄웠어요: ${err.message}`); process.exitCode = 1; }
    });
    server.listen(port, "127.0.0.1", () => {
      const s = current();
      const url = `http://127.0.0.1:${port}/`;
      console.log(`토큰 사용량 보기: ${url}  (읽는 폴더 ${s.data.dirs.length}개, 호출 ${s.data.rows.length}건)`);
      console.log("화면이 10초마다 새 기록을 확인합니다. 이 창을 닫으면 자동 갱신이 멈춥니다.");
      if (!s.data.dirs.length) console.log("기록 폴더를 못 찾았어요. 폴더를 인자로 주세요.");
      if (open) openUrl(url);
    });
  };
  tryPort(first, 10);
}
async function isOurs(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(800) });
    return (await r.json()).tool === TOOL;
  } catch { return false; }
}
function handle(req, res, port, current) {
  // 다른 사이트가 이 주소를 부르지 못하게, 127.0.0.1/localhost로 온 요청만 받는다.
  const host = String(req.headers.host || "");
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
  const { pathname } = new URL(req.url || "/", `http://${host}`);
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  try {
    if (pathname === "/") return send(200, "text/html; charset=utf-8", viewHtml());
    if (pathname === "/version") return send(200, "application/json", JSON.stringify({ tool: TOOL, version: current().version }));
    if (pathname === "/data.json") return send(200, "application/json; charset=utf-8", current().body);
    send(404, "text/plain", "not found");
  } catch (err) {
    send(500, "text/plain; charset=utf-8", String(err?.message || err));
  }
}

if (serve) startServer();
else buildOnce();
