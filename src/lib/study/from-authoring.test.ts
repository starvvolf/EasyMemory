import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { toStudyDeck, type StudyArtifactMeta } from "./from-authoring.ts";

const meta: StudyArtifactMeta = {
  id: "authoring:test", title: "테스트 자료", artifactSha256: "a".repeat(64),
  sourceFile: "source.pdf", sourceCatalogId: "geometric-transformations", sourceTotalPages: 32,
};
const source = (objectiveId: string, page: number, sourceRange = "첫 인용 / 둘째 인용") => ({
  learningUnitId: "lu", objectiveId, sourceId: "source.pdf", sourcePage: page, sourceRange, sourceText: "요약", target: `${objectiveId} 목표`, successCriteria: [],
});
const frame = { x: 0, y: 0, width: 10, height: 10 };

test("객관식·빈칸·자기확인 문항을 되짚기 형식으로 옮긴다", () => {
  const document: AuthoringDocument = {
    schemaVersion: "problem-authoring-v1", id: "doc", title: "doc",
    questions: [
      {
        id: "q1", source: source("o1", 3), page: { width: 1, height: 1 },
        blocks: [
          { id: "t", kind: "text", text: "옳은 것은?", frame },
          { id: "m", kind: "math", latex: "\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}", frame },
          { id: "c", kind: "choice-set", responseId: "r1", optionIds: ["a", "b"], frame },
          { id: "v", kind: "answer-reveal", responseIds: ["r1"], frame },
        ],
        responses: [{ id: "r1", kind: "single-choice", options: [{ id: "a", text: "가" }, { id: "b", latex: "x^2" }], correctOptionId: "b", grading: "exact", explanation: "설명" }],
      },
      {
        id: "q2", source: { ...source("o1", 4), sourcePages: [4, 5] }, page: { width: 1, height: 1 },
        blocks: [{ id: "b", kind: "blank", responseId: "r1", promptBefore: "값은 ", promptAfter: "이다.", frame }],
        responses: [{ id: "r1", kind: "short-text", acceptedAnswers: ["(1,2)"], grading: "exact-normalized" }],
      },
      {
        id: "q3", source: source("o2", 7), page: { width: 1, height: 1 },
        blocks: [{ id: "t", kind: "text", text: "과정을 설명하세요.", frame }],
        responses: [{ id: "r1", kind: "short-text", acceptedAnswers: ["첫째", "둘째"], grading: "self-check" }],
      },
    ],
  };
  const deck = toStudyDeck(meta, document);
  assert.deepEqual(deck.items.map((item) => item.format), ["choice", "value", "card"]);
  assert.equal(deck.items[0].prompt, "옳은 것은?\n$\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}$");
  assert.deepEqual(deck.items[0].options, ["가", "$x^2$"]);
  assert.equal(deck.items[0].answer, 1);
  assert.equal(deck.items[1].prompt, "값은 ＿＿＿이다.");
  assert.deepEqual(deck.items[1].accepted, ["(1,2)"]);
  assert.equal(deck.items[2].answer, "첫째\n둘째");
  assert.deepEqual(deck.objectives.map((o) => [o.id, o.pages, o.quote]), [["o1", [3, 4, 5], "첫 인용"], ["o2", [7], "첫 인용"]]);
  assert.equal(deck.items[0].quote, "첫 인용 / 둘째 인용");
  assert.deepEqual(deck.skipped, []);
});

test("정답 연결이 깨진 문항은 추측해 채우지 않고 건너뛴 목록에 남긴다", () => {
  const document: AuthoringDocument = {
    schemaVersion: "problem-authoring-v1", id: "doc", title: "doc",
    questions: [{
      id: "q1", source: source("o1", 3), page: { width: 1, height: 1 }, blocks: [],
      responses: [{ id: "r1", kind: "single-choice", options: [{ id: "a", text: "가" }], correctOptionId: "missing", grading: "exact" }],
    }],
  };
  const deck = toStudyDeck(meta, document);
  assert.equal(deck.items.length, 0);
  assert.equal(deck.skipped[0].questionId, "q1");
});

