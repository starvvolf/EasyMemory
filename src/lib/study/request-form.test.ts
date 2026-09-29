import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createExperimentRequestSchema } from "../mcp-experiment-requests.ts";
import type { ExperimentRequest } from "../mcp-experiment-requests.ts";
import { findReusableRequest, buildRemakeBody, pageRangeText, buildRequestBody, eligibleLeafIds, objectivesFromCompletedRequest, parsePageSelection, type RequestSource } from "./request-form.ts";

const source: RequestSource = {
  id: "geometric-transformations",
  pageCount: 32,
  outline: { status: "recorded", value: { nodes: [
    { id: "root", parentId: null, sourceRefs: [{ pageNumbers: [1, 2, 3] }] },
    { id: "leaf-a", parentId: "root", sourceRefs: [{ pageNumbers: [2] }] },
    { id: "leaf-b", parentId: "root", sourceRefs: [{ pageNumbers: [9] }] },
  ] } },
};

test("쪽 범위를 읽고 범위 밖이나 잘못된 형식은 거부한다", () => {
  assert.deepEqual(parsePageSelection("2-4, 7", 32), { pages: [2, 3, 4, 7], error: "" });
  assert.match(parsePageSelection("0-3", 32).error, /1~32쪽/);
  assert.match(parsePageSelection("두쪽", 32).error, /형식/);
});

test("선택한 쪽에 걸친 말단 목차만 고른다", () => {
  assert.deepEqual(eligibleLeafIds(source, [2, 3]), ["leaf-a"]);
  assert.deepEqual(eligibleLeafIds({ ...source, outline: { status: "not-generated" } }, [2]), []);
});

test("요청 본문은 실제 요청 스키마를 통과한다", () => {
  const built = buildRequestBody(source, "1-32", "시험 대비");
  if (!("body" in built) || !built.body) throw new Error(built.error);
  const parsed = createExperimentRequestSchema.safeParse(built.body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(built.body.stopAfterStage, "cards");
  assert.deepEqual(built.body.scope.outlineLeafIds, ["leaf-a", "leaf-b"]);
});

test("선택한 능력은 자유 문장과 별도로 저장하고 재사용 판단에도 반영한다", () => {
  const first = buildRequestBody(source, "2-3", "시험 대비", { abilities: ["계산·적용하기"] });
  const second = buildRequestBody(source, "2-3", "시험 대비", { abilities: ["식·절차 쓰기"] });
  if (!("body" in first) || !("body" in second) || !first.body || !second.body) throw new Error("요청 본문 없음");
  assert.ok(createExperimentRequestSchema.safeParse(first.body).success);
  assert.deepEqual(first.body.abilities, ["계산·적용하기"]);
  assert.equal(findReusableRequest([{ id: "same-purpose", status: "completed", input: first.body } as ExperimentRequest], second.body), null);
});

test("목표 설계까지만 요청하고 그 결과를 이어서 재사용할 수 있다", () => {
  const design = buildRequestBody(source, "2-9", "시험 대비", { stopAfterStage: "learning-design" });
  if (!("body" in design) || !design.body) throw new Error(design.error);
  assert.ok(createExperimentRequestSchema.safeParse(design.body).success);
  assert.deepEqual(Object.keys(design.body.requestedStages), ["analyze", "concept-tree", "learning-design"]);

  const reuse = { kind: "output" as const, runId: "mcp:design", stage: "learning-design" as const, sha256: "a".repeat(64) };
  const author = buildRequestBody(source, "2-9", "시험 대비", { reuse, selectedObjectiveIds: ["objective-2"] });
  if (!("body" in author) || !author.body) throw new Error(author.error);
  assert.ok(createExperimentRequestSchema.safeParse(author.body).success);
  assert.equal(author.body.stopAfterStage, "cards");
  assert.deepEqual(author.body.reuse, reuse);
  assert.deepEqual(author.body.selectedObjectiveIds, ["objective-2"]);
});

test("목적이나 범위가 비면 저장하지 않는다", () => {
  assert.equal(buildRequestBody(source, "", "목적").error, "학습할 쪽을 입력하세요.");
  assert.equal(buildRequestBody(source, "1-2", " ").error, "학습 목적을 적어 주세요.");
});

test("기존 학습 설계 기록을 화면 목표와 재사용 해시로 옮긴다", async () => {
  const raw = await readFile(new URL("./fixtures/learning-design-request.json", import.meta.url), "utf8");
  const record = (JSON.parse(raw) as { request: ExperimentRequest }).request;
  const result = objectivesFromCompletedRequest(record);
  assert.ok(result.objectives.length > 0);
  assert.equal(result.hash, record.stages.find((stage) => stage.stage === "learning-design")?.actual.outputSha256);
  assert.equal(result.objectives[0].id, "objective-1");
  assert.ok(result.objectives[0].pages.includes(2));
  assert.ok(result.objectives[0].quote.length > 0);
});

test("같은 조건의 대기·진행·완료 요청은 다시 쓰고, 실패했거나 조건이 다르면 새로 만든다", () => {
  const built = buildRequestBody(source, "2-3", "시험 대비", { stopAfterStage: "learning-design" });
  if (!("body" in built) || !built.body) throw new Error(built.error);
  const request = (id: string, status: ExperimentRequest["status"], input = built.body) =>
    ({ id, status, input } as unknown as ExperimentRequest);
  assert.equal(findReusableRequest([request("a", "waiting-for-executor")], built.body)?.id, "a");
  assert.equal(findReusableRequest([request("b", "completed")], built.body)?.id, "b");
  assert.equal(findReusableRequest([request("c", "failed")], built.body), null);
  assert.equal(findReusableRequest([request("d", "running", { ...built.body, purpose: "다른 목적" })], built.body), null);
  const withSelection = buildRequestBody(source, "2-3", "시험 대비", { stopAfterStage: "cards",
    reuse: { kind: "output", runId: "mcp:run", stage: "learning-design", sha256: "a".repeat(64) }, selectedObjectiveIds: ["objective-1"] });
  if (!("body" in withSelection) || !withSelection.body) throw new Error(withSelection.error);
  assert.equal(findReusableRequest([request("e", "claimed", withSelection.body)],
    { ...withSelection.body, selectedObjectiveIds: ["objective-2"] }), null);
});

test("다시 만들기: 원래 요청의 학습 설계를 재사용하고 고른 목표만 요청한다", async () => {
  assert.equal(pageRangeText([9, 2, 3, 4, 5, 3]), "2-5, 9");
  const origin = (JSON.parse(await readFile(new URL("./fixtures/learning-design-request.json", import.meta.url), "utf8")) as { request: ExperimentRequest }).request;
  const built = buildRemakeBody(source, origin, ["objective-2", "objective-2"]);
  if (!("body" in built) || !built.body) throw new Error(built.error);
  assert.ok(createExperimentRequestSchema.safeParse(built.body).success);
  assert.deepEqual(built.body.selectedObjectiveIds, ["objective-2"]);
  assert.equal(built.body.reuse?.sha256, origin.stages[2].actual.outputSha256);
  assert.deepEqual(built.body.scope.pageNumbers, [2, 3, 4, 5, 6, 7]);
  assert.equal(buildRemakeBody(source, { ...origin, status: "failed" }, ["objective-2"]).error, "이 자료는 원래 요청 기록이 없어 다시 만들 수 없어요.");
});
