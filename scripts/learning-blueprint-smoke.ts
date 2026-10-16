import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const corpusDirectory = path.resolve("eval/corpus/generation-quality-v1");
const outputDirectory = path.resolve("eval/local/learning-blueprint-v1");

const cases = [
  ["opic", "speaking-opic-person-description.pdf"],
  ["deadlocks", "technical-deadlocks.pdf"],
  ["bill-of-rights", "history-bill-of-rights.pdf"],
  ["moon-phases", "science-moon-phases.pdf"],
  ["disaster-checklist", "rules-disaster-checklist.pdf"],
  ["calculus-problems", "unsupported-calculus-problems.pdf"],
] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["whatIsThis", "readerWalkthrough", "bundles"],
  properties: {
    whatIsThis: {
      type: "string",
      description: "처음 본 사람에게 자료의 종류와 내용을 설명하는 짧은 한 문장",
    },
    readerWalkthrough: {
      type: "array",
      minItems: 5,
      maxItems: 9,
      description: "사람이 자료를 넘겨보며 자연스럽게 묻고 답하는 짧은 판단 과정",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
    bundles: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "center", "core", "relatedContent", "suggestedOrder"],
        properties: {
          id: { type: "string" },
          center: {
            type: "object",
            additionalProperties: false,
            required: ["title", "reason", "sourceRanges"],
            properties: {
              title: { type: "string" },
              reason: { type: "string" },
              sourceRanges: { type: "array", minItems: 1, items: { type: "string" } },
            },
          },
          core: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "content", "whyCore", "sourceRanges"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                content: { type: "string" },
                whyCore: { type: "string" },
                sourceRanges: { type: "array", minItems: 1, items: { type: "string" } },
              },
            },
          },
          relatedContent: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "role", "connectedCoreIds", "sourceRanges"],
              properties: {
                title: { type: "string" },
                role: {
                  type: "string",
                  enum: ["new_core", "explanation", "example", "tip", "practice"],
                },
                connectedCoreIds: { type: "array", items: { type: "string" } },
                sourceRanges: { type: "array", minItems: 1, items: { type: "string" } },
              },
            },
          },
          suggestedOrder: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["order", "target", "purpose", "usesCoreIds", "sourceRanges"],
              properties: {
                order: { type: "integer", minimum: 1 },
                target: { type: "string" },
                purpose: { type: "string" },
                usesCoreIds: { type: "array", items: { type: "string" } },
                sourceRanges: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
} as const;

