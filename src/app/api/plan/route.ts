import { NextResponse } from "next/server";
import { z } from "zod";
import type {
  PdfAnalysisResponse,
  StudyGuidelineDraft,
} from "@/lib/types";

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
});

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

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { message: "OPENAI_API_KEY 환경변수가 필요합니다." },
        { status: 500 },
      );
    }

    const input = requestSchema.parse(await request.json());
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
      model: OPENAI_MODEL,
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
