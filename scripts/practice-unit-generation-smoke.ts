import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage, type ApiTokenUsage } from "../src/lib/api-usage.ts";
import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import { runCardGeneration } from "../src/lib/pipeline/generate.ts";
import type {
  ActivityDesign,
  AnalysisResult,
  Card,
  LearningActivityType,
  LearningOperation,
  LearningSupportLevel,
  LearningUnit,
  OrganizedMaterial,
} from "../src/lib/types.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const targetDirectory = path.resolve("eval/local/learning-target-v2");
const outlineDirectory = path.resolve("eval/local/analyze-outline-v1");
const outputDirectory = path.resolve("eval/local/question-plan-optimization-v1");
const argv = process.argv.slice(2);

function option(name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const variant = option("--variant") ?? "coverage_first";
const designOnly = argv.includes("--design-only");
const requested = argv.filter(
  (value, index) =>
    !value.startsWith("--") && argv[index - 1] !== "--variant",
);

const defaultCases = ["bill-of-rights", "opic", "dfs-bfs", "calculus-problems"];
const selectedCases = requested.length > 0 ? requested : defaultCases;
const variantInstructions: Record<string, string> = {
  coverage_first: [
    "근거 분할 관점으로 설계하세요.",
    "각 learningUnit의 evidenceNodeIds를 먼저 모두 확인하고, 각 근거를 적어도 하나의 practiceUnit에 배치하세요.",
    "하나의 근거가 여러 practiceUnit에 꼭 필요한 공통 맥락인 경우에만 중복 사용하세요.",
    "근거 ID를 새로 만들거나 다른 learningUnit의 근거를 가져오지 마세요.",
  ].join("\n"),
  answer_boundary: [
    "정답 경계 관점으로 설계하세요.",
    "각 practiceUnit에서 학습자가 한 번에 내야 할 정답을 먼저 머릿속으로 구성하세요.",
    "그 정답 안에 서로 독립적으로 맞거나 틀릴 수 있는 결과가 여러 개라면 practiceUnit을 나누세요.",
    "하나의 공통 관계·순서·분류 전체가 정답인 경우에만 여러 요소를 한 practiceUnit으로 유지하세요.",
  ].join("\n"),
  interaction_first: [
    "지원 화면 역산 관점으로 설계하세요.",
    "네 가지 화면 중 하나에서 한 번의 상호작용으로 직접 연습하고 채점할 수 있는 가장 큰 범위를 찾으세요.",
    "화면에 맞추려고 원래 목표를 단순 사실 확인으로 바꾸지 마세요.",
    "어떤 화면도 원래 행동을 직접 받지 못하면 partial 또는 unsupported로 남기세요.",
  ].join("\n"),
};
if (!variantInstructions[variant]) {
  throw new Error(`알 수 없는 실험 관점입니다: ${variant}`);
}

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

type OutlineNode = {
  id: string;
  title: string;
  summary: string;
  sourceRange: string;
};

type TargetArtifact = {
  source: { id: string; filename: string; outlineArtifactPath?: string };
  result: {
    learningGoal: string;
    chunks: Array<{
      id: string;
      title: string;
      learningTargets: Array<{
        target: string;
        operation: LearningOperation;
        successCriterion: string;
        evidenceNodeIds: string[];
      }>;
    }>;
  };
};

type OutlineArtifact = {
  result: { nodes: OutlineNode[] };
};

type PracticeUnit = {
  id: string;
  task: string;
  operation: LearningOperation;
  successCriterion: string;
  sourceNodeIds: string[];
  finalContent: string;
  supportLevel: LearningSupportLevel;
  recommendedType: LearningActivityType | null;
  reason: string;
  limitation: string;
};

type PracticeUnitDesign = {
  units: Array<{
    learningUnitId: string;
    practiceUnits: PracticeUnit[];
  }>;
};

const practiceUnitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["units"],
  properties: {
    units: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["learningUnitId", "practiceUnits"],
        properties: {
          learningUnitId: { type: "string" },
          practiceUnits: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "task",
                "operation",
                "successCriterion",
                "sourceNodeIds",
                "finalContent",
                "supportLevel",
                "recommendedType",
                "reason",
                "limitation",
              ],
              properties: {
                id: { type: "string" },
                task: { type: "string" },
                operation: {
                  type: "string",
                  enum: ["recall", "reconstruct", "discriminate", "apply"],
                },
                successCriterion: { type: "string" },
                sourceNodeIds: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string" },
                },
                finalContent: { type: "string" },
                supportLevel: {
                  type: "string",
                  enum: ["supported", "partial", "unsupported"],
                },
                recommendedType: {
                  type: ["string", "null"],
                  enum: [
                    "flashcard",
                    "true_false",
                    "multiple_choice",
                    "structure_recall",
                    null,
                  ],
                },
                reason: { type: "string" },
                limitation: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const supportDescription = [
  "현재 앱이 실제로 제공하는 문제 방식은 아래 네 가지뿐입니다.",
  "1. flashcard: 고정된 단서 하나를 보고 짧고 안정된 정답을 머릿속으로 떠올린 뒤, 정답을 공개하여 사용자가 스스로 확인합니다. 계산 과정, 코드, 자유서술, 말하기, 그림, 실제 수행을 입력받거나 자동채점하지 못합니다.",
  "2. true_false: 명제 하나를 보고 O/X 중 하나를 누르면 정답 여부를 자동채점합니다.",
  "3. multiple_choice: 미리 제시된 서로 겹치지 않는 선택지 중 하나를 고르면 자동채점합니다.",
  "4. structure_recall: 자료에 고정된 순서·상하관계·분류 구조의 빈 라벨들을 복원하면 자동채점합니다. 서로 다른 라벨이 최소 2개 있어야 합니다.",
  "이 네 형식으로 원래 목표 행동을 직접 연습하고 채점할 수 있으면 supported입니다.",
  "원래 목표의 선행 지식이나 일부 능력만 연습할 수 있으면 partial입니다.",
  "형식을 바꾸는 순간 원래 목표가 사라지거나 단일 정답으로 채점할 수 없으면 unsupported입니다.",
  "Apply 목표를 단순한 사실 확인 OX나 객관식으로 바꿔 놓고 supported라고 판단하지 마세요.",
].join("\n");

const designRules = [
  "입력의 각 learningUnit은 기존 엔진이 확정한 학습 목표입니다. 이 목표 자체는 수정하지 않습니다.",
  "먼저 한 번의 집중된 문제에서 성공 여부를 판정하기에 이미 적당한 범위인지 봅니다. 적당하면 practiceUnit 하나로 유지합니다.",
  "서로 독립적으로 성공·실패를 판정할 수 있는 여러 수행 범위가 들어 있을 때만 여러 practiceUnit으로 나눕니다.",
  "한 task가 여러 독립 항목·행·대상을 나열하고 각 항목을 따로 맞거나 틀릴 수 있다면, 그것은 한 문제가 아니라 여러 practiceUnit입니다.",
  "반대로 하나의 공통 순서·상하관계·분류 체계 전체를 복원하는 것이 목표라면 그 관계는 한 practiceUnit으로 유지합니다.",
  "지원되는 문제를 억지로 만들기 위해 목표를 잘게 나누지 않습니다.",
  "여러 practiceUnit은 함께 원래 learningUnit의 의미를 빠짐없이 보존해야 하고 서로 중복되면 안 됩니다.",
  "task는 한 번의 문제에서 학습자에게 실제로 시킬 행동 하나만 적습니다.",
  "finalContent에는 그 문제와 정답을 원문에 근거해 만들 수 있는 완결된 학습 내용만 적습니다. 문제 문구, 보기 기호, 빈칸, 정답표를 미리 만들지 않습니다.",
  "하나의 finalContent를 보고 정확한 문제 하나를 만들 수 있어야 하며, 생성기가 그중 일부만 골라야 할 정도로 여러 독립 문제 후보를 넣지 않습니다.",
  "sourceNodeIds는 해당 learningUnit이 제공한 근거 노드 중 실제로 사용한 것만 적습니다.",
  "operation과 successCriterion은 practiceUnit의 task에 맞춰 정합니다.",
  "partial이면 가능한 보조 훈련 형식을 recommendedType에 적고 limitation에서 원래 목표와의 차이를 분명히 밝힙니다.",
  "unsupported이면 recommendedType은 null입니다.",
].join("\n");

function extractOutputText(data: unknown) {
  if (data && typeof data === "object" && "output_text" in data && typeof data.output_text === "string") {
    return data.output_text;
  }
  const output = (data as { output?: Array<{ content?: Array<unknown> }> }).output;
  const item = output?.flatMap((entry) => entry.content ?? []).find(
    (entry): entry is { text: string } =>
      entry !== null && typeof entry === "object" && "text" in entry && typeof entry.text === "string",
  );
  if (!item) throw new Error("OpenAI 응답에서 구조화 출력 텍스트를 찾지 못했습니다.");
  return item.text;
}

async function latestFile(directory: string, suffix: string) {
  const filename = (await fs.readdir(directory))
    .filter((item) => item.endsWith(suffix))
    .sort()
    .at(-1);
  if (!filename) throw new Error(`${suffix}: 실험 결과가 없습니다.`);
  return path.join(directory, filename);
}

function validateDesign(
  sourceUnits: Array<{ id: string; evidenceNodeIds: string[] }>,
  design: PracticeUnitDesign,
) {
  const expectedIds = sourceUnits.map((unit) => unit.id);
  const actualIds = design.units.map((unit) => unit.learningUnitId);
  if (
    expectedIds.length !== actualIds.length ||
    new Set(actualIds).size !== actualIds.length ||
    expectedIds.some((id) => !actualIds.includes(id))
  ) {
    throw new Error("기존 학습단위와 연습범위 설계의 연결이 일치하지 않습니다.");
  }
  const practiceIds = design.units.flatMap((unit) => unit.practiceUnits.map((practice) => practice.id));
  if (new Set(practiceIds).size !== practiceIds.length) {
    throw new Error("중복된 practiceUnit ID가 있습니다.");
  }
  for (const unit of design.units) {
    const source = sourceUnits.find((item) => item.id === unit.learningUnitId)!;
    const allowedNodeIds = new Set(source.evidenceNodeIds);
    const coveredNodeIds = new Set<string>();
    for (const practice of unit.practiceUnits) {
      if (!practice.task.trim() || !practice.successCriterion.trim() || !practice.finalContent.trim()) {
        throw new Error(`${practice.id}: 문제 구성에 필요한 내용이 비어 있습니다.`);
      }
      if (practice.sourceNodeIds.some((id) => !allowedNodeIds.has(id))) {
        throw new Error(`${practice.id}: 원래 학습단위 밖의 근거를 참조했습니다.`);
      }
      for (const id of practice.sourceNodeIds) coveredNodeIds.add(id);
      if (practice.supportLevel === "unsupported" && practice.recommendedType !== null) {
        throw new Error(`${practice.id}: 미지원 범위에 문제 방식이 지정되었습니다.`);
      }
      if (practice.supportLevel !== "unsupported" && practice.recommendedType === null) {
        throw new Error(`${practice.id}: 지원 또는 부분 지원 범위에 문제 방식이 없습니다.`);
      }
    }
    const missingNodeIds = source.evidenceNodeIds.filter((id) => !coveredNodeIds.has(id));
    if (missingNodeIds.length > 0) {
      throw new Error(`${unit.learningUnitId}: 문제 계획에서 빠진 근거가 있습니다: ${missingNodeIds.join(", ")}`);
    }
  }
}

function toLearningUnit(
  sourceName: string,
  nodeById: Map<string, OutlineNode>,
  parentId: string,
  practice: PracticeUnit,
): LearningUnit {
  const sourceRanges = practice.sourceNodeIds
    .map((id) => nodeById.get(id)?.sourceRange)
    .filter((value): value is string => Boolean(value));
  const groundedContent = practice.sourceNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is OutlineNode => Boolean(node))
    .map((node) => `${node.title}: ${node.summary}`)
    .join("\n");
  return {
    id: `${parentId}::${practice.id}`,
    sourceId: sourceName,
    sourcePage: 0,
    sourceRange: sourceRanges.join("; "),
    sourceText: groundedContent,
    reviewedText: groundedContent,
    knowledgeType: "other",
    fixedPart: "",
    variableSlots: [],
    generalizedForm: "",
    target: practice.task,
    operation: practice.operation,
    successCriterion: practice.successCriterion,
    rationale: `기존 학습단위 ${parentId}의 문제 연습 범위`,
  };
}

function machineIssues(cards: Card[], expectedUnits: LearningUnit[], design: ActivityDesign) {
  const typeById = new Map(
    design.recommendations
      .filter((item) => item.includeInGeneration)
      .map((item) => [item.learningUnitId, item.recommendedType]),
  );
  const issues = cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  const expectedIds = expectedUnits.map((unit) => unit.id);
  if (cards.length !== expectedIds.length) issues.push("지원 연습범위 수와 생성 문제 수가 다릅니다.");
  for (const card of cards) {
    if (!card.learningUnitId || !expectedIds.includes(card.learningUnitId)) {
      issues.push(`알 수 없는 learningUnitId: ${card.learningUnitId ?? "없음"}`);
      continue;
    }
    if (card.activityType !== typeById.get(card.learningUnitId)) {
      issues.push(`${card.learningUnitId}: 추천 방식과 실제 문제 방식이 다릅니다.`);
    }
    const source = expectedUnits.find((unit) => unit.id === card.learningUnitId)!;
    if (card.sourceId !== source.sourceId || card.sourceRange !== source.sourceRange) {
      issues.push(`${card.learningUnitId}: 문제 출처가 연습범위 출처와 다릅니다.`);
    }
  }
  return issues;
}

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const id of selectedCases) {
  const targetPath = await latestFile(targetDirectory, `-${id}.json`);
  const outlinePath = await latestFile(outlineDirectory, `-${id}.json`);
  const targetArtifact = JSON.parse(await fs.readFile(targetPath, "utf8")) as TargetArtifact;
  const outlineArtifact = JSON.parse(await fs.readFile(outlinePath, "utf8")) as OutlineArtifact;
  const nodeById = new Map(outlineArtifact.result.nodes.map((node) => [node.id, node]));
  const sourceUnits = targetArtifact.result.chunks.flatMap((chunk) =>
    chunk.learningTargets.map((target, index) => ({
      id: `${chunk.id}-T${index + 1}`,
      chunkTitle: chunk.title,
      target: target.target,
      operation: target.operation,
      successCriterion: target.successCriterion,
      evidenceNodeIds: target.evidenceNodeIds,
      evidence: target.evidenceNodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean),
    })),
  );

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: REASONING_EFFORT },
      input: [
        {
          role: "system",
          content:
            "당신은 확정된 학습 목표를 현재 앱이 실제로 제공할 수 있는 문제 연습 범위로 바꾸는 학습 설계자입니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                supportDescription,
                "",
                designRules,
                "",
                "이번 실험에서 사용할 설계 관점:",
                variantInstructions[variant],
                "",
                `자료 전체 학습 목표: ${targetArtifact.result.learningGoal}`,
                "",
                "기존 학습단위와 근거:",
                JSON.stringify(sourceUnits, null, 2),
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "practice_unit_design",
          strict: true,
          schema: practiceUnitSchema,
        },
      },
    }),
  });
  const responseData = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(responseData)}`);
  const design = JSON.parse(extractOutputText(responseData)) as PracticeUnitDesign;
  validateDesign(sourceUnits, design);
  const designUsage = parseApiTokenUsage(responseData, {
    sourceName: targetArtifact.source.filename,
    experimentId: `practice-unit-${runStamp}-${id}`,
    stage: "activity-design",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
  });

  const practiceWithParent = design.units.flatMap((unit) =>
    unit.practiceUnits.map((practice) => ({ parentId: unit.learningUnitId, practice })),
  );
  const supported = practiceWithParent.filter(
    ({ practice }) => practice.supportLevel === "supported" && practice.recommendedType !== null,
  );
  const learningUnits = practiceWithParent.map(({ parentId, practice }) =>
    toLearningUnit(targetArtifact.source.filename, nodeById, parentId, practice),
  );
  const supportedUnits = learningUnits.filter((unit) =>
    supported.some(({ parentId, practice }) => unit.id === `${parentId}::${practice.id}`),
  );
  const activityDesign: ActivityDesign = {
    recommendations: practiceWithParent.map(({ parentId, practice }) => ({
      learningUnitId: `${parentId}::${practice.id}`,
      supportLevel: practice.supportLevel,
      recommendedType: practice.recommendedType,
      reason: practice.reason,
      limitation: practice.limitation,
      includeInGeneration: practice.supportLevel === "supported",
    })),
  };
  const analysis: AnalysisResult = {
    detectedGoal: targetArtifact.result.learningGoal,
    sourceType: "mixed",
    keyTopics: targetArtifact.result.chunks.map((chunk) => chunk.title),
    recommendedStrategy: "현재 앱이 직접 연습하고 채점할 수 있는 범위만 문제로 생성",
    learningUnits,
  };
  const material: OrganizedMaterial = {
    title: targetArtifact.source.filename,
    sections: learningUnits.map((unit) => ({
      heading: unit.target ?? unit.id,
      content: unit.reviewedText ?? unit.sourceText,
      learningUnitIds: [unit.id],
    })),
  };

  const cardUsage: ApiTokenUsage[] = [];
  const generation = supportedUnits.length > 0 && !designOnly
    ? await runCardGeneration(
        "flashcard",
        material,
        analysis,
        "확정된 연습범위의 내용과 출처만 사용해 한 연습범위당 문제 하나를 생성한다.",
        "",
        "",
        "",
        "",
        JSON.stringify(activityDesign),
        {
          activitySelectionMode: "automatic",
          cards: {
            model: MODEL,
            reasoningEffort: REASONING_EFFORT,
            compactInput: true,
            sourceName: targetArtifact.source.filename,
            experimentId: `practice-unit-cards-${runStamp}-${id}`,
            onUsage: (usage) => {
              cardUsage.push(usage);
            },
          },
        },
      )
    : { cards: [], baselineTrace: { generatedCards: [], criticCards: [] } };
  const issues = designOnly
    ? []
    : machineIssues(generation.cards, supportedUnits, activityDesign);
  const result = {
    artifactType: "study-forge-practice-unit-generation-smoke",
    artifactVersion: "v1",
    completedAt: new Date().toISOString(),
    source: { id, filename: targetArtifact.source.filename, targetPath, outlinePath },
    experiment: { variant, designOnly },
    model: { name: MODEL, reasoningEffort: REASONING_EFFORT, criticEnabled: false },
    inputLearningUnits: sourceUnits,
    supportDescription,
    design,
    activityDesign,
    generatedCards: generation.cards,
    machineIssues: issues,
    usage: { design: designUsage, cards: cardUsage },
  };
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  summary.push({
    id,
    variant,
    designOnly,
    outputPath,
    inputUnitCount: sourceUnits.length,
    practiceUnitCount: practiceWithParent.length,
    supportedCount: supported.length,
    generatedCardCount: generation.cards.length,
    machineIssues: issues,
    designUsage,
    cardUsage,
  });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({ summaryPath }));
