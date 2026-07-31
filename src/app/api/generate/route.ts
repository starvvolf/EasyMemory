import { NextResponse } from "next/server";
import { z } from "zod";
import type {
  AnalysisResult,
  Card,
  GeneratePipelineResult,
  OrganizedMaterial,
  StudyMode,
} from "@/lib/types";

const requestSchema = z.object({
  title: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  tags: z.array(z.string()).default([]),
  sourceText: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  analysisContext: z.string().optional().default(""),
  stage: z.enum(["full", "prepare", "cards"]).optional().default("full"),
  preparedAnalysis: z.string().optional().default(""),
  preparedMaterial: z.string().optional().default(""),
  mode: z.enum(["flashcard", "cloze", "translation"]),
});

type GenerateInput = z.infer<typeof requestSchema>;
type PdfInput = {
  filename: string;
  mimeType: string;
  base64: string;
};

const analysisSchema = z.object({
  detectedGoal: z.string(),
  sourceType: z.enum(["concept", "comparison", "script", "definition", "mixed"]),
  keyTopics: z.array(z.string()),
  recommendedStrategy: z.string(),
  extractedMaterial: z.string(),
});

const organizedMaterialSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
    }),
  ),
});

const cardDraftSchema = z.object({
  type: z.enum(["flashcard", "cloze", "translation"]),
  front: z.string(),
  back: z.string(),
  clozeText: z.string(),
  answer: z.string(),
  answers: z.array(z.string()),
  hint: z.string(),
  tags: z.array(z.string()),
  basis: z.string(),
});

const cardsSchema = z.object({
  cards: z.array(cardDraftSchema).min(1),
});

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

type PipelineStep = "analysis" | "organize" | "cards";

const stepMessages: Record<PipelineStep, string> = {
  analysis: "학습 자료 분석에 실패했습니다.",
  organize: "학습 자료 정리에 실패했습니다.",
  cards: "암기 카드 생성에 실패했습니다.",
};

const fallbackTitle = "새 학습 덱";

class PipelineError extends Error {
  constructor(
    readonly step: PipelineStep,
    message = stepMessages[step],
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  try {
    const { input, pdfs } = await parseGenerateRequest(request);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          message: "OPENAI_API_KEY 환경변수가 필요합니다.",
          step: "config",
        },
        { status: 500 },
      );
    }

    if (
      input.stage !== "cards" &&
      !input.sourceText.trim() &&
      pdfs.length === 0
    ) {
      return NextResponse.json(
        {
          message: "학습 자료 텍스트 또는 PDF 파일이 필요합니다.",
          step: "input",
        },
        { status: 400 },
      );
    }

    if (input.stage === "cards") {
      if (!input.preparedAnalysis || !input.preparedMaterial) {
        return NextResponse.json(
          {
            message: "카드 생성에 사용할 추출 결과가 필요합니다.",
            step: "input",
          },
          { status: 400 },
        );
      }

      const analysis = analysisSchema.parse(
        JSON.parse(input.preparedAnalysis),
      );
      const organizedMaterial = organizedMaterialSchema.parse(
        JSON.parse(input.preparedMaterial),
      );
      const cards = await runCardGeneration(
        input.mode,
        organizedMaterial,
        analysis,
        input.instruction,
      );

      return NextResponse.json({
        analysis,
        organizedMaterial,
        cards,
      } satisfies GeneratePipelineResult);
    }

    const analysis = await runAnalysis(input, pdfs);
    const organizedMaterial = await runOrganization(input, analysis);

    if (input.stage === "prepare") {
      return NextResponse.json({
        analysis,
        organizedMaterial,
        cards: [],
      } satisfies GeneratePipelineResult);
    }

    const cards = await runCardGeneration(
      input.mode,
      organizedMaterial,
      analysis,
      input.instruction,
    );

    const result: GeneratePipelineResult = {
      analysis,
      organizedMaterial,
      cards,
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineError) {
      console.error(error.message, { step: error.step, detail: error.detail });
      return NextResponse.json(
        {
          message: error.message,
          step: error.step,
        },
        { status: 500 },
      );
    }

    console.error("generate route failed", error);
    return NextResponse.json(
      {
        message: "암기자료 생성 요청을 처리하지 못했습니다.",
        step: "unknown",
      },
      { status: 400 },
    );
  }
}

