import { NextResponse } from "next/server";
import { z } from "zod";
import type { RecallDesignDraft } from "@/lib/types";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "@/lib/model-config";

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
    wholeDocumentCore: z
      .object({
        summary: z.string(),
        learningGoal: z.string(),
        selectionRationale: z.string(),
        areas: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            learningValue: z.string(),
            sourceScope: z.array(z.string()),
            estimatedLearningUnitCount: z.number().int().min(1),
          }),
        ),
        exclusions: z.array(z.string()),
        estimatedLearningUnitCount: z.number().int().min(1),
      })
      .optional(),
    countPolicy: z.literal("soft_budget").optional(),
    learningUnitSoftBudget: z
      .object({
        target: z.number().int().min(1),
        min: z.number().int().min(1),
        max: z.number().int().min(1),
        areas: z.array(
          z.object({
            areaId: z.string(),
            target: z.number().int().min(1),
            min: z.number().int().min(1),
            max: z.number().int().min(1),
          }),
        ),
      })
      .optional(),
  }),
});

const optionSchema = z.object({
  id: z.string(),
  title: z.string(),
  cue: z.string(),
  target: z.string(),
  unit: z.string(),
  instruction: z.string(),
  mode: z.enum(["flashcard", "cloze", "translation"]),
  variants: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      slotMode: z.enum(["template", "filled_example"]),
      exampleSource: z.enum(["source", "generated"]),
      preservePlaceholders: z.boolean(),
      sample: z.object({
        title: z.string(),
        cue: z.string(),
        target: z.string(),
        supportingInfo: z.string(),
      }),
    }),
  ).length(2),
});

type PdfInput = {
  filename: string;
  mimeType: string;
  base64: string;
};

