// 테스트 만들기 (2026-10-26, docs/DECISIONS.md "로컬 채점"): the app side of harness.mjs. The AI writes a generator, a
// checker, a reference, a simple solution and a few faulty solutions; this hands them to one separate Node process with
// an empty environment and gets back the tests, or the reason the draft failed.
import { spawn } from "node:child_process";
import path from "node:path";

export type GenTest = { input: string; output: string; kind: string; size: string; refMs: number };
export type Mutant = { flaw: string; code: string };
export type TestgenJob = {
  generator: string; reference: string; brute?: string; mutants?: Mutant[];
  /** Examples copied from the source text: the answer key. */
  sourceExamples?: Array<{ input: string; output: string }>;
  /** Example inputs the AI wrote (no source): answered by the reference. */
  exampleInputs?: string[];
  /** Small inputs the simple solution must agree on (only asked for problems without source examples). */
  needCompared?: number;
  smallCount?: number; runMs?: number; seed?: number;
  /** How outputs are compared (compare.mjs); exact when left out. */
  compare?: { mode?: "exact" | "approx"; eps?: number };
};
export type Mutation = { killed: number; total: number; survived: string[]; added: number; maybeRight: string[] };
export type TestgenResult =
  | { ok: true; examples: Array<{ input: string; output: string }>; tests: GenTest[]; compared: number; small: number; maxTests: number; mutation: Mutation }
  | { ok: false; reason: string };

const HARNESS = () => path.join(process.cwd(), "src", "lib", "code", "testgen", "harness.mjs");
const WAIT_MS = 180_000;

/** Runs one job in its own process. Only what Node needs to start is passed on: no keys, no tokens, no app settings. */
export function runTestgen(job: TestgenJob): Promise<TestgenResult> {
  return new Promise((resolve) => {
    const env = {} as NodeJS.ProcessEnv;
    for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ["--max-old-space-size=2048", "--stack-size=65500", HARNESS()], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let err = ""; let settled = false;
    const done = (result: TestgenResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); done({ ok: false, reason: `테스트 만들기가 ${WAIT_MS / 1000}초 안에 끝나지 않음 (생성기나 풀이가 너무 느림)` }); }, WAIT_MS);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); if (err.length > 20_000) err = err.slice(-20_000); });
    child.on("error", (e) => done({ ok: false, reason: `테스트 만들기 실행기를 띄우지 못함: ${e.message}` }));
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8");
      try { done(JSON.parse(text) as TestgenResult); }
      catch { done({ ok: false, reason: code === 134 || /heap out of memory/i.test(err) ? "테스트를 만들다 메모리가 모자람 (입력이 너무 큼)" : `테스트 만들기 실행기가 비정상 종료 (${code}): ${err.slice(-300)}` }); }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(job));
  });
}
