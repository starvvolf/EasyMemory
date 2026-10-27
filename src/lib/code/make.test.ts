// 문제 만들기의 정답 풀이 검사 (docs/DECISIONS.md 2026-10-26): the fake model stands in for the AI, the references really run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { makeProblem } from "../assist/code-ai.ts";
import { readProblem } from "./problems.ts";

const READ = `const t = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number); const n = t[0];`;
const SUM = `${READ} let s = 0; for (let i = 1; i <= n; i++) s += t[i]; console.log(s);`;
const SUM_PLUS_ONE = `${READ} let s = 1; for (let i = 1; i <= n; i++) s += t[i]; console.log(s);`;
const SUM_MISSING_LAST = `${READ} let s = 0; for (let i = 1; i < n; i++) s += t[i]; console.log(s);`;
const SUM_BRUTE = `${READ} console.log(t.slice(1, n + 1).reduce((a, b) => a + b, 0));`;
const PASTED = "문제: N개의 수의 합을 구하라.\n입력: 첫 줄에 N, 둘째 줄에 수 N개\n출력: 합\n예제 입력 1\n3\n1 2 3\n예제 출력 1\n6";
// 숨은 테스트 생성기 (testgen/harness.mjs): 1 ≤ N ≤ 1000, -100 ≤ A_i ≤ 100.
const GENERATOR = `module.exports = {
  tests: [ { kind: "min", size: "min", count: 1 }, { kind: "random", size: "mid", count: 3 }, { kind: "allMax", size: "max", count: 1 } ],
  smallKinds: ["random", "same", "neg"],
  gen(kind, size, rnd) {
    const n = size === "min" ? 1 : size === "small" ? rnd.int(1, 5) : size === "mid" ? rnd.int(10, 200) : 1000;
    const v = () => kind === "allMax" ? 100 : kind === "same" ? 7 : kind === "neg" ? rnd.int(-100, -1) : rnd.int(-100, 100);
    return n + "\\n" + Array.from({ length: n }, v).join(" ") + "\\n";
  },
  check(input) {
    const t = input.trim().split(/\\s+/).map(Number);
    return t[0] >= 1 && t[0] <= 1000 && t.length === t[0] + 1 && t.slice(1).every((x) => Number.isInteger(x) && x >= -100 && x <= 100) || "제약 밖";
  },
};`;

const draft = (over: Record<string, unknown>) => JSON.stringify({
  title: "수의 합", statement: "N개의 수의 합을 구한다.", inputText: "첫 줄에 N, 둘째 줄에 수 N개", outputText: "합", answerKind: "one",
  constraints: "1 ≤ N ≤ 1000\n-100 ≤ A_i ≤ 100", timeLimitMs: 0,
  sourceExamples: [], exampleInputs: ["2\n5 7\n"], generator: GENERATOR, reference: SUM, brute: SUM_BRUTE, mutants: [],
  knowledge: ["누적 합"], folder: "알고리즘/합", blank: { code: "", filled: "" }, ...over,
});

/**
 * A data folder and a fake model that answers code:make with the given replies in order; returns the requests it saw.
 * code:solve (the independent solution) gets `solve` if given, else the latest draft's own reference.
 */
async function withFake(replies: string[], run: (seen: ModelRequest[]) => Promise<void>, solve?: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-make-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir;
  process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const seen: ModelRequest[] = [];
  const latest = () => replies[Math.min(seen.length, replies.length) - 1] ?? "{}";
  setFakeModelResponder((request) => {
    if (request.purpose === "code:solve") return JSON.stringify({ code: solve ?? (JSON.parse(latest()) as { reference: string }).reference });
    if (request.purpose === "code:make") seen.push(request);
    return latest();
  });
  try { await run(seen); } finally {
    setFakeModelResponder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
const savedCount = async () => (await readdir(path.join(process.env.STUDY_FORGE_DATA_DIR!, "code", "problems")).catch(() => [])).length;

test("a pasted problem's examples are the answer key: a reference that prints them is saved, marked 원문", () => withFake(
  [draft({ sourceExamples: [{ input: "3\n1 2 3", output: "6" }], exampleInputs: [] })],
  async (seen) => {
    const made = await makeProblem({ lesson: PASTED, kind: "full" });
    assert.equal(seen.length, 1);
    const saved = await readProblem(made.id);
    assert.equal(saved.examplesFrom, "source");
    assert.equal(saved.check?.by, "source");
    assert.equal(saved.check?.cases, 1);
    assert.equal(saved.check?.tries, 1);
    assert.deepEqual(saved.examples, [{ input: "3\n1 2 3", output: "6" }]);
    assert.ok(saved.tests.length >= 5, `hidden tests from the generator: ${saved.tests.length}`);
    assert.equal(saved.check?.maxTests, 1);
    assert.ok(saved.tests.some((x) => x.output === "100000"), "the max test: 1000 × 100");
    assert.equal(saved.testgen?.generator, GENERATOR);
  }));

test("a reference that misses a source example is asked again with the reason, then refused and not saved", () => withFake(
  [draft({ sourceExamples: [{ input: "3\n1 2 3", output: "6" }], exampleInputs: [], reference: SUM_PLUS_ONE })],
  async (seen) => {
    await assert.rejects(makeProblem({ lesson: PASTED, kind: "full" }), (error: Error & { status?: number }) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /저장하지 않았어요/);
      assert.match(error.message, /예제 1번: 기대 6, 모범 풀이 7/);
      return true;
    });
    assert.equal(seen.length, 3, "first try and two retries");
    assert.match(seen[1].user, /\[지난 시도에서 막힌 곳\]\n1\. 예제 1번: 기대 6, 모범 풀이 7/);
    assert.equal(await savedCount(), 0);
  }));

