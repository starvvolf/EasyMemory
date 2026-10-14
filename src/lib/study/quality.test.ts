import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseRules } from "./plan.ts";
import { appendLedger, applyPatches, ledgerCounts, ledgerLine, similarObjectives, similarity, tooEasy, type StudyPatch } from "./quality.ts";

test("패치: 정답 추가는 값 문제에만, 같은 답은 한 번, 카드 전환은 인정 답안이 뒷면", () => {
  const deck = { items: [{ id: "a", format: "value", accepted: ["(1,2)"] }, { id: "b", format: "card", answer: "x" }] };
  const patches: StudyPatch[] = [
    { id: "1", at: "", kind: "accept", itemId: "a", answer: "(1, 2)" },
    { id: "2", at: "", kind: "accept", itemId: "a", answer: "(1, 2)" },
    { id: "3", at: "", kind: "accept", itemId: "b", answer: "y" },
    { id: "4", at: "", kind: "accept", itemId: "없음", answer: "y" },
  ];
  applyPatches(deck, patches);
  assert.deepEqual(deck.items[0].accepted, ["(1,2)", "(1, 2)"]);
  assert.equal((deck.items[1] as { accepted?: string[] }).accepted, undefined);
  applyPatches(deck, [{ id: "5", at: "", kind: "card", itemId: "a" }], (text) => `[${text}]`);
  assert.equal(deck.items[0].format, "card");
  assert.equal((deck.items[0] as { answer?: string }).answer, "[(1,2)\n(1, 2)]");
});

test("비슷한 목표: 강의 운영 안내끼리, 또는 낱말이 많이 겹치는 것", () => {
  assert.ok(similarity("회전 행렬의 부호를 말할 수 있다", "회전 행렬의 부호를 설명할 수 있다") >= 0.5);
  const list = [
    { id: "1", statement: "중간고사 반영 비율을 말할 수 있다" },
    { id: "2", statement: "출석 점수 기준을 말할 수 있다" },
    { id: "3", statement: "동차좌표의 의미를 설명할 수 있다" },
  ];
  assert.deepEqual(similarObjectives({ id: "0", statement: "성적 평가 비율을 말할 수 있다" }, list), ["1", "2"]);
  assert.deepEqual(similarObjectives({ id: "0", statement: "동차좌표의 의미를 말할 수 있다" }, list), ["3"]);
});

test("장부: 줄 형식, 원인별 집계, 메모 절 앞에 덧붙이기", () => {
  const line = ledgerLine({ at: "2026-10-15T14:03:00.000Z", deck: "그래픽스 02", item: "q-s4-o9", signal: "내 답도 맞아요", action: "정답 추가 \"(1,2)\"", cause: "인정답안누락" });
  assert.equal(line, "- 2026-10-15 14:03 | 그래픽스 02 · q-s4-o9 | 내 답도 맞아요 → 정답 추가 \"(1,2)\" | 원인: 인정답안누락 [단답-1]");
  const first = appendLedger(null, [line]);
  const withMemo = first + "\n## 메모\n\n사람 메모\n";
  const next = appendLedger(withMemo, [line.replace("인정답안누락 [단답-1]", "형식선택 [단답-1]")]);
  assert.ok(next.indexOf("형식선택") < next.indexOf("## 메모"));
  assert.match(next, /사람 메모/);
  assert.deepEqual(ledgerCounts(next), { 인정답안누락: 1, 형식선택: 1 });
});

test("너무 쉬움: 서로 다른 날 연속으로 혼자 맞힌 횟수", () => {
  const day = 864e5;
  const ok = (t: number) => ({ t, item: "a", kind: "rate", rating: "remembered" });
  assert.equal(tooEasy([ok(0), ok(day), ok(2 * day), ok(3 * day)], "a", 4), true);
  assert.equal(tooEasy([ok(0), ok(1000), ok(2 * day), ok(3 * day)], "a", 4), false);
  assert.equal(tooEasy([ok(0), ok(day), { t: 2 * day, item: "a", kind: "reveal" }, ok(3 * day)], "a", 4), false);
});

test("저장소의 학습규칙/품질.md는 경고 없이 읽힌다", () => {
  const { rules, warnings } = parseRules(readFileSync(new URL("../../../학습규칙/품질.md", import.meta.url), "utf8"));
  assert.deepEqual(warnings, []);
  assert.equal(rules.easyStreak, 4);
  assert.equal(rules.candidateThreshold, 3);
});
