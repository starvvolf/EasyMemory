// 답 판정(2026-11-08 사용자 결정: "적용 과제의 답이 맞을 때만 적용 ✓", "판정 규칙을 넣는다").
// 일반 모델 — 튜터 한 차례 = 판정 → 행동. 실측: 협업/결과보고/실측_튜터답판정_D_20261108.md
// - RESPOND_RULE: 매 차례 맥락에 붙는 한 줄(튜터가 답하기 전에 스스로 판정하고 그에 맞게 말함). 상태는 안 바꾼다
// - judgeApply: [해 봤어요] 때만 따로 한 번 부르는 판정. 완료 조건 · 튜터가 낸 과제 · 학습자의 답(채팅 · 저장한 코드의 바뀐 줄)만 비교한다.
//   문제 종류별 엔진이 아니라 "완료 조건을 채웠나" 하나로 본다. 결과로 코드가 적용 ✓를 찍는다(goals.ts)
import { aiJson, S } from "./ai.ts";

// 11/8 밤 사용자 "결과 좋으면 오케이": 틀린 곳 짚기를 소크라테스식으로(평가 v3, 힌트에 정답 핵심 79–86% → 7–21%, 협업/결과보고/실측_소크라테스식힌트_D_20261108.md)
export const RESPOND_RULE = `[답에 반응하기] 학습자의 마지막 말이 직전 질문 · 과제에 대한 답이면, 먼저 그 질문과 지금 목표의 완료 조건이 요구한 것을 떠올리고, 학습자가 실제로 말한 것만으로 맞음 · 일부만 맞음 · 틀림 · 판단 근거 부족 중 하나로 판단한다. 요구한 것을 하나라도 빠뜨렸거나 뭉뚱그려 말했으면 일부만 맞음이다. 맞음이면 짧게 확인하고 이어 간다. 일부만 맞음 · 틀림이면 '맞아요'로 시작하지 않고, 맞은 부분은 구체적으로 인정한 뒤 소크라테스식으로 짚는다: 정답도, 정답에 들어갈 낱말 · 코드 · 이름도 말하지 않는다. 대신 학습자가 자기 답을 그대로 따라가 보거나 자기 말의 앞뒤를 비교해 스스로 어긋난 곳을 찾게 하는 질문을 하나만 한다. 질문 안에 정답을 넣거나 고를 보기로 정답을 주지 않는다. 판단 근거가 부족하면 무엇을 뜻하는지 짧게 되묻는다.`;

export const JUDGE_SYSTEM = `학습자의 마지막 말이 튜터가 바로 앞에 낸 질문 · 과제에 대한 답인지 보고, 답이면 지금 목표의 완료 조건에 비추어 판정한다.
verdict: correct(핵심이 다 맞음) · partial(맞은 부분이 있지만 핵심이 하나 이상 빠지거나 틀림) · incorrect(핵심이 틀림) · unclear(뜻이 모호하거나 이해했는지 판단할 근거가 부족) · not_answer(질문 · 요청 · 잡담).
right: 맞은 부분 한 구절(없으면 빈 글). gap: 빠지거나 틀린 부분이 무엇인지 한 문장(correct · not_answer면 빈 글). gap에는 정답 코드나 정답 자체를 쓰지 말고 무엇이 빠지거나 틀렸는지만 쓴다(이 판정은 튜터가 힌트를 주는 데 쓴다).
학습자가 실제로 말한 것만으로 판단한다. 학습자가 알 거라고 너그럽게 채우지 않는다.`;
export const JUDGE_SCHEMA = S.obj({ verdict: S.oneOf("correct", "partial", "incorrect", "unclear", "not_answer"), right: S.str, gap: S.str });
export type Verdict = { verdict: "correct" | "partial" | "incorrect" | "unclear" | "not_answer"; right: string; gap: string };
export const VERDICT_KO: Record<string, string> = { correct: "맞음", partial: "일부만 맞음", incorrect: "틀림", unclear: "판단 근거 부족", not_answer: "답이 아님" };

/** [해 봤어요] 판정. answer가 비면(한 게 안 보이면) AI를 부르지 않고 근거 부족 */
export async function judgeApply(unit: { title: string; done: string }, task: string, answer: string): Promise<Verdict & { ms: number; called: boolean }> {
  if (!answer.trim()) return { verdict: "unclear", right: "", gap: "학습자가 해 본 것(답 · 코드 저장)이 아직 안 보여요", ms: 0, called: false };
  const t0 = Date.now();
  const user = `[학습 목표]\n현재 목표: ${unit.title} — 완료 조건: ${unit.done} · 단계: ② 적용 중\n\n[최근 대화]\n튜터: ${task.slice(-3000)}\n\n[학습자] ${answer.slice(-6000)}`;
  const v = await aiJson<Verdict>("judge-apply", JUDGE_SYSTEM, user, JUDGE_SCHEMA);
  return { ...v, ms: Date.now() - t0, called: true };
}
