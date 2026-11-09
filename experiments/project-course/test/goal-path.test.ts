import { test } from "node:test";
import assert from "node:assert/strict";
import { goalPath } from "../lib/goal-path.ts";

const L = (kind: string, text: string, at = "2026-11-09T00:00:00Z") => ({ at, kind, text });

test("goalPath: 확정 → 다듬기 → 판정 · 막힘 · 보충 → 마침 → 다음 목표 → 학습 종료", () => {
  const p = goalPath([
    L("survey", "q"), L("plan", "장기"), L("confirm", "장기"),
    L("current", "리스트 만들기"),
    L("apply-check", "리스트 만들기: 일부만 맞음 · 빠진 곳: 인덱스 · 학습자 답: \"a[1]\""),
    L("stuck", "용어를 몰라요 · 인덱스가 뭐예요"),
    L("support", "인덱스 세기 / 음수 인덱스"),
    L("support-done", "인덱스 세기: 맞음"), L("support-back", "리스트 만들기"), L("support-close", "리스트 만들기"),
    L("applied", "리스트 만들기"), L("next", "리스트 만들기: 마침"),
    L("current", "딕셔너리: 키로 찾기"), L("understood", "딕셔너리: 키로 찾기"),
    L("end", "딕셔너리: 키로 찾기: 건너뜀(이해 ✓, 적용 –)"),
  ], null);
  assert.equal(p.length, 2);
  assert.equal(p[0].title, "리스트 만들기");
  assert.equal(p[0].result, "마침");
  assert.deepEqual(p[0].events.map((e) => e.kind), ["check", "stuck", "support", "support-done", "back", "applied"]);
  assert.match(p[0].events[0].text, /일부만 맞음 · 빠진 곳: 인덱스$/);
  assert.equal(p[1].title, "딕셔너리: 키로 찾기");
  assert.equal(p[1].result, "멈춤");
});

test("goalPath: 확정의 첫 목표는 끝날 때의 이름으로, 진행 중 목표 · 너무 쉬움", () => {
  const p = goalPath([L("confirm", "장기"), L("easy", "첫"), L("next", "첫 목표: 너무 쉬워서 넘어감"), L("current", "둘째")], { title: "둘째" });
  assert.deepEqual(p.map((g) => [g.title, g.result]), [["첫 목표", "너무 쉬움"], ["둘째", "진행 중"]]);
  const q = goalPath([L("confirm", "장기")], { title: "처음" });
  assert.deepEqual(q.map((g) => [g.title, g.result]), [["처음", "진행 중"]]);
});
