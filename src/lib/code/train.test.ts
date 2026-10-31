import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKnowledge, memoryEvents } from "../knowledge/api.ts";
import { saveProblem } from "./problems.ts";
import { ensureProblemKnowledge, saveReview, submitAndRecord } from "./service.ts";
import { checkUnderstand, complexityVerdict, numbersIn, quickCheck, readTrain, setMode, sizeOf, tryInputs } from "./train.ts";

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-train-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}
const SUM = `const t=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);let s=0;for(let i=1;i<=t[0];i++)s+=t[i];console.log(s);`;
const SLOW = `const t=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);let s=0;for(let i=1;i<=t[0];i++)for(let j=1;j<=t[0];j++)if(i===j)s+=t[j];console.log(s);`;
const OFF = `const t=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);let s=0;for(let i=1;i<t[0];i++)s+=t[i];console.log(s);`;
async function sumProblem() {
  const big = `100000\n${Array.from({ length: 100000 }, (_, i) => (i % 97) + 1).join(" ")}\n`;
  const bigSum = Array.from({ length: 100000 }, (_, i) => (i % 97) + 1).reduce((a, b) => a + b, 0);
  return ensureProblemKnowledge(await saveProblem({ title: "수 더하기", statement: "N개의 수를 모두 더한다.", inputText: "첫 줄에 N, 둘째 줄에 N개의 수", outputText: "합",
    examples: [{ input: "3\n1 2 3\n", output: "6" }, { input: "1\n5\n", output: "5" }], tests: [{ input: "2\n4 4\n", output: "8" }, { input: big, output: String(bigSum) }],
    timeLimitMs: 1000, kind: "full", templates: {}, reference: { lang: "javascript", code: SUM }, knowledge: ["누적 합"], folder: "알고리즘", source: { kind: "manual", title: "test" },
    constraints: "1 ≤ N ≤ 100,000\n1 ≤ 수 ≤ 100" }));
}

test("numbers in a constraints text, however they are written", () => {
  assert.deepEqual(numbersIn("1 ≤ N ≤ 100,000"), [1, 100000]);
  assert.deepEqual(numbersIn("N ≤ 2×10^5, |A| ≤ 10⁹"), [200000, 1e9]);
  assert.deepEqual(numbersIn("M ≤ 1e6"), [1e6]);
});

test("a complexity is counted at the largest N against the time limit", () => {
  assert.equal(complexityVerdict("n log n", 100000, 1000).level, "넉넉");
  assert.equal(complexityVerdict("n²", 100000, 1000).level, "안 됨");
  assert.equal(complexityVerdict("n²", 10000, 1000).level, "아슬");
  assert.equal(complexityVerdict("2ⁿ", 500, 2000).level, "안 됨");
  assert.match(complexityVerdict("n²", 500, 2000).note, /25만|2\.5×10\^5/);
});

test("step 1 checks N and the time limit, and answers the learner's own input with the reference", () => withData(async () => {
  const p = await sumProblem();
  const r = await checkUnderstand(p.id, { maxN: 100000, timeSec: 2, input: "2\n10 20", myAnswer: "30" });
  assert.equal(r.n?.ok, true);
  assert.equal(r.time?.ok, false, "the limit is 1 second");
  assert.equal(r.mine?.ok, true);
  const wrong = await checkUnderstand(p.id, { maxN: 1000, input: "2\n10 20", myAnswer: "200" });
  assert.equal(wrong.n?.ok, false);
  assert.equal(wrong.mine?.ok, false);
  assert.equal(wrong.mine?.expected, "30");
  assert.equal(await sizeOf(p.id), 100000, "from the constraints until the learner says it");
}));

test("the learner's inputs: the reference's answer, and their code beside it", () => withData(async () => {
  const p = await sumProblem();
  const only = await tryInputs(p.id, ["1\n7", "  "]);
  assert.deepEqual(only.rows.map((r) => r.expected), ["7"]);
  const mine = await tryInputs(p.id, ["1\n7", "3\n1 1 1"], { lang: "javascript", code: OFF });
  assert.deepEqual(mine.rows.map((r) => r.verdict), ["WA", "WA"]);
  assert.equal(mine.rows[1].got?.trim(), "2");
}));

