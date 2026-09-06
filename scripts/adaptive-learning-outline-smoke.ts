import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const inputDirectory = path.resolve("eval/local/analyze-outline-v1");
const targetDirectory = path.resolve("eval/local/learning-target-v2");
const outputDirectory = path.resolve("eval/local/adaptive-learning-outline-v1");
const requested = process.argv.slice(2);
const selectedCases = requested.length > 0 ? requested : ["bill-of-rights", "opic"];

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

type SourceNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  sourceRange: string;
};

type LearningOutlineNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  directSourceNodeIds: string[];
};

type LearningOutline = {
  title: string;
  summary: string;
  nodes: LearningOutlineNode[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "nodes"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "parentId", "order", "title", "summary", "directSourceNodeIds"],
        properties: {
          id: { type: "string" },
          parentId: { type: ["string", "null"] },
          order: { type: "integer", minimum: 1 },
          title: { type: "string" },
          summary: { type: "string" },
          directSourceNodeIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const prompt = [
  "입력은 PDF를 사실대로 구조화한 원문 목차입니다.",
  "이 원문 목차를 문제 구성에 적합한 학습용 목차로 재구성하세요.",
  "입력에는 앞 단계가 만든 임시 학습 덩어리도 함께 있습니다. 이 덩어리는 최종 문제 단위가 아니라 학습용 목차의 부모 후보입니다.",
  "원문의 사실을 바꾸거나 새로운 학습 내용을 추가하지 마세요.",
  "원문 순서를 반드시 그대로 유지할 필요는 없지만, 원문이 가르치는 관계와 흐름은 보존하세요.",
  "",
  "핵심 원칙:",
  "- 큰 주제는 부모 목차로 남깁니다.",
  "- 임시 학습 덩어리가 여러 독립 내용을 담고 있으면 덩어리 제목을 부모로 유지하고 내부 내용을 자식 목차로 펼칩니다.",
  "- 한 부모 아래에 서로 독립적으로 질문하고 성공·실패를 판정할 수 있는 내용이 여러 개 있으면 자식 목차로 펼칩니다.",
  "- 한 목차의 내용을 문제로 만들 때 일부만 골라야 할 정도로 크다면 그 목차는 더 펼칩니다.",
  "- 여러 요소의 공통 순서·관계·분류 체계 전체가 하나의 학습 대상이면 부모와 자식 구조를 함께 유지합니다.",
  "- 단순히 글이 길거나 번호가 많다는 이유만으로 펼치지 않습니다.",
  "- 같은 원리를 보여주는 반복 예시는 각각 핵심 목차로 만들지 않고 하나의 예시 묶음으로 유지할 수 있습니다.",
  "- 서로 다른 기능을 담당하는 재사용 가능한 요소들은 같은 체계의 자식 목차로 둘 수 있습니다.",
  "- 설명, 예시, 연습 안내도 자료 구조에는 남기되 핵심 내용과 뒤섞지 않습니다.",
  "- 상위 목차 제목만으로 자식 내용을 대신하지 마세요. 자식 목차가 있으면 각 자식이 무엇인지 한 문장으로 분명히 적으세요.",
  "",
  "출처 연결 규칙:",
  "- 모든 원문 node ID를 적어도 한 번 directSourceNodeIds에 배치하세요.",
  "- 새 학습용 부모 목차는 directSourceNodeIds가 비어 있어도 됩니다.",
  "- 원문 node ID를 새로 만들거나 누락하지 마세요.",
  "- 하나의 넓은 원문 node가 서로 다른 자식 목차를 실제로 함께 뒷받침할 때만 그 ID를 여러 자식에서 공통으로 사용할 수 있습니다.",
  "- 하나의 원문 node가 너무 넓더라도 그 안의 사실을 임의로 쪼갠 새 출처 ID는 만들지 마세요.",
  "",
  "결과의 nodes는 중첩하지 않고 일렬 배열로 반환합니다.",
  "최상위 학습 목차의 parentId는 null이고, 자식은 부모의 새 학습용 node ID를 parentId로 참조합니다.",
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

async function latestFile(id: string) {
  const filename = (await fs.readdir(inputDirectory))
    .filter((item) => item.endsWith(`-${id}.json`))
    .sort()
    .at(-1);
  if (!filename) throw new Error(`${id}: 원문 목차 결과가 없습니다.`);
  return path.join(inputDirectory, filename);
}

async function latestTargetFile(id: string) {
  const filename = (await fs.readdir(targetDirectory))
    .filter((item) => item.endsWith(`-${id}.json`))
    .sort()
    .at(-1);
  if (!filename) throw new Error(`${id}: 임시 학습 덩어리 결과가 없습니다.`);
  return path.join(targetDirectory, filename);
}

function validateOutline(sourceNodes: SourceNode[], result: LearningOutline) {
  const sourceIds = new Set(sourceNodes.map((node) => node.id));
  const nodeIds = result.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("중복된 학습 목차 ID가 있습니다.");
  const knownLearningIds = new Set(nodeIds);
  for (const node of result.nodes) {
    if (!node.title.trim() || !node.summary.trim()) throw new Error(`${node.id}: 제목 또는 요약이 비어 있습니다.`);
    if (node.parentId !== null && !knownLearningIds.has(node.parentId)) {
      throw new Error(`${node.id}: 존재하지 않는 부모 목차를 참조합니다.`);
    }
  }
  const assigned = result.nodes.flatMap((node) => node.directSourceNodeIds);
  const unknown = assigned.filter((id) => !sourceIds.has(id));
  const counts = new Map<string, number>();
  for (const id of assigned) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = [...sourceIds].filter((id) => !counts.has(id));
  if (unknown.length || missing.length) {
    throw new Error(JSON.stringify({ unknown, missing }));
  }
  const roots = result.nodes.filter((node) => node.parentId === null);
  if (roots.length === 0) throw new Error("최상위 학습 목차가 없습니다.");
  for (const parentId of [null, ...nodeIds]) {
    const siblings = result.nodes.filter((node) => node.parentId === parentId);
    if (siblings.length === 0) continue;
    const orders = siblings.map((node) => node.order).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index + 1)) {
      throw new Error(`${parentId ?? "root"}: 형제 목차의 순서가 1부터 연속되지 않습니다.`);
    }
  }
}

function normalizeSiblingOrders(result: LearningOutline) {
  const parentIds = new Set(result.nodes.map((node) => node.parentId));
  for (const parentId of parentIds) {
    const siblings = result.nodes
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.order - b.order);
    siblings.forEach((node, index) => {
      node.order = index + 1;
    });
  }
}

