// 코드 실행 (2026-10-26): the learner's code runs on this computer with the compilers already installed here.
// Each run gets its own temporary folder; compiling and every test run have a time limit, and a run that goes over is
// killed with everything it started. Nothing is sandboxed beyond that: this is the learner's own code on their own PC,
// and the server only answers loopback requests (local experiment mode).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const LANGS = ["python", "javascript", "cpp", "csharp"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { python: "Python", javascript: "JavaScript", cpp: "C++", csharp: "C#" };
const SOURCE: Record<Lang, string> = { python: "main.py", javascript: "main.js", cpp: "main.cpp", csharp: "Main.cs" };
const win = process.platform === "win32";

export type Exec = { stdout: string; stderr: string; code: number | null; timedOut: boolean; tooMuch: boolean; ms: number; failedToStart?: string };
const OUTPUT_CAP = 8_000_000;

/** Run one program: stdin in, stdout/stderr out, killed (with its children) after `timeMs`. */
export function execute(cmd: string, args: string[], options: { cwd: string; input?: string; timeMs: number; env?: Record<string, string> }): Promise<Exec> {
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
    ...(win ? [() => probe("py", ["-3"], ["--version"], /Python 3/)] : []),
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
    const error = await compile(found.cmd, [...found.pre, "-O2", "-std=gnu++17", ...(win ? ["-static"] : []), "-o", exe, SOURCE.cpp]);
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
export type Verdict = "AC" | "WA" | "TLE" | "RE" | "CE" | "MISSING";
export const VERDICT_LABEL: Record<Verdict, string> = { AC: "맞았습니다", WA: "틀렸습니다", TLE: "시간 초과", RE: "런타임 에러", CE: "컴파일 에러", MISSING: "실행기 없음" };
export type TestCase = { input: string; output: string };
export type TestResult = { index: number; verdict: Verdict; ms: number; input: string; expected: string; got: string; stderr: string };
export type Judgement = { verdict: Verdict; passed: number; total: number; results: TestResult[]; compile: string; ms: number };

/** Output as judges compare it: \r\n as \n, spaces at line ends and blank lines at the end ignored. */
export const normalizeOutput = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");
const clipText = (text: string, n = 4000) => text.length > n ? `${text.slice(0, n)}\n… (${text.length - n}자 더)` : text;

export async function judge(lang: Lang, code: string, tests: TestCase[], options: { timeLimitMs?: number; stopAtFirstFail?: boolean } = {}): Promise<Judgement> {
  const started = Date.now();
  const prepared = await prepare(lang, code);
  try {
    if (!prepared.ok) return { verdict: prepared.kind === "missing" ? "MISSING" : "CE", passed: 0, total: tests.length, results: [], compile: clipText(prepared.error, 8000), ms: Date.now() - started };
    const results: TestResult[] = [];
    const limit = options.timeLimitMs ?? 2000;
    for (const [index, test] of tests.entries()) {
      const out = await execute(prepared.cmd, prepared.args, { cwd: prepared.dir, input: test.input, timeMs: limit, ...(prepared.env ? { env: prepared.env } : {}) });
      const verdict: Verdict = out.failedToStart ? "RE" : out.timedOut ? "TLE" : out.tooMuch || out.code !== 0 ? "RE"
        : normalizeOutput(out.stdout) === normalizeOutput(test.output) ? "AC" : "WA";
      results.push({ index, verdict, ms: out.ms, input: clipText(test.input), expected: clipText(test.output), got: clipText(out.stdout),
        stderr: clipText(out.failedToStart ?? (out.tooMuch ? "출력이 너무 많아요 (8MB 넘음)." : out.stderr), 3000) });
      if (verdict !== "AC" && options.stopAtFirstFail) break;
    }
    const failed = results.find((r) => r.verdict !== "AC");
    return { verdict: failed?.verdict ?? "AC", passed: results.filter((r) => r.verdict === "AC").length, total: tests.length, results, compile: "", ms: Date.now() - started };
  } finally { await cleanup(prepared); }
}
/** "실행": the learner's own input, no expected answer. */
export async function runOnce(lang: Lang, code: string, input: string, timeLimitMs = 5000, full = false) {
  const prepared = await prepare(lang, code);
  try {
    if (!prepared.ok) return { ok: false as const, kind: prepared.kind, error: clipText(prepared.error, 8000) };
    const out = await execute(prepared.cmd, prepared.args, { cwd: prepared.dir, input, timeMs: timeLimitMs, ...(prepared.env ? { env: prepared.env } : {}) });
    return { ok: true as const, stdout: full ? out.stdout : clipText(out.stdout, 20_000), tooMuch: out.tooMuch, stderr: clipText(out.failedToStart ?? out.stderr, 4000), code: out.code, timedOut: out.timedOut, ms: out.ms };
  } finally { await cleanup(prepared); }
}
