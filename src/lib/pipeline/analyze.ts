import { NextResponse } from "next/server.js";
import { z } from "zod";
import type {
  LearningOutline,
  LearningStructureTag,
  PdfAnalysisResponse,
} from "../types.ts";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "../model-config.ts";
import { callCodexJson } from "../ai/codex-provider.ts";
import {
  findCodexRuntimeError,
  toCodexHttpError,
} from "../ai/codex-errors.ts";
import {
  type ApiUsageCapture,
} from "../api-usage.ts";

const maxFiles = 20;
const maxTotalBytes = 50 * 1024 * 1024;
const analysisBatchSize = 3;
const learningStructureTags = [
  "절차",
  "목록",
  "관계",
  "비교",
  "수치",
  "공식",
  "예외",
  "틀",
] as const satisfies readonly LearningStructureTag[];

class PdfAnalysisError extends Error {
  readonly status: number;
  readonly fileName?: string;

  constructor(
    message: string,
    status = 500,
    fileName?: string,
  ) {
    super(message);
    this.status = status;
    this.fileName = fileName;
  }
}

export const fileAnalysisSchema = z.object({
  documentType: z.string(),
  summary: z.string(),
  keyTopics: z.array(z.string()),
  outline: z.array(
    z.object({
      heading: z.string(),
      points: z.array(z.string()),
    }),
  ),
  sourceOutline: z.object({
    title: z.string(),
    summary: z.string(),
    nodes: z.array(
      z.object({
        id: z.string(),
        parentId: z.string().nullable(),
        order: z.number().int().min(1),
        title: z.string(),
        summary: z.string(),
        sourceRefs: z.array(
          z.object({
            sourceId: z.string().optional(),
            fileName: z.string(),
            pageNumbers: z.array(z.number().int().min(1)),
          }),
        ),
        sourceEvidence: z.string(),
        selectedByDefault: z.boolean(),
        structureTags: z
          .array(z.enum(learningStructureTags))
          .max(4)
          .transform((tags) => [...new Set(tags)]),
        importance: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.literal(3),
        ]),
      }),
    ).min(1).max(120),
  }),
  suggestedRole: z.string(),
});

