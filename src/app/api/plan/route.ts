import { NextResponse } from "next/server";
import { z } from "zod";
import type {
  PdfAnalysisResponse,
  StudyGuidelineDraft,
  WholeDocumentCorePlan,
} from "@/lib/types";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "@/lib/model-config";

const requestSchema = z.object({
  analysis: z.object({
    files: z.array(
      z.object({
        fileName: z.string(),
        documentType: z.string(),
        summary: z.string(),
        keyTopics: z.array(z.string()),
        outline: z.array(
          z.object({
            heading: z.string(),
            points: z.array(z.string()),
          }),
        ),
        suggestedRole: z.string(),
      }),
    ),
  }),
  instruction: z.string().optional().default(""),
  runMode: z
    .enum(["focused_area", "whole_document_core"])
    .optional()
    .default("focused_area"),
});

const wholeDocumentCoreAreaSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  learningValue: z.string(),
  sourceScope: z.array(z.string()).min(1),
  estimatedLearningUnitCount: z.number().int().min(1).max(200),
});

const wholeDocumentCoreSchema = z.object({
  summary: z.string(),
  learningGoal: z.string(),
  selectionRationale: z.string(),
  areas: z.array(wholeDocumentCoreAreaSchema).min(1).max(12),
  exclusions: z.array(z.string()),
  estimatedLearningUnitCount: z.number().int().min(1).max(200),
});

type PdfInput = {
  filename: string;
  mimeType: string;
  base64: string;
};

const focusGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  itemCount: z.number().int().min(1).max(200),
  itemLabel: z.string(),
  selectionInstruction: z.string(),
});

const responseSchema = z.object({
  summary: z.string(),
  question: z.string(),
  groups: z.array(focusGroupSchema).min(2).max(6),
  recommendedGroupId: z.string(),
});

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { message: "OPENAI_API_KEY 환경변수가 필요합니다." },
        { status: 500 },
      );
    }

    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const { input, pdfs } = await parseWholeDocumentRequest(request);
      if (input.runMode !== "whole_document_core") {
        return NextResponse.json(
          { message: "전체 핵심 학습 실험 요청 형식이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      const plan = await createWholeDocumentCorePlan(
        input.analysis,
        input.instruction,
        pdfs,
      );
      return NextResponse.json(plan);
    }

    const input = requestSchema.parse(await request.json());
    if (input.runMode === "whole_document_core") {
      return NextResponse.json(
        { message: "전체 핵심 학습 실험에는 원본 PDF가 필요합니다." },
        { status: 400 },
      );
    }
    const draft = await createGuideline(input.analysis, input.instruction);
    return NextResponse.json(draft);
  } catch (error) {
    console.error("plan route failed", error);
    return NextResponse.json(
      { message: "학습 방향을 만드는 데 실패했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}

async function parseWholeDocumentRequest(request: Request) {
  const formData = await request.formData();
  const files = formData
    .getAll("pdfs")
    .filter((entry): entry is File => entry instanceof File);

  if (files.length === 0 || files.length > 20) {
    throw new Error("전체 핵심 학습 실험에는 1~20개의 PDF가 필요합니다.");
  }
  if (files.some((file) => file.type !== "application/pdf")) {
    throw new Error("PDF 파일만 사용할 수 있습니다.");
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error("PDF 전체 용량은 최대 50MB입니다.");
  }

  const input = requestSchema.parse({
    analysis: JSON.parse(String(formData.get("analysis") ?? "{}")),
    instruction: String(formData.get("instruction") ?? ""),
    runMode: String(formData.get("runMode") ?? ""),
  });
  const pdfs = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })),
  );
  return { input, pdfs };
}

async function createWholeDocumentCorePlan(
  analysis: PdfAnalysisResponse,
  instruction: string,
  pdfs: PdfInput[],
): Promise<WholeDocumentCorePlan> {
  const prompt = [
    "PDF 구조 분석 결과:",
    JSON.stringify(analysis, null, 2),
    "",
    `사용자 추가 지시사항: ${instruction || "없음"}`,
    "",
    "특정 영역 하나를 선택하지 않고, 원자료 전체에서 능동 인출로 학습할 가치가 높은 핵심 범위를 결정하세요.",
    "",
    "규칙:",
    "- 모든 섹션을 균등하게 포함하거나 카드 수를 동일하게 배분하지 않습니다.",
    "- 학습 목표, 개념적 중요도, 이후 인출 가치에 따라 핵심 LearningUnit 후보만 선별합니다.",
    "- 자료의 중요한 하위 영역이 빠지지 않게 하되 상대적 중요도를 반영해 estimatedLearningUnitCount를 다르게 정할 수 있습니다.",
    "- 예시, 반복 요약, 번역 중복, 페이지 번호와 저작권 문구 같은 메타데이터는 핵심 지식보다 낮은 우선순위로 봅니다.",
    "- 구체적 예시가 핵심 개념의 이해나 조건 적용에 필수적인 경우에만 포함하고, 예시 자체를 무조건 독립 단위로 세지 않습니다.",
    "- areas는 서로 구분되는 핵심 의미 범위이며, sourceScope에는 실제 제목·페이지·슬라이드 범위를 기록합니다.",
    "- learningValue에는 해당 영역을 인출할 수 있어야 하는 이유를 씁니다.",
    "- exclusions에는 이번 학습 목표에서 제외하거나 낮은 우선순위로 둔 내용과 이유를 함께 씁니다.",
    "- estimatedLearningUnitCount는 카드 수가 아니라 전체 핵심 범위에서 기대하는 독립 LearningUnit 수이며 areas의 합과 같아야 합니다.",
    "- gold/reference나 외부 정답을 가정하지 말고 제공된 analyze 결과와 PDF 원문만 사용합니다.",
  ].join("\n");

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
            "당신은 학습자료 전체에서 중요도와 능동 인출 가치를 기준으로 핵심 학습 범위를 선별하는 학습 설계자입니다. 문서 분량을 균등 배분하지 않고 실제 학습 가치에 따라 범위를 결정합니다. 결과는 한국어 JSON만 반환합니다.",
        },
        {
          role: "user",
          content: [
            ...pdfs.map((file) => ({
              type: "input_file" as const,
              filename: file.filename,
              file_data: `data:${file.mimeType};base64,${file.base64}`,
            })),
            { type: "input_text" as const, text: prompt },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "whole_document_core_plan",
          strict: true,
          schema: wholeDocumentCoreJsonSchema,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error("OpenAI whole-document core planning request failed");
  }

  const parsed = wholeDocumentCoreSchema.parse(
    JSON.parse(extractOutputText(data)),
  );
  return {
    ...parsed,
    estimatedLearningUnitCount: parsed.areas.reduce(
      (sum, area) => sum + area.estimatedLearningUnitCount,
      0,
    ),
  };
}

