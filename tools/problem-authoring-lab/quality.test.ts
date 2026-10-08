import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthoredQuestion, AuthoringDocument, ResponseContract } from "./contract.ts";
import { inspectQuality, isCompositeAnswer } from "./quality.ts";

const frame = (y: number, height = 40) => ({ x: 20, y, width: 700, height });
const source = { learningUnitId: "lu", objectiveId: "o", sourceId: "s.pdf", sourcePage: 1, sourceRange: "원문", sourceText: "원문", target: "목표", successCriteria: ["기준"] };

function choice(id: string, stem: string, correct: string, wrong: string[]): AuthoredQuestion {
  const options = [correct, ...wrong].map((text, index) => ({ id: `${id}-o${index}`, text }));
  return {
    id, source, page: { width: 760, height: 600 },
    blocks: [{ id: "t", kind: "text", text: stem, frame: frame(20) }, { id: "c", kind: "choice-set", responseId: "r", optionIds: options.map((o) => o.id), frame: frame(80, 200) }, { id: "v", kind: "answer-reveal", responseIds: ["r"], frame: frame(300, 100) }],
    responses: [{ id: "r", kind: "single-choice", options, correctOptionId: `${id}-o0`, grading: "exact" }],
  };
}
function blank(id: string, before: string, answers: string[], grading: "exact-normalized" | "self-check" = "exact-normalized", extra: Partial<AuthoredQuestion> = {}): AuthoredQuestion {
  const response: ResponseContract = { id: "r", kind: "short-text", acceptedAnswers: answers, grading };
  return {
    id, source, page: { width: 760, height: 600 },
    blocks: [{ id: "b", kind: "blank", responseId: "r", promptBefore: before, promptAfter: "이다.", frame: frame(20) }, { id: "v", kind: "answer-reveal", responseIds: ["r"], frame: frame(80, 100) }],
    responses: [response], ...extra,
  };
}
const doc = (...questions: AuthoredQuestion[]): AuthoringDocument => ({ schemaVersion: "problem-authoring-v1", id: "d", title: "d", questions });
const codes = (document: AuthoringDocument) => inspectQuality(document).map((issue) => `${issue.questionId}:${issue.code}`);

test("answer-leak-before-reveal: 정답이나 정답 낱말 대부분이 본문에 있으면 오류", () => {
  assert.deepEqual(codes(doc(blank("q1", "점 (1,2)를 그대로 두면 (1,2)가 되므로 답은", ["(1,2)"]))), ["q1:answer-leak-before-reveal"]);
  assert.deepEqual(codes(doc(blank("q2", "소스는 캐리어 공급 게이트는 채널 제어를 하므로 역할은", ["소스 캐리어 공급 게이트 채널 제어"], "self-check"))), ["q2:answer-leak-before-reveal"]);
  assert.deepEqual(codes(doc(choice("q3", "정답은 오른손 좌표계이다. 옳은 것은?", "오른손 좌표계", ["왼손 좌표계", "구면 좌표계", "원통 좌표계"]))), ["q3:answer-leak-before-reveal"]);
  assert.deepEqual(codes(doc(blank("q4", "점 (2,-1)을 (-3,4)만큼 옮기면", ["(-1,3)"]))), []);
});

test("composite-short-answer: 괄호 밖 구분자로 이어진 여러 요소나 25자 초과는 오류, self-check는 제외", () => {
  assert.equal(isCompositeAnswer("(x,y,1)"), false);
  assert.equal(isCompositeAnswer("(x,y,1); h≠0"), true);
  assert.equal(isCompositeAnswer("원점 이동→축 정렬→회전"), true);
  assert.equal(isCompositeAnswer("x′=x, y′=y, z′=z"), true);
  assert.equal(isCompositeAnswer("σ=neμe+peμh 그리고 두 수송자의 합으로 구한다"), true);
  assert.deepEqual(codes(doc(blank("q1", "세 식은", ["x′=x, y′=y, z′=z"]))), ["q1:composite-short-answer"]);
  assert.deepEqual(codes(doc(blank("q2", "세 식은", ["x′=x, y′=y, z′=z"], "self-check"))), []);
});

test("choice-length-cue와 implausible-distractor는 경고", () => {
  assert.deepEqual(codes(doc(choice("q1", "옳은 것은?", "소스는 캐리어 공급, 게이트는 채널 제어, 드레인은 배출", ["모두 같다", "게이트만 쓴다", "드레인만 쓴다"]))),
    ["q1:choice-length-cue", "q1:implausible-distractor"]);
  assert.deepEqual(codes(doc(choice("q2", "옳은 것은?", "sx·sy≠0일 때 역행렬이 있다", ["sx=0이어도 역행렬이 있다", "sy만 0이 아니어도 있다", "sx·sy 값과는 무관하다"]))), []);
});

test("duplicate-item, source-notation-missing, absolute-layout, choice-longest-ratio", () => {
  assert.deepEqual(codes(doc(blank("q1", "(2,-1)에 (-3,4)를 더하면", ["(-1,3)"]), blank("q2", "(2,-1)과 (-3,4)를 합성하면", ["(-1,3)"]))), ["q2:duplicate-item"]);
  const notation = blank("q3", "방향 스케일 합성식은", ["R(-θ)SR(θ)"], "exact-normalized", { source: { ...source, sourceText: "PDF 13쪽의 R^-1(θ)·S·R(θ)" } });
  assert.deepEqual(codes(doc(notation)), ["q3:source-notation-missing"]);
  const spaced = blank("q4", "값은", ["3"]);
  spaced.blocks[1].frame = frame(400, 100);
  assert.deepEqual(codes(doc(spaced)), ["q4:absolute-layout"]);
  const longest = ["a", "b", "c", "d"].map((id) => choice(id, "옳은 것은?", "정답 보기 조금 더 김", ["오답 보기 하나", "오답 보기 둘", "오답 보기 셋"]));
  assert.ok(codes(doc(...longest)).includes("document:choice-longest-ratio"));
});

test("r02 문서에서 작업지시 02가 지목한 문항이 걸리고, 좋은 예(기하 9·18·20)는 걸리지 않는다", async () => {
  const load = async (name: string) => JSON.parse(await readFile(new URL(`./runs/integrated-${name}-full-20260928-r02/iteration-0/document.json`, import.meta.url), "utf8")) as AuthoringDocument;
  const found = (document: AuthoringDocument, code: string) => inspectQuality(document).filter((issue) => issue.code === code).map((issue) => issue.questionId);
  const geometry = await load("geometry");
  const semiconductor = await load("semiconductor");
  for (const n of [21, 22, 23, 24, 25]) assert.ok(found(geometry, "composite-short-answer").includes(`question-${n}`), `기하 ${n}`);
  for (const n of [4, 9, 20]) assert.ok(found(semiconductor, "composite-short-answer").includes(`question-${n}`), `반도체 ${n}`);
  assert.ok(found(geometry, "implausible-distractor").includes("question-26"));
  for (const n of [16, 19]) assert.ok(found(semiconductor, "implausible-distractor").includes(`question-${n}`));
  assert.ok(found(geometry, "duplicate-item").includes("question-10"));
  assert.ok(found(geometry, "source-notation-missing").includes("question-15"));
  assert.ok(found(geometry, "absolute-layout").includes("question-1"));
  for (const n of [9, 18, 20]) {
    const id = `question-${n}`;
    assert.ok(!found(geometry, "choice-length-cue").includes(id) && !found(geometry, "implausible-distractor").includes(id), `좋은 예 기하 ${n}`);
  }
});
