// 용량 줄이기 (11/9): 큰 입력은 테스트 파일에 쓰지 않고, 읽을 때 생성기로 다시 만든다. 채점은 같은 입력으로.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GEN = `module.exports = { tests: [], smallKinds: ["r"], gen(kind, size, rnd) { const n = size === "max" ? 200000 : 3; return n + "\\n" + Array.from({ length: n }, () => rnd.int(1, 9)).join(" ") + "\\n"; }, check() { return true; } };`;
const REF = `const t = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number); let s = 0; for (let i = 1; i <= t[0]; i++) s += t[i]; console.log(String(s));`;

test("a big hidden input is not saved, and is made again (the same) when the tests are read", { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-regen-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const { runRegen } = await import("./testgen/index.ts");
    const made = await runRegen({ regen: { generator: GEN, reference: REF, items: [{ kind: "r", size: "max", seed: 42, needOutput: true }] } });
    assert.ok(made.ok);
    const big = made.items[0];
    const { saveProblem, readProblem } = await import("./problems.ts");
    const p = await saveProblem({ title: "합", statement: "s", inputText: "i", outputText: "o", examples: [{ input: "3\n1 2 3\n", output: "6" }], kind: "full", templates: {},
      tests: [{ input: "3\n1 1 1\n", output: "3" }, { input: big.input, output: big.output!, regen: { kind: "r", size: "max", seed: 42 } }],
      timeLimitMs: 2000, reference: { lang: "javascript", code: REF }, testgen: { generator: GEN, seed: 1 }, knowledge: [], folder: "알고리즘", examplesFrom: "source", source: { kind: "ai", title: "t" } } as never);
    const file = path.join(dir, "code", "problems", `${p.id}.tests.json`);
    const { size } = await stat(file);
    assert.ok(size < 2000, `the tests file stays small (${size} bytes, the input alone is ${big.input.length})`);
    assert.ok(!(await readFile(file, "utf8")).includes(big.input.slice(0, 200)));
    (globalThis as { __codeTests?: Map<string, unknown> }).__codeTests?.clear(); // read from the file, as after a restart
    const back = await readProblem(p.id);
    assert.equal(back.tests[1].input, big.input);
    assert.equal(back.tests[1].output, big.output);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
