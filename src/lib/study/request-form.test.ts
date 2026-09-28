import assert from "node:assert/strict";
import test from "node:test";
import { createExperimentRequestSchema } from "../mcp-experiment-requests.ts";
import { buildRequestBody, eligibleLeafIds, parsePageSelection, type RequestSource } from "./request-form.ts";

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

test("목적이나 범위가 비면 저장하지 않는다", () => {
  assert.equal(buildRequestBody(source, "", "목적").error, "학습할 쪽을 입력하세요.");
  assert.equal(buildRequestBody(source, "1-2", " ").error, "학습 목적을 적어 주세요.");
});