async function parseGenerateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      input: requestSchema.parse(await request.json()),
      pdfs: [],
    };
  }

  const formData = await request.formData();
  const files = [
    ...formData.getAll("pdfs"),
    formData.get("pdf"),
  ].filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
  const tagsText = String(formData.get("tags") ?? "[]");
  const input = requestSchema.parse({
    title: String(formData.get("title") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    tags: JSON.parse(tagsText),
    sourceText: String(formData.get("sourceText") ?? ""),
    instruction: String(formData.get("instruction") ?? ""),
    analysisContext: String(formData.get("analysisContext") ?? ""),
    stage: String(formData.get("stage") ?? "full"),
    preparedAnalysis: String(formData.get("preparedAnalysis") ?? ""),
    preparedMaterial: String(formData.get("preparedMaterial") ?? ""),
    mode: String(formData.get("mode") ?? "flashcard"),
  });

  if (files.length > 20) {
    throw new Error("한 번에 최대 20개의 PDF를 생성에 사용할 수 있습니다.");
  }

  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error("생성에 사용하는 PDF 전체 용량은 최대 50MB입니다.");
  }

  if (files.some((file) => file.type !== "application/pdf")) {
    throw new Error("PDF 파일만 업로드할 수 있습니다.");
  }

  const pdfs = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      return {
        filename: file.name,
        mimeType: file.type,
        base64: bytes.toString("base64"),
      };
    }),
  );

  return {
    input,
    pdfs,
  };
}

async function runAnalysis(input: GenerateInput, pdfs: PdfInput[]) {
  const content = await callOpenAIJson({
    schemaName: "study_material_analysis",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "detectedGoal",
        "sourceType",
        "keyTopics",
        "recommendedStrategy",
        "extractedMaterial",
      ],
      properties: {
        detectedGoal: { type: "string" },
        sourceType: {
          type: "string",
          enum: ["concept", "comparison", "script", "definition", "mixed"],
        },
        keyTopics: { type: "array", items: { type: "string" } },
        recommendedStrategy: { type: "string" },
        extractedMaterial: { type: "string" },
      },
    },
    system:
      "당신은 학습 자료를 암기 가능한 형태로 바꾸기 전에 자료의 성격과 학습 목적을 분석하는 전문가입니다. PDF가 제공되면 텍스트와 시각 정보에서 학습에 필요한 내용을 읽고, 다음 단계가 그대로 사용할 수 있는 추출 자료를 만듭니다. 결과는 한국어 JSON만 반환합니다.",
    user: buildAnalysisPrompt(input, pdfs),
    files: pdfs,
    step: "analysis",
  });

  return analysisSchema.parse(content);
}

function buildAnalysisPrompt(input: GenerateInput, pdfs: PdfInput[]) {
  return [
    `제목: ${input.title || fallbackTitle}`,
    `과목: ${input.subject || "미지정"}`,
    `태그: ${input.tags.join(", ") || "없음"}`,
    `사용자 추가 지시사항: ${
      input.instruction || "없음. 자료 성격을 기준으로 자동 판단합니다."
    }`,
    "",
    pdfs.length > 0
      ? `분석할 PDF 파일 (${pdfs.length}개): ${pdfs
          .map((pdf) => pdf.filename)
          .join(", ")}`
      : "분석할 학습 자료:",
    input.sourceText || "텍스트 입력 없음. 첨부 PDF를 기준으로 분석합니다.",
    input.analysisContext
      ? `\n사용자가 확인한 사전 구조 분석 결과:\n${input.analysisContext}`
      : "",
    "",
    "해야 할 일:",
    "- 사용자가 공부하고 외워야 할 목표를 파악합니다.",
    "- 자료에서 실제로 암기해야 할 핵심 대상을 추립니다.",
    "- 자료 성격을 concept, comparison, script, definition, mixed 중 하나로 분류합니다.",
    "- 이후 암기자료 생성을 위한 추천 전략을 제안합니다.",
    "- extractedMaterial에는 2단계가 원문처럼 사용할 수 있는 핵심 학습 내용을 충분히 자세히 정리합니다.",
    "- PDF 안에 그림이나 슬라이드 구조가 의미를 가진다면 텍스트로 설명해 extractedMaterial에 포함합니다.",
    "- 불확실한 내용은 추측하지 말고 확인 가능한 내용 중심으로 씁니다.",
  ].join("\n");
}