function outlineLines(nodes: LearningOutlineNode[]) {
  const children = new Map<string | null, LearningOutlineNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      lines.push(`${"  ".repeat(depth)}- ${node.title}: ${node.summary}`);
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return lines;
}

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const id of selectedCases) {
  const inputPath = await latestFile(id);
  const targetPath = await latestTargetFile(id);
  const artifact = JSON.parse(await fs.readFile(inputPath, "utf8")) as {
    source: { filename: string };
    result: { whatIsThis: string; nodes: SourceNode[] };
  };
  const targetArtifact = JSON.parse(await fs.readFile(targetPath, "utf8")) as {
    result: {
      learningGoal: string;
      chunks: Array<{
        id: string;
        title: string;
        nodeIds: string[];
        importance: number;
        reason: string;
      }>;
      structuralNodeIds: string[];
    };
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
          content: "당신은 원문 목차를 학습과 문제 구성에 알맞은 깊이의 목차로 재구성하는 학습 설계자입니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                prompt,
                "",
                `자료 한 문장 설명: ${artifact.result.whatIsThis}`,
                "",
                "원문 목차:",
                JSON.stringify(artifact.result.nodes, null, 2),
                "",
                `자료 전체 학습 목표: ${targetArtifact.result.learningGoal}`,
                "",
                "앞 단계가 만든 임시 학습 덩어리:",
                JSON.stringify(targetArtifact.result.chunks, null, 2),
                "",
                "내용을 직접 담지 않는 원문 구조 노드:",
                JSON.stringify(targetArtifact.result.structuralNodeIds),
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "adaptive_learning_outline",
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(data)}`);
  const result = JSON.parse(extractOutputText(data)) as LearningOutline;
  normalizeSiblingOrders(result);
  validateOutline(artifact.result.nodes, result);
  const usage = parseApiTokenUsage(data, {
    sourceName: artifact.source.filename,
    experimentId: `adaptive-learning-outline-${runStamp}-${id}`,
    stage: "plan",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-adaptive-learning-outline-smoke",
      artifactVersion: "v1",
      completedAt: new Date().toISOString(),
      source: { id, filename: artifact.source.filename, inputPath, targetPath },
      model: { name: MODEL, reasoningEffort: REASONING_EFFORT },
      result,
      outlineLines: outlineLines(result.nodes),
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  summary.push({ id, outputPath, nodeCount: result.nodes.length, outlineLines: outlineLines(result.nodes), usage });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({ summaryPath }));
