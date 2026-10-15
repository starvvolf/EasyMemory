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

test("용어 고르기: 같은 자료의 다른 용어가 오답, 같은 단원·비슷한 표기가 먼저, 문장·식은 제외", async () => {
  const { termChoice, termAnswer } = await import("./quality.ts");
  const card = (id: string, objectiveId: string, answer: string) => ({ id, objectiveId, format: "card", answer });
  const deck = {
    items: [card("q1", "o1", "자아 강도(Ego Strength)"), card("q2", "o2", "통제 위치(Locus of Control)"), card("q3", "o3", "내재론자(internal)"),
      card("q4", "o4", "외재론자(external)"), card("q5", "o5", "도덕적 의도를 실제 행동으로 옮기는 단계."), card("q6", "o6", "마키아벨리즘(Machiavellianism)"),
      card("q7", "o7", "윤리적 딜레마")],
    outline: [{ title: "개인 특성", objectives: ["o1", "o2", "o3", "o4", "o5"].map((id) => ({ id, kind: "용어" })) },
      { title: "다른 단원", objectives: [{ id: "o6", kind: "용어" }, { id: "o7", kind: "개념" }] }],
  };
  const pick = termChoice(deck, "q1", "2026-10-15")!;
  assert.equal(pick.options.length, 4);
  assert.equal(pick.options[pick.answer], "자아 강도(Ego Strength)");
  assert.ok(!pick.options.includes("도덕적 의도를 실제 행동으로 옮기는 단계."));
  assert.ok(!pick.options.includes("윤리적 딜레마"));
  assert.deepEqual(termChoice(deck, "q1", "2026-10-15"), pick);
  assert.equal(termChoice(deck, "q7", "x"), null);
  assert.equal(termAnswer("\\(P' = M_1 P\\)"), null);
  assert.equal(termAnswer("준법경영, 사회적 책임, 가치경영(윤리경영)"), null);
  assert.equal(termAnswer("pixel당 bit 수"), "pixel당 bit 수");
});
