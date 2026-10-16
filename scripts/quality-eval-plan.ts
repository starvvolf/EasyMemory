export const qualityEvalStages = [
  "analyze",
  "plan",
  "prepare",
  "activity-design",
  "cards",
] as const;

export type QualityEvalStage = (typeof qualityEvalStages)[number];
export type QualityEvalModelFamily = "sol" | "terra";
export type QualityEvalPhase = "selection" | "activity" | "all";

export type PlannedApiCall = {
  caseId: string;
  attempt: number;
  stage: QualityEvalStage;
  modelFamily: QualityEvalModelFamily;
  frozenStages: QualityEvalStage[];
};

export type QualityEvalExecutionPlan = {
  fromStage: QualityEvalStage;
  toStage: QualityEvalStage;
  phase: QualityEvalPhase;
  caseIds: string[];
  attempts: number;
  calls: PlannedApiCall[];
  solCalls: number;
  terraCalls: number;
  estimatedCostUsd: number | null;
  missingFrozenInputs: Array<{
    caseId: string;
    stages: QualityEvalStage[];
  }>;
};

const modelByStage: Record<QualityEvalStage, QualityEvalModelFamily> = {
  analyze: "terra",
  plan: "terra",
  prepare: "sol",
  "activity-design": "terra",
  cards: "terra",
};

export function createQualityEvalExecutionPlan(input: {
  caseIds: string[];
  fromStage: QualityEvalStage;
  toStage?: QualityEvalStage;
  phase?: QualityEvalPhase;
  attempts: number;
  estimatedCostPerCallUsd?: Partial<Record<QualityEvalModelFamily, number>>;
  missingFrozenInputs?: Array<{
    caseId: string;
    stages: QualityEvalStage[];
  }>;
}) {
  if (input.caseIds.length === 0) throw new Error("실험 자료가 한 개 이상 필요합니다.");
  if (!Number.isInteger(input.attempts) || input.attempts < 1) {
    throw new Error("반복 횟수는 1 이상의 정수여야 합니다.");
  }

  const phase = input.phase ?? "all";
  const start = qualityEvalStages.indexOf(input.fromStage);
  const toStage = input.toStage ?? qualityEvalStages.at(-1)!;
  const end = qualityEvalStages.indexOf(toStage);
  if (end < start) {
    throw new Error(`종료 단계 ${toStage}가 시작 단계 ${input.fromStage}보다 앞에 있습니다.`);
  }
  const allowedStages =
    phase === "selection"
      ? qualityEvalStages.slice(0, 3)
      : phase === "activity"
        ? qualityEvalStages.slice(3)
        : qualityEvalStages;
  const executedStages = qualityEvalStages
    .slice(start, end + 1)
    .filter((stage) => allowedStages.includes(stage));
  if (executedStages.length === 0) {
    throw new Error(`${phase} 실험에서 ${input.fromStage}부터 실행할 단계가 없습니다.`);
  }
  const frozenStages = qualityEvalStages.slice(0, start);
  const calls = input.caseIds.flatMap((caseId) =>
    Array.from({ length: input.attempts }, (_, attemptIndex) =>
      executedStages.map((stage) => ({
        caseId,
        attempt: attemptIndex + 1,
        stage,
        modelFamily: modelByStage[stage],
        frozenStages: [...frozenStages],
      })),
    ).flat(),
  );
  const solCalls = calls.filter((call) => call.modelFamily === "sol").length;
  const terraCalls = calls.length - solCalls;
  const solEstimate = input.estimatedCostPerCallUsd?.sol;
  const terraEstimate = input.estimatedCostPerCallUsd?.terra;
  const estimatedCostUsd =
    typeof solEstimate === "number" && typeof terraEstimate === "number"
      ? Math.round((solCalls * solEstimate + terraCalls * terraEstimate) * 1_000_000) /
        1_000_000
      : null;

  return {
    fromStage: input.fromStage,
    toStage,
    phase,
    caseIds: [...input.caseIds],
    attempts: input.attempts,
    calls,
    solCalls,
    terraCalls,
    estimatedCostUsd,
    missingFrozenInputs: input.missingFrozenInputs ?? [],
  } satisfies QualityEvalExecutionPlan;
}

export function assertQualityEvalBudget(
  plan: QualityEvalExecutionPlan,
  limits: {
    maxSolCalls?: number;
    maxTerraCalls?: number;
    maxEstimatedCostUsd?: number;
  },
) {
  if (limits.maxSolCalls !== undefined && plan.solCalls > limits.maxSolCalls) {
    throw new Error(
      `예정된 Sol 호출 ${plan.solCalls}회가 한도 ${limits.maxSolCalls}회를 초과합니다.`,
    );
  }
  if (limits.maxTerraCalls !== undefined && plan.terraCalls > limits.maxTerraCalls) {
    throw new Error(
      `예정된 Terra 호출 ${plan.terraCalls}회가 한도 ${limits.maxTerraCalls}회를 초과합니다.`,
    );
  }
  if (limits.maxEstimatedCostUsd !== undefined) {
    if (plan.estimatedCostUsd === null) {
      throw new Error("예상 단가가 없어 최대 예상 비용을 안전하게 검사할 수 없습니다.");
    }
    if (plan.estimatedCostUsd > limits.maxEstimatedCostUsd) {
      throw new Error(
        `예상 비용 $${plan.estimatedCostUsd.toFixed(4)}가 한도 $${limits.maxEstimatedCostUsd.toFixed(4)}를 초과합니다.`,
      );
    }
  }
}