const prompt = [
  "당신은 PDF를 요약하는 사람이 아니라, 자료를 가장 효율적으로 학습할 수 있도록 다시 조직하는 학습 설계자입니다.",
  "사용자가 별도 목적을 고르지 않은 자동 추천 상황입니다.",
  "",
  "PDF와 함께 Analyze가 만든 자료 구조 지도가 제공될 수 있습니다.",
  "구조 지도가 있으면 먼저 목차처럼 훑어 자료의 큰 구성을 파악한 뒤, PDF 원문에서 실제 내용을 확인하세요.",
  "readerWalkthrough은 그 구조를 따라 읽으며 ‘크게 이런 부분들이 있네 → 이게 중심이겠네 → 뒤의 이것들은 앞 내용을 쓴 예시네 → 이것은 보조 내용이네’라고 판단하는 흐름이 드러나게 쓰세요.",
  "readerWalkthrough의 첫 질문은 Analyze 목차를 보고 ‘이 자료가 크게 어떤 부분들로 구성됐는가?’를 확인하는 질문으로 만드세요.",
  "첫 답변에는 세부 항목을 모두 나열하지 말고, 자료를 이해하는 데 필요한 큰 부분 2~5개만 원문 순서대로 짧게 말하세요.",
  "그 다음 질문부터 어느 부분이 중심인지, 반복되는 핵심이 무엇인지, 나머지가 그 핵심과 어떤 관계인지 판단하세요.",
  "Analyze의 요약을 그대로 복사하거나 무조건 믿지 말고 PDF 원문으로 확인하세요.",
  "",
  "0. 먼저 이 자료를 처음 본 사람에게 ‘이게 무슨 자료인가?’를 한 문장으로 답하세요.",
  "whatIsThis에는 자료의 종류와 다루는 내용만 씁니다.",
  "학습 목표, 추천 방법, 학습 효과, 세부 목차를 섞지 말고 짧고 일상적인 표현을 사용하세요.",
  "예: ‘인물 묘사 답변에 쓰는 영어 패턴과 예시를 모아 둔 OPIc 학습자료.’",
  "",
  "그다음 readerWalkthrough에는 사람이 PDF를 처음부터 쭉 넘겨보며 핵심을 잡는 생각을 질문과 답변으로 보여주세요.",
  "고정된 보고서 항목을 채우듯 쓰지 말고, 실제 자료에서 눈에 띄는 부분을 두고 자연스럽게 질문하세요.",
  "질문과 답변은 짧고 평범한 말투로 쓰며, 한 답변은 가능하면 한두 문장을 넘기지 마세요.",
  "다음 판단 흐름은 포함하되 질문 문구는 자료에 맞게 바꿔도 됩니다.",
  "- 이게 무슨 자료인가?",
  "- 자료 전체가 결국 무엇을 하게 만드는가?",
  "- 쭉 봤을 때 반복되거나 여러 뒤 내용을 만들어내는 핵심은 무엇인가?",
  "- 뒤의 큰 부분들은 새로운 내용인가, 앞 핵심의 설명·예시·연습인가?",
  "- 앞뒤의 전략·주의사항·부록 같은 내용은 핵심인가, 도움을 주는 내용인가?",
  "- 그러면 가장 먼저 무엇을 익히는 것이 효율적인가?",
  "- 그다음에는 무엇을 보고 무엇을 직접 해봐야 하는가?",
  "자료에 존재하지 않는 특정 항목을 억지로 질문하지 마세요.",
  "예를 들어 모든 자료에 긴 스크립트나 전략, 쉐도잉이 있다고 가정하면 안 됩니다.",
  "분류 용어인 new_core, explanation, example, tip, practice는 readerWalkthrough 답변에 쓰지 마세요.",
  "",
  "먼저 이 자료 전체가 학습자에게 결국 무엇을 익히게 하려는지 하나의 중심 과제로 설명하세요.",
  "행동이나 내용이 여러 개 보인다는 이유만으로 별도 목표로 분리하지 마세요.",
  "하나의 중심 과제를 돕는 핵심, 설명, 예시, 팁, 연습일 수 있습니다.",
  "서로 관련 없는 큰 단원들이 실제로 함께 들어 있어 하나의 구체적인 중심으로 자연스럽게 묶이지 않을 때만 bundles를 나누세요.",
  "",
  "그다음 여러 설명과 사례에서 반복 사용되는 재사용 가능한 핵심을 찾으세요.",
  "단순 반복 횟수만으로 핵심을 정하지 마세요.",
  "중심 과제에 직접 필요하고, 여러 뒤 내용을 만들어내거나 압축해서 설명하며, 먼저 익혔을 때 학습 효율이 높아지는 내용이어야 합니다.",
  "여러 사례가 같은 핵심의 조합이나 변형이면 사례별로 새로운 핵심을 만들지 마세요.",
  "반대로 기존 핵심만으로 설명되지 않는 중요한 내용은 new_core로 연결하세요.",
  "",
  "나머지 내용은 핵심과의 관계에 따라 다음 중 하나로 연결하세요.",
  "- new_core: 기존 핵심으로 설명되지 않는 새로운 핵심",
  "- explanation: 핵심을 풀어 설명하는 내용",
  "- example: 핵심이 실제로 사용된 모습",
  "- tip: 핵심을 더 정확하거나 쉽게 사용하는 데 도움을 주는 내용",
  "- practice: 핵심을 직접 사용하거나 숙달하게 하는 내용",
  "",
  "마지막으로 PDF 목차 순서가 아니라, 중심 과제에 도달하는 데 필요한 것 중 적은 노력으로 큰 진전을 얻는 학습 순서를 제안하세요.",
  "핵심을 먼저 익히고, 필요한 경우 사용 모습을 확인하고, 직접 사용하고, 반복·교정하는 흐름을 고려하되 자료에 없는 단계를 억지로 만들지 마세요.",
  "각 판단에는 실제 PDF 페이지·절·문제 범위를 연결하세요.",
  "외부 지식이나 자료에 없는 학습내용을 추가하지 마세요.",
  "",
  "표현 규칙:",
  "- center.title, core.title, relatedContent.title, suggestedOrder.target은 각각 한눈에 읽히는 짧은 문장이나 구로 씁니다.",
  "- 자세한 근거는 reason, content, whyCore, purpose에만 씁니다.",
  "- 같은 설명을 여러 필드에 반복하지 마세요.",
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

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");

const rawArguments = process.argv.slice(2);
const analysisIndex = rawArguments.indexOf("--analysis");
const analysisArgument = analysisIndex >= 0 ? rawArguments[analysisIndex + 1] : undefined;
if (analysisIndex >= 0 && !analysisArgument) throw new Error("--analysis 뒤에 파일 경로가 필요합니다.");
const requested = rawArguments.filter((value, index) =>
  index !== analysisIndex && index !== analysisIndex + 1,
);
const selectedCases = requested.length > 0
  ? cases.filter(([id]) => requested.includes(id))
  : cases;
if (selectedCases.length === 0) throw new Error("선택한 자료가 없습니다.");
if (analysisArgument && selectedCases.length !== 1) {
  throw new Error("--analysis는 자료 하나를 시험할 때만 사용할 수 있습니다.");
}

const analysisMap = analysisArgument
  ? await fs.readFile(path.resolve(analysisArgument), "utf8").then((text) => {
      const artifact = JSON.parse(text) as { response?: unknown };
      return artifact.response ?? artifact;
    })
  : null;

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const [id, filename] of selectedCases) {
  const pdfPath = path.join(corpusDirectory, filename);
  const pdf = await fs.readFile(pdfPath);
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
          content: "당신은 자료 전체의 중심과 재사용 가능한 핵심을 먼저 찾고, 나머지를 그 핵심과 연결해 효율적인 학습 순서를 만드는 학습 설계자입니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename,
              file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
            },
            {
              type: "input_text",
              text: analysisMap
                ? [
                    "Analyze가 먼저 만든 자료 구조 지도:",
                    JSON.stringify(analysisMap, null, 2),
                    "",
                    "위 구조 지도를 따라 PDF 원문을 확인하며 아래 작업을 수행하세요.",
                    prompt,
                  ].join("\n")
                : prompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "learning_blueprint",
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(data)}`);
  const blueprint = JSON.parse(extractOutputText(data));
  const usage = parseApiTokenUsage(data, {
    sourceName: filename,
    experimentId: `learning-blueprint-${runStamp}-${id}`,
    stage: "plan",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  const artifact = {
    artifactType: "study-forge-learning-blueprint-smoke",
    artifactVersion: "v1",
    completedAt: new Date().toISOString(),
    source: {
      id,
      filename,
      pdfPath,
      analysisPath: analysisArgument ? path.resolve(analysisArgument) : null,
    },
    model: { name: MODEL, reasoningEffort: REASONING_EFFORT },
    blueprint,
    usage,
  };
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  summary.push({
    id,
    outputPath,
    whatIsThis: blueprint.whatIsThis,
    readerWalkthrough: blueprint.readerWalkthrough,
    bundleCount: blueprint.bundles.length,
    centers: blueprint.bundles.map((bundle: { center: { title: string } }) => bundle.center.title),
    coreCount: blueprint.bundles.reduce(
      (sum: number, bundle: { core: unknown[] }) => sum + bundle.core.length,
      0,
    ),
    usage,
  });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({ summaryPath }));
