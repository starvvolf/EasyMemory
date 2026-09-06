import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
} from "../src/lib/model-config.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit missing-key check below gives the useful error.
}

type QuestionUnit = {
  id: string;
  learningUnitId: string;
  target: string;
  answerContent: string;
  operation: "recall" | "reconstruct" | "discriminate" | "apply";
  sourceRange: string;
};

type GeneratedProblem = {
  unitId: string;
  activityType: "flashcard" | "true_false" | "multiple_choice" | "structure_recall";
  front: string;
  back: string;
  options: string[];
  correctOptionIndex: number;
  correctBoolean: boolean;
  structureItems: string[];
  structureMode: "word_bank" | "free_input";
};

const cases = [
  {
    id: "opic",
    input: "eval/local/question-unit-smoke/question-unit-opic-2026-08-16T144054826Z.json",
  },
  {
    id: "deadlocks",
    input: "eval/local/question-unit-smoke/question-unit-deadlocks-2026-08-16T144054826Z.json",
  },
] as const;

function outputText(data: unknown) {
  if (
    typeof data === "object" && data !== null &&
    "output_text" in data && typeof data.output_text === "string"
  ) return data.output_text;
  const output = (data as { output?: Array<{ content?: Array<unknown> }> }).output;
  const item = output?.flatMap((value) => value.content ?? []).find(
    (value): value is { text: string } =>
      typeof value === "object" && value !== null &&
      "text" in value && typeof value.text === "string",
  );
  if (!item) throw new Error("구조화 출력 텍스트가 없습니다.");
  return item.text;
}

function validateProblems(units: QuestionUnit[], problems: GeneratedProblem[]) {
  const expectedIds = new Set(units.map((unit) => unit.id));
  const returnedIds = problems.map((problem) => problem.unitId);
  const uniqueReturnedIds = new Set(returnedIds);
  const missingIds = [...expectedIds].filter((id) => !uniqueReturnedIds.has(id));
  const unknownIds = [...uniqueReturnedIds].filter((id) => !expectedIds.has(id));
  const duplicateIds = returnedIds.filter(
    (id, index) => returnedIds.indexOf(id) !== index,
  );
  const invalidProblems = problems.flatMap((problem, index) => {
    const issues: string[] = [];
    if (!problem.front.trim()) issues.push("front가 비어 있음");
    if (problem.activityType === "flashcard" && !problem.back.trim()) {
      issues.push("flashcard 정답이 비어 있음");
    }
    if (problem.activityType === "multiple_choice") {
      if (problem.options.length < 2) issues.push("객관식 보기가 2개 미만");
      if (
        problem.correctOptionIndex < 0 ||
        problem.correctOptionIndex >= problem.options.length
      ) issues.push("객관식 정답 번호가 범위를 벗어남");
    }
    if (
      problem.activityType === "structure_recall" &&
      problem.structureItems.length < 2
    ) issues.push("구조복원 항목이 2개 미만");
    return issues.length > 0 ? [{ index, unitId: problem.unitId, issues }] : [];
  });

  return {
    isValid:
      problems.length === units.length && missingIds.length === 0 &&
      unknownIds.length === 0 && duplicateIds.length === 0 &&
      invalidProblems.length === 0,
    expectedCount: units.length,
    actualCount: problems.length,
    missingIds,
    unknownIds,
    duplicateIds: [...new Set(duplicateIds)],
    invalidProblems,
  };
}

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/question-unit-card-smoke");
await fs.mkdir(outputDirectory, { recursive: true });

for (const evalCase of cases) {
  const artifact = JSON.parse(
    await fs.readFile(path.resolve(evalCase.input), "utf8"),
  ) as {
    input: { learningGoal: string; advice: string };
    units: QuestionUnit[];
  };
  const units = artifact.units;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      reasoning: { effort: DEFAULT_REASONING_EFFORT },
      input: [
        {
          role: "system",
          content:
            "당신은 교사가 확정한 문제 단위를 실제 학습 문제로 바꾸는 출제자입니다. 각 단위는 이미 문제 하나의 크기로 분리되어 있습니다. 단위를 합치거나 다시 나누지 말고 정확히 한 문제씩 만드세요. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            `전체 학습 목표: ${artifact.input.learningGoal}`,
            `문제 방향: ${artifact.input.advice}`,
            "",
            "문제 단위:",
            JSON.stringify(units, null, 2),
            "",
            "출제 규칙:",
            "- 입력 단위 하나당 문제를 정확히 하나 만들고 unitId를 그대로 반환합니다.",
            "- 여러 단위를 한 문제로 합치거나 한 단위를 여러 문제로 늘리지 않습니다.",
            "- front만 보고 답이 드러나면 안 됩니다.",
            "- recall은 먼저 떠올리고 답을 확인하는 flashcard를 우선합니다.",
            "- discriminate는 OX나 객관식을 우선하고, 적용 가능한 짧은 상황을 제시합니다.",
            "- apply는 주어진 지식을 사용해야 풀리는 새롭고 구체적인 입력을 제시합니다. 현재 자동채점이 어렵다면 먼저 답한 뒤 back과 비교하는 flashcard로 만듭니다.",
            "- reconstruct는 관계나 순서가 실제 학습 대상일 때만 structure_recall을 사용합니다.",
            "- 문제와 정답은 answerContent의 범위를 벗어나지 않습니다.",
            "- 사용하지 않는 형식 필드는 빈 문자열, 빈 배열, 0, false로 반환합니다.",
            "- structureItems에는 정답 순서로 항목만 반환합니다. 화면에서 무작위로 섞습니다.",
            "- 짧고 명확하게 쓰고, 문제 제작 설명이나 메타 문구는 넣지 않습니다.",
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "question_unit_problems",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["problems"],
            properties: {
              problems: {
                type: "array",
                minItems: units.length,
                maxItems: units.length,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "unitId", "activityType", "front", "back", "options",
                    "correctOptionIndex", "correctBoolean", "structureItems",
                    "structureMode",
                  ],
                  properties: {
                    unitId: { type: "string" },
                    activityType: {
                      type: "string",
                      enum: [
                        "flashcard", "true_false", "multiple_choice",
                        "structure_recall",
                      ],
                    },
                    front: { type: "string" },
                    back: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correctOptionIndex: { type: "integer" },
                    correctBoolean: { type: "boolean" },
                    structureItems: {
                      type: "array",
                      items: { type: "string" },
                    },
                    structureMode: {
                      type: "string",
                      enum: ["word_bank", "free_input"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  const result = JSON.parse(outputText(data)) as { problems: GeneratedProblem[] };
  const validation = validateProblems(units, result.problems);
  const usage = parseApiTokenUsage(data, {
    sourceName: evalCase.id,
    experimentId: `question-unit-card-${evalCase.id}-${stamp}`,
    stage: "cards",
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  });
  const outputPath = path.join(
    outputDirectory,
    `question-unit-card-${evalCase.id}-${stamp}.json`,
  );
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-question-unit-card-smoke",
      completedAt: new Date().toISOString(),
      sourceArtifact: evalCase.input,
      input: artifact.input,
      units,
      problems: result.problems,
      validation,
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({
    id: evalCase.id,
    problemCount: result.problems.length,
    validation,
    usage,
    outputPath,
  }));
  if (!validation.isValid) {
    throw new Error(`${evalCase.id} 문제 결과가 기계 검사를 통과하지 못했습니다.`);
  }
}
