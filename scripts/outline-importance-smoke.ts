import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const outputDirectory = path.resolve("eval/local/learning-target-v2");
const outlineDirectory = path.resolve("eval/local/analyze-outline-v1");

const cases = [
  "opic",
  "deadlocks",
  "dfs-bfs",
  "bill-of-rights",
  "moon-phases",
  "disaster-checklist",
  "calculus-problems",
] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["learningGoal", "goalReason", "chunks", "structuralNodeIds"],
  properties: {
    learningGoal: {
      type: "string",
      description: "사용자 목표가 없을 때 자료 전체에서 추론한 기본 학습 목표",
    },
    goalReason: {
      type: "string",
      description: "이 목표가 자료 전체를 가장 자연스럽게 설명하는 짧은 이유",
    },
    chunks: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "nodeIds",
          "importance",
          "reason",
          "learningTargets",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          nodeIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          importance: { type: "integer", minimum: 0, maximum: 3 },
          reason: { type: "string" },
          learningTargets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["target", "operation", "successCriterion", "evidenceNodeIds"],
              properties: {
                target: {
                  type: "string",
                  description: "이 덩어리에서 학습자가 가져가야 할 구체적인 대상",
                },
                operation: {
                  type: "string",
                  enum: ["recall", "reconstruct", "discriminate", "apply"],
                },
                successCriterion: {
                  type: "string",
                  description: "학습 성공을 관찰할 수 있는 한 문장 기준",
                },
                evidenceNodeIds: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    structuralNodeIds: {
      type: "array",
      description: "목차 제목처럼 하위 내용을 묶지만 자체 학습 덩어리는 아닌 노드 ID",
      items: { type: "string" },
    },
  },
} as const;

