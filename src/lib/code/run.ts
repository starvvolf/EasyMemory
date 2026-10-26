// 코드 실행 (2026-10-26): the learner's code runs on this computer with the compilers already installed here.
// Each run gets its own temporary folder; compiling and every test run have a time limit, and a run that goes over is
// killed with everything it started. Nothing is sandboxed beyond that: this is the learner's own code on their own PC,
// and the server only answers loopback requests (local experiment mode).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareOutput, normalizeOutput } from "./compare.mjs";

export { normalizeOutput };

export const LANGS = ["python", "javascript", "cpp", "csharp"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { python: "Python", javascript: "JavaScript", cpp: "C++", csharp: "C#" };
const SOURCE: Record<Lang, string> = { python: "main.py", javascript: "main.js", cpp: "main.cpp", csharp: "Main.cs" };
const win = process.platform === "win32";

/** CPU time (user + kernel, every process the program started) and peak committed memory, from the job object. */
export type Usage = { cpuMs: number; peakKb: number; procs: number; hit: "cpu" | "mem" | "" };
export type Exec = { stdout: string; stderr: string; code: number | null; timedOut: boolean; tooMuch: boolean; ms: number; failedToStart?: string; usage?: Usage };
export type Limits = { cpuMs: number; memMb: number };
const OUTPUT_CAP = 8_000_000;

/** Run one program: stdin in, stdout/stderr out, killed (with its children) after `timeMs`. */
export async function execute(cmd: string, args: string[], options: { cwd: string; input?: string; timeMs: number; env?: Record<string, string>; limits?: Limits }): Promise<Exec> {
  const helper = options.limits ? await jobrun() : null;
  if (!helper || !options.limits) return spawnOnce(cmd, args, options);
  const stats = path.join(options.cwd, `job-${randomBytes(4).toString("hex")}.json`);
  const out = await spawnOnce(helper, [stats, String(options.limits.cpuMs), String(options.limits.memMb), cmd, ...args], options);
  try {
    const s = JSON.parse(await readFile(stats, "utf8")) as { exit: number; cpuMs: number; peakKb: number; procs?: number; hit: Usage["hit"]; error: string };
    await rm(stats, { force: true });
    if (s.error) return out; // the job could not be set up: the run still happened, without measurements
    return { ...out, code: s.exit > 0x7fffffff ? s.exit - 0x100000000 : s.exit, usage: { cpuMs: s.cpuMs, peakKb: s.peakKb, procs: s.procs ?? 1, hit: s.hit } };
  } catch { return out; } // killed by the wall clock before it could write
}

function spawnOnce(cmd: string, args: string[], options: { cwd: string; input?: string; timeMs: number; env?: Record<string, string> }): Promise<Exec> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "", stderr = "", timedOut = false, tooMuch = false, settled = false;
    const child = spawn(cmd, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true, detached: !win, stdio: ["pipe", "pipe", "pipe"] });
    const kill = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        if (win) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else process.kill(-child.pid, "SIGKILL");
      } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeMs);
    const take = (chunk: Buffer, into: "out" | "err") => {
      if (into === "out") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > OUTPUT_CAP) { tooMuch = true; kill(); }
    };
    child.stdout.on("data", (c: Buffer) => take(c, "out"));
    child.stderr.on("data", (c: Buffer) => take(c, "err"));
    const done = (code: number | null, failedToStart?: string) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ stdout: stdout.slice(0, OUTPUT_CAP), stderr: stderr.slice(0, 20_000), code, timedOut, tooMuch, ms: Date.now() - started, ...(failedToStart ? { failedToStart } : {}) });
    };
    child.on("error", (error) => done(null, error.message));
    child.on("close", (code) => done(code));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

