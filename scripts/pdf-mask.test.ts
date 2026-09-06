import assert from "node:assert/strict";
import test from "node:test";
import type { LearningUnit } from "../src/lib/types.ts";
import {
  findPdfMaskTarget,
  matchesPdfEvidence,
} from "../src/lib/pdf-mask.ts";

const deadlockUnit: LearningUnit = {
  id: "LU03",
  sourceId: "lecture8.pdf",
  sourcePage: 5,
  sourceRange: "Deadlock Characterization — Mutual exclusion",
  sourceText: "Mutual exclusion — Only one process at a time can use a resource.",
  knowledgeType: "concept",
  fixedPart: "",
  variableSlots: [],
  generalizedForm: "",
  target: "데드락 필요 조건인 상호 배제의 의미를 설명한다.",
  rationale: "",
};

test("PDF 문장과 AI가 선택한 데드락 근거를 연결한다", () => {
  assert.equal(
    matchesPdfEvidence(
      "Mutual exclusion - Only one process at a time can use a resource.",
      deadlockUnit.sourceText,
      deadlockUnit.sourceRange,
    ),
    true,
  );
});

test("글머리표·줄바꿈·문장부호 차이는 위치 연결에 영향을 주지 않는다", () => {
  assert.equal(
    matchesPdfEvidence(
      "• Deadlock can arise if four conditions hold simultaneously.",
      "Deadlock can arise if four conditions hold simultaneously:\nMutual exclusion",
      "Deadlock Characterization",
    ),
    true,
  );
});

test("수식 표기와 일부 문구가 달라도 같은 핵심 문장이면 연결한다", () => {
  assert.equal(
    matchesPdfEvidence(
      "Circular wait. There exists a set {P0, P1, …, P0} of waiting processes such that P0 is waiting for a resource that is held by P1 and Pn is waiting for a resource that is held by P0.",
      "Circular wait: there exists a set {P0, P1, …, Pn} of waiting processes such that P0 is waiting for a resource held by P1, …, Pn is waiting for a resource held by P0.",
      "Deadlock Characterization — Circular wait",
    ),
    true,
  );
});

test("관련 없는 문장은 가림 대상으로 만들지 않는다", () => {
  assert.equal(
    findPdfMaskTarget("Banker's algorithm uses several data structures.", [
      deadlockUnit,
    ]),
    undefined,
  );
});
