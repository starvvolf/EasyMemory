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

type Operation = "recall" | "reconstruct" | "discriminate" | "apply";

type QuestionUnit = {
  id: string;
  target: string;
  answerContent: string;
  operation: Operation;
  sourcePages: string;
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
    id: "high-school-social-game-economy-student",
    pdf: "tmp/high-school-student-samples/kdi-game-economy-student.pdf",
    ocrArtifact:
      "eval/local/pdf-ocr-v1/2026-08-16T153220713Z-kdi-game-economy-student-selected.json",
    sourceName: "KDI 학생용 워크북 「게임, 경제를 캐리하라!」 읽기자료",
    learningGoal:
      "GDP와 경제 성장의 뜻, 생산 요소 증가·혁신·산업 연관 효과를 이해하고, 게임 산업의 사례가 경제 성장에 기여하는 방식을 근거와 함께 구분해 설명한다.",
    advice:
      "GDP의 포함·제외 기준, 생산 요소 증가와 혁신의 차이, 산업 연관 효과의 뜻과 종류, 게임 산업 사례를 근거에 연결하는 판단을 우선한다. 특정 연도 매출 수치, 프로그램 안내, 빈 활동지는 그 자체를 암기 대상으로 만들지 않는다.",
    maxUnits: 12,
  },
  {
    id: "high-school-science-stars-spectrum-student",
    pdf: "tmp/high-school-student-samples/kosac-integrated-science-info-student.pdf",
    pageNumbers: [34, 35, 36, 37, 39, 40],
    sourceName: "고등학교 1학년 학생용 통합과학·정보 교재의 별과 스펙트럼 단원",
    learningGoal:
      "별의 형성과 핵융합에 따른 원소 형성을 설명하고, 연속·선·흡수 스펙트럼의 생성 조건을 구분하여 관측된 스펙트럼으로 천체 정보를 해석한다.",
    advice:
      "원시별 형성, 핵융합과 원소 생성, 별의 질량에 따른 생성 원소의 차이, 세 스펙트럼의 모습과 생성 조건, 흡수선으로 알 수 있는 정보를 우선한다. 그림자 예술 활동 절차와 자기평가표는 암기 대상으로 만들지 않는다.",
    maxUnits: 10,
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

async function extractPdfPages(pdfPath: string, selectedPageNumbers?: readonly number[]) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await fs.readFile(path.resolve(pdfPath)));
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  const pageNumbers = selectedPageNumbers?.length
    ? selectedPageNumbers
    : Array.from({ length: document.numPages }, (_, index) => index + 1);
  for (const pageNumber of pageNumbers) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => "str" in item ? item.str : "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber, text });
  }
  return pages;
}

async function loadCasePages(evalCase: typeof cases[number]) {
  if ("ocrArtifact" in evalCase) {
    const artifact = JSON.parse(
      await fs.readFile(path.resolve(evalCase.ocrArtifact), "utf8"),
    ) as { pages: Array<{ pageNumber: number; text: string }> };
    return artifact.pages.map(({ pageNumber, text }) => ({ pageNumber, text }));
  }
  return extractPdfPages(
    evalCase.pdf,
    "pageNumbers" in evalCase ? evalCase.pageNumbers : undefined,
  );
}

async function callStructuredOutput(
  input: unknown,
  schemaName: string,
  schema: Record<string, unknown>,
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      reasoning: { effort: DEFAULT_REASONING_EFFORT },
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return { data, parsed: JSON.parse(outputText(data)) as unknown };
}