/* ---------- 작업 개체 도우미 (Windows): jobrun/JobRun.cs, built once with the csc.exe that ships with Windows ---------- */
// Bump when JobRun.cs changes, so a dev server that hot-reloads picks up the new build (the exe name has the source hash).
const JOBRUN_VERSION = 2;
const jobCache = globalThis as unknown as { __jobrun?: Promise<string | null>; __jobrunVersion?: number };
export function jobrun(): Promise<string | null> {
  if (!win || process.env.RECALLER_NO_JOBRUN) return Promise.resolve(null);
  if (jobCache.__jobrunVersion !== JOBRUN_VERSION) { jobCache.__jobrun = undefined; jobCache.__jobrunVersion = JOBRUN_VERSION; }
  jobCache.__jobrun ??= (async () => {
    try {
      const source = await readFile(path.join(process.cwd(), "src", "lib", "code", "jobrun", "JobRun.cs"), "utf8");
      const dir = path.join(os.tmpdir(), "recaller-code");
      const exe = path.join(dir, `jobrun-${createHash("sha1").update(source).digest("hex").slice(0, 10)}.exe`);
      if (await exists(exe)) return exe;
      await mkdir(dir, { recursive: true });
      const windir = process.env.WINDIR ?? process.env.windir ?? "C:\\Windows";
      const csc = path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
      const work = path.join(dir, `jobrun-build-${randomBytes(4).toString("hex")}`);
      await mkdir(work, { recursive: true });
      await writeFile(path.join(work, "JobRun.cs"), source, "utf8");
      const out = await spawnOnce(csc, ["/nologo", "/optimize+", "/out:jobrun.exe", "JobRun.cs"], { cwd: work, timeMs: 60_000 });
      if (out.code !== 0) { console.warn(`[code] jobrun build failed: ${out.stdout.slice(0, 500)}`); return null; }
      await rename(path.join(work, "jobrun.exe"), exe).catch(() => undefined);
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      return (await exists(exe)) ? exe : null;
    } catch (e) { console.warn(`[code] jobrun unavailable: ${(e as Error).message}`); return null; }
  })();
  return jobCache.__jobrun;
}

/* ---------- which compilers this computer has ---------- */
type Tool = { cmd: string; pre: string[]; version: string };
const exists = async (file: string) => { try { await access(file); return true; } catch { return false; } };
async function probe(cmd: string, pre: string[] = [], versionArgs = ["--version"], expect?: RegExp): Promise<Tool | null> {
  const dir = os.tmpdir();
  const out = await execute(cmd, [...pre, ...versionArgs], { cwd: dir, timeMs: 8000 });
  const text = `${out.stdout}\n${out.stderr}`.trim();
  if (out.failedToStart || out.timedOut || (out.code !== 0 && !expect?.test(text))) return null;
  if (expect && !expect.test(text)) return null;
  return { cmd, pre, version: text.split("\n")[0].slice(0, 80) };
}
async function firstOf(candidates: Array<() => Promise<Tool | null>>) { for (const c of candidates) { const t = await c(); if (t) return t; } return null; }
const winPaths = (...parts: string[][]) => parts.map((p) => path.join(...p));

type Toolchain = { python: Tool | null; javascript: Tool | null; cpp: Tool | null; csharp: (Tool & { via: "csc" | "mcs" | "dotnet"; runner?: string }) | null };
const cache = globalThis as unknown as { __codeTools?: { at: number; tools: Promise<Toolchain> } };

