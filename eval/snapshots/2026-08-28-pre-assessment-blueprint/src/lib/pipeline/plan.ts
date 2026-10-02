import { NextResponse } from "next/server.js";
import { z } from "zod";
import type {
  LearningOutline,
  LearningStructureTag,
  PdfAnalysisResponse,
  StudyGuidelineDraft,
  WholeDocumentCorePlan,
} from "../types.ts";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "../model-config.ts";
import { callCodexJson } from "../ai/codex-provider.ts";
import {
  type ApiUsageCapture,
} from "../api-usage.ts";

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
  learningGoal: z.string().optional().default(""),
  selectedSourceOutline: z.unknown().optional(),
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
});

const learningOutlineNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  order: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  sourceRefs: z.array(
    z.object({
      fileName: z.string(),
      pageNumbers: z.array(z.number().int().min(1)),
    }),
  ),
  sourceEvidence: z.string(),
  selectedByDefault: z.boolean(),
  structureTags: z
    .array(z.enum(learningStructureTags))
    .max(4)
    .default([])
    .transform((tags) => [...new Set(tags)]),
  importance: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]).default(2),
});

export const learningOutlineSchema = z.object({
  title: z.string(),
  summary: z.string(),
  nodes: z.array(learningOutlineNodeSchema).min(1).max(100),
});

export const wholeDocumentCoreSchema = z.object({
  summary: z.string(),
  learningGoal: z.string(),
  selectionRationale: z.string(),
  areas: z.array(wholeDocumentCoreAreaSchema).min(1).max(12),
  exclusions: z.array(z.string()),
  maxLearningUnitCount: z.number().int().min(1).max(200),
});