async function createGuideline(
  analysis: PdfAnalysisResponse,
  instruction: string,
): Promise<StudyGuidelineDraft> {
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
            "당신은 문서의 구조를 학습 가능한 영역으로 나누는 학습 설계자입니다. 사용자가 자료의 어느 부분에 집중할지 고를 수 있도록 실제 문서 구조와 개수를 정확히 설명합니다. 결과는 한국어 JSON만 반환합니다.",
        },
        {
          role: "user",
          content: [
            "PDF 구조 분석 결과:",
            JSON.stringify(analysis, null, 2),
            "",
            `사용자 추가 지시사항: ${instruction || "없음"}`,
            "",
            "이 자료를 사용자가 선택할 수 있는 주요 학습 영역으로 나누세요.",
            "",
            "규칙:",
            "- groups에는 문서의 주요 구성 요소를 서로 겹치지 않게 2~6개로 나눕니다.",
            "- 목차의 실제 장·절과 내용 종류를 기준으로 나누며 문서에 없는 영역을 만들지 않습니다.",
            "- itemCount는 카드 수가 아니라 해당 영역에 실제로 존재하는 독립 학습 단위의 개수입니다.",
            "- 패턴 6개, 스크립트 4개처럼 구조 분석에서 확인되는 개수를 그대로 사용하며 부풀리지 않습니다.",
            "- itemLabel에는 패턴, 스크립트, 전략, 지침처럼 단위 이름을 씁니다.",
            "- description에는 해당 영역이 무엇으로 이루어졌는지 한 문장으로 설명합니다.",
            "- selectionInstruction에는 선택 시 포함할 내용과 제외할 다른 영역을 명확히 씁니다.",
            "- summary에는 '이 자료는 A, B, C로 구성되어 있습니다' 형태로 전체 구조를 간단히 설명합니다.",
            "- question은 사용자가 한 영역을 고를 수 있는 짧은 질문으로 만듭니다.",
            "- recommendedGroupId는 groups 중 학습 가치가 가장 높은 하나의 id와 같아야 합니다.",
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "study_guideline_draft",
          strict: true,
          schema: guidelineJsonSchema,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error("OpenAI guideline request failed");
  }

  const parsed = responseSchema.parse(JSON.parse(extractOutputText(data)));
  const ids = new Set(parsed.groups.map((group) => group.id));
  const recommendedGroupId = ids.has(parsed.recommendedGroupId)
    ? parsed.recommendedGroupId
    : parsed.groups[0].id;

  return {
    ...parsed,
    recommendedGroupId,
  };
}

const guidelineJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "question", "groups", "recommendedGroupId"],
  properties: {
    summary: { type: "string" },
    question: { type: "string" },
    recommendedGroupId: { type: "string" },
    groups: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "description",
          "itemCount",
          "itemLabel",
          "selectionInstruction",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          itemCount: { type: "integer", minimum: 1, maximum: 200 },
          itemLabel: { type: "string" },
          selectionInstruction: { type: "string" },
        },
      },
    },
  },
} as const;

const wholeDocumentCoreJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "learningGoal",
    "selectionRationale",
    "areas",
    "exclusions",
    "estimatedLearningUnitCount",
  ],
  properties: {
    summary: { type: "string" },
    learningGoal: { type: "string" },
    selectionRationale: { type: "string" },
    areas: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "description",
          "learningValue",
          "sourceScope",
          "estimatedLearningUnitCount",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          learningValue: { type: "string" },
          sourceScope: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          estimatedLearningUnitCount: {
            type: "integer",
            minimum: 1,
            maximum: 200,
          },
        },
      },
    },
    exclusions: { type: "array", items: { type: "string" } },
    estimatedLearningUnitCount: {
      type: "integer",
      minimum: 1,
      maximum: 200,
    },
  },
} as const;

function extractOutputText(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "output_text" in data &&
    typeof data.output_text === "string"
  ) {
    return data.output_text;
  }

  const output = (data as { output?: Array<{ content?: Array<unknown> }> }).output;
  const textItem = output
    ?.flatMap((item) => item.content ?? [])
    .find(
      (item): item is { text: string } =>
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof item.text === "string",
    );

  if (textItem) {
    return textItem.text;
  }

  throw new Error("OpenAI 응답에서 학습 가이드를 찾지 못했습니다.");
}
