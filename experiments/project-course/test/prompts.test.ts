// 고칠 수 있는 프롬프트(11/4): 자리표시 채우기, 빈 값 줄 빼기, 모르는 자리표시는 그대로
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, DEFAULT_FIXED, DEFAULT_TURN } from "../lib/prompts.ts";

test("자리표시를 채우고, 값이 빈 줄은 뺀다", () => {
  assert.equal(render("a {x}\n강사 메모: {m}\nb", { x: "1", m: "" }), "a 1\nb");
  assert.equal(render("{학습자상태}\n{막혔어요}\n{추가지시}", { 학습자상태: "[상태]", 막혔어요: "", 추가지시: "짧게" }), "[상태]\n짧게");
  assert.equal(render("그대로 {모름}", {}), "그대로 {모름}");
});
test("기본 틀은 지금까지 코드가 만들던 모양", () => {
  const out = render(DEFAULT_FIXED, { 코스이름: "인사 서버", 학습자목표: "", 코스순서: "1. 인사", 단계번호: "1", 단계이름: "인사", 단계목표: "이름으로 인사", 가르칠것: "쿼리", 고칠곳: "greet", 강사메모: "", 숨길것: "정답" });
  assert.match(out, /^\[코스\] 인사 서버\n1\. 인사\n\n\[이번 단계\] 1단계 인사 — 이름으로 인사/);
  assert.doesNotMatch(out, /강사 메모/);
  assert.ok(DEFAULT_TURN.includes("{막혔어요}") && DEFAULT_TURN.includes("{추가지시}"));
});