test("지켜보기 runs the examples and the largest test, and says only what went wrong", () => withData(async () => {
  const p = await sumProblem();
  assert.equal((await quickCheck(p.id, "javascript", SUM)).state, "ok");
  const off = await quickCheck(p.id, "javascript", OFF);
  assert.equal(off.state, "warn"); assert.equal(off.what, "예제");
  const slow = await quickCheck(p.id, "javascript", SLOW);
  assert.equal(slow.state, "warn"); assert.equal(slow.what, "시간");
  assert.ok(!JSON.stringify(slow).includes("100000\n"), "the test itself is not shown");
}));

test("passing in 훈련 모드 is a note, not 앎; the review lands on the knowledge as a note", () => withData(async () => {
  const p = await sumProblem();
  await setMode(p.id, "train");
  assert.equal((await readTrain(p.id)).mode, "train");
  const r = await submitAndRecord(p.id, "javascript", SUM, "submit", 0);
  assert.equal(r.verdict, "AC");
  const k = (await getKnowledge(p.knowledgeIds[0])).item;
  assert.notEqual(k.state, "known");
  const saved = await saveReview(p.id, { idea: "한 번 훑으며 더한다", stuck: "", transfer: "" });
  assert.equal(saved.recorded, 1);
  const notes = (await memoryEvents({ knowledgeId: p.knowledgeIds[0], kinds: ["note"] })).events.map((e) => e.detail);
  assert.ok(notes.includes("훈련 모드로 통과"));
  assert.ok(notes.some((d) => d.startsWith("[복기] 핵심 발상: 한 번 훑으며 더한다")));
  assert.deepEqual((await readTrain(p.id)).steps.review?.answer, { idea: "한 번 훑으며 더한다", stuck: "", transfer: "" });
}));

test("after the watcher's warnings a pass is a note too; alone it is 앎", () => withData(async () => {
  const p = await sumProblem();
  await submitAndRecord(p.id, "javascript", SUM, "submit", 0, 2);
  assert.notEqual((await getKnowledge(p.knowledgeIds[0])).item.state, "known");
  const q = await sumProblem();
  await submitAndRecord(q.id, "javascript", SUM, "submit", 0);
  assert.equal((await getKnowledge(q.knowledgeIds[0])).item.state, "known");
}));

test("the coach sees the reference but a reply that copies a line of it is not passed on", () => withData(async () => {
  const { setFakeModelResponder } = await import("../ai/model.ts");
  const { trainCheck, watchAdvice } = await import("../assist/code-ai.ts");
  const prior = process.env.STUDY_FORGE_MODEL_PROVIDER;
  process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const seen: string[] = [];
  let reply = { state: "더 생각", say: "n이 10만이면 몇 번 돌까요?", what: "복잡도", line: 3 };
  setFakeModelResponder((request) => { seen.push(request.user); return JSON.stringify(reply); });
  try {
    const p = await sumProblem();
    const ok = await trainCheck({ problemId: p.id, step: "approach", answer: { brute: "다 더한다" } });
    assert.equal(ok.say, "n이 10만이면 몇 번 돌까요?");
    assert.ok(seen[0].includes("[모범 풀이 — 학습자에게 보이지 않음]"));
    reply = { ...reply, say: `이렇게 하세요: ${SUM}` };
    assert.notEqual((await trainCheck({ problemId: p.id, step: "model", answer: { line: "배열" } })).say, reply.say);
    assert.notEqual((await watchAdvice({ problemId: p.id, lang: "javascript", code: "let s=0" })).say, reply.say);
  } finally { setFakeModelResponder(null); if (prior === undefined) delete process.env.STUDY_FORGE_MODEL_PROVIDER; else process.env.STUDY_FORGE_MODEL_PROVIDER = prior; }
}));