export const pdfAnalysisResponseSchema = z.object({
  files: z.array(
    fileAnalysisSchema.extend({
      fileName: z.string(),
    }),
  ).min(1),
  sourceOutline: fileAnalysisSchema.shape.sourceOutline.optional(),
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "").trim() || undefined;
    const learningGoal = String(formData.get("learningGoal") ?? "").trim();
    const instruction = String(formData.get("instruction") ?? "").trim();
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
          ...(await analyzePdf(file, {}, { projectId, learningGoal, instruction })),
        })),
      );
      analyzedFiles.push(...batchResults);
    }

    const result: PdfAnalysisResponse = {
      files: analyzedFiles,
      sourceOutline: combineSourceOutlines(analyzedFiles),
    };
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

    const failure = toCodexHttpError(
      error,
      "PDF 분석 중 예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
    );
    if (failure.code !== "unknown") {
      return NextResponse.json(
        { message: failure.message, code: failure.code },
        { status: failure.status },
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

export async function analyzePdf(
  file: File,
  usage: ApiUsageCapture = {},
  context: { projectId?: string; learningGoal?: string; instruction?: string } = {},
) {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    void usage;
    const data = await callCodexJson({
      schemaName: "pdf_outline_analysis",
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      projectId: context.projectId,
      system:
        "당신은 학습 자료를 읽고 구조를 파악하는 분석가입니다. PDF의 실제 내용만 근거로 파일의 성격과 목차형 구조를 정리합니다. 결과는 한국어 JSON만 반환합니다.",
      user: [
        `파일명: ${file.name}`,
        `사용자 학습 목표: ${context.learningGoal || "없음. 자료가 명시한 중심 목적을 기준으로 예비 중요도를 판단합니다."}`,
        `사용자 추가 지시: ${context.instruction || "없음"}`,
        "목표: PDF의 실제 구성을 보존한 원문 목차와 예비 학습 우선순위를 만듭니다.",
        "",
        "출력:",
        "- documentType은 자료의 용도를 한 문장으로, summary는 2~3문장으로, keyTopics는 핵심 주제 3~8개로 씁니다.",
        "- sourceOutline에는 PDF에서 확인되는 장·절·소제목·번호 항목의 계층을 그대로 보존합니다. 문제 크기에 맞추려고 임의로 쪼개거나 합치지 않습니다.",
        "- outline은 같은 sourceOutline을 간단히 펼쳐 보여주는 요약입니다. 서로 다른 해석이나 새 목차를 만들지 않습니다.",
        "- suggestedRole은 이후 학습에서 이 파일이 맡을 역할을 한 문장으로 제안합니다.",
        "",
        "판단 기준:",
        "- 부모 노드는 묶음 역할만 하므로 sourceEvidence를 비우고, 최종 자식 노드에는 정확한 페이지와 필요한 최소 원문 근거를 둡니다.",
        "- importance는 3=자료 목적·사용자 목표의 중심, 2=중요한 뒷받침, 1=참고 맥락, 0=안내·반복·학습대상 아님입니다. 분량이나 반복 횟수만으로 높이지 않습니다.",
        `- structureTags는 실제 구조가 있을 때만 ${learningStructureTags.join(", ")} 중 최대 4개를 붙입니다. 무태그가 기본입니다. 절차=순서, 목록=항목 집합, 관계=원인·조건·입출력 연결, 비교=차이·공통점, 수치=외울 값, 공식=수식 관계, 예외=일반 규칙의 특수 경우, 틀=고정 표현과 교체 자리입니다.`,
        "- importance가 2 이상인 최종 자식만 selectedByDefault=true로 두고 부모는 false로 둡니다.",
        "- 문서에 없는 구조나 내용을 만들지 않으며, outline과 sourceOutline이 같은 자료 구조를 가리키는지 확인합니다.",
      ].join("\n"),
      files: [
        {
          filename: file.name,
          mimeType: file.type,
          base64: bytes.toString("base64"),
        },
      ],
      schema: {
            type: "object",
            additionalProperties: false,
            required: ["documentType", "summary", "keyTopics", "outline", "sourceOutline", "suggestedRole"],
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
              sourceOutline: {
                type: "object",
                additionalProperties: false,
                required: ["title", "summary", "nodes"],
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                  nodes: {
                    type: "array",
                    minItems: 1,
                    maxItems: 120,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["id", "parentId", "order", "title", "summary", "sourceRefs", "sourceEvidence", "selectedByDefault", "structureTags", "importance"],
                      properties: {
                        id: { type: "string" },
                        parentId: { type: ["string", "null"] },
                        order: { type: "integer", minimum: 1 },
                        title: { type: "string" },
                        summary: { type: "string" },
                        sourceRefs: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["fileName", "pageNumbers"],
                            properties: {
                              fileName: { type: "string" },
                              pageNumbers: { type: "array", items: { type: "integer", minimum: 1 } },
                            },
                          },
                        },
                        sourceEvidence: { type: "string" },
                        selectedByDefault: { type: "boolean" },
                        structureTags: { type: "array", maxItems: 4, items: { type: "string", enum: learningStructureTags } },
                        importance: { type: "integer", minimum: 0, maximum: 3 },
                      },
                    },
                  },
                },
              },
              suggestedRole: { type: "string" },
            },
      },
    });
    return fileAnalysisSchema.parse(data);
  } catch (error) {
    if (error instanceof PdfAnalysisError) {
      throw error;
    }

    if (findCodexRuntimeError(error)) {
      throw error;
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

export function combineSourceOutlines(
  files: Array<z.infer<typeof fileAnalysisSchema> & { fileName: string }>,
): LearningOutline {
  const nodes = files.flatMap((file, fileIndex) => {
    const prefix = `source-${fileIndex + 1}:`;
    return file.sourceOutline.nodes.map((node) => ({
      ...node,
      id: `${prefix}${node.id}`,
      parentId: node.parentId ? `${prefix}${node.parentId}` : null,
      order: fileIndex * 1000 + node.order,
        sourceRefs: node.sourceRefs.map((ref) => ({
          ...(ref.sourceId ? { sourceId: ref.sourceId } : {}),
          fileName: file.fileName,
        pageNumbers: ref.pageNumbers,
      })),
    }));
  });

  return {
    title: files.length === 1 ? files[0].sourceOutline.title : "업로드한 자료의 원문 구조",
    summary: "AI가 문제 단위로 재구성하기 전, PDF에서 확인한 장·절·항목 구조입니다.",
    nodes,
  };
}
