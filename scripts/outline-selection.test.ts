import assert from "node:assert/strict";
import test from "node:test";

import {
  getOutlineNodeSelectionState,
  getSelectableOutlineLeafIds,
  toggleOutlineNodeSelection,
  validateOutlineSelection,
  type LearningOutlineNode,
} from "../src/lib/outline-selection.ts";
import {
  buildSelectedOutlineSourceText,
  filterPlanToOutlineSelection,
  getDefaultOutlineSelection,
} from "../src/lib/learning-outline.ts";
import type { WholeDocumentCorePlan } from "../src/lib/types.ts";

const nodes: LearningOutlineNode[] = [
  { id: "root", parentId: null, order: 1, title: "전체" },
  { id: "a", parentId: "root", order: 1, title: "A" },
  { id: "a-1", parentId: "a", order: 1, title: "A-1" },
  { id: "a-2", parentId: "a", order: 2, title: "A-2" },
  { id: "b", parentId: "root", order: 2, title: "B" },
];

test("자식이 없는 최종 목차만 문제 대상으로 반환한다", () => {
  assert.deepEqual(getSelectableOutlineLeafIds(nodes), ["a-1", "a-2", "b"]);
});

test("부모 목차를 선택하면 모든 하위 최종 목차를 선택한다", () => {
  assert.deepEqual(toggleOutlineNodeSelection(nodes, [], "a"), ["a-1", "a-2"]);
  assert.deepEqual(toggleOutlineNodeSelection(nodes, [], "root"), ["a-1", "a-2", "b"]);
});

test("자식을 독립적으로 선택하면 부모는 일부 선택 상태가 된다", () => {
  const selected = toggleOutlineNodeSelection(nodes, [], "a-1");
  assert.deepEqual(selected, ["a-1"]);
  assert.equal(getOutlineNodeSelectionState(nodes, selected, "a"), "partial");
  assert.equal(getOutlineNodeSelectionState(nodes, selected, "root"), "partial");
});

test("모두 선택된 부모를 다시 누르면 해당 하위 목차만 해제한다", () => {
  assert.deepEqual(
    toggleOutlineNodeSelection(nodes, ["a-1", "a-2", "b"], "a"),
    ["b"],
  );
});

test("최소 1개를 선택해야 하고 부모는 최종 선택 ID로 받지 않는다", () => {
  assert.match(validateOutlineSelection(nodes, [])[0], /최소 1개/);
  assert.match(validateOutlineSelection(nodes, ["a"])[0], /최종 목차만/);
  assert.deepEqual(validateOutlineSelection(nodes, ["a-1"]), []);
});

test("AI 기본 선택과 사용자 선택 범위만 Prepare 근거로 만든다", () => {
  const plan: WholeDocumentCorePlan = {
    summary: "요약",
    learningGoal: "목표",
    selectionRationale: "이유",
    areas: [],
    exclusions: [],
    maxLearningUnitCount: 4,
    learningOutline: {
      title: "목차",
      summary: "요약",
      nodes: [
        { id: "root", parentId: null, order: 1, title: "전체", summary: "", sourceRefs: [], sourceEvidence: "", selectedByDefault: false },
        { id: "a", parentId: "root", order: 1, title: "A", summary: "", sourceRefs: [{ fileName: "x.pdf", pageNumbers: [1] }], sourceEvidence: "A 근거", selectedByDefault: true },
        { id: "b", parentId: "root", order: 2, title: "B", summary: "", sourceRefs: [{ fileName: "x.pdf", pageNumbers: [2] }], sourceEvidence: "B 근거", selectedByDefault: false },
      ],
    },
  };

  assert.deepEqual(getDefaultOutlineSelection(plan), ["a"]);
  const source = buildSelectedOutlineSourceText(plan.learningOutline!.nodes, ["b"]);
  assert.match(source, /B 근거/);
  assert.doesNotMatch(source, /A 근거/);
  assert.deepEqual(
    filterPlanToOutlineSelection(plan, ["b"]).learningOutline!.nodes.map((node) => node.id),
    ["root", "b"],
  );
});
