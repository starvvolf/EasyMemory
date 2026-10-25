import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { judge, languages, normalizeOutput, runOnce } from "./run.ts";
import { findCounterexample, listProblems, publicProblem, readDrafts, readProblem, readSubmissions, saveDraft, submit } from "./problems.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}
const ready = async () => Object.fromEntries((await languages()).map((l) => [l.lang, l.ready]));

test("outputs compare like a judge: line-end spaces and trailing blank lines do not matter", () => {
  assert.equal(normalizeOutput("1 2 \r\n3\n\n"), normalizeOutput("1 2\n3"));
  assert.notEqual(normalizeOutput("1 2\n3"), normalizeOutput("1  2\n3"));
});

test("a program runs with its input, and one that runs forever is stopped at the limit", async () => {
  const echo = await runOnce("javascript", "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()));", "abc");
  assert.ok(echo.ok && echo.stdout === "ABC");
  const forever = await judge("javascript", "while (true) {}", [{ input: "", output: "x" }], { timeLimitMs: 300 });
  assert.equal(forever.verdict, "TLE");
  const crash = await judge("javascript", "throw new Error('boom')", [{ input: "", output: "x" }]);
  assert.equal(crash.verdict, "RE");
  assert.match(crash.results[0].stderr, /boom/);
});

test("C++ and Python compile and run where installed; a compile error says why", async (t) => {
  const has = await ready();
  if (has.cpp) {
    const ok = await judge("cpp", "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<\"\\n\";}", [{ input: "2 3", output: "5" }, { input: "-1 1", output: "0" }]);
    assert.equal(ok.verdict, "AC");
    const bad = await judge("cpp", "int main(){ return x; }", [{ input: "", output: "" }]);
    assert.equal(bad.verdict, "CE");
    assert.match(bad.compile, /x/);
  } else t.diagnostic("g++ 없음: C++ 확인 건너뜀");
  if (has.python) {
    const py = await judge("python", "a, b = map(int, input().split())\nprint(a + b)", [{ input: "2 3\n", output: "5" }]);
    assert.equal(py.verdict, "AC");
  } else t.diagnostic("Python 없음");
});

test("seed problems get outputs from their reference; submit stops at the first failure and shows only it", () => withData(async () => {
  const list = await listProblems();
  assert.equal(list.length, 5);
  const p = await readProblem("cp_seed_range_sum");
  assert.ok(p.tests.length >= 4 && p.examples[0].output === "12\n9\n1");
  const shown = publicProblem(p);
  assert.equal("tests" in shown, false);
  assert.equal("reference" in shown, false);
  // Right answer.
  const good = "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);let p=0;const n=d[p++],q=d[p++];const s=[0];for(let i=1;i<=n;i++)s[i]=s[i-1]+d[p++];const o=[];for(let i=0;i<q;i++){const l=d[p++],r=d[p++];o.push(s[r]-s[l-1]);}console.log(o.join('\\n'));";
  const ac = await submit(p.id, "javascript", good, "submit");
  assert.equal(ac.verdict, "AC");
  assert.equal(ac.shown.length, 0);
  // Off by one: r instead of r - ... shows one failed case.
  const wrong = good.replace("s[l-1]", "s[l]");
  const wa = await submit(p.id, "javascript", wrong, "submit", 1);
  assert.equal(wa.verdict, "WA");
  assert.equal(wa.shown.length, 1);
  assert.ok(wa.shown[0].expected !== wa.shown[0].got);
  const ex = await submit(p.id, "javascript", wrong, "example");
  assert.equal(ex.shown.length, 1, "examples show every example");
  const subs = await readSubmissions(p.id);
  assert.deepEqual(subs.map((s) => [s.mode, s.verdict, s.hints]), [["submit", "AC", 0], ["submit", "WA", 1], ["example", "WA", 0]]);
  assert.equal((await listProblems()).find((x) => x.id === p.id)!.status, "wrong", "the latest submission decides");
  // A blank problem refuses to run with blanks left.
  await assert.rejects(submit("cp_seed_blank_search", "python", (await readProblem("cp_seed_blank_search")).templates.python!, "example"), /빈칸/);
  // Counterexample: the wrong program disagrees with the reference on a small input.
  const ce = await findCounterexample(p.id, "javascript", wrong, ["3 1\n1 2 3\n2 3\n", "1 1\n5\n1 1\n"]);
  assert.equal(ce.found, true);
  await saveDraft(p.id, "cpp", "int main(){}");
  assert.equal((await readDrafts(p.id)).cpp, "int main(){}");
}));

test("the blank template, filled in, passes", () => withData(async () => {
  await listProblems();
  const p = await readProblem("cp_seed_blank_search");
  const filled = p.templates.javascript!.replace("____", "st <= en").replace("____", "st = mid + 1").replace("____", "en = mid - 1");
  assert.equal((await submit(p.id, "javascript", filled, "submit")).verdict, "AC");
  const loop = p.templates.javascript!.replace("____", "st < en").replace("____", "st = mid + 1").replace("____", "en = mid - 1");
  assert.equal((await submit(p.id, "javascript", loop, "submit")).verdict, "WA", "st < en misses the last candidate");
}));
