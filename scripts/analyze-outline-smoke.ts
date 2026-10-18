import fs from "node:fs/promises";
import path from "node:path";

import { parseApiTokenUsage } from "../src/lib/api-usage.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const corpusDirectory = path.resolve("eval/corpus/generation-quality-v1");
const outputDirectory = path.resolve("eval/local/analyze-outline-v1");

const cases = [
  ["opic", "speaking-opic-person-description.pdf", path.join(corpusDirectory, "speaking-opic-person-description.pdf")],
  ["deadlocks", "technical-deadlocks.pdf", path.join(corpusDirectory, "technical-deadlocks.pdf")],
  ["bill-of-rights", "history-bill-of-rights.pdf", path.join(corpusDirectory, "history-bill-of-rights.pdf")],
  ["moon-phases", "science-moon-phases.pdf", path.join(corpusDirectory, "science-moon-phases.pdf")],
  ["disaster-checklist", "rules-disaster-checklist.pdf", path.join(corpusDirectory, "rules-disaster-checklist.pdf")],
  ["calculus-problems", "unsupported-calculus-problems.pdf", path.join(corpusDirectory, "unsupported-calculus-problems.pdf")],
  [
    "dfs-bfs",
    "05 DFS BFS.pdf",
    path.resolve("eval/local/sources/7bd68c1e2fbc049167489a90bea1b36cc2a867efd907f11e53fd8ac52a67da31.pdf"),
  ],
] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["whatIsThis", "nodes"],
  properties: {
    whatIsThis: {
      type: "string",
      description: "처음 본 사람에게 이 자료가 무엇인지 알려주는 짧은 한 문장",
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "parentId", "order", "title", "summary", "sourceRange"],
        properties: {
          id: { type: "string" },
          parentId: { type: ["string", "null"] },
          order: { type: "integer", minimum: 1 },
          title: { type: "string" },
          summary: { type: "string" },
          sourceRange: { type: "string" },
        },
      },
    },
  },
} as const;

const prompt = [
  "PDF 전체를 처음 읽는 사람이 문서의 구성을 빠르게 파악할 수 있도록 목차형 구조 지도를 만드세요.",
  "이 단계에서는 무엇을 외울지, 어떤 문제를 만들지, 무엇이 핵심인지 판단하지 않습니다.",
  "문서가 실제로 어떤 부분들로 이루어져 있고 각 부분이 무엇을 말하는지만 보여주세요.",
  "",
  "규칙:",
  "- PDF에 보이는 실제 장, 절, 주제 전환과 내용 관계를 따라 상위 항목과 하위 항목을 구성하세요.",
  "- 원문 목차가 없더라도 내용의 명확한 전환을 근거로 최소한의 구조를 복원할 수 있습니다.",
  "- 원문에 번호나 소제목으로 명시된 형제 항목은 내용이 비슷하거나 연속된다는 이유로 합치지 말고 각각 별도 항목으로 보존하세요.",
  "- 원문의 명시적 항목 아래에 더 작은 설명만 있을 때는, 그 설명을 새로운 항목으로 늘리지 말고 해당 항목의 한 줄 summary에 담으세요.",
  "- 같은 부모 아래의 번호 항목들이 모두 같은 형식이라면 공통 설명은 부모 summary에 한 번만 쓰고, 각 자식 summary에는 다른 자식과 구별되는 내용만 쓰세요.",
  "- 반복을 줄이는 것은 summary 문구만 짧게 만드는 일입니다. 이를 이유로 번호 항목을 범위로 묶거나 하나의 항목으로 합치면 안 됩니다.",
  "- 형제 summary마다 같은 끝말이나 형식을 반복하지 마세요. 번호가 연속되는 형제 항목의 summary는 완전한 문장 대신 짧은 내용 구로 쓰세요.",
  "- 부모 summary가 형제 항목들의 공통 형식을 이미 설명했다면 자식에는 각 항목을 구별하는 고유 내용만 남기세요.",
  "- 부모 title이나 summary에 이미 나온 자료 형식명은 자식 summary에서 반복하지 마세요.",
  "- 자식 summary 끝에 ‘내용’, ‘항목’, ‘부분’처럼 정보가 없는 일반 명사를 붙이지 말고 구별되는 핵심 정보에서 끝내세요.",
  "- 모든 문서를 같은 고정 분류표에 끼워 맞추지 마세요.",
  "- 예시, 설명, 팁, 연습 같은 역할을 판정하거나 그런 항목을 억지로 만들지 마세요.",
  "- 서로 다른 내용을 한 항목에 뭉치지 마세요.",
  "- 각 항목의 title은 원문의 번호와 이름을 보존한 짧은 목차 이름으로 씁니다. summary 내용을 title에 덧붙이지 마세요.",
  "- 각 항목의 summary는 그 부분에서 실제로 무엇을 다루는지 한 줄로 씁니다.",
  "- summary에 중요도 평가, 학습 추천, 카드화 제안은 넣지 마세요.",
  "- 모든 항목을 nodes 배열에 한 번씩만 일렬로 반환하세요. 중첩 JSON이나 children 필드는 사용하지 않습니다.",
  "- 각 항목에는 문서 안에서 중복되지 않는 짧은 id를 붙이세요.",
  "- 최상위 항목의 parentId는 null이고, 나머지는 실제 부모 항목의 id를 parentId에 적으세요.",
  "- 같은 parentId를 가진 형제들의 원문 순서를 order에 1부터 차례로 적으세요.",
  "- 부모보다 자식을 먼저 반환하지 마세요.",
  "- 구조 깊이는 제한하지 않습니다. 어떤 항목이 바로 뒤의 번호 목록이나 구성요소들을 설명하면 그 항목을 부모로 연결하세요.",
  "- sourceRange에는 확인 가능한 페이지나 절 범위를 짧게 적으세요.",
  "- whatIsThis은 자료 종류와 다루는 내용을 일상적인 한 문장으로만 설명하세요.",
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

const requested = process.argv.slice(2);
const selectedCases = requested.length > 0 ? cases.filter(([id]) => requested.includes(id)) : cases;
if (selectedCases.length === 0) throw new Error("선택한 자료가 없습니다.");

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const [id, filename, pdfPath] of selectedCases) {
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
          content: "당신은 PDF의 실제 구성을 과장 없이 목차형 구조로 복원하는 문서 분석가입니다. 결과는 한국어 JSON으로만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename,
              file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
            },
            { type: "input_text", text: prompt },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "document_outline",
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(data)}`);
  const result = JSON.parse(extractOutputText(data));
  const usage = parseApiTokenUsage(data, {
    sourceName: filename,
    experimentId: `analyze-outline-${runStamp}-${id}`,
    stage: "analyze",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  const artifact = {
    artifactType: "study-forge-analyze-outline-smoke",
    artifactVersion: "v1",
    completedAt: new Date().toISOString(),
    source: { id, filename, pdfPath },
    model: { name: MODEL, reasoningEffort: REASONING_EFFORT },
    result,
    usage,
  };
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  summary.push({ id, outputPath, result, usage });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ summaryPath }));
