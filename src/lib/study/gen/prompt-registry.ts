// 실험실 프롬프트 고치기 (11/5 사용자 "실험실에서 프롬프트 수정 가능하게"): the prompts a run may replace (input.lab.prompts[name]),
// with the step that uses them and the code's text. The topic summary's instructions depend on the topic's kind, so they are
// not listed (the 목차 → 카드 way has no topic summary call).
import { DIGEST_CARD, FLOW_AFTER, FLOW_WITH, MAP_CARD, OBJECTIVES_SYSTEM, PLAN_COMMON, PLAN_TASK, PLAN_TASK_CONCEPTS, PLAN_TASK_GOALS, SOURCE_EN, WRAP_SYSTEM } from "./digest.ts";
import { Q_CHOICE, Q_CLOZE, Q_EXPLAIN, Q_MATERIAL, Q_PICK, Q_PICK_GOALS, Q_SCORE, Q_WRITE } from "./quiz.ts";
import { SAME_ANSWER, VERIFY } from "./recaller.ts";
import { ORGANIZE } from "./cards.ts";

export type EditablePrompt = { name: string; step: string; label: string; text: string; when?: string;
  /** The text comes from a file at run time (출제기준): the lab takes it from the run's own call, between these marks. */
  fromCall?: { after: string; before?: string } };
export const EDITABLE_PROMPTS: EditablePrompt[] = [
  { name: "PLAN_COMMON", step: "rc-digest-plan", label: "목차 · 지시문(system)", text: PLAN_COMMON },
  { name: "PLAN_TASK_CONCEPTS", step: "rc-digest-plan", label: "목차 · 작업(항목까지)", text: PLAN_TASK_CONCEPTS, when: "목차 → 바로 카드, 개념 줄" },
  { name: "PLAN_TASK", step: "rc-digest-plan", label: "목차 · 작업(주제만)", text: PLAN_TASK, when: "목차 → 요약 → 카드" },
  { name: "PLAN_TASK_GOALS", step: "rc-digest-plan", label: "목차 · 작업(학습 목표 포함)", text: PLAN_TASK_GOALS, when: "goalsInPlan" },
  { name: "SOURCE_EN", step: "(모든 글 쓰는 호출)", label: "영어 자료 규칙", text: SOURCE_EN, when: "영어 자료" },
  { name: "ORGANIZE", step: "rc-digest-card", label: "카드 · 공통 지시(맨 앞, 쪽당 장수 등)", text: ORGANIZE },
  { name: "MAP_CARD", step: "rc-digest-card", label: "카드 · 항목에서 바로", text: MAP_CARD, when: "목차 → 바로 카드" },
  { name: "DIGEST_CARD", step: "rc-digest-card", label: "카드 · 요약 줄에서", text: DIGEST_CARD, when: "목차 → 요약 → 카드" },
  { name: "GUIDE_ORGANIZE", step: "rc-digest-card", label: "카드 · 정리 기준(출제기준 폴더, 맨 끝)", text: "", fromCall: { after: "[정리 기준]\n", before: "\n[영어 자료]" } },
  { name: "FLOW_WITH", step: "rc-digest-card", label: "흐름 카드 · 카드와 같이", text: FLOW_WITH, when: "flowCard with" },
  { name: "FLOW_AFTER", step: "rc-flow", label: "흐름 카드 · 카드 다음에", text: FLOW_AFTER, when: "flowCard after" },
  { name: "WRAP_SYSTEM", step: "rc-wrap", label: "개요·핵심 정리", text: WRAP_SYSTEM },
  { name: "OBJECTIVES_SYSTEM", step: "rc-q-goals", label: "학습 목표", text: OBJECTIVES_SYSTEM, when: "퀴즈" },
  { name: "Q_PICK_GOALS", step: "rc-q-pick", label: "출제할 카드 고르기(목표 있음)", text: Q_PICK_GOALS, when: "퀴즈" },
  { name: "Q_PICK", step: "rc-q-pick", label: "출제할 카드 고르기(목표 없음)", text: Q_PICK, when: "퀴즈" },
  { name: "Q_MATERIAL", step: "rc-q-material", label: "문제 재료(맞는 진술·오개념 쌍)", text: Q_MATERIAL, when: "퀴즈" },
  { name: "Q_CHOICE", step: "rc-q-choice", label: "객관식", text: Q_CHOICE, when: "퀴즈" },
  { name: "Q_SCORE", step: "rc-q-score", label: "객관식 보기 채점", text: Q_SCORE, when: "퀴즈" },
  { name: "Q_CLOZE", step: "rc-q-cloze", label: "빈칸", text: Q_CLOZE, when: "퀴즈" },
  { name: "Q_WRITE", step: "rc-q-write", label: "서술형", text: Q_WRITE, when: "퀴즈" },
  { name: "Q_EXPLAIN", step: "rc-q-explain", label: "해설·힌트", text: Q_EXPLAIN, when: "퀴즈" },
  { name: "VERIFY", step: "rc-check", label: "정답 확인(따로 풀기)", text: VERIFY, when: "퀴즈" },
  { name: "SAME_ANSWER", step: "rc-check", label: "빈칸 같은 답 판정", text: SAME_ANSWER, when: "퀴즈" },
];