const prompt = [
  "아래 입력은 PDF 원문을 사실대로 구조화한 목차 지도입니다.",
  "이 목차를 바꾸거나 다시 요약하지 말고, 학습 관점에서 함께 다뤄야 할 항목들을 덩어리로 묶은 뒤 덩어리 단위로 중요도를 판단하세요.",
  "사용자가 별도 목표를 고르지 않은 자동 추천 상황이므로 자료가 실제로 만들려는 기본 학습 목표를 먼저 한 문장으로 정하세요.",
  "",
  "덩어리 구성 규칙:",
  "- 부모와 자식을 각각 별도 중요도로 평가하지 마세요. 하나의 완결된 내용을 함께 이루면 같은 덩어리에 넣으세요.",
  "- 여러 번호 항목이 합쳐져 하나의 체계·절차·패턴 집합을 이루면 한 덩어리로 유지하세요.",
  "- 같은 원리의 서로 다른 사례나 반복 적용은 하나의 덩어리로 묶으세요.",
  "- 서로 배우는 목적이 다르거나 각각 독립적으로 사용할 수 있는 큰 내용은 덩어리를 나누세요.",
  "- 한 덩어리는 ‘무엇을 익히는 부분인지’ 한 문장으로 자연스럽게 설명할 수 있어야 합니다.",
  "- 덩어리는 서로 겹치면 안 됩니다. 하나의 nodeId를 여러 덩어리에 넣지 마세요.",
  "- 자체 학습 내용 없이 하위 목차만 묶는 제목은 structuralNodeIds에 넣으세요.",
  "- 입력의 모든 nodeId는 chunks의 nodeIds 또는 structuralNodeIds 중 정확히 한 곳에 있어야 합니다.",
  "- 상위 목차 노드를 덩어리에 포함했다면 structuralNodeIds에 다시 넣지 마세요. 두 곳 중 하나만 선택합니다.",
  "",
  "중요도는 자료에서 많이 언급됐거나 먼저 배우는지가 아니라, 기본 학습 목표를 실제로 구성하는 정도에 따라 정하세요:",
  "- 3 핵심: 이 덩어리 자체가 최종 능력을 직접 수행하게 하거나, 여러 최종 결과를 만들어내는 공통 기반인 경우",
  "- 2 주요: 최종 능력에 필요한 중요한 구성요소이지만 그 자체가 최종 수행이나 여러 결과를 만드는 중심은 아닌 경우",
  "- 1 활용: 핵심을 보여주거나 이해·확인·연습을 돕지만, 이 덩어리 자체를 별도 학습 대상으로 삼지 않아도 목표 수행이 가능한 경우",
  "- 0 제외: 현재 목표와 무관하거나 다른 내용을 반복해 별도 학습 대상으로 만들 필요가 없는 덩어리",
  "",
  "판단 주의:",
  "- 예시, 문제, 전략, 연습이라는 형식만 보고 중요도를 고정하지 마세요. 추론한 학습 목표에서 실제로 하는 역할을 보세요.",
  "- 페이지 길이, 등장 순서, 반복 횟수만으로 점수를 높이지 마세요.",
  "- 중요도는 학습 순서나 난이도가 아닙니다. 뒤에서 배우는 적용·문제·수행이라도 최종 목표를 직접 실행한다면 3일 수 있습니다.",
  "- 반대로 먼저 배우는 정의나 안내라도 이후 학습을 돕는 구성요소일 뿐이면 2 또는 1일 수 있습니다.",
  "- 모든 것을 핵심으로 만들지 마세요. 3은 자료의 중심을 직접 구성하는 덩어리에만 사용하세요.",
  "- reason은 다른 덩어리와 비교해 왜 이 수준인지 한 문장으로 설명하세요.",
  "- 입력에 없는 nodeId나 지식을 만들지 마세요.",
  "",
  "중요도가 2 또는 3인 각 덩어리에서 실제 학습 대상을 learningTargets로 추출하세요:",
  "- target은 지식·방법·사례 같은 종류 이름이 아니라, 학습자가 가져가야 할 구체적인 대상을 자연어 한 문장으로 적습니다.",
  "- operation은 학습자가 그 대상에 대해 성공적으로 보여야 할 주 행동 하나만 고릅니다.",
  "- recall: 자료 없이 대상 자체를 말하거나 적습니다.",
  "- reconstruct: 자료에서 배운 고정된 구성요소의 관계나 순서를 같은 구조로 복원합니다.",
  "- discriminate: 조건을 보고 맞음·틀림 또는 적절한 대상을 판별합니다.",
  "- apply: 새로운 입력에 지식이나 규칙을 사용해 입력에 따라 달라지는 결과를 만듭니다.",
  "- 그래프·수치·상황 등 새로운 입력에 따라 정답이 달라지면 순서를 쓰더라도 reconstruct가 아니라 apply입니다.",
  "- 절차의 순서 자체를 자료 없이 재현하는 목표는 reconstruct이지만, 그 절차를 실제 상황에서 실행하는 목표는 apply입니다.",
  "- target과 successCriterion은 같은 행동을 말해야 합니다. ‘실행한다’는 target을 ‘순서를 설명한다’는 기준으로 바꾸지 마세요.",
  "- operation은 난이도 순서가 아니며 문제 형식도 아닙니다.",
  "- successCriterion에는 무엇을 하면 배웠다고 볼 수 있는지 관찰 가능한 행동으로 적습니다.",
  "- 보조 operation을 붙이지 마세요. 서로 독립적으로 성공하거나 실패할 수 있는 목표가 둘이면 learningTargets를 둘로 나눕니다.",
  "- 하나의 target과 successCriterion에는 독립적으로 성공·실패를 판정할 수 있는 행동 하나만 둡니다.",
  "- ‘A를 하거나 B를 한다’처럼 서로 다른 성공 방법을 하나로 묶지 마세요. 결과 산출과 구현처럼 각각 따로 평가할 수 있으면 learningTargets를 나눕니다.",
  "- 하나의 learningTarget은 보통 한 번의 집중된 연습에서 하나의 질문과 하나의 답으로 성공 여부를 판단할 수 있는 크기여야 합니다.",
  "- 한 target에 서로 독립적인 여러 결과·규칙·판단이 들어가 일부만 맞을 수 있다면 learningTargets를 나눕니다.",
  "- 단, 여러 요소의 순서·분류·대응 관계 전체를 복원하거나 하나의 공통 틀을 완성하는 것이 목표라면 요소 수만 보고 쪼개지 않습니다.",
  "- 긴 장 전체를 한 번에 모두 재현하게 하지 말고, 목차 안에서 실제로 함께 다루는 의미 단위 중 한 번에 연습 가능한 가장 큰 단위로 만듭니다.",
  "- 설명·이유·예시·연습 방법은 중심 목표를 돕는다는 이유만으로 별도 target으로 만들지 마세요. 그 내용 자체를 보존하거나 수행해야 목표가 완성될 때만 target으로 둡니다.",
  "- importance가 0 또는 1인 덩어리는 별도 학습 대상으로 삼지 않으므로 learningTargets를 빈 배열로 둡니다.",
  "- evidenceNodeIds는 같은 덩어리의 nodeIds 중 이 target의 근거가 되는 ID만 사용합니다.",
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

type OutlineNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  sourceRange: string;
};

