import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AuthoredQuestion } from "../../../../tools/problem-authoring-lab/contract.ts";
import { codeGrade, keyText, learnerView, mutate, startJudge, verdictOf, type JudgeCall } from "./judge.ts";
import { createGen, runGen } from "./runner.ts";
import { scorecard } from "./scorecard.ts";

const choice: AuthoredQuestion = {
  id: "q-s1-o1", page: { width: 760, height: 300 },
  source: { learningUnitId: "s1-o1", objectiveId: "s1-o1", sourceId: "a.pdf", sourcePage: 1, sourceRange: "PDF 1쪽", sourceText: "q", target: "t", successCriteria: ["c"] },
  blocks: [
    { id: "b1", kind: "text", text: "큐에 처음 넣을 때만 추가하는 이유는?", frame: { x: 0, y: 0, width: 10, height: 10 } },
    { id: "choices", kind: "choice-set", responseId: "r1", optionIds: ["o1", "o2", "o3", "o4"], frame: { x: 0, y: 0, width: 10, height: 10 } },
    { id: "reveal", kind: "answer-reveal", responseIds: ["r1"], frame: { x: 0, y: 0, width: 10, height: 10 } },
  ],
  responses: [{ id: "r1", kind: "single-choice", options: [{ id: "o1", text: "가" }, { id: "o2", text: "나" }, { id: "o3", text: "다" }, { id: "o4", text: "라" }], correctOptionId: "o3", grading: "exact", explanation: "다가 맞다" }],
};
const short: AuthoredQuestion = { ...choice, id: "q-s1-o2", blocks: [choice.blocks[0], { id: "input", kind: "blank", responseId: "r1", promptBefore: "자료구조:", promptAfter: "", frame: { x: 0, y: 0, width: 10, height: 10 } }],
  responses: [{ id: "r1", kind: "short-text", acceptedAnswers: ["boolean array", "불리언 배열"], grading: "exact-normalized", explanation: "e" }] };

test("학습자가 보는 글에는 정답·해설이 없고, 객관식·단답은 코드가 채점한다", () => {
  const view = learnerView(choice, "Q1");
  assert.match(view, /### Q1[\s\S]*A\. 가[\s\S]*D\. 라/);
  assert.ok(!view.includes("다가 맞다"));
  assert.equal(keyText(choice), "C. 다");
  assert.equal(codeGrade(choice, "C"), "correct");
  assert.equal(codeGrade(choice, "a."), "wrong");
  assert.equal(codeGrade(short, "불리언 배열"), "correct");
  assert.match(learnerView(short, "Q2"), /\[답 입력칸\] 자료구조: ____/);
});

test("판정 규칙: 조건·정답 오류는 실패, 노출·모호·목표 불일치는 의심", () => {
  const ok = { conditionMatch: true, answerCorrect: true, answerUnique: true, objectiveMatch: true, distractorsPlausible: null, depth: "이해" as const };
  const base = { questionId: "q", objectiveId: "o", sectionId: "s1", problems: "", blind: { answer: "", confidence: 0, grade: "wrong" as const }, readers: [{ answer: "x", grade: "correct" as const }] };
  assert.equal(verdictOf({ ...base, checks: ok }).verdict, "통과");
  assert.equal(verdictOf({ ...base, checks: { ...ok, conditionMatch: false } }).verdict, "실패");
  assert.equal(verdictOf({ ...base, checks: ok, readers: [{ answer: "", grade: "wrong" }, { answer: "", grade: "wrong" }] }).verdict, "실패");
  assert.equal(verdictOf({ ...base, checks: ok, blind: { answer: "x", confidence: 0.9, grade: "correct" } }).verdict, "의심");
  assert.equal(verdictOf({ ...base, checks: ok, blind: { answer: "x", confidence: 0.3, grade: "correct" } }).verdict, "통과", "a low-confidence guess is not exposure");
  assert.match(verdictOf({ ...base, checks: ok, readers: [{ answer: "", grade: "correct" }, { answer: "", grade: "partial" }] }).reasons.join(), /모호/);
});

test("결함 심기: 정답 노출·정답 바꾸기·조건 바꾸기 복제본을 만든다", () => {
  assert.match(learnerView(mutate(choice, "leak", [choice])!, "Q1"), /참고: 다/);
  assert.equal((mutate(choice, "wrong-key", [choice])!.responses[0] as { correctOptionId: string }).correctOptionId, "o4");
  assert.match(learnerView(mutate(choice, "condition-swap", [])!, "Q1"), /이미 넣을 때만/);
  assert.equal((mutate(short, "wrong-key", [short, { ...short, id: "other", responses: [{ id: "r1", kind: "short-text", acceptedAnswers: ["HashSet"], grading: "exact-normalized" }] }])!.responses[0] as { acceptedAnswers: string[] }).acceptedAnswers[0], "HashSet");
  assert.equal(mutate({ ...short, blocks: [{ id: "b1", kind: "text", text: "자료구조는?", frame: { x: 0, y: 0, width: 1, height: 1 } }] }, "condition-swap", []), null);
});

const PAGES = new Map([
  [1, "Breadth-first search visits vertices in order of distance from the start. A queue holds the vertices that are waiting to be visited."],
  [2, "Adding a vertex that was already in the queue has no effect on the result. A boolean array records whether each vertex has been in the queue."],
]);
async function withData<T>(fn: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "judge-"));
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await fn(); }
  finally { if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); }
}