async function runOrganization(
  input: GenerateInput,
  analysis: AnalysisResult,
) {
  const sourceForOrganization =
    analysis.extractedMaterial?.trim() || input.sourceText;
  const content = await callOpenAIJson({
    schemaName: "organized_study_material",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "sections"],
      properties: {
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "content"],
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      },
    },
    system:
      "당신은 원문 학습 자료를 암기하기 좋은 정리본으로 재구성하는 전문가입니다. 원문에 없는 사실을 과하게 추가하지 말고, 중요한 정의, 표현, 비교 관계를 보존합니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      `제목: ${input.title || analysis.keyTopics[0] || fallbackTitle}`,
      `사용자 추가 지시사항: ${input.instruction || "없음"}`,
      "",
      "1단계 분석 결과:",
      JSON.stringify(analysis, null, 2),
      "",
      "원문 자료:",
      sourceForOrganization,
      "",
      "해야 할 일:",
      "- 분석 결과에 맞게 학습용 정리본으로 재구성합니다.",
      "- 카드로 변환하기 쉽게 섹션을 나눕니다.",
      "- 원문의 중요한 표현과 자료의 의미를 보존합니다.",
      "- 비교 자료는 차이점이 드러나게 정리합니다.",
    ].join("\n"),
    step: "organize",
  });

  return organizedMaterialSchema.parse(content);
}