test("전체 범위 r02 두 문서는 모든 문항이 변환된다", async () => {
  for (const [name, count] of [["geometry", 28], ["semiconductor", 22]] as const) {
    const raw = await readFile(new URL(`../../../tools/problem-authoring-lab/runs/integrated-${name}-full-20260928-r02/iteration-0/document.json`, import.meta.url), "utf8");
    const deck = toStudyDeck(meta, JSON.parse(raw) as AuthoringDocument);
    assert.equal(deck.items.length, count, name);
    assert.deepEqual(deck.skipped, [], name);
    assert.ok(deck.items.every((item) => item.prompt.trim() && item.page > 0), name);
  }
});

test("검사에서 제외한 문항은 연습에 넣지 않고 이유와 함께 남긴다", async () => {
  const raw = await readFile(new URL("../../../tools/problem-authoring-lab/runs/integrated-geometry-full-20260928-r02/iteration-0/document.json", import.meta.url), "utf8");
  const deck = toStudyDeck(meta, JSON.parse(raw) as AuthoringDocument, 0, new Map([["question-21", "검사 제외: 한 칸에 여러 답"]]));
  assert.equal(deck.items.length, 27);
  assert.ok(!deck.items.some((item) => item.id === "question-21"));
  assert.deepEqual(deck.skipped, [{ questionId: "question-21", reason: "검사 제외: 한 칸에 여러 답" }]);
});

test("문제 본문을 블록 단위로 넘긴다: 공통 지문, 표, 수식, 빈칸, 그림", () => {
  const document: AuthoringDocument = {
    schemaVersion: "problem-authoring-v1", id: "doc", title: "doc",
    sharedSets: [{ id: "set", source: source("o1", 3), page: { width: 1, height: 1 }, blocks: [{ id: "p", kind: "text", text: "공통 지문", frame }] }],
    questions: [{
      id: "q1", sharedSetId: "set", source: source("o1", 3), page: { width: 1, height: 1 },
      blocks: [
        { id: "t", kind: "text", text: "표를 보고 답하세요.", style: "heading", frame },
        { id: "tb", kind: "table", rows: [["변환", "행렬"], ["이동", "T"]], headerRows: 1, frame: { ...frame, y: 1 } },
        { id: "m", kind: "math", latex: "x^2", frame: { ...frame, y: 2 } },
        { id: "g", kind: "image", alt: "원문 그림", sourceAssetRef: { sourceId: "source.pdf", page: 3, assetId: "a" }, frame: { ...frame, y: 3 } },
        { id: "b", kind: "blank", responseId: "r1", promptBefore: "값은 ", promptAfter: "이다.", frame: { ...frame, y: 4 } },
        { id: "v", kind: "answer-reveal", responseIds: ["r1"], frame: { ...frame, y: 5 } },
      ],
      responses: [{ id: "r1", kind: "short-text", acceptedAnswers: ["1"], grading: "exact-normalized" }],
    }],
  };
  const [item] = toStudyDeck(meta, document).items;
  assert.deepEqual(item.blocks.map((block) => block.kind), ["text", "text", "table", "math", "image", "blank"]);
  assert.deepEqual(item.blocks[0], { kind: "text", text: "공통 지문", heading: false });
  assert.deepEqual(item.blocks[2], { kind: "table", rows: [["변환", "행렬"], ["이동", "T"]], headerRows: 1 });
  assert.deepEqual(item.blocks[4], { kind: "image", alt: "원문 그림", page: 3 });
  assert.deepEqual(item.blocks[5], { kind: "blank", before: "값은 ", after: "이다.", own: true });
  assert.ok(item.prompt.startsWith("공통 지문\n표를 보고 답하세요."));
});
