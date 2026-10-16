import type { AssessmentBlueprint, KnowledgeUnit } from "../../src/lib/types.ts";

type ChosenActivity = { blueprintId: string; includeInGeneration: boolean };

/** Advisory only: a mismatch asks for review, never changes the learner's selection or invents a task. */
export function inspectAbilityCoverage(
  abilities: readonly string[],
  blueprints: readonly AssessmentBlueprint[],
  activities: readonly ChosenActivity[],
  units: readonly KnowledgeUnit[],
): string[] {
  const active = new Set(activities.filter((item) => item.includeInGeneration).map((item) => item.blueprintId));
  const selected = blueprints.filter((item) => active.has(item.id));
  const warnings: string[] = [];
  if (abilities.includes("계산·적용하기") && !selected.some((item) => {
    const task = [...item.given.map((part) => part.description), item.expectedResponse.description].join(" ");
    return item.expectedResponse.kind === "numeric" ||
      /(?:계산|적용|구하|산출|대입|풀이)/.test(task) && /\d|값|결과|식|함수|좌표/.test(task);
  })) warnings.push("계산·적용하기를 선택했지만 실제 생성 대상에 계산·적용 과제가 없습니다. 자료에 맞는 과제를 설계했는지 확인하세요.");
  const hasProcedureTarget = units.some((unit) => unit.knowledgeType === "procedure" || /절차|순서|단계/.test(unit.content));
  if (abilities.includes("식·절차 쓰기") && hasProcedureTarget && !selected.some((item) => item.expectedResponse.kind === "ordered_structure")) {
    warnings.push("식·절차 쓰기를 선택했지만 실제 생성 대상에 순서 복원 과제가 없습니다. 절차가 학습 목표라면 순서형을 검토하세요.");
  }
  return warnings;
}