async function runCardGeneration(
  mode: StudyMode,
  organizedMaterial: OrganizedMaterial,
  analysis: AnalysisResult,
  instruction = "",
) {
  const analysisForCards = {
    detectedGoal: analysis.detectedGoal,
    sourceType: analysis.sourceType,
    keyTopics: analysis.keyTopics,
    recommendedStrategy: analysis.recommendedStrategy,
  };

  const content = await callOpenAIJson({
    schemaName: "memory_cards",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "front",
              "back",
              "clozeText",
              "answer",
              "answers",
              "hint",
              "tags",
              "basis",
            ],
            properties: {
              type: { type: "string", enum: ["flashcard", "cloze", "translation"] },
              front: { type: "string" },
              back: { type: "string" },
              clozeText: { type: "string" },
              answer: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
              hint: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              basis: { type: "string" },
            },
          },
        },
      },
    },
    system:
      "당신은 정리된 학습 자료를 사용자가 선택한 암기 카드 유형으로 변환하는 전문가입니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      `선택한 암기 유형: ${mode}`,
      `사용자 추가 지시사항: ${instruction || "없음"}`,
      "",
      "1단계 분석 결과:",
      JSON.stringify(analysisForCards, null, 2),
      "",
      "사용자가 검토하고 수정한 최종 학습 내용:",
      JSON.stringify(organizedMaterial, null, 2),
      "",
      "규칙:",
      "- 카드의 사실과 표현은 사용자가 검토한 최종 학습 내용에서만 가져옵니다.",
      "- 분석 결과는 학습 목표와 카드 구성 전략을 판단하는 용도로만 사용합니다.",
      "- flashcard 유형이면 type을 flashcard로 두고 front/back을 채웁니다. clozeText, answer, hint는 빈 문자열, answers는 빈 배열로 둡니다.",
      "- cloze 유형이면 type을 cloze로 두고 clozeText, answer, hint를 채웁니다. front/back은 빈 문자열로 둡니다.",
      "- translation 유형이면 type을 translation으로 두고 front에는 한국어 의미나 cue, back에는 외울 영어 문장을 넣습니다. clozeText, answer, hint는 빈 문자열, answers는 빈 배열로 둡니다.",
      "- translation 유형은 오픽, 영어 표현, 스크립트 자료에 적합합니다. 영어 문장 자체를 보존하고, front는 사용자가 영작할 수 있는 자연스러운 한국어 cue로 만듭니다.",
      "- translation 유형에서 '이 문장은 어떤 주제인가?' 같은 메타 질문은 만들지 않습니다.",
      "- clozeText에는 Anki 문법 {{c1::정답}}을 쓰지 않습니다.",
      "- clozeText의 정답 자리는 반드시 ____ 로 표시합니다. 예: TCP는 ____ 프로토콜이다.",
      "- answer에는 ____에 들어갈 정답만 씁니다.",
      "- 빈칸이 여러 개면 answers 배열에 빈칸 순서대로 정답을 넣고, answer에는 쉼표로 합친 값을 씁니다.",
      "- 선택한 유형이 자료와 완전히 맞지 않아도 사용자의 선택을 존중합니다.",
      "- 카드 하나에는 핵심 개념 하나만 담습니다.",
      "- 중복 카드는 만들지 않습니다.",
      "- basis에는 카드 생성 근거가 된 정리본 문장을 짧게 씁니다.",
    ].join("\n"),
    step: "cards",
  });

  const parsed = cardsSchema.parse(content);
  return parsed.cards.map<Card>((card) => {
    const answers =
      mode === "cloze"
        ? normalizeClozeAnswers(card.clozeText, card.answer, card.answers)
        : undefined;

    return {
      id: crypto.randomUUID(),
      type: mode,
      front: card.front || undefined,
      back: card.back || undefined,
      clozeText:
        mode === "cloze" && answers
          ? normalizeClozeText(card.clozeText, answers)
          : undefined,
      answer: answers?.join(", "),
      answers,
      hint: card.hint || undefined,
      tags: card.tags,
      status: "new",
      basis: card.basis || undefined,
    };
  });
}

function normalizeClozeText(clozeText: string, answers: string[]) {
  let nextText = clozeText.replace(
    /\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g,
    "____",
  );
  answers.forEach((answer) => {
    nextText = nextText.replace(answer, "____");
  });
  return nextText;
}

function normalizeClozeAnswers(
  clozeText: string,
  answer: string,
  answers: string[],
) {
  const clozeMatches = Array.from(
    clozeText.matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g),
  ).map((match) => match[1].trim());
  const candidates = clozeMatches.length > 0 ? clozeMatches : answers;
  const parsed = candidates.length > 0 ? candidates : splitAnswerText(answer);
  return parsed.filter(Boolean);
}

function splitAnswerText(answer: string) {
  return answer
    .split(/\n|,|;|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function callOpenAIJson({
  schemaName,
  schema,
  system,
  user,
  files,
  step,
}: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: PdfInput[];
  step: PipelineStep;
}) {
  try {
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
            content: system,
          },
          {
            role: "user",
            content: files && files.length > 0
              ? [
                  ...files.map((file) => ({
                    type: "input_file",
                    filename: file.filename,
                    file_data: `data:${file.mimeType};base64,${file.base64}`,
                  })),
                  {
                    type: "input_text",
                    text: user,
                  },
                ]
              : user,
          },
        ],
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

    if (!response.ok) {
      throw new PipelineError(step, stepMessages[step], data);
    }

    const outputText = extractOutputText(data);
    return JSON.parse(outputText) as unknown;
  } catch (error) {
    if (error instanceof PipelineError) {
      throw error;
    }
    throw new PipelineError(step, stepMessages[step], error);
  }
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
      (item): item is { type: string; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        "text" in item &&
        typeof item.text === "string",
    );

  if (textItem) {
    return textItem.text;
  }

  throw new Error("OpenAI 응답에서 JSON 텍스트를 찾지 못했습니다.");
}
