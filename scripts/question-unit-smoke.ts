import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
} from "../src/lib/model-config.ts";
import { createCompactActivityDesignInput } from "../src/lib/pipeline/compact-input.ts";
import { selectLearningUnitsForCards } from "../src/lib/pipeline/generate.ts";
import type {
  AnalysisResult,
  OrganizedMaterial,
} from "../src/lib/types.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit missing-key check below gives the useful error.
}

const cases = [
  {
    id: "opic",
    prepared: "eval/local/plan-prepare-v1/quality-v1-opic-selection-a2.json",
    advice:
      "7개 인물 묘사 패턴을 새 인물 정보에 맞게 영어로 직접 만들어 쓰는 단위를 우선한다. 흐름과 문법은 별도 보조 단위로 두고, 긴 완성 스크립트와 쉐도잉 절차는 제외한다.",
  },
  {
    id: "deadlocks",
    prepared: "eval/local/plan-prepare-v1/quality-v1-deadlocks-selection-a1.json",
    advice:
      "정의, 네 필요조건, 간선, 사이클과 인스턴스 판정, 예방·회피·탐지·복구가 빠지지 않게 나눈다. 실제 적용이 어렵더라도 판단 규칙과 절차를 별도 단위로 보존한다.",
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

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/question-unit-smoke");
await fs.mkdir(outputDirectory, { recursive: true });

for (const evalCase of cases) {
  const artifact = JSON.parse(
    await fs.readFile(path.resolve(evalCase.prepared), "utf8"),
  ) as {
    input: { learningGoal: string };
    prepare: { analysis: AnalysisResult; organizedMaterial: OrganizedMaterial };
  };
  const learningUnits = selectLearningUnitsForCards(
    artifact.prepare.analysis,
    artifact.prepare.organizedMaterial,
  );
  const compactInput = createCompactActivityDesignInput(
    artifact.prepare.analysis,
    learningUnits,
  );
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
            "당신은 문제를 만드는 사람이 아니라, 확정된 학습 내용을 한 번의 문제에서 요구할 크기로 나누는 편집자입니다. 문제 문장·보기·힌트·문제 형식·채점표는 만들지 않습니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            `학습 목표: ${artifact.input.learningGoal}`,
            `사용자 방향: ${evalCase.advice}`,
            "",
            "확정된 학습 내용:",
            JSON.stringify(compactInput, null, 2),
            "",
            "분리 규칙:",
            "- 나중에 각 단위가 문제 하나가 됩니다.",
            "- 한 번의 시도에서 하나의 성공 또는 실패를 판정할 수 있는 크기로 나눕니다.",
            "- 서로 따로 틀릴 수 있는 지식·판단·표현은 나눕니다.",
            "- 관계·순서·대응 자체가 학습 대상이면 그 관계는 한 단위로 유지합니다.",
            "- 중요한 적용 내용이 현재 문제 방식으로 어렵더라도 삭제하지 않습니다.",
            "- 같은 내용을 표현만 바꾸어 중복하지 않습니다.",
            "- target에는 학습자가 나중에 해내야 할 한 가지를 씁니다.",
            "- answerContent에는 원문에서 정답으로 보존할 핵심 내용만 씁니다.",
            "- 실제 문제는 절대 작성하지 않습니다.",
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "question_units",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["units"],
            properties: {
              units: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id", "learningUnitId", "target", "answerContent",
                    "operation", "sourceRange",
                  ],
                  properties: {
                    id: { type: "string" },
                    learningUnitId: { type: "string" },
                    target: { type: "string" },
                    answerContent: { type: "string" },
                    operation: {
                      type: "string",
                      enum: ["recall", "reconstruct", "discriminate", "apply"],
                    },
                    sourceRange: { type: "string" },
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
  const result = JSON.parse(outputText(data)) as { units: unknown[] };
  const usage = parseApiTokenUsage(data, {
    sourceName: evalCase.id,
    experimentId: `question-unit-${evalCase.id}-${stamp}`,
    stage: "activity-design",
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  });
  const outputPath = path.join(
    outputDirectory,
    `question-unit-${evalCase.id}-${stamp}.json`,
  );
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-question-unit-smoke",
      completedAt: new Date().toISOString(),
      input: { learningGoal: artifact.input.learningGoal, advice: evalCase.advice },
      units: result.units,
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({
    id: evalCase.id,
    unitCount: result.units.length,
    usage,
    outputPath,
  }));
}
