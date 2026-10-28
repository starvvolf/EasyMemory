// 실습 서버 프로세스 켜고 끄기. 학습자 작업 폴더 안에서만 돈다. 포트는 4100번대.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";

const [major, minor] = process.versions.node.split(".").map(Number);
/** 실습 서버를 띄울 때 쓰는 node 옵션. */
export function nodeArgs() {
  const args = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
  if (major === 22 && minor < 13) args.push("--experimental-sqlite");
  return args;
}
export function nodeSupport() {
  const ok = major > 22 || (major === 22 && minor >= 6);
  return { ok, version: process.versions.node, message: ok ? "" : `Node ${process.versions.node}에서는 실습 서버를 못 띄워요. 22.13 이상이 필요해요.` };
}

export function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

export type Running = {
  child: ChildProcess;
  port: number;
  cwd: string;
  logs: string[];
  startedAt: string;
  exited: { code: number | null; signal: string | null } | null;
  stop: () => Promise<void>;
};

const all = new Set<Running>();

/** 실습 서버를 켠다. /health가 응답하거나 프로세스가 죽을 때까지 기다린다. */
export async function startServer(opts: { cwd: string; port: number; env?: Record<string, string>; waitMs?: number; logLimit?: number; onLog?: (line: string) => void }) {
  if (!(await portFree(opts.port))) throw new Error(`${opts.port}번 포트를 이미 누가 쓰고 있어요.`);
  const child = spawn(process.execPath, [...nodeArgs(), "src/server.ts"], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, PORT: String(opts.port), FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const run: Running = {
    child, port: opts.port, cwd: opts.cwd, logs: [], startedAt: new Date().toISOString(), exited: null,
    stop: () => stopChild(run),
  };
  all.add(run);
  const limit = opts.logLimit ?? 400;
  const push = (prefix: string) => (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const text = prefix + line;
      run.logs.push(text);
      if (run.logs.length > limit) run.logs.shift();
      opts.onLog?.(text);
    }
  };
  child.stdout!.on("data", push(""));
  child.stderr!.on("data", push("! "));
  child.on("exit", (code, signal) => { run.exited = { code, signal }; all.delete(run); });

  const deadline = Date.now() + (opts.waitMs ?? 8000);
  while (Date.now() < deadline) {
    if (run.exited) return run;
    if (await answers(opts.port)) return run;
    await new Promise((r) => setTimeout(r, 120));
  }
  return run;
}

function answers(port: number) {
  return new Promise<boolean>((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", agent: false, timeout: 500 }, (res) => { res.resume(); resolve(true); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

async function stopChild(run: Running) {
  if (run.exited) return;
  const done = new Promise<void>((resolve) => run.child.once("exit", () => resolve()));
  run.child.kill();
  const timer = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  await Promise.race([done, timer]);
  if (!run.exited) { run.child.kill("SIGKILL"); await Promise.race([done, new Promise((r) => setTimeout(r, 1000))]); }
}

/** 코스 서버가 꺼질 때 남은 실습 서버를 모두 정리한다. */
export function killAll() {
  for (const run of all) { try { run.child.kill(); } catch { /* 이미 꺼짐 */ } }
  all.clear();
}
export const runningCount = () => all.size;
