// 테스트 만들기 실행기 (2026-10-26, docs/DECISIONS.md "로컬 채점"): one Node process, started with an empty environment,
// runs the AI's JavaScript — the generator, the checker, the reference, the simple (brute) solution and the faulty
// solutions — thousands of times in fresh vm contexts. Starting a process per input took ~0.1 s each (minutes for a
// problem); here a run costs about a millisecond. It never sees the app's keys: the app starts it with no environment.
//
// stdin: a job (JSON, see testgen/index.ts). stdout: one JSON result.
import vm from "node:vm";
import util from "node:util";
import { performance } from "node:perf_hooks";
import { compareOutput, normalizeOutput as norm } from "../compare.mjs";

const EXIT = Symbol("exit");
const MAX_TESTS = 60;
const MAX_TOTAL_INPUT = 40_000_000;

/* ---------- seeded random, handed to the generator ---------- */
function rng(seed) {
  let a = seed >>> 0;
  const u32 = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
  const next = () => (u32() * 2 ** 21 + (u32() >>> 11)) / 2 ** 53; // 53 random bits
  const int = (lo, hi) => { lo = Math.ceil(lo); hi = Math.floor(hi); if (hi < lo) throw new Error(`rnd.int(${lo}, ${hi}): 범위가 비었어요`); return lo + Math.floor(next() * (hi - lo + 1)); };
  const bigint = (lo, hi) => { lo = BigInt(lo); hi = BigInt(hi); const span = hi - lo + 1n; let r = 0n; for (let i = 0; i < 4; i++) r = (r << 32n) | BigInt(u32()); return lo + (r % span); };
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = int(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return { next, int, bigint, shuffle, pick: (arr) => arr[int(0, arr.length - 1)], perm: (n) => shuffle(Array.from({ length: n }, (_, i) => i + 1)),
    string: (len, alphabet = "abcdefghijklmnopqrstuvwxyz") => { let s = ""; for (let i = 0; i < len; i++) s += alphabet[int(0, alphabet.length - 1)]; return s; } };
}

/* ---------- running one program on one input, in its own context ---------- */
function compile(code, what) {
  try { return new vm.Script(code, { filename: `${what}.js` }); }
  catch (e) { return { error: `${what} 코드에 문법 오류: ${String(e.message).slice(0, 200)}` }; }
}
/** A stdin → stdout program (require("fs").readFileSync(0), console.log / process.stdout.write). */
function run(script, input, timeoutMs) {
  const out = [];
  const fs = { readFileSync: (f) => { if (f === 0 || f === "/dev/stdin") return input; throw new Error(`파일을 열 수 없어요: ${f}`); } };
  const context = vm.createContext({
    console: { log: (...a) => { out.push(util.format(...a) + "\n"); }, error: () => undefined, warn: () => undefined },
    require: (name) => { if (name === "fs" || name === "node:fs") return fs; throw new Error(`require("${name}")는 쓸 수 없어요`); },
    process: { stdout: { write: (s) => { out.push(String(s)); return true; } }, argv: ["node", "main.js"], env: {}, exit: () => { throw EXIT; } },
    module: { exports: {} }, exports: {},
  });
  const started = performance.now();
  try { script.runInContext(context, { timeout: timeoutMs }); }
  catch (e) {
    if (e !== EXIT) {
      const ms = performance.now() - started;
      if (e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return { stdout: "", ms, timedOut: true, error: "" };
      return { stdout: out.join(""), ms, timedOut: false, error: String(e && e.message || e).slice(0, 300) };
    }
  }
  return { stdout: out.join(""), ms: performance.now() - started, timedOut: false, error: "" };
}
/** The generator module: module.exports = { tests, smallKinds, gen(kind, size, rnd), check(input) }. */
function loadGenerator(code) {
  const script = compile(code, "generator");
  if (script.error) return { error: script.error };
  const holder = { exports: {} };
  const context = vm.createContext({ module: holder, exports: holder.exports, console: { log() {} } });
  try { script.runInContext(context, { timeout: 5000 }); }
  catch (e) { return { error: `생성기를 불러오지 못함: ${String(e.message).slice(0, 200)}` }; }
  const g = holder.exports;
  if (typeof g.gen !== "function" || typeof g.check !== "function" || !Array.isArray(g.tests) || !Array.isArray(g.smallKinds) || !g.smallKinds.length)
    return { error: "생성기는 module.exports = { tests, smallKinds, gen, check } 꼴이어야 함" };
  // gen and check run inside the generator's context with a time limit, so a generator that never ends cannot hang us.
  const callGen = new vm.Script("__out = module.exports.gen(__kind, __size, __rnd)");
  const callCheck = new vm.Script("__out = module.exports.check(__input)");
  const call = (script, values, ms) => { Object.assign(context, values, { __out: undefined }); script.runInContext(context, { timeout: ms }); return context.__out; };
  return { g: { tests: g.tests, smallKinds: g.smallKinds,
    gen: (kind, size, rnd) => call(callGen, { __kind: kind, __size: size, __rnd: rnd }, 20000),
    check: (input) => call(callCheck, { __input: input }, 10000) } };
}

const short = (t, n = 80) => { const one = String(t).replace(/\n/g, " ⏎ "); return one.length > n ? `${one.slice(0, n)}…` : one || "(빈 출력)"; };
const badRun = (r) => r.timedOut ? "시간 초과" : r.error ? `실행 중 에러 (${r.error})` : !r.stdout.trim() ? "출력 없음" : "";

function main(job) {
  const runMs = job.runMs ?? 5000;
  const fail = (reason) => ({ ok: false, reason });
  const same = (got, want) => compareOutput(got, want, job.compare).ok;
  const loaded = loadGenerator(job.generator);
  if (loaded.error) return fail(loaded.error);
  const { g } = loaded;
  const reference = compile(job.reference, "reference");
  if (reference.error) return fail(reference.error);
  const brute = job.brute?.trim() ? compile(job.brute, "brute") : null;
  if (brute?.error) return fail(brute.error);
  const checkInput = (input, where) => {
    let verdict;
    try { verdict = g.check(input); } catch (e) { return `검사기가 ${where} 입력에서 에러: ${String(e.message).slice(0, 120)}`; }
    return verdict === true ? "" : `검사기가 ${where} 입력을 거부함 (${typeof verdict === "string" ? verdict : "false"}): ${short(input, 60)}`;
  };
  const make = (kind, size, seed, where) => {
    let input;
    try { input = g.gen(kind, size, rng(seed)); } catch (e) { return { error: `생성기가 ${where}(${kind}/${size})에서 에러: ${String(e.message).slice(0, 160)}` }; }
    if (typeof input !== "string" || !input.trim()) return { error: `생성기가 ${where}(${kind}/${size})에서 빈 입력을 냄` };
    const bad = checkInput(input, `${where}(${kind}/${size})`);
    return bad ? { error: bad } : { input };
  };

  // 1. 원문 예제: the checker must accept them, the reference must print them.
  const examples = [];
  for (const [i, ex] of (job.sourceExamples ?? []).entries()) {
    const bad = checkInput(ex.input, `원문 예제 ${i + 1}번`);
    if (bad) return fail(`${bad} — 제약 조건을 잘못 읽은 것 같음`);
    const r = run(reference, ex.input, runMs);
    const why = badRun(r);
    if (why) return fail(`예제 ${i + 1}번: 모범 풀이 ${why}`);
    if (!same(r.stdout, ex.output)) return fail(`예제 ${i + 1}번: 기대 ${short(norm(ex.output))}, 모범 풀이 ${short(norm(r.stdout))}`);
    examples.push({ input: ex.input, output: norm(ex.output) });
  }
  for (const [i, input] of (job.exampleInputs ?? []).entries()) {
    const bad = checkInput(input, `예제 ${i + 1}번`);
    if (bad) return fail(bad);
    const r = run(reference, input, runMs); const why = badRun(r);
    if (why) return fail(`예제 ${i + 1}번: 모범 풀이 ${why}`);
    examples.push({ input, output: norm(r.stdout) });
  }

  // 2. 작은 입력: the simple solution and the reference must agree on every one it can answer.
  const seed0 = job.seed ?? 1;
  const small = []; const seen = new Set();
  const smallCount = job.smallCount ?? 300;
  for (let i = 0; i < smallCount * 2 && small.length < smallCount; i++) {
    const kind = g.smallKinds[i % g.smallKinds.length];
    const made = make(kind, "small", seed0 * 7919 + i, "작은 입력");
    if (made.error) return fail(made.error);
    if (seen.has(made.input)) continue;
    seen.add(made.input); small.push({ kind, input: made.input });
  }
  let compared = 0;
  const smallOut = new Map();
  for (const [i, s] of small.entries()) {
    const fast = run(reference, s.input, runMs); const why = badRun(fast);
    if (why) return fail(`작은 입력 ${i + 1}번 (${s.kind}: ${short(s.input, 60)}): 모범 풀이 ${why}`);
    smallOut.set(s.input, norm(fast.stdout));
    if (!brute) continue;
    const slow = run(brute, s.input, runMs);
    if (badRun(slow)) continue;
    if (!same(slow.stdout, fast.stdout)) return fail(`작은 입력 ${i + 1}번 (${s.kind}: ${short(s.input, 60)}): 단순 풀이 ${short(norm(slow.stdout))}, 모범 풀이 ${short(norm(fast.stdout))}`);
    compared++;
  }
  if (job.needCompared && compared < job.needCompared) return fail(`단순 풀이로 확인된 작은 입력이 ${compared}개뿐 (${job.needCompared}개 이상 필요)`);

  // 3. 숨은 테스트: the generator's plan (kinds × sizes), plus a few distinct small ones, answered by the reference.
  const tests = []; let total = 0;
  const add = (t) => { if (tests.length >= MAX_TESTS || total + t.input.length > MAX_TOTAL_INPUT) return false; tests.push(t); total += t.input.length; return true; };
  for (const [p, item] of g.tests.entries()) {
    const count = Math.max(0, Math.min(Number(item.count) || 1, item.size === "max" ? 3 : 10));
    for (let c = 0; c < count; c++) {
      const made = make(item.kind, item.size, seed0 * 104729 + p * 101 + c, "숨은 테스트");
      if (made.error) return fail(made.error);
      const r = run(reference, made.input, runMs); const why = badRun(r);
      if (why) return fail(`숨은 테스트(${item.kind}/${item.size}): 모범 풀이 ${why}${r.timedOut ? ` — ${runMs}ms 안에 못 풂, 모범 풀이가 느리거나 입력이 제약보다 큼` : ""}`);
      if (!add({ input: made.input, output: norm(r.stdout), kind: item.kind, size: item.size, refMs: Math.round(r.ms) })) break;
    }
  }
  const picked = new Set();
  for (const s of small) { if (picked.size >= 10) break; if (![...picked].some((x) => x.kind === s.kind) || picked.size >= g.smallKinds.length) picked.add(s); }
  for (const s of picked) add({ input: s.input, output: smallOut.get(s.input), kind: s.kind, size: "small", refMs: 0 });
  if (tests.length < 3) return fail(`숨은 테스트가 ${tests.length}개뿐 (생성기의 tests 계획을 늘려야 함)`);

  // 4. 결함 풀이: each must fail some test. One that passes everything is checked against the simple solution on the
  // small inputs: a difference means the tests missed it — that input joins the tests for good; no difference means it
  // may be right after all, and it is not counted.
  const mutation = { killed: 0, total: 0, survived: [], added: 0, maybeRight: [] };
  for (const m of job.mutants ?? []) {
    const script = compile(m.code, "faulty");
    if (script.error) continue; // a fake wrong answer that does not run says nothing about the tests
    let killed = false;
    for (const t of [...examples, ...tests]) {
      const limit = Math.max(1000, (t.refMs ?? 0) * 10);
      const r = run(script, t.input, limit);
      if (r.timedOut || r.error || !same(r.stdout, t.output)) { killed = true; break; }
    }
    if (killed) { mutation.total++; mutation.killed++; continue; }
    let found = null;
    if (brute) for (const s of small) {
      const r = run(script, s.input, runMs);
      if (r.timedOut || r.error || !same(r.stdout, smallOut.get(s.input))) { found = s; break; }
    }
    if (found) {
      mutation.total++; mutation.killed++;
      if (add({ input: found.input, output: smallOut.get(found.input), kind: `반례:${m.flaw}`, size: "small", refMs: 0 })) mutation.added++;
    } else if (brute) mutation.maybeRight.push(m.flaw);
    else { mutation.total++; mutation.survived.push(m.flaw); }
  }

  return { ok: true, examples, tests, compared, small: small.length, maxTests: tests.filter((t) => t.size === "max").length, mutation };
}

/**
 * 독립 풀이 대조 (안전장치 ⑤): a second solution, written in a separate model call from the statement alone, runs on
 * every test. Where it disagrees, the simple solution decides if it can finish on that input: agreeing with the
 * reference means the second solution is the wrong one; otherwise the expected output is wrong. Where the simple
 * solution can't decide (a big input), nobody knows which is right, and that is reported too.
 */
function verify(job) {
  const v = job.verify;
  const same = (got, want) => compareOutput(got, want, job.compare).ok;
  const second = compile(v.code, "second");
  if (second.error) return { ok: true, status: "broken", agreed: 0, total: v.tests.length, unchecked: v.tests.length, secondWrong: 0, reason: second.error };
  const brute = v.brute ? compile(v.brute, "brute") : null;
  let agreed = 0, unchecked = 0, secondWrong = 0;
  for (const [i, t] of v.tests.entries()) {
    const r = run(second, t.input, Math.max(2000, (t.refMs ?? 0) * 20));
    if (r.timedOut || r.error) { unchecked++; continue; } // a slow or crashing second solution says nothing about the answer
    if (same(r.stdout, t.output)) { agreed++; continue; }
    const where = `${i + 1}번 테스트${t.kind ? ` (${t.kind}/${t.size})` : ""}`;
    const b = brute && !brute.error ? run(brute, t.input, 3000) : null;
    if (b && !b.timedOut && !b.error) {
      if (same(b.stdout, t.output)) { secondWrong++; continue; }
      return { ok: false, reason: `${where}: 단순 풀이와 독립 풀이가 모두 ${short(norm(b.stdout))}인데 기대 출력은 ${short(norm(t.output))} (모범 풀이가 틀림)` };
    }
    return { ok: false, reason: `${where}: 모범 풀이 ${short(norm(t.output))}, 다른 호출에서 쓴 독립 풀이 ${short(norm(r.stdout))} — 큰 입력이라 단순 풀이로 가릴 수 없음 (어느 쪽이 맞는지 다시 확인)` };
  }
  const status = secondWrong ? "second-wrong" : agreed === 0 ? "unchecked" : "agreed";
  return { ok: true, status, agreed, total: v.tests.length, unchecked, secondWrong };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  let result;
  try { const job = JSON.parse(raw); result = job.verify ? verify(job) : main(job); } catch (e) { result = { ok: false, reason: `테스트 만들기 실행기 에러: ${String(e && e.message || e).slice(0, 300)}` }; }
  process.stdout.write(JSON.stringify(result));
});
