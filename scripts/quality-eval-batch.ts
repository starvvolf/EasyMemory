import fs from "node:fs/promises";
import path from "node:path";

import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import {
  runActivityDesign,
  runCardGeneration,
} from "../src/lib/pipeline/generate.ts";
import type {
  AnalysisResult,
  OrganizedMaterial,
  WholeDocumentCorePlan,
} from "../src/lib/types.ts";
import { runPlanPrepareSmoke } from "./plan-prepare-smoke.ts";
import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import { GenerationPreflightError } from "../src/lib/pipeline/preflight.ts";
import {
  assertQualityEvalBudget,
  createQualityEvalExecutionPlan,
  qualityEvalStages,
  type QualityEvalStage,
} from "./quality-eval-plan.ts";
import { getGitInfo, promptChecksums, sha256 } from "./eval-runner.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The selected pipeline reports a missing key before its first API request.
}

type EvalCase = {
  id: string;
  pdf: string;
  goal: string;
  problemAdvice: string;
  selectedAttempt: 1 | 2;
};

const cases: EvalCase[] = [
  {
    id: "opic",
    selectedAttempt: 2,
    pdf: "eval/corpus/generation-quality-v1/speaking-opic-person-description.pdf",
    goal:
      "OPIc 인물 묘사 질문을 받았을 때 공통 답변 흐름을 떠올리고, 말하려는 의미에 맞는 영어 패턴의 변수 자리를 바꾸어 직접 말할 수 있다.",
    problemAdvice:
      "이 자료의 핵심은 7개 인물 묘사 패턴을 새로운 인물 정보에 맞게 바꾸어 영어로 직접 만들어 쓰는 것입니다. 한국어 의도와 새 인물 정보를 보고 영어 표현을 떠올리는 플래시카드를 각 핵심 패턴에 우선 배치하세요. 답변 순서와 문법을 알아보는 문제만 반복하지 말고, he/she·his/her와 3인칭 단수 동사 형태를 실제 영어 답에 적용하게 하세요. 음성 채점이 어려우면 영어 문장을 통암기하는 플래시카드로 남기고, 긴 완성 스크립트와 쉐도잉 절차는 우선순위를 낮추세요.",
  },
  {
    id: "deadlocks",
    selectedAttempt: 1,
    pdf: "eval/corpus/generation-quality-v1/technical-deadlocks.pdf",
    goal:
      "데드락의 개념과 네 발생 조건을 설명하고, 자원 할당 그래프와 시스템 상태를 보고 데드락 가능성을 판단하며, 예방·회피·탐지 및 복구의 차이를 구분할 수 있다.",
    problemAdvice:
      "데드락 정의와 네 필요조건뿐 아니라 요청·할당 간선, 사이클과 자원 인스턴스 수, 안전 상태, 예방·회피·탐지·복구의 판단 기준을 고르게 다루세요. 현재 화면으로 실제 그래프나 다단계 상태 판단을 직접 훈련하기 어렵다면 해당 핵심을 버리지 말고, 상황을 판단할 때 적용할 규칙과 절차를 플래시카드로 통암기하게 하세요. request-use-release 같은 주변 순서 문제만 남기지 마세요.",
  },
  {
    id: "bill-of-rights",
    selectedAttempt: 1,
    pdf: "eval/corpus/generation-quality-v1/history-bill-of-rights.pdf",
    goal:
      "반연방주의자의 요구, 매디슨의 제안, 최종 권리장전 사이에서 권리와 정부 권한 제한이 어떻게 이어지고 바뀌었는지 구분할 수 있다.",
    problemAdvice: "자료의 중심 대응 관계를 보존하고, 세 단계의 연결을 실제로 복원하게 하세요.",
  },
  {
    id: "moon-phases",
    selectedAttempt: 1,
    pdf: "eval/corpus/generation-quality-v1/science-moon-phases.pdf",
    goal:
      "태양·지구·달의 상대적 위치로 달의 위상이 생기는 이유를 설명하고, 지구 그림자나 구름이 원인이라는 오개념을 구분할 수 있다.",
    problemAdvice: "상대적 위치와 관찰 결과의 관계 및 대표 오개념 구분을 우선하세요.",
  },
  {
    id: "disaster-checklist",
    selectedAttempt: 1,
    pdf: "eval/corpus/generation-quality-v1/rules-disaster-checklist.pdf",
    goal:
      "재난 전 중요 기록을 어떻게 복사하고 보관해야 하는지와 재난 뒤 어떤 정보와 절차를 확인해야 하는지 판단할 수 있다.",
    problemAdvice: "실제 상황에서 행동 순서와 적절한 조치를 판단하도록 구성하세요.",
  },
  {
    id: "calculus-problems",
    selectedAttempt: 2,
    pdf: "eval/corpus/generation-quality-v1/unsupported-calculus-problems.pdf",
    goal:
      "이 자료가 요구하는 미적분 문제 해결 능력 중 현재 앱의 문제 방식으로 제대로 훈련할 수 있는 내용과 그렇지 않은 내용을 구분한다.",
    problemAdvice: "직접 풀이가 어려우면 공식과 적용 조건, 풀이 절차를 플래시카드로 보존하되 풀이 숙련으로 표시하지 마세요.",
  },
];

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numericArgument(name: string) {
  const value = argument(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name}에는 0 이상의 숫자가 필요합니다.`);
  }
  return parsed;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function evaluationError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  const detail = "detail" in error ? (error as Error & { detail?: unknown }).detail : undefined;
  const printableDetail = detail instanceof Error
    ? { name: detail.name, message: detail.message, cause: detail.cause }
    : detail;
  return {
    message: error.message,
    ...(printableDetail === undefined ? {} : { detail: printableDetail }),
  };
}

async function mapConcurrent<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

const requestedCaseIds = argument("--case")?.split(",").map((value) => value.trim()).filter(Boolean);
const selectedCases = requestedCaseIds
  ? cases.filter((item) => requestedCaseIds.includes(item.id))
  : cases;
if (selectedCases.length === 0) throw new Error("선택한 실험 자료를 찾을 수 없습니다.");

const requestedFrom = argument("--from") ?? "analyze";
if (!qualityEvalStages.includes(requestedFrom as QualityEvalStage)) {
  throw new Error(`지원하지 않는 시작 단계입니다: ${requestedFrom}`);
}
const phase = (argument("--phase") ?? "all") as "selection" | "activity" | "all";
const requestedTo = argument("--to") ?? (phase === "selection" ? "prepare" : "cards");
if (!qualityEvalStages.includes(requestedTo as QualityEvalStage)) {
  throw new Error(`지원하지 않는 종료 단계입니다: ${requestedTo}`);
}
const requestedAttempts = numericArgument("--attempts") ?? 1;
const compactInput = hasFlag("--compact-input");
const explicitPreparedArtifact = argument("--prepared-artifact");
if (explicitPreparedArtifact && selectedCases.length !== 1) {
  throw new Error("--prepared-artifact는 자료를 하나만 선택했을 때 사용할 수 있습니다.");
}
const currentPreparedPaths = new Map<string, string>();

function preparedArtifactPath(evalCase: EvalCase) {
  return currentPreparedPaths.get(evalCase.id) ??
    (explicitPreparedArtifact ? path.resolve(explicitPreparedArtifact) : path.resolve(
      "eval/local/plan-prepare-v1",
      `quality-v1-${evalCase.id}-selection-a${evalCase.selectedAttempt}.json`,
    ));
}
if (!["selection", "activity", "all"].includes(phase)) {
  throw new Error(`지원하지 않는 실험 단계 묶음입니다: ${phase}`);
}
if (phase === "selection" && !["analyze", "prepare"].includes(requestedFrom)) {
  throw new Error("selection 실험은 analyze 또는 prepare부터 시작할 수 있습니다.");
}
if (phase === "activity" && !["activity-design", "cards"].includes(requestedFrom)) {
  throw new Error("activity 실험은 activity-design 또는 cards부터 시작할 수 있습니다.");
}
const missingFrozenInputs = await Promise.all(
  selectedCases.map(async (item) => {
    if (requestedFrom === "analyze") return null;
    const preparedPath = preparedArtifactPath(item);
    try {
      const artifact = JSON.parse(await fs.readFile(preparedPath, "utf8")) as {
        analyze?: unknown;
        plan?: unknown;
        prepare?: unknown;
      };
      const missing = [] as QualityEvalStage[];
      if (requestedFrom === "plan" && !artifact.analyze) missing.push("analyze");
      if (requestedFrom === "prepare" && !artifact.plan) {
        missing.push("plan");
      }
      if (["activity-design", "cards"].includes(requestedFrom) && !artifact.prepare) {
        missing.push("prepare");
      }
      return missing.length > 0 ? { caseId: item.id, stages: missing } : null;
    } catch {
      return {
        caseId: item.id,
        stages: qualityEvalStages.slice(0, qualityEvalStages.indexOf(requestedFrom as QualityEvalStage)),
      };
    }
  }),
).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null));
const executionPlan = createQualityEvalExecutionPlan({
  caseIds: selectedCases.map((item) => item.id),
  fromStage: requestedFrom as QualityEvalStage,
  toStage: requestedTo as QualityEvalStage,
  phase,
  attempts: requestedAttempts,
  missingFrozenInputs,
  estimatedCostPerCallUsd:
    numericArgument("--estimate-sol-call-usd") !== undefined &&
    numericArgument("--estimate-terra-call-usd") !== undefined
      ? {
          sol: numericArgument("--estimate-sol-call-usd")!,
          terra: numericArgument("--estimate-terra-call-usd")!,
        }
      : undefined,
});
assertQualityEvalBudget(executionPlan, {
  maxSolCalls: numericArgument("--max-sol-calls"),
  maxTerraCalls: numericArgument("--max-terra-calls"),
  maxEstimatedCostUsd: numericArgument("--max-usd"),
});
if (executionPlan.missingFrozenInputs.length > 0 && !hasFlag("--dry-run")) {
  throw new Error(
    `고정할 앞 단계 결과가 없습니다: ${JSON.stringify(executionPlan.missingFrozenInputs)}`,
  );
}

if (hasFlag("--dry-run")) {
  console.log(JSON.stringify({ dryRun: true, networkCallsMade: 0, executionPlan }, null, 2));
  process.exit(0);
}

const outputDirectory = path.resolve("eval/local/generation-quality-v1");
await fs.mkdir(outputDirectory, { recursive: true });
const summary: Array<Record<string, unknown>> = [];
const runStamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const runtimeMetadata = {
  git: getGitInfo(process.cwd()),
  promptChecksums: await promptChecksums(process.cwd()),
};

async function runSelection(evalCase: EvalCase) {
  for (let attempt = 1; attempt <= requestedAttempts; attempt += 1) {
    const label = `quality-v2-${evalCase.id}-${runStamp}-selection-a${attempt}`;
    try {
      const args = [
        "--pdf",
        evalCase.pdf,
        "--goal",
        evalCase.goal,
        "--label",
        label,
      ];
      if (requestedFrom === "prepare") {
        args.push(
          "--reuse-plan",
          path.resolve(
            "eval/local/plan-prepare-v1",
            `quality-v1-${evalCase.id}-selection-a${evalCase.selectedAttempt}.json`,
          ),
        );
      }
      const result = await runPlanPrepareSmoke(args);
      currentPreparedPaths.set(evalCase.id, result.outputPath);
      console.log(JSON.stringify({ phase: "selection", id: evalCase.id, attempt, ...result }));
      summary.push({ phase: "selection", id: evalCase.id, attempt, status: "completed", ...result });
    } catch (error) {
      const failure = evaluationError(error);
      console.log(JSON.stringify({ phase: "selection", id: evalCase.id, attempt, status: "failed", ...failure }));
      summary.push({ phase: "selection", id: evalCase.id, attempt, status: "failed", ...failure });
    }
  }
}

async function runActivity(evalCase: EvalCase) {
  const preparedPath = preparedArtifactPath(evalCase);
  const artifact = JSON.parse(await fs.readFile(preparedPath, "utf8")) as {
    plan: WholeDocumentCorePlan;
    input: { learningGoal: string };
    prepare: {
      analysis: AnalysisResult;
      organizedMaterial: OrganizedMaterial;
    };
  };
  const preparedBytes = await fs.readFile(preparedPath);
  const pdfBytes = await fs.readFile(path.resolve(evalCase.pdf));

  for (let attempt = 1; attempt <= requestedAttempts; attempt += 1) {
    const label = `quality-v2-${evalCase.id}-${runStamp}-activity-a${attempt}`;
    const rawCardsPath = path.join(outputDirectory, `${label}-cards-raw.json`);
    let rawCardsSaved = false;
    try {
      const usage: ApiTokenUsage[] = [];
      const usageContext = {
        sourceName: path.basename(evalCase.pdf),
        experimentId: label,
        compactInput,
        instruction: `문제 만들기 방향:\n${evalCase.problemAdvice}`,
        onUsage: (record: ApiTokenUsage) => {
          usage.push(record);
        },
      };
      const existingActivityPath = path.resolve(
        "eval/local/generation-quality-v1",
        `quality-v1-${evalCase.id}-activity-a1.json`,
      );
      const existingActivityBytes = requestedFrom === "cards"
        ? await fs.readFile(existingActivityPath)
        : null;
      const activityDesign = existingActivityBytes
        ? (JSON.parse(existingActivityBytes.toString("utf8")) as {
            activityDesign: Awaited<ReturnType<typeof runActivityDesign>>;
          }).activityDesign
        : await runActivityDesign(
            artifact.prepare.analysis,
            artifact.prepare.organizedMaterial,
            usageContext,
          );
      const activityStagePath = path.join(outputDirectory, `${label}-activity-design.json`);
      await fs.writeFile(
        activityStagePath,
        `${JSON.stringify({
          artifactType: "study-forge-generation-quality-activity-design",
          artifactVersion: "v1",
          completedAt: new Date().toISOString(),
          source: {
            preparedPath,
            preparedChecksum: sha256(preparedBytes),
            pdfPath: path.resolve(evalCase.pdf),
            pdfSha256: sha256(pdfBytes),
          },
          lineage: {
            analyze: "frozen-legacy",
            plan: "frozen-legacy",
            prepare: "frozen-legacy",
            activityDesign: existingActivityBytes ? "frozen-legacy" : "executed",
          },
          runtime: runtimeMetadata,
          problemAdvice: evalCase.problemAdvice,
          activityDesign,
          usage,
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      if (requestedTo === "activity-design") {
        console.log(JSON.stringify({
          phase: "activity",
          id: evalCase.id,
          attempt,
          status: "completed",
          activityStagePath,
          recommendationCount: activityDesign.recommendations.length,
        }));
        summary.push({
          phase: "activity",
          id: evalCase.id,
          attempt,
          status: "completed",
          activityStagePath,
          recommendationCount: activityDesign.recommendations.length,
        });
        continue;
      }
      const guideline = JSON.stringify({
        wholeDocumentCore: artifact.plan,
        countPolicy: "soft_budget",
        learningUnitSoftBudget: { max: artifact.plan.maxLearningUnitCount },
      });
      const generation = await runCardGeneration(
        "flashcard",
        artifact.prepare.organizedMaterial,
        artifact.prepare.analysis,
        [
          `학습 목표:\n${artifact.input.learningGoal}`,
          `문제 만들기 방향:\n${evalCase.problemAdvice}`,
        ].join("\n\n"),
        guideline,
        "",
        "",
        "",
        JSON.stringify(activityDesign),
        {
          cards: usageContext,
          critic: usageContext,
          onCardsGenerated: async (cards) => {
            await fs.writeFile(
              rawCardsPath,
              `${JSON.stringify({
                artifactType: "study-forge-generation-quality-raw-cards",
                artifactVersion: "v1",
                completedAt: new Date().toISOString(),
                source: {
                  preparedPath,
                  preparedChecksum: sha256(preparedBytes),
                  pdfPath: path.resolve(evalCase.pdf),
                  pdfSha256: sha256(pdfBytes),
                  activityStagePath,
                },
                activityDesign,
                cards,
                usage,
              }, null, 2)}\n`,
              { encoding: "utf8", flag: "wx" },
            );
            rawCardsSaved = true;
          },
        },
      );
      const structuralIssues = generation.cards.flatMap((card) =>
        validateLearningActivity(card).map((issue) => ({ cardId: card.id, issue })),
      );
      const result = {
        artifactType: "study-forge-generation-quality-activity",
        artifactVersion: "v1",
        completedAt: new Date().toISOString(),
        source: {
          preparedPath,
          preparedChecksum: sha256(preparedBytes),
          pdfPath: path.resolve(evalCase.pdf),
          pdfSha256: sha256(pdfBytes),
          frozenActivityPath: existingActivityBytes ? existingActivityPath : null,
          frozenActivityChecksum: existingActivityBytes ? sha256(existingActivityBytes) : null,
        },
        lineage: {
          analyze: "frozen-legacy",
          plan: "frozen-legacy",
          prepare: "frozen-legacy",
          activityDesign: existingActivityBytes ? "frozen-legacy" : "executed",
          cards: "executed",
        },
        runtime: runtimeMetadata,
        problemAdvice: evalCase.problemAdvice,
        activityDesign,
        cards: generation.cards,
        usage,
        estimatedCostUsd: usage.reduce(
          (sum, record) => sum + (record.estimatedCostUsd ?? 0),
          0,
        ),
        observations: {
          learningUnitCount: artifact.prepare.analysis.learningUnits?.length ?? 0,
          recommendationCount: activityDesign.recommendations.length,
          generatedCount: generation.cards.length,
          activityTypeCounts: Object.fromEntries(
            ["flashcard", "true_false", "multiple_choice", "structure_recall"].map(
              (type) => [
                type,
                generation.cards.filter((card) => card.activityType === type).length,
              ],
            ),
          ),
          structuralIssues,
        },
      };
      const outputPath = path.join(outputDirectory, `${label}.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      console.log(JSON.stringify({ phase: "activity", id: evalCase.id, attempt, activityStagePath, outputPath, observations: result.observations }));
      summary.push({ phase: "activity", id: evalCase.id, attempt, status: "completed", activityStagePath, outputPath, observations: result.observations });
    } catch (error) {
      const failure = evaluationError(error);
      const rawCardsArtifact = rawCardsSaved ? rawCardsPath : null;
      console.log(JSON.stringify({ phase: "activity", id: evalCase.id, attempt, status: "failed", rawCardsArtifact, ...failure }));
      summary.push({ phase: "activity", id: evalCase.id, attempt, status: "failed", rawCardsArtifact, ...failure });
      if (error instanceof GenerationPreflightError) {
        summary.push({
          phase: "activity",
          id: evalCase.id,
          skippedRemainingAttempts: requestedAttempts - attempt,
          reason: "mechanical-preflight-failure",
        });
        break;
      }
    }
  }
}

if (phase === "all" || phase === "selection") {
  await mapConcurrent(selectedCases, 1, runSelection);
}
if (phase === "all" || phase === "activity") {
  await mapConcurrent(selectedCases, 1, runActivity);
}
await fs.writeFile(
  path.join(outputDirectory, `batch-${phase}-${runStamp}-summary.json`),
  `${JSON.stringify(summary, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" },
);