async function findTools(): Promise<Toolchain> {
  const env = process.env;
  const python = await firstOf([
    ...(env.RECALLER_PYTHON ? [() => probe(env.RECALLER_PYTHON!, [], ["--version"], /Python 3/)] : []),
    // The py launcher stays running as a second process (and ~30MB) next to python.exe; use python.exe directly.
    ...(win ? [async () => {
      const t = await probe("py", ["-3"], ["--version"], /Python 3/);
      if (!t) return null;
      const where = await execute("py", ["-3", "-c", "import sys; print(sys.executable)"], { cwd: os.tmpdir(), timeMs: 8000 });
      const exe = where.stdout.trim();
      return exe && where.code === 0 && await exists(exe) ? { cmd: exe, pre: [], version: t.version } : t;
    }] : []),
    () => probe(win ? "python" : "python3", [], ["--version"], /Python 3/),
    () => probe(win ? "python3" : "python", [], ["--version"], /Python 3/),
  ]);
  const javascript: Tool = { cmd: process.execPath, pre: [], version: `Node ${process.version}` };
  const gppPaths = win ? winPaths(["C:\\", "msys64", "ucrt64", "bin", "g++.exe"], ["C:\\", "msys64", "mingw64", "bin", "g++.exe"], ["C:\\", "MinGW", "bin", "g++.exe"],
    ["C:\\", "mingw64", "bin", "g++.exe"], [env.ProgramFiles ?? "C:\\Program Files", "mingw-w64", "bin", "g++.exe"]) : [];
  const cpp = await firstOf([
    ...(env.RECALLER_GPP ? [() => probe(env.RECALLER_GPP!)] : []),
    () => probe("g++"),
    ...gppPaths.map((p) => async () => (await exists(p)) ? probe(p) : null),
    () => probe("clang++"),
  ]);
  const windir = env.WINDIR ?? env.windir ?? "C:\\Windows";
  const csc = win ? path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe") : "";
  const csharp = await firstOf([
    ...(env.RECALLER_CSC ? [async () => { const t = await probe(env.RECALLER_CSC!, [], ["/help"], /Compiler|컴파일러/i); return t ? { ...t, via: "csc" as const } : null; }] : []),
    async () => { const t = await probe("dotnet", [], ["--version"], /^\d+\.\d+/m); return t ? { ...t, via: "dotnet" as const } : null; },
    ...(csc ? [async () => { if (!(await exists(csc))) return null; const t = await probe(csc, [], ["/help"], /Compiler|컴파일러|C#/i); return t ? { ...t, via: "csc" as const } : null; }] : []),
    async () => { const t = await probe("mcs", [], ["--version"], /Mono|C#/i); if (!t) return null; const mono = await probe("mono"); return mono ? { ...t, via: "mcs" as const, runner: mono.cmd } : null; },
  ]) as Toolchain["csharp"];
  return { python, javascript, cpp, csharp };
}
export function tools(refresh = false) {
  if (refresh || !cache.__codeTools || Date.now() - cache.__codeTools.at > 5 * 60_000) cache.__codeTools = { at: Date.now(), tools: findTools() };
  return cache.__codeTools.tools;
}
/** For the screen: each language, whether it can run here, and what to install if not. */
export async function languages() {
  const found = await tools();
  const help: Record<Lang, string> = {
    python: "Python 3을 설치하고 PATH에 넣어 주세요 (python.org 설치 프로그램의 'Add to PATH').",
    javascript: "",
    cpp: "MinGW-w64(g++)를 설치하고 PATH에 넣어 주세요. 다른 위치라면 RECALLER_GPP에 g++ 경로를 적어요.",
    csharp: ".NET SDK를 설치하거나, Windows에 기본으로 있는 csc.exe를 써요. 다른 위치라면 RECALLER_CSC에 적어요.",
  };
  return LANGS.map((lang) => ({ lang, label: LANG_LABEL[lang], ready: Boolean(found[lang]), version: found[lang]?.version ?? "", help: found[lang] ? "" : help[lang] }));
}

/* ---------- compile once, run many ---------- */
export type Prepared = { ok: true; cmd: string; args: string[]; env?: Record<string, string>; dir: string; compileMs: number } | { ok: false; error: string; kind: "compile" | "missing"; dir: string };
const COMPILE_MS = 30_000;

export async function prepare(lang: Lang, code: string): Promise<Prepared> {
  const dir = path.join(os.tmpdir(), "recaller-code", randomBytes(6).toString("hex"));
  await mkdir(dir, { recursive: true });
  const found = (await tools())[lang];
  if (!found) return { ok: false, kind: "missing", error: `${LANG_LABEL[lang]} 실행기가 이 컴퓨터에 없어요.`, dir };
  await writeFile(path.join(dir, SOURCE[lang]), code, "utf8");
  const started = Date.now();
  const compile = async (cmd: string, args: string[], env?: Record<string, string>) => {
    const out = await execute(cmd, args, { cwd: dir, timeMs: COMPILE_MS, ...(env ? { env } : {}) });
    if (out.failedToStart) return `컴파일러를 실행하지 못했어요: ${out.failedToStart}`;
    if (out.timedOut) return "컴파일이 30초 안에 끝나지 않았어요.";
    return out.code === 0 ? null : (`${out.stderr}\n${out.stdout}`.trim() || `컴파일러가 ${out.code}로 끝났어요.`);
  };
  if (lang === "python") return { ok: true, cmd: found.cmd, args: [...found.pre, "-X", "utf8", SOURCE.python], env: { PYTHONIOENCODING: "utf-8" }, dir, compileMs: 0 };
  if (lang === "javascript") return { ok: true, cmd: found.cmd, args: [SOURCE.javascript], dir, compileMs: 0 };
  if (lang === "cpp") {
    const exe = win ? "main.exe" : "main";
    // Static linking on Windows: a MinGW program then runs without its DLLs on PATH.
    // A 256MB stack on Windows (the default is 1MB): judges let deep recursion use the memory limit.
    const error = await compile(found.cmd, [...found.pre, "-O2", "-std=gnu++17", ...(win ? ["-static", "-Wl,--stack,268435456"] : []), "-o", exe, SOURCE.cpp]);
    if (error) return { ok: false, kind: "compile", error, dir };
    return { ok: true, cmd: path.join(dir, exe), args: [], dir, compileMs: Date.now() - started };
  }
  const cs = found as NonNullable<Toolchain["csharp"]>;
  if (cs.via === "csc") {
    const error = await compile(cs.cmd, ["/nologo", "/optimize+", "/out:main.exe", SOURCE.csharp]);
    if (error) return { ok: false, kind: "compile", error, dir };
    return { ok: true, cmd: path.join(dir, "main.exe"), args: [], dir, compileMs: Date.now() - started };
  }
  if (cs.via === "mcs") {
    const error = await compile(cs.cmd, ["-optimize+", "-out:main.exe", SOURCE.csharp]);
    if (error) return { ok: false, kind: "compile", error, dir };
    return { ok: true, cmd: cs.runner ?? "mono", args: ["main.exe"], dir, compileMs: Date.now() - started };
  }
  const major = cs.version.match(/^(\d+)/)?.[1] ?? "8";
  await writeFile(path.join(dir, "main.csproj"), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net${major}.0</TargetFramework>`
    + `<ImplicitUsings>enable</ImplicitUsings><Nullable>disable</Nullable><AssemblyName>main</AssemblyName><InvariantGlobalization>true</InvariantGlobalization></PropertyGroup></Project>`, "utf8");
  const error = await compile(cs.cmd, ["build", "-c", "Release", "-o", "out", "--nologo", "-v", "q"], { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" });
  if (error) return { ok: false, kind: "compile", error: error.split("\n").filter((l) => /error|오류/i.test(l)).join("\n") || error, dir };
  return { ok: true, cmd: cs.cmd, args: [path.join("out", "main.dll")], dir, compileMs: Date.now() - started };
}
export async function cleanup(prepared: Prepared) { await rm(prepared.dir, { recursive: true, force: true }).catch(() => undefined); }

/* ---------- judging ---------- */
export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "MISSING";
export const VERDICT_LABEL: Record<Verdict, string> = { AC: "맞았습니다", WA: "틀렸습니다", TLE: "시간 초과", MLE: "메모리 초과", RE: "런타임 에러", CE: "컴파일 에러", MISSING: "실행기 없음" };
export type TestCase = { input: string; output: string };
export type TestResult = { index: number; verdict: Verdict; ms: number; input: string; expected: string; got: string; stderr: string; /** where a wrong answer first differs */ diff?: string;
  /** CPU time and peak memory (Windows job object); `near` when over the limit but inside the allowance band */ cpuMs?: number; peakKb?: number; near?: "time" | "memory" };
export type Judgement = { verdict: Verdict; passed: number; total: number; results: TestResult[]; compile: string; ms: number; /** false when CPU time and memory could not be measured (not Windows, or the helper failed) */ measured?: boolean };

/**
 * This PC against the reference PC (calibrate.ts): `speed` > 1 means slower, so CPU time is divided by it; `base` is
 * what an empty program of each language costs here (start-up CPU, memory), taken off before comparing with the limit.
 */
export type Calibration = { speed: number; base: Partial<Record<Lang, { cpuMs: number; peakKb: number }>> };

/**
 * Limits as a judge would apply them, with an allowance band for this PC not being the judge's machine: a run over the
 * limit but inside the band still gets its verdict, marked `near`; past the band it is TLE / MLE. The wall clock
 * (a program waiting for input uses no CPU) is a generous multiple of the time limit. With a calibration, the hard
 * limits handed to the job object are in this PC's raw terms (scaled by speed, plus the language's empty-program cost).
 */
export function limitsFor(timeLimitMs: number, memoryLimitMb: number, lang?: Lang, cal?: Calibration) {
  const timeBand = Math.max(300, Math.round(timeLimitMs * 0.3)), memBand = Math.max(16, Math.round(memoryLimitMb * 0.1));
  const speed = cal?.speed ?? 1, base = lang ? cal?.base[lang] : undefined;
  const cpuMs = Math.round((timeLimitMs + timeBand) * speed + (base?.cpuMs ?? 0));
  const memMb = Math.round(memoryLimitMb + memBand + (base?.peakKb ?? 0) / 1024);
  return { cpuMs, memMb, wallMs: Math.max(cpuMs * 3, cpuMs + 3000) };
}
/** Raw job-object numbers → what the solution itself used, in reference-PC terms. */
export function effectiveUsage(u: { cpuMs: number; peakKb: number }, lang: Lang, cal?: Calibration) {
  const base = cal?.base[lang];
  return { cpuMs: Math.max(0, Math.round((u.cpuMs - (base?.cpuMs ?? 0)) / (cal?.speed ?? 1))), peakKb: Math.max(0, u.peakKb - (base?.peakKb ?? 0)) };
}
export const DEFAULT_MEMORY_MB = 256;

export type CompareHow = { mode?: "exact" | "approx"; eps?: number };
const clipText = (text: string, n = 4000) => text.length > n ? `${text.slice(0, n)}\n… (${text.length - n}자 더)` : text;

export async function judge(lang: Lang, code: string, tests: TestCase[], options: { timeLimitMs?: number; memoryLimitMb?: number; stopAtFirstFail?: boolean; compare?: CompareHow; calibration?: Calibration } = {}): Promise<Judgement> {
  const started = Date.now();
  const prepared = await prepare(lang, code);
  try {
    if (!prepared.ok) return { verdict: prepared.kind === "missing" ? "MISSING" : "CE", passed: 0, total: tests.length, results: [], compile: clipText(prepared.error, 8000), ms: Date.now() - started };
    const results: TestResult[] = [];
    const limit = options.timeLimitMs ?? 2000, memory = options.memoryLimitMb ?? DEFAULT_MEMORY_MB;
    const hard = limitsFor(limit, memory, lang, options.calibration);
    let measured = true;
    for (const [index, test] of tests.entries()) {
      const out = await execute(prepared.cmd, prepared.args, { cwd: prepared.dir, input: test.input, timeMs: hard.wallMs, limits: { cpuMs: hard.cpuMs, memMb: hard.memMb }, ...(prepared.env ? { env: prepared.env } : {}) });
      const u = out.usage ? { ...out.usage, ...effectiveUsage(out.usage, lang, options.calibration) } : undefined;
      if (!u) measured = false;
      // Without measurements (not Windows) the wall clock is all there is, held to the time limit itself.
      const slow = u ? u.hit === "cpu" || out.timedOut || u.cpuMs > limit + Math.max(300, Math.round(limit * 0.3)) : out.timedOut || out.ms > limit;
      const memoryOut = Boolean(u && (u.hit === "mem" || (out.code !== 0 && out.usage!.peakKb >= hard.memMb * 1024 * 0.97)));
      const ran = !out.failedToStart && !slow && !memoryOut && !out.tooMuch && out.code === 0;
      const same = ran ? compareOutput(out.stdout, test.output, options.compare) : null;
      const verdict: Verdict = out.failedToStart ? "RE" : slow ? "TLE" : memoryOut ? "MLE" : !ran ? "RE" : same!.ok ? "AC" : "WA";
      const near = u && verdict !== "TLE" && verdict !== "MLE" ? (u.cpuMs > limit ? "time" as const : u.peakKb > memory * 1024 ? "memory" as const : undefined) : undefined;
      results.push({ index, verdict, ms: out.ms, input: clipText(test.input), expected: clipText(test.output), got: clipText(out.stdout),
        stderr: clipText(out.failedToStart ?? (out.tooMuch ? "출력이 너무 많아요 (8MB 넘음)." : out.stderr), 3000),
        ...(same && !same.ok ? { diff: same.why } : {}), ...(u ? { cpuMs: u.cpuMs, peakKb: u.peakKb } : {}), ...(near ? { near } : {}) });
      if (verdict !== "AC" && options.stopAtFirstFail) break;
    }
    const failed = results.find((r) => r.verdict !== "AC");
    return { verdict: failed?.verdict ?? "AC", passed: results.filter((r) => r.verdict === "AC").length, total: tests.length, results, compile: "", ms: Date.now() - started, measured };
  } finally { await cleanup(prepared); }
}
/** "실행": the learner's own input, no expected answer. */
export async function runOnce(lang: Lang, code: string, input: string, timeLimitMs = 5000, full = false) {
  const prepared = await prepare(lang, code);
  try {
    if (!prepared.ok) return { ok: false as const, kind: prepared.kind, error: clipText(prepared.error, 8000) };
    const out = await execute(prepared.cmd, prepared.args, { cwd: prepared.dir, input, timeMs: timeLimitMs, limits: { cpuMs: timeLimitMs, memMb: 2048 }, ...(prepared.env ? { env: prepared.env } : {}) });
    return { ok: true as const, ...(out.usage ? { cpuMs: out.usage.cpuMs, peakKb: out.usage.peakKb } : {}), stdout: full ? out.stdout : clipText(out.stdout, 20_000), tooMuch: out.tooMuch, stderr: clipText(out.failedToStart ?? out.stderr, 4000), code: out.code, timedOut: out.timedOut, ms: out.ms };
  } finally { await cleanup(prepared); }
}