test("평가 실행: 목차마다 맨손 1·원문 3·전문가 1번 부르고, 판정이 점수표에 들어간다", () => withData(async () => {
  const caller = { uid: "local-experiment" };
  const gen = await createGen({ sourceId: "src", fileName: "bfs.pdf", pageNumbers: [1, 2], provider: "fake", purpose: "core", autoConfirm: true });
  const done = await runGen(gen.id, caller, { pages: async () => PAGES });
  assert.equal(done.status, "done");
  const roles: string[] = [];
  // Page 2's question gets a condition the expert rejects; page 1's question is answered blind with confidence.
  const fakeReply = (role: JudgeCall["role"], user: string) => {
    roles.push(role);
    const labels = [...user.matchAll(/^### (Q\d+)$/gm)].map((match) => match[1]);
    if (role === "blind") return JSON.stringify({ answers: labels.map((questionId) => ({ questionId, answer: "추측", confidence: 0.9 })) });
    if (role === "reader") return JSON.stringify({ answers: labels.map((questionId) => ({ questionId, answer: "원문대로", confidence: 1 })) });
    const page2 = user.includes("boolean array");
    return JSON.stringify({ questions: labels.map((questionId) => ({ questionId, blindGrade: page2 ? "wrong" : "correct", readerGrades: ["correct", "correct", "correct"],
      conditionMatch: !page2, answerCorrect: true, answerUnique: true, objectiveMatch: true, distractorsPlausible: null, depth: "되풀이", problems: page2 ? "조건이 바뀜" : "" })) });
  };
  const { finished } = await startJudge(gen.id, { kind: "judge" }, caller, { pages: async () => PAGES, fakeReply });
  const run = await finished;
  assert.equal(run.status, "done", run.message);
  assert.deepEqual(roles, ["blind", "reader", "reader", "reader", "expert", "blind", "reader", "reader", "reader", "expert"]);
  assert.deepEqual(run.results.map((result) => result.verdict), ["의심", "실패"]);
  assert.equal(run.summary!.exposed, 1);
  assert.equal(run.summary!.conditionMismatch, 1);
  const score = scorecard(done, [], new Map(), run);
  assert.equal(score.judge?.summary?.fail, 1);
}));

test("판정단 시험: 통과한 문제에 결함을 심고 검출률과 오탐률을 낸다", () => withData(async () => {
  const caller = { uid: "local-experiment" };
  const gen = await createGen({ sourceId: "src", fileName: "bfs.pdf", pageNumbers: [1, 2], provider: "fake", purpose: "core", autoConfirm: true });
  await runGen(gen.id, caller, { pages: async () => PAGES });
  // The fake expert catches what a real one should: a leaked answer, and a key that no longer matches the objective.
  const fakeReply = (role: JudgeCall["role"], user: string) => {
    const blocks = user.split(/^### /m).slice(1);
    if (role !== "expert") return JSON.stringify({ answers: blocks.map((block) => ({ questionId: block.split("\n")[0], answer: block.includes("(참고:") ? "베낀 답" : "모름", confidence: block.includes("(참고:") ? 0.95 : 0.1 })) });
    return JSON.stringify({ questions: blocks.map((block) => {
      const recall = /떠올릴 것: (.+)/.exec(block)?.[1]?.trim();
      const key = /정답: 모범 답: (.+)/.exec(block)?.[1]?.trim();
      return { questionId: block.split("\n")[0], blindGrade: block.includes("(참고:") ? "correct" : "wrong", readerGrades: ["correct", "correct", "correct"],
        conditionMatch: true, answerCorrect: !key || key === recall, answerUnique: true, objectiveMatch: true, distractorsPlausible: null, depth: "이해", problems: "" };
    }) });
  };
  const { finished } = await startJudge(gen.id, { kind: "trial" }, caller, { pages: async () => PAGES, fakeReply });
  const run = await finished;
  assert.equal(run.status, "done", run.message);
  assert.equal(run.trial!.originals, 2);
  assert.equal(run.trial!.falseAlarms, 0);
  assert.equal(run.trial!.planted, 2);
  assert.equal(run.trial!.caught, 2);
  assert.equal(Object.values(run.trial!.byKind).reduce((sum, kind) => sum + kind.planted, 0), 2);
}));

test("출제가 끝나지 않았거나 실제 호출 확인이 없으면 판정을 시작하지 않는다", () => withData(async () => {
  const caller = { uid: "local-experiment" };
  const waiting = await createGen({ sourceId: "src", fileName: "bfs.pdf", pageNumbers: [1], provider: "fake", purpose: "core" });
  await runGen(waiting.id, caller, { pages: async () => PAGES });
  await assert.rejects(startJudge(waiting.id, {}, caller), /출제가 끝난/);
}));