type ChunkResult = {
  learningGoal: string;
  goalReason: string;
  chunks: Array<{
    id: string;
    title: string;
    nodeIds: string[];
    importance: 0 | 1 | 2 | 3;
    reason: string;
    learningTargets: Array<{
      target: string;
      operation: "recall" | "reconstruct" | "discriminate" | "apply";
      successCriterion: string;
      evidenceNodeIds: string[];
    }>;
  }>;
  structuralNodeIds: string[];
};

function validateResult(nodes: OutlineNode[], result: ChunkResult) {
  const expectedIds = new Set(nodes.map((node) => node.id));
  const assigned = [
    ...result.chunks.flatMap((chunk) => chunk.nodeIds.map((nodeId) => ({ nodeId, owner: chunk.id }))),
    ...result.structuralNodeIds.map((nodeId) => ({ nodeId, owner: "structural" })),
  ];
  const unknown = assigned.filter(({ nodeId }) => !expectedIds.has(nodeId));
  const counts = new Map<string, number>();
  for (const { nodeId } of assigned) counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([nodeId]) => nodeId);
  const missing = [...expectedIds].filter((nodeId) => !counts.has(nodeId));
  if (unknown.length || duplicate.length || missing.length) {
    throw new Error(JSON.stringify({ unknown, duplicate, missing }));
  }
  for (const chunk of result.chunks) {
    if (chunk.importance <= 1 && chunk.learningTargets.length > 0) {
      throw new Error(`${chunk.id}: 보조 또는 제외 덩어리에 학습 대상이 있습니다.`);
    }
    if (chunk.importance >= 2 && chunk.learningTargets.length === 0) {
      throw new Error(`${chunk.id}: 학습 대상이 없습니다.`);
    }
    const chunkNodeIds = new Set(chunk.nodeIds);
    for (const target of chunk.learningTargets) {
      if (!target.target.trim() || !target.successCriterion.trim()) {
        throw new Error(`${chunk.id}: 학습 대상 또는 성공 기준이 비어 있습니다.`);
      }
      if (target.evidenceNodeIds.some((nodeId) => !chunkNodeIds.has(nodeId))) {
        throw new Error(`${chunk.id}: 다른 덩어리의 근거 노드를 참조했습니다.`);
      }
    }
  }
}

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");

const requested = process.argv.slice(2);
const selectedCases = requested.length > 0 ? cases.filter((id) => requested.includes(id)) : cases;
if (selectedCases.length === 0) throw new Error("선택한 자료가 없습니다.");

async function findLatestOutlineArtifact(id: string) {
  const filenames = (await fs.readdir(outlineDirectory))
    .filter((filename) => filename.endsWith(`-${id}.json`))
    .sort();
  const filename = filenames.at(-1);
  if (!filename) throw new Error(`${id}: 평면 목차 실험 결과가 없습니다.`);
  return path.join(outlineDirectory, filename);
}

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const id of selectedCases) {
  const sourcePath = await findLatestOutlineArtifact(id);
  const artifact = JSON.parse(await fs.readFile(sourcePath, "utf8")) as {
    source: { filename: string };
    result: { whatIsThis: string; nodes: OutlineNode[] };
  };
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
          content: "당신은 문서 목차를 훼손하지 않고 학습 덩어리와 앱 제어용 중요도를 설계하는 학습 설계자입니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                prompt,
                "",
                "자료 한 문장 설명:",
                artifact.result.whatIsThis,
                "",
                "목차 노드:",
                JSON.stringify(artifact.result.nodes, null, 2),
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "learning_target_plan",
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(data)}`);
  const result = JSON.parse(extractOutputText(data)) as ChunkResult;
  validateResult(artifact.result.nodes, result);
  const usage = parseApiTokenUsage(data, {
    sourceName: artifact.source.filename,
    experimentId: `learning-target-${runStamp}-${id}`,
    stage: "plan",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-learning-target-smoke",
      artifactVersion: "v1",
      completedAt: new Date().toISOString(),
      source: { id, filename: artifact.source.filename, outlineArtifactPath: sourcePath },
      model: { name: MODEL, reasoningEffort: REASONING_EFFORT },
      result,
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  summary.push({ id, outputPath, result, usage });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ summaryPath }));