test("with no source examples the reference is cross-checked against a simple solution; a mismatch is retried", () => withFake(
  [draft({ reference: SUM_MISSING_LAST }), draft({})],
  async (seen) => {
    const made = await makeProblem({ topic: "누적 합", kind: "full" });
    assert.equal(seen.length, 2);
    assert.match(seen[1].user, /작은 입력 \d+번 .*: 단순 풀이 -?\d+, 모범 풀이 -?\d+/);
    const saved = await readProblem(made.id);
    assert.equal(saved.examplesFrom, "made");
    assert.equal(saved.check?.by, "cross");
    assert.ok((saved.check?.cases ?? 0) >= 30, `small inputs agreed: ${saved.check?.cases}`);
    assert.equal(saved.check?.tries, 2);
    assert.deepEqual(saved.examples, [{ input: "2\n5 7\n", output: "12" }]);
  }));

test("examples the model calls 원문 but that are not in the pasted text do not count as the answer key", () => withFake(
  [draft({ sourceExamples: [{ input: "2\n5 7", output: "12" }], exampleInputs: [] })],
  async (seen) => {
    await assert.rejects(makeProblem({ topic: "누적 합", kind: "full" }), /붙여 넣은 글에 없음/);
    assert.equal(seen.length, 3);
    assert.equal(await savedCount(), 0);
  }));

test("a person's solution must print the same as the reference on every test; when it does, the check says so", () => withFake(
  [draft({ sourceExamples: [{ input: "3\n1 2 3", output: "6" }], exampleInputs: [] })],
  async (seen) => {
    const human = { lang: "javascript" as const, code: SUM_BRUTE };
    const made = await makeProblem({ lesson: PASTED, kind: "full", human, id: "cp_boj_9999", folder: "바킹독/0x00 시험" });
    assert.equal(seen.length, 1);
    const saved = await readProblem("cp_boj_9999");
    assert.equal(saved.check?.human, "match");
    assert.equal(saved.folder, "바킹독/0x00 시험");
    assert.equal(made.id, "cp_boj_9999");
    const wrongHuman = { lang: "javascript" as const, code: SUM_MISSING_LAST };
    await assert.rejects(makeProblem({ lesson: PASTED, kind: "full", human: wrongHuman }), /사람이 쓴 정답 코드와 모범 풀이가 다름/);
  }));

test("a problem with more than one right answer is refused at once (not yet gradable)", () => withFake(
  [draft({ answerKind: "many" })],
  async (seen) => {
    await assert.rejects(makeProblem({ topic: "아무 해나 출력", kind: "full" }), /아직 채점할 수 없어서/);
    assert.equal(seen.length, 1);
    assert.equal(await savedCount(), 0);
  }));

test("faulty solutions are scored, not a gate: the problem is saved with how many of them the tests caught", () => withFake(
  [draft({ mutants: [
    { flaw: "경계값", code: SUM_MISSING_LAST },
    { flaw: "초기화", code: SUM_PLUS_ONE },
    { flaw: "사실은 맞는 풀이", code: SUM_BRUTE },
  ] })],
  async () => {
    const made = await makeProblem({ topic: "누적 합", kind: "full" });
    const saved = await readProblem(made.id);
    assert.deepEqual(saved.check?.mutation, { killed: 2, total: 2, survived: [], added: 0 });
  }));

