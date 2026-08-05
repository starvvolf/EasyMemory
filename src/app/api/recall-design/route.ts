import { NextResponse } from "next/server";
import { z } from "zod";
import type { RecallDesignDraft } from "@/lib/types";

const focusGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  itemCount: z.number().int().min(1),
  itemLabel: z.string(),
  selectionInstruction: z.string(),
});

const requestSchema = z.object({
  analysis: z.object({ files: z.array(z.unknown()) }),
  guideline: z.object({
    summary: z.string(),
    selectedGroup: focusGroupSchema,
  }),
});

const optionSchema = z.object({
  id: z.string(),
  title: z.string(),
  cue: z.string(),
  target: z.string(),
  unit: z.string(),
  instruction: z.string(),
});

const responseSchema = z.object({
  question: z.string(),
  options: z.array(optionSchema).min(2).max(3),
  recommendedOptionId: z.string(),
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
    const design = await createRecallDesign(input.analysis, input.guideline);
    return NextResponse.json(design);
  } catch (error) {
    console.error("recall design route failed", error);
    return NextResponse.json(
      { message: "인출 훈련 방식을 설계하지 못했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}

async function createRecallDesign(
  analysis: z.infer<typeof requestSchema>["analysis"],
  guideline: z.infer<typeof requestSchema>["guideline"],
): Promise<RecallDesignDraft> {
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
            "당신은 학습 내용을 인출 훈련으로 설계하는 전문가입니다. 모든 선택지는 사용자가 무엇을 보고 무엇을 머릿속에서 꺼낼지 명확해야 합니다. 이해, 읽기, 복습처럼 인출 대상이 불분명한 활동은 제안하지 않습니다. 결과는 한국어 JSON만 반환합니다.",
        },
        {
          role: "user",
          content: [
            "PDF 구조 분석:",
            JSON.stringify(analysis, null, 2),
            "",
            "사용자가 선택한 학습 영역:",
            JSON.stringify(guideline.selectedGroup, null, 2),
            "",
            "이 영역에 적합한 인출 방식 2~3개를 제안하세요.",
            "",
            "규칙:",
            "- 모든 선택지는 Cue -> Target 관계여야 합니다.",
            "- options는 선택 영역 전체에 적용할 서로 다른 인출 설계의 대안입니다.",
            "- 영역 안의 개별 패턴, 전략, 스크립트마다 선택지를 하나씩 만들지 않습니다.",
            "- 사용자가 하나를 고르면 selectedGroup.itemCount개의 모든 단위에 같은 Cue -> Target 구조가 적용되어야 합니다.",
            "- cue에는 사용자가 카드 앞면에서 실제로 보는 정보 종류를 구체적으로 씁니다.",
            "- target에는 사용자가 보지 않고 인출해야 하는 내용을 구체적으로 씁니다.",
            "- target은 학습자가 직접 말하거나 써서 재생산할 원문 지식, 표현, 문장, 순서여야 합니다.",
            "- 해석하기, 이해하기, 기능 설명하기, 역할 설명하기처럼 메타 설명을 target으로 삼지 않습니다.",
            "- unit에는 selectedGroup.itemLabel 하나를 쓰고, selectedGroup.itemCount와 카드 수가 대응되게 합니다.",
            "- instruction에는 이후 샘플과 전체 자료를 만드는 AI가 그대로 따를 제작 규칙을 씁니다.",
            "- 이해하기, 익히기, 확인하기처럼 인출 대상이 없는 선택지는 금지합니다.",
            "- 영어 패턴이나 스크립트 영역이면 '한국어 발화 의도 -> 영어 패턴', '한국어 문장 -> 원문 영어 문장', '상황과 키워드 -> 패턴을 적용한 영어 발화'를 우선 검토합니다.",
            "- 언어 자료에서는 영어를 직접 산출하는 능동 인출 방식을 우선 추천합니다.",
            "- 선택한 영역의 실제 내용에 맞게 제안하며 다른 영역은 끌어오지 않습니다.",
            "- 모든 option의 cue와 target은 selectedGroup.title과 itemLabel에 속한 내용만 사용합니다.",
            "- selectionInstruction에서 제외하라고 한 스크립트, 전략, 지침 등은 선택지 제목이나 내용에도 넣지 않습니다.",
            "- title은 '한국어 발화 의도 -> 영어 패턴'처럼 Cue와 Target이 드러나게 씁니다.",
            "- Success나 정답 판정 기준은 만들지 않습니다.",
            "- question은 '무엇을 보고 무엇을 인출할까요?'라는 의미가 드러나게 씁니다.",
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "recall_training_design",
          strict: true,
          schema: recallDesignJsonSchema,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error("OpenAI recall design request failed");
  }

  const parsed = responseSchema.parse(JSON.parse(extractOutputText(data)));
  const ids = new Set(parsed.options.map((option) => option.id));
  return {
    ...parsed,
    recommendedOptionId: ids.has(parsed.recommendedOptionId)
      ? parsed.recommendedOptionId
      : parsed.options[0].id,
  };
}

const recallDesignJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "options", "recommendedOptionId"],
  properties: {
    question: { type: "string" },
    recommendedOptionId: { type: "string" },
    options: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "cue", "target", "unit", "instruction"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          cue: { type: "string" },
          target: { type: "string" },
          unit: { type: "string" },
          instruction: { type: "string" },
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

  throw new Error("OpenAI 응답에서 인출 설계를 찾지 못했습니다.");
}
