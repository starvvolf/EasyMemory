// 필요할 때 조금씩 (11/10): 문제 재료를 미리 다 만들지 않고, 패턴이 필요할 때 그 단원 문제 몇 개만, 유저가 넣은 문제는 그 문제를.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RAW = { summary: "격자에서 여러 곳이 동시에 번진다. N ≤ 1000", maxN: 1000, patterns: ["multi-source"], signals: ["동시에"],
  approaches: [{ name: "시작점을 모두 큐에", verdict: "best", why: "한 번에" }, { name: "시작점마다 BFS", verdict: "slow", why: "느림" }, { name: "정렬", verdict: "wrong", why: "순서 무관" }],
  state: { right: "날짜 배열", wrong: ["합계", "포인터"] }, update: "꺼낸 칸 + 1", complexity: "n", pitfalls: ["익지 않은 칸"],
  walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, predict: { question: "출력은?", input: "2" }, contrast: { number: "", differs: "" } };

async function withFake(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-ondemand-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const { setFakeModelResponder } = await import("../../ai/model.ts");
  setFakeModelResponder(() => JSON.stringify(RAW));
  try { await run(dir); } finally {
    setFakeModelResponder(null); delete process.env.STUDY_FORGE_MODEL_PROVIDER;
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("ensurePool: a pattern's chapter problems are made only up to what is needed; numbers with no archived original are remembered and skipped", () => withFake(async (dir) => {
  const { ensurePool, readModels, tutorTargets } = await import("./problem-model.ts");
  const noArchive: typeof fetch = async () => Response.json({ archived_snapshots: {} });
  const run = async () => ({ ok: true, code: 0, timedOut: false, stdout: "4\n", stderr: "", ms: 1 }) as never;
  const first = await ensurePool("multi-source", 3, { fetcher: noArchive, run });
  assert.equal(first.started.length, 3, "at most three tried at once");
  assert.ok(first.started.every((n) => tutorTargets().find((t) => t.number === n)?.chapter === "0x09"), "only from the pattern's chapter");
  assert.deepEqual(Object.keys(await readModels()), []);
  const missing = JSON.parse(await readFile(path.join(dir, "code", "tutor", "missing.json"), "utf8")) as string[];
  assert.deepEqual([...missing].sort(), [...first.started].sort());
  const again = await ensurePool("multi-source", 3, { fetcher: noArchive, run });
  assert.ok(again.started.every((n) => !first.started.includes(n)), "a number with no original is not asked again");
}));

test("modelForProblem: a learner's own BOJ problem gets its material from the saved problem, the prediction answered by its verified solution", () => withFake(async () => {
  const { modelForProblem, readModels, tutorNumberOf } = await import("./problem-model.ts");
  let ran = "";
  const run = (async (_lang: string, code: string, input: string) => { ran = `${code}|${input}`; return { ok: true, code: 0, timedOut: false, stdout: "7\n", stderr: "", ms: 1 }; }) as never;
  const m = await modelForProblem({ id: "cp_mine123", title: "BOJ 9999번: 내가 넣은 문제", statement: "s N ≤ 1000", inputText: "i", outputText: "o", examples: [{ input: "1\n", output: "1\n" }],
    reference: { lang: "javascript", code: "console.log(7)" } }, { run });
  assert.ok(m);
  assert.equal(m.number, "9999"); assert.equal(m.problemId, "cp_mine123"); assert.equal(m.title, "내가 넣은 문제");
  assert.equal(m.predict?.answer, "7"); assert.match(ran, /^console\.log\(7\)\|2\n$/);
  assert.ok((await readModels())["9999"]);
  assert.equal(await tutorNumberOf("cp_mine123"), "9999", "hints on the learner's own problem now count as tutor help");
  assert.equal(await tutorNumberOf("cp_boj_7576"), "7576");
  assert.equal(await modelForProblem({ id: "cp_x", title: "합이 X인 두 수", statement: "", inputText: "", outputText: "", examples: [] }), null, "not a BOJ problem: nothing");
}));

test("같이 만들기: the material starts with the hidden tests (no solution yet); the prediction is answered once the solution is verified", () => withFake(async () => {
  const { modelForProblem, fillPredict } = await import("./problem-model.ts");
  const run = (async () => ({ ok: true, code: 0, timedOut: false, stdout: "5\n", stderr: "", ms: 1 })) as never;
  const p = { id: "cp_mine9", title: "BOJ 8888번: 같이", statement: "s", inputText: "i", outputText: "o", examples: [{ input: "1\n", output: "1\n" }] };
  const [early, again] = await Promise.all([modelForProblem(p, { run }), modelForProblem(p, { run })]);
  assert.equal(early, again, "one build even when asked twice at once");
  assert.equal(early!.predict, undefined); assert.equal(early!.predictDraft?.input, "2");
  const done = await fillPredict({ ...p, reference: { lang: "javascript", code: "console.log(5)" } }, { run });
  assert.equal(done!.predict?.answer, "5"); assert.equal(done!.predictDraft, undefined);
}));