test("a generator that breaks its own constraints is sent back with the reason", () => withFake(
  [draft({ generator: GENERATOR.replace('size === "max" ? 1000 : 1000', "").replace(": 1000;", ": 5000;") }), draft({})],
  async (seen) => {
    await makeProblem({ topic: "누적 합", kind: "full" });
    assert.equal(seen.length, 2);
    assert.match(seen[1].user, /검사기가 숨은 테스트\(allMax\/max\) 입력을 거부함/);
  }));

// 안전장치 ⑤: a solution from another model call is run on every test.
const SUM_WRONG_WHEN_BIG = `${READ} let s = 0; for (let i = 1; i <= n; i++) s += t[i]; console.log(n > 500 ? s + 1 : s);`;
const BRUTE_SMALL_ONLY = `${READ} if (n > 50) while (true) {} console.log(t.slice(1, n + 1).reduce((a, b) => a + b, 0));`;

test("the independent solution agrees on every test: saved, and the check says which model and how many", () => withFake(
  [draft({})],
  async () => {
    const saved = await readProblem((await makeProblem({ topic: "누적 합", kind: "full" })).id);
    assert.equal(saved.check?.second?.status, "agreed");
    assert.equal(saved.check?.second?.agreed, saved.check?.second?.total);
    assert.ok((saved.check?.second?.total ?? 0) >= saved.tests.length);
  }));

test("it disagrees on a big input the simple solution can't finish: nobody knows who is right, so the draft is asked again", { timeout: 60_000 }, () => withFake(
  [draft({ brute: BRUTE_SMALL_ONLY }), draft({ brute: BRUTE_SMALL_ONLY }), draft({ brute: BRUTE_SMALL_ONLY })],
  async (seen) => {
    await assert.rejects(makeProblem({ topic: "누적 합", kind: "full" }), /저장하지 않았어요/);
    assert.equal(seen.length, 3);
    assert.match(seen[1].user, /다른 호출에서 쓴 독립 풀이.*가릴 수 없음/);
    assert.equal(await savedCount(), 0);
  }, SUM_WRONG_WHEN_BIG));

test("where the simple solution can decide, it sides with the reference: the second solution is the wrong one, the problem is saved", () => withFake(
  [draft({})],
  async () => {
    const saved = await readProblem((await makeProblem({ topic: "누적 합", kind: "full" })).id);
    assert.equal(saved.check?.second?.status, "second-wrong");
  }, SUM_WRONG_WHEN_BIG));

test("when the reference is the one that's wrong, the simple and the independent solution outvote it", () => withFake(
  [draft({ reference: `${READ} let s = 0; for (let i = 1; i <= n; i++) s += t[i]; console.log(n > 500 ? s + 1 : s);`, sourceExamples: [{ input: "3\n1 2 3", output: "6" }], exampleInputs: [] }), draft({ sourceExamples: [{ input: "3\n1 2 3", output: "6" }], exampleInputs: [] })],
  async (seen) => {
    await makeProblem({ lesson: PASTED, kind: "full" });
    assert.equal(seen.length, 2);
    assert.match(seen[1].user, /모범 풀이가 틀림/);
  }, SUM));

test("a problem is two files: the list and the problem screen never read the hidden tests; a file from before is split on first read", () => withFake(
  [draft({})],
  async () => {
    const { readProblemMeta, listProblems } = await import("./problems.ts");
    const { readFile, writeFile, stat } = await import("node:fs/promises");
    const made = await makeProblem({ topic: "누적 합", kind: "full" });
    const dir = path.join(process.env.STUDY_FORGE_DATA_DIR!, "code", "problems");
    const metaFile = path.join(dir, `${made.id}.json`), testsFile = path.join(dir, `${made.id}.tests.json`);
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    assert.equal(meta.tests, undefined, "the problem file has no tests");
    assert.equal(meta.hiddenTests, made.tests.length);
    assert.equal(JSON.parse(await readFile(testsFile, "utf8")).length, made.tests.length);
    assert.equal((await readProblemMeta(made.id)).hiddenTests, made.tests.length);
    assert.deepEqual((await readProblem(made.id)).tests, made.tests);
    // A file written before the split: tests inline, no tests file.
    const { hiddenTests, ...old } = meta; void hiddenTests;
    await writeFile(metaFile, JSON.stringify({ ...old, tests: made.tests.slice(0, 2) }), "utf8");
    await (await import("node:fs/promises")).rm(testsFile);
    assert.ok((await listProblems()).some((p) => p.id === made.id));
    assert.equal(JSON.parse(await readFile(metaFile, "utf8")).tests, undefined, "split on first read");
    assert.ok((await stat(testsFile)).size > 0);
    assert.equal((await readProblem(made.id)).tests.length, 2);
  }));