export type PlanPdfInput = {
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

export const studyGuidelineDraftSchema = responseSchema;

export async function POST(request: Request) {
  try {
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
        input.learningGoal,
        {},
        input.selectedSourceOutline as LearningOutline | undefined,
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
    const draft = await createGuideline(
      input.analysis,
      input.instruction,
      input.learningGoal,
    );
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
    learningGoal: String(formData.get("learningGoal") ?? ""),
    selectedSourceOutline: formData.get("selectedSourceOutline")
      ? JSON.parse(String(formData.get("selectedSourceOutline")))
      : undefined,
    runMode: String(formData.get("runMode") ?? ""),
  });
  if (input.selectedSourceOutline) {
    input.selectedSourceOutline = learningOutlineSchema.parse(
      input.selectedSourceOutline,
    );
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

export async function createWholeDocumentCorePlan(
  analysis: PdfAnalysisResponse,
  instruction: string,
  pdfs: PlanPdfInput[],
  learningGoal = "",
  usage: ApiUsageCapture = {},
  selectedSourceOutline?: LearningOutline,
): Promise<WholeDocumentCorePlan> {
  void usage;
  const prompt = [
    "PDF 구조 분석 결과:",
    JSON.stringify(analysis, null, 2),
    "",
    "사용자가 원문 목차에서 선택한 범위:",
    selectedSourceOutline
      ? JSON.stringify(selectedSourceOutline, null, 2)
      : "별도 선택 없음. 전체 분석 범위를 사용합니다.",
    "",
    `사용자 학습 목표: ${learningGoal || "없음. 자료 학습 후 실제 상황에서 무엇을 할 수 있어야 하는지 기준으로 자동 설정합니다."}`,
    `사용자 추가 지시사항: ${instruction || "없음"}`,
    "",
    "목표: 사용자가 선택한 원문 범위 안에서 무엇을 왜 학습할지 결정합니다. 원문 목차를 다시 만들거나 문제 단위로 나누지 않습니다.",
    "",
    "우선순위:",
    "- 사용자 학습 목표가 있으면 최우선으로 따릅니다. 없으면 자료 학습 후 실제로 기억·적용·수행할 수 있어야 하는 행동을 learningGoal로 정합니다.",
    "- 사용자가 선택한 최종 항목과 필요한 상위 맥락만 사용합니다. 선택하지 않은 섹션은 다시 포함하지 않습니다.",
    "- 실제 학습할 지식·규칙·패턴·교과 절차는 areas에, 설명용 예시·반복·학습 방법·문서 안내는 exclusions에 이유와 함께 둡니다. 예시 자체가 학습 목표일 때만 area가 될 수 있습니다.",
    "- 교과 내용을 수행하는 절차는 학습 대상이고, 자료를 공부하는 방법은 기본적으로 제외 대상입니다. 사용자가 학습 방법 자체를 목표로 한 경우는 예외입니다.",
    "- 상위 요약과 하위 세부처럼 의미가 겹치는 area를 중복 생성하지 않으며, 분량·반복 횟수·문서 위치만으로 우선순위를 정하지 않습니다.",
    "",
    "출력 기준:",
    "- areas는 서로 구분되는 핵심 의미 범위입니다. sourceScope에는 Analyze의 실제 제목·ID·페이지 범위를, learningValue에는 학습해야 하는 이유를 씁니다.",
    "- exclusions에는 선택 범위 안에서 제외하거나 낮은 우선순위로 둔 내용과 이유를 씁니다. 사용자의 선택을 몰래 삭제하지 않습니다.",
    "- maxLearningUnitCount는 독립적으로 질문·판정할 수 있는 핵심 단위를 수용하는 과다 추출 안전선입니다. 채울 목표나 area 개수가 아니며, 관계 전체가 한 목표면 구성요소 수만큼 늘리지 않습니다.",
    "- 원문 목차의 계층·제목·태그·중요도·ID를 변경하지 않습니다. 문제 하나의 크기로 나누는 일은 Prepare 단계에 맡깁니다.",
    "- 제공된 분석과 PDF 근거 밖의 내용을 추가하지 않습니다.",
  ].join("\n");

  const data = await callCodexJson({
    schemaName: "whole_document_core_plan",
    schema: wholeDocumentCoreJsonSchema,
    system:
      "당신은 사용자가 선택한 원문 범위에서 학습 목표와 우선순위를 정하는 학습 설계자입니다. 원문 구조는 바꾸지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    user: prompt,
    files: pdfs,
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  });

  return normalizeWholeDocumentCorePlan(
    wholeDocumentCoreSchema.parse(data),
    selectedSourceOutline,
  );
}

function normalizeWholeDocumentCorePlan(
  plan: z.infer<typeof wholeDocumentCoreSchema>,
  selectedSourceOutline?: LearningOutline,
): WholeDocumentCorePlan {
  if (selectedSourceOutline) {
    const normalizedOutline = learningOutlineSchema.parse(selectedSourceOutline);
    validateLearningOutline(normalizedOutline);
    const parentIds = new Set(
      normalizedOutline.nodes.flatMap((node) =>
        node.parentId ? [node.parentId] : [],
      ),
    );
    const selectedLeafCount = normalizedOutline.nodes.filter(
      (node) => node.selectedByDefault && !parentIds.has(node.id),
    ).length;
    return {
      ...plan,
      learningOutline: normalizedOutline,
      maxLearningUnitCount: Math.max(
        plan.maxLearningUnitCount,
        selectedLeafCount,
      ),
    };
  }

  return plan;
}

function validateLearningOutline(
  outline: z.infer<typeof learningOutlineSchema>,
) {
  const ids = new Set(outline.nodes.map((node) => node.id));
  if (ids.size !== outline.nodes.length) {
    throw new Error("Learning outline contains duplicate node IDs.");
  }

  const parentIds = new Set(
    outline.nodes.flatMap((node) => node.parentId ? [node.parentId] : []),
  );
  for (const node of outline.nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      throw new Error(`Learning outline node ${node.id} has an unknown parent.`);
    }
    const isLeaf = !parentIds.has(node.id);
    if (!isLeaf && (node.selectedByDefault || node.sourceEvidence.trim())) {
      throw new Error(`Learning outline parent ${node.id} must only organize children.`);
    }
    if (
      isLeaf &&
      (!node.sourceEvidence.trim() ||
        node.sourceRefs.length === 0 ||
        node.sourceRefs.some((ref) => ref.pageNumbers.length === 0))
    ) {
      throw new Error(`Learning outline leaf ${node.id} is missing source evidence.`);
    }
  }
}

async function createGuideline(
  analysis: PdfAnalysisResponse,
  instruction: string,
  learningGoal = "",
): Promise<StudyGuidelineDraft> {
  const data = await callCodexJson({
    schemaName: "study_guideline_draft",
    schema: guidelineJsonSchema,
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    system:
      "당신은 문서의 구조를 학습 가능한 영역으로 나누는 학습 설계자입니다. 사용자가 자료의 어느 부분에 집중할지 고를 수 있도록 실제 문서 구조와 개수를 정확히 설명합니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
            "PDF 구조 분석 결과:",
            JSON.stringify(analysis, null, 2),
            "",
            `사용자 학습 목표: ${learningGoal || "없음. 자료 학습 후 실제 상황에서 무엇을 할 수 있어야 하는지 기준으로 자동 설정합니다."}`,
            `사용자 추가 지시사항: ${instruction || "없음"}`,
            "",
            "이 자료를 사용자가 선택할 수 있는 주요 학습 영역으로 나누세요.",
            "",
            "규칙:",
            "- 사용자 학습 목표가 있으면 최우선으로 사용합니다.",
            "- 중요도 판단 전에 핵심 지식/규칙/패턴/교과 절차, 구체적 예시, 자료 학습 방법, 반복 요약/문서 안내/메타정보를 구분합니다.",
            "- groups에는 실제 목표에서 기억·적용·수행해야 하는 핵심만 넣고 예시는 근거로 사용합니다. 학습 방법과 문서 안내는 해당 방법 자체가 목표가 아닌 한 제외합니다.",
            "- 상위 요약과 하위 세부 내용처럼 의미가 겹치는 groups를 동시에 만들지 않으며 반복 빈도만으로 추천하지 않습니다.",
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
  });
  const parsed = responseSchema.parse(data);
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
    "maxLearningUnitCount",
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
        },
      },
    },
    exclusions: { type: "array", items: { type: "string" } },
    maxLearningUnitCount: {
      type: "integer",
      minimum: 1,
      maximum: 200,
    },
  },
} as const;