function validateProblems(units: QuestionUnit[], problems: GeneratedProblem[]) {
  const expected = new Set(units.map((unit) => unit.id));
  const ids = problems.map((problem) => problem.unitId);
  const unique = new Set(ids);
  const missingIds = [...expected].filter((id) => !unique.has(id));
  const unknownIds = [...unique].filter((id) => !expected.has(id));
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const invalidProblems = problems.flatMap((problem) => {
    const issues: string[] = [];
    if (!problem.front.trim()) issues.push("빈 문제");
    if (problem.activityType === "flashcard" && !problem.back.trim()) {
      issues.push("빈 플래시카드 정답");
    }
    if (
      problem.activityType === "multiple_choice" &&
      (problem.options.length < 2 ||
        problem.correctOptionIndex < 0 ||
        problem.correctOptionIndex >= problem.options.length)
    ) issues.push("잘못된 객관식 정답");
    if (
      problem.activityType === "structure_recall" &&
      problem.structureItems.length < 2
    ) issues.push("구조복원 항목 부족");
    return issues.length ? [{ unitId: problem.unitId, issues }] : [];
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
    duplicateIds,
    invalidProblems,
  };
}

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/high-school-question-unit-smoke");
await fs.mkdir(outputDirectory, { recursive: true });

for (const evalCase of cases) {
  const pages = await loadCasePages(evalCase);
  const unitResponse = await callStructuredOutput(
    [
      {
        role: "system",
        content:
          "당신은 고등학교 학습자료를 문제로 만들기 전에, 실제로 배울 내용을 문제 하나 크기로 구분하는 편집자입니다. 아직 문제·보기·힌트는 만들지 않습니다. 결과는 한국어 JSON으로만 반환합니다.",
      },
      {
        role: "user",
        content: [
          `자료: ${evalCase.sourceName}`,
          `학습 목표: ${evalCase.learningGoal}`,
          `교사 조언: ${evalCase.advice}`,
          "",
          "PDF 페이지별 추출문:",
          JSON.stringify(pages, null, 2),
          "",
          "구분 규칙:",
          "- 각 단위는 나중에 정확히 문제 하나가 됩니다.",
          "- 한 번의 시도에서 한 가지 성공·실패를 판정할 수 있게 나눕니다.",
          "- 따로 틀릴 수 있는 개념·판단은 나누고, 관계나 순서 자체가 목표면 함께 둡니다.",
          "- 설명을 돕는 예시, 교사용 수업 안내, 배점, 빈 활동지는 학습 대상과 구분합니다.",
          "- 연습문제에 담긴 핵심 개념과 판단은 보존하되 기존 문항을 그대로 복사하지 않습니다.",
          "- 같은 내용을 표현만 바꾸어 중복하지 않습니다.",
          `- 최대 ${evalCase.maxUnits}개는 안전선이지 채워야 할 목표가 아닙니다. 자료와 목표에 필요한 만큼만 반환합니다.`,
          "- reconstruct는 실제 순서·계층·대응 관계 자체를 복원하는 것이 목표일 때만 사용합니다. 일반 설명 문장을 여러 조각으로 잘라 배열시키기 위해 사용하지 않습니다.",
          "- 학습 목표가 비교·판단·적용을 요구하고 PDF 안에 판단에 필요한 입력이나 사례가 있으면, 그 행동을 보존한 apply 또는 discriminate 단위를 최소 하나 포함합니다.",
          "- PDF에 판단 입력이 없다면 새 사실을 지어내지 말고, 지원 가능한 핵심 지식만 남깁니다.",
          "- target은 학습자가 해내야 할 한 가지, answerContent는 정답으로 보존할 내용만 씁니다.",
          "- sourcePages에는 근거 페이지를 간단히 씁니다.",
          "- 실제 문제는 작성하지 않습니다.",
        ].join("\n"),
      },
    ],
    `${evalCase.id.replace(/-/g, "_")}_units`,
    {
      type: "object",
      additionalProperties: false,
      required: ["documentSummary", "units"],
      properties: {
        documentSummary: { type: "string" },
        units: {
          type: "array",
          minItems: 3,
          maxItems: evalCase.maxUnits,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "target", "answerContent", "operation", "sourcePages"],
            properties: {
              id: { type: "string" },
              target: { type: "string" },
              answerContent: { type: "string" },
              operation: {
                type: "string",
                enum: ["recall", "reconstruct", "discriminate", "apply"],
              },
              sourcePages: { type: "string" },
            },
          },
        },
      },
    },
  );
  const unitResult = unitResponse.parsed as {
    documentSummary: string;
    units: QuestionUnit[];
  };
  const unitIds = unitResult.units.map((unit) => unit.id);
  if (new Set(unitIds).size !== unitIds.length) {
    throw new Error(`${evalCase.id}: 문제 단위 ID가 중복되었습니다.`);
  }

  const problemResponse = await callStructuredOutput(
    [
      {
        role: "system",
        content:
          "당신은 확정된 문제 단위를 실제 고등학교 학습 문제로 바꾸는 출제자입니다. 단위를 합치거나 다시 나누지 말고 정확히 한 문제씩 만드세요. 결과는 한국어 JSON으로만 반환합니다.",
      },
      {
        role: "user",
        content: [
          `학습 목표: ${evalCase.learningGoal}`,
          `교사 조언: ${evalCase.advice}`,
          "",
          "확정된 문제 단위:",
          JSON.stringify(unitResult.units, null, 2),
          "",
          "출제 규칙:",
          "- 단위 하나당 문제 하나를 만들고 unitId를 그대로 반환합니다.",
          "- 앞면에서 정답을 직접 알려주지 않습니다.",
          "- recall은 flashcard, discriminate는 OX·객관식, reconstruct는 실제 관계·순서일 때 구조복원을 우선합니다.",
          "- reconstruct 단위라도 실제 순서·계층·대응 관계가 아니라면 structure_recall로 억지 변환하지 말고 의미에 맞는 flashcard·OX·객관식을 사용합니다.",
          "- apply는 해당 지식을 사용해야 풀리는 짧고 구체적인 입력을 줍니다. 자동채점이 어렵다면 답을 먼저 생각하고 back과 비교하는 flashcard로 만듭니다.",
          "- 단위의 operation을 낮추지 않습니다. apply를 단순 정의 회상으로, discriminate를 용어 암기로 바꾸지 않습니다.",
          "- answerContent와 자료 범위를 벗어난 사실을 만들지 않습니다.",
          "- 사용하지 않는 필드는 빈 문자열, 빈 배열, 0, false로 반환합니다.",
          "- structureItems는 정답 순서로 반환하며 화면에서 무작위로 섞습니다.",
        ].join("\n"),
      },
    ],
    `${evalCase.id.replace(/-/g, "_")}_problems`,
    {
      type: "object",
      additionalProperties: false,
      required: ["problems"],
      properties: {
        problems: {
          type: "array",
          minItems: unitResult.units.length,
          maxItems: unitResult.units.length,
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
                enum: ["flashcard", "true_false", "multiple_choice", "structure_recall"],
              },
              front: { type: "string" },
              back: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correctOptionIndex: { type: "integer" },
              correctBoolean: { type: "boolean" },
              structureItems: { type: "array", items: { type: "string" } },
              structureMode: { type: "string", enum: ["word_bank", "free_input"] },
            },
          },
        },
      },
    },
  );
  const problems = (problemResponse.parsed as { problems: GeneratedProblem[] }).problems;
  const validation = validateProblems(unitResult.units, problems);
  const experimentId = `${evalCase.id}-${stamp}`;
  const usage = [
    parseApiTokenUsage(unitResponse.data, {
      sourceName: evalCase.sourceName,
      experimentId,
      stage: "activity-design",
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    }),
    parseApiTokenUsage(problemResponse.data, {
      sourceName: evalCase.sourceName,
      experimentId,
      stage: "cards",
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    }),
  ];
  const outputPath = path.join(outputDirectory, `${experimentId}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-high-school-question-unit-smoke",
      completedAt: new Date().toISOString(),
      source: {
        name: evalCase.sourceName,
        pdfPath: path.resolve(evalCase.pdf),
        pageCount: pages.length,
      },
      input: {
        learningGoal: evalCase.learningGoal,
        advice: evalCase.advice,
      },
      documentSummary: unitResult.documentSummary,
      units: unitResult.units,
      problems,
      validation,
      usage,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(JSON.stringify({
    id: evalCase.id,
    unitCount: unitResult.units.length,
    problemCount: problems.length,
    validation,
    usage,
    outputPath,
  }));
  if (!validation.isValid) {
    throw new Error(`${evalCase.id}: 문제 결과가 기계 검사를 통과하지 못했습니다.`);
  }
}
