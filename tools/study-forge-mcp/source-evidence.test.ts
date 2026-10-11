import assert from "node:assert/strict";
import test from "node:test";
import { evidenceQuotes, inspectSourceEvidence, unmatchedEvidenceExcerpt } from "./source-evidence.ts";
import type { KnowledgeUnit } from "../../src/lib/types.ts";

const unit = (sourceText: string) => ({ id: "u1", sourceId: "lesson.pdf", sourcePage: 2, sourceText }) as KnowledgeUnit;
const pages = (text: string) => new Map([["lesson.pdf", new Map([[2, text]])]]);
const refs = new Map([["lesson.pdf", new Map([["u1", [2]]])]]);

test("인용 여러 개를 허용하고 공백·줄바꿈·하이픈·PDF 쪽 표기를 정리한다", () => {
  assert.deepEqual(evidenceQuotes("「chain- rule」 (PDF 2쪽) || T⁻¹ (PDF 2쪽)"), ["chain- rule", "T⁻¹"]);
  assert.equal(inspectSourceEvidence([unit("chain- rule || T⁻¹")], pages("chain-\nrule 및 T⁻¹"), refs)[0]?.status, "원문 확인");
});

test("실제 문구가 없으면 요약을 원문 인용으로 통과시키지 않는다", () => {
  assert.throws(() => inspectSourceEvidence([unit("정리하면 네 조건이다")], pages("상호 배제, 점유와 대기, 비선점, 순환 대기"), refs), /실제 문구/);
});

test("글자 없는 쪽은 실패가 아닌 원문 글자 없음으로 표시한다", () => {
  assert.equal(inspectSourceEvidence([unit("도표의 관계")], pages(""), refs)[0]?.status, "원문 글자 없음");
});

// Live run req_8cd8…: the unit's evidence held two excerpts with page labels between them, and a card that
// copied both excerpts joined by || was rejected because the whole string was compared at once.
const twoExcerpts = "x is already gone. It won’t come back. (PDF 2쪽) || x is still waiting. Adding it again has no effect. (PDF 2쪽)";

test("카드 근거가 학습 단위의 여러 구절을 ||로 옮기면 쪽 표기가 사이에 있어도 통과한다", () => {
  assert.equal(unmatchedEvidenceExcerpt(twoExcerpts, "x is already gone. It won’t come back. || x is still waiting. Adding it again has no effect."), null);
  assert.equal(unmatchedEvidenceExcerpt(twoExcerpts, "x is still waiting."), null);
  assert.equal(unmatchedEvidenceExcerpt(twoExcerpts, "x is already gone. (PDF 2쪽)"), null);
});

test("카드 근거가 학습 단위 근거와 다르면 어긋난 구절을 돌려준다", () => {
  assert.equal(unmatchedEvidenceExcerpt(twoExcerpts, "x is already gone. || x was removed long ago."), "x was removed long ago.");
  // Two excerpts glued into one with numbering is not a copy of either excerpt.
  assert.notEqual(unmatchedEvidenceExcerpt(twoExcerpts, "1. x is already gone. It won’t come back. 2. x is still waiting."), null);
  assert.notEqual(unmatchedEvidenceExcerpt(twoExcerpts, "x is"), null);
  assert.notEqual(unmatchedEvidenceExcerpt(twoExcerpts, ""), null);
});
