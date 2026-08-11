import { NextResponse } from "next/server";
import { z } from "zod";
import type { PdfAnalysisResponse } from "@/lib/types";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "@/lib/model-config";

const maxFiles = 20;
const maxTotalBytes = 50 * 1024 * 1024;
const analysisBatchSize = 3;

class PdfAnalysisError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly fileName?: string,
  ) {
    super(message);
  }
}

const fileAnalysisSchema = z.object({
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
});

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { message: "OPENAI_API_KEY 환경변수가 필요합니다." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll("pdfs")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length === 0) {
      return NextResponse.json(
        { message: "분석할 PDF 파일을 한 개 이상 선택하세요." },
        { status: 400 },
      );
    }

    if (files.length > maxFiles) {
      return NextResponse.json(
        { message: `한 번에 최대 ${maxFiles}개의 PDF를 분석할 수 있습니다.` },
        { status: 400 },
      );
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxTotalBytes) {
      return NextResponse.json(
        { message: "PDF 전체 용량은 최대 50MB까지 분석할 수 있습니다." },
        { status: 400 },
      );
    }

    if (files.some((file) => file.type !== "application/pdf")) {
      return NextResponse.json(
        { message: "PDF 파일만 업로드할 수 있습니다." },
        { status: 400 },
      );
    }

    const analyzedFiles = [];
    for (let index = 0; index < files.length; index += analysisBatchSize) {
      const batch = files.slice(index, index + analysisBatchSize);
      const batchResults = await Promise.all(
        batch.map(async (file) => ({
          fileName: file.name,
          ...(await analyzePdf(file)),
        })),
      );
      analyzedFiles.push(...batchResults);
    }

    const result: PdfAnalysisResponse = { files: analyzedFiles };
    return NextResponse.json(result);
  } catch (error) {
    console.error("pdf analysis failed", error);

    if (error instanceof PdfAnalysisError) {
      return NextResponse.json(
        {
          message: error.message,
          fileName: error.fileName,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        message:
          "PDF 분석 중 예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
      },
      { status: 500 },
    );
  }
}

async function analyzePdf(file: File) {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
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
            "당신은 학습 자료를 읽고 구조를 파악하는 분석가입니다. PDF의 실제 내용만 근거로 파일의 성격과 목차형 구조를 정리합니다. 결과는 한국어 JSON만 반환합니다.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: file.name,
              file_data: `data:${file.type};base64,${bytes.toString("base64")}`,
            },
            {
              type: "input_text",
              text: [
                `파일명: ${file.name}`,
                "해야 할 일:",
                "- 이 자료가 무엇을 위한 자료인지 documentType에 한 문장으로 씁니다.",
                "- summary에는 실제 내용에 기반한 2~3문장 요약을 씁니다.",
                "- keyTopics에는 핵심 주제를 3~8개 추립니다.",
                "- outline에는 문서의 실제 장, 절, 슬라이드 흐름을 목차처럼 정리합니다. 각 heading에는 핵심 내용을, points에는 1~4개의 요점을 넣습니다.",
                "- suggestedRole에는 이후 학습 카드 생성에서 이 파일이 맡을 역할을 한 문장으로 제안합니다.",
                "- 문서에 없는 목차나 내용을 추측해 만들지 않습니다.",
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pdf_outline_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["documentType", "summary", "keyTopics", "outline", "suggestedRole"],
            properties: {
              documentType: { type: "string" },
              summary: { type: "string" },
              keyTopics: { type: "array", items: { type: "string" } },
              outline: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["heading", "points"],
                  properties: {
                    heading: { type: "string" },
                    points: { type: "array", items: { type: "string" } },
                  },
                },
              },
              suggestedRole: { type: "string" },
            },
          },
        },
      },
    }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new PdfAnalysisError(
        getOpenAIErrorMessage(data),
        response.status,
        file.name,
      );
    }

    return fileAnalysisSchema.parse(JSON.parse(extractOutputText(data)));
  } catch (error) {
    if (error instanceof PdfAnalysisError) {
      throw error;
    }

    if (error instanceof TypeError && error.message === "fetch failed") {
      throw new PdfAnalysisError(
        "AI 분석 서버에 연결하지 못했습니다. 네트워크 연결 또는 API 서버 상태를 확인한 뒤 다시 시도하세요.",
        503,
        file.name,
      );
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new PdfAnalysisError(
        "AI가 이 파일의 분석 결과를 올바른 형식으로 만들지 못했습니다. 다시 시도하세요.",
        502,
        file.name,
      );
    }

    throw new PdfAnalysisError(
      "PDF 분석 처리 중 알 수 없는 오류가 발생했습니다. 파일 문제로 단정할 수 없으니 다시 시도해 보세요.",
      500,
      file.name,
    );
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

  throw new Error("OpenAI 응답에서 분석 결과를 찾지 못했습니다.");
}

function getOpenAIErrorMessage(data: unknown) {
  const error = data as { error?: { message?: unknown; code?: unknown } };
  const message = error.error?.message;
  const code = error.error?.code;

  if (typeof message === "string") {
    const safeMessage = message
      .replace(/sk-[A-Za-z0-9_-]+/g, "[숨김]")
      .slice(0, 240);
    return `AI 분석 요청이 거절되었습니다: ${safeMessage}${
      typeof code === "string" ? ` (${code})` : ""
    }`;
  }

  return "AI 분석 요청이 거절되었습니다. 잠시 후 다시 시도하세요.";
}