const responseSchema = z.object({
  question: z.string(),
  options: z.array(optionSchema).min(2).max(3),
  recommendedOptionId: z.string(),
});

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { message: "OPENAI_API_KEY 환경변수가 필요합니다." },
        { status: 500 },
      );
    }

    const { input, pdfs } = await parseRecallDesignRequest(request);
    const design = await createRecallDesign(input.analysis, input.guideline, pdfs);
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
  pdfs: PdfInput[],
): Promise<RecallDesignDraft> {
  const usesSoftBudget = guideline.countPolicy === "soft_budget";
  const userPrompt = [
    "PDF 구조 분석:",
    JSON.stringify(analysis, null, 2),
    "",
    "사용자가 선택한 학습 영역:",
    JSON.stringify(guideline.selectedGroup, null, 2),
    ...(guideline.wholeDocumentCore
      ? [
          "",
          "실험용 전체 핵심 학습 범위:",
          JSON.stringify(guideline.wholeDocumentCore, null, 2),
        ]
      : []),
    ...(usesSoftBudget && guideline.learningUnitSoftBudget
      ? [
          "",
          "실험용 LearningUnit soft budget:",
          JSON.stringify(guideline.learningUnitSoftBudget, null, 2),
        ]
      : []),
    "",
    "이 영역에 적합한 인출 방식 2~3개와 각 방식의 대표 예시 두 가지를 제안하세요.",
    "",
    "규칙:",
    "- 모든 선택지는 Cue -> Target 관계여야 합니다.",
    "- 각 option의 variants는 정확히 2개이며 template과 filled_example을 하나씩 만듭니다.",
    "- template variant는 slotMode=template, exampleSource=source, preservePlaceholders=true로 둡니다.",
    "- template variant는 첨부 PDF의 일반화된 패턴을 사용하고 [인물], ____ 같은 변수 자리를 그대로 보존합니다.",
    "- filled_example variant는 slotMode=filled_example, exampleSource=generated, preservePlaceholders=false로 둡니다.",
    "- filled_example variant는 같은 패턴의 변수 자리를 자연스럽고 구체적인 값으로 모두 채운 완성 예문을 만듭니다. 패턴의 의미와 문법은 바꾸지 않습니다.",
    "- 각 variant의 sample.cue에는 카드 앞면에 그대로 사용할 예시를, sample.target에는 카드 뒷면에 그대로 사용할 예시를 씁니다.",
    "- sample에 '다음 뜻을', '영어로 말하세요', '번역하세요' 같은 메타 지시문을 임의로 붙이지 않습니다.",
    "- 한 variant 안에서 빈칸 유지형과 완성 예문형을 섞지 않습니다.",
    "- options는 선택 영역 전체에 적용할 서로 다른 인출 설계의 대안입니다.",
    "- 영역 안의 개별 패턴, 전략, 스크립트마다 선택지를 하나씩 만들지 않습니다.",
    ...(usesSoftBudget
      ? [
          "- 사용자가 하나를 고르면 추출된 모든 핵심 LearningUnit에 같은 Cue -> Target 구조가 적용되어야 합니다.",
          "- learningUnitSoftBudget은 대략적인 분량 가이드일 뿐 정확한 LearningUnit 수나 카드 수가 아닙니다.",
          "- option의 instruction에 총 N장 또는 영역별 정확한 카드 수를 명시하지 않습니다.",
          "- 의미적 완결성이 soft budget보다 우선하며 숫자를 맞추기 위해 단위를 합치거나 낮은 가치 내용을 추가하지 않습니다.",
        ]
      : [
          "- 사용자가 하나를 고르면 selectedGroup.itemCount개의 모든 단위에 같은 Cue -> Target 구조가 적용되어야 합니다.",
        ]),
    "- cue에는 사용자가 카드 앞면에서 실제로 보는 정보 종류를 구체적으로 씁니다.",
    "- target에는 사용자가 보지 않고 인출해야 하는 내용을 구체적으로 씁니다.",
    "- target은 학습자가 직접 말하거나 써서 재생산할 원문 지식, 표현, 문장, 순서여야 합니다.",
    "- 해석하기, 이해하기, 기능 설명하기, 역할 설명하기처럼 메타 설명을 target으로 삼지 않습니다.",
    ...(usesSoftBudget
      ? [
          "- unit에는 selectedGroup.itemLabel 하나를 쓰고 LearningUnit 수와 카드 수를 동일하게 고정하지 않습니다.",
        ]
      : [
          "- unit에는 selectedGroup.itemLabel 하나를 쓰고, selectedGroup.itemCount와 카드 수가 대응되게 합니다.",
        ]),
    "- instruction에는 이후 전체 카드를 만드는 AI가 그대로 따를 제작 규칙을 씁니다.",
    "- mode는 예시를 가장 자연스럽게 구현할 카드 UI 유형으로 선택합니다. 영어 산출은 translation을 우선합니다.",
    "- 영어 패턴이나 스크립트 영역이면 영어를 직접 산출하는 능동 인출 방식을 우선 검토합니다.",
    "- 선택한 영역의 실제 내용에 맞게 제안하며 다른 영역은 끌어오지 않습니다.",
    "- selectionInstruction에서 제외하라고 한 내용은 선택지와 variants의 sample에도 넣지 않습니다.",
    ...(guideline.wholeDocumentCore
      ? [
          "- 이 실행은 특정 영역 하나가 아니라 wholeDocumentCore.areas 전체의 핵심 범위를 대상으로 합니다.",
          "- 영역별 단위 수를 균등하게 맞추지 말고 estimatedLearningUnitCount와 learningValue의 상대적 비중을 반영합니다.",
          "- wholeDocumentCore.exclusions에 적힌 내용은 대표 예시와 인출 설계의 핵심 대상으로 삼지 않습니다.",
        ]
      : []),
    "- title은 Cue와 Target 관계가 드러나게 씁니다.",
    "- question은 예시를 보고 원하는 카드 구조를 고르라는 의미가 드러나게 씁니다.",
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
            "당신은 학습 내용을 인출 훈련으로 설계하는 전문가입니다. 모든 선택지는 사용자가 무엇을 보고 무엇을 머릿속에서 꺼낼지 명확해야 합니다. 이해, 읽기, 복습처럼 인출 대상이 불분명한 활동은 제안하지 않습니다. 결과는 한국어 JSON만 반환합니다.",
        },
        {
          role: "user",
          content:
            pdfs.length > 0
              ? [
                  ...pdfs.map((file) => ({
                    type: "input_file" as const,
                    filename: file.filename,
                    file_data: `data:${file.mimeType};base64,${file.base64}`,
                  })),
                  { type: "input_text" as const, text: userPrompt },
                ]
              : userPrompt,
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
        required: ["id", "title", "cue", "target", "unit", "instruction", "mode", "variants"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          cue: { type: "string" },
          target: { type: "string" },
          unit: { type: "string" },
          instruction: { type: "string" },
          mode: { type: "string", enum: ["flashcard", "cloze", "translation"] },
          variants: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "description", "slotMode", "exampleSource", "preservePlaceholders", "sample"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                slotMode: { type: "string", enum: ["template", "filled_example"] },
                exampleSource: { type: "string", enum: ["source", "generated"] },
                preservePlaceholders: { type: "boolean" },
                sample: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "cue", "target", "supportingInfo"],
                  properties: {
                    title: { type: "string" },
                    cue: { type: "string" },
                    target: { type: "string" },
                    supportingInfo: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

async function parseRecallDesignRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { input: requestSchema.parse(await request.json()), pdfs: [] };
  }

  const formData = await request.formData();
  const input = requestSchema.parse({
    analysis: JSON.parse(String(formData.get("analysis") ?? "{}")),
    guideline: JSON.parse(String(formData.get("guideline") ?? "{}")),
  });
  const files = formData
    .getAll("pdfs")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length > 20) throw new Error("인출 설계에는 PDF를 최대 20개까지 사용할 수 있습니다.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error("인출 설계에 사용하는 PDF 전체 용량은 최대 50MB입니다.");
  }
  if (files.some((file) => file.type !== "application/pdf")) {
    throw new Error("PDF 파일만 인출 설계에 사용할 수 있습니다.");
  }

  const pdfs = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })),
  );
  return { input, pdfs };
}

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
