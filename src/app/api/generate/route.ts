import { NextResponse } from "next/server";
import { z } from "zod";
import type {
  AnalysisResult,
  Card,
  CardStrategy,
  GeneratePipelineResult,
  KnowledgeType,
  LearningUnit,
  LearningUnitSample,
  OrganizedMaterial,
  ExampleSource,
  SlotMode,
  StudyMode,
} from "@/lib/types";
import {
  CRITIC_MODEL,
  CRITIC_REASONING_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  EXTRACTION_MODEL,
  EXTRACTION_REASONING_EFFORT,
  type ReasoningEffort,
} from "@/lib/model-config";

const requestSchema = z.object({
  title: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  tags: z.array(z.string()).default([]),
  sourceText: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  analysisContext: z.string().optional().default(""),
  studyGuideline: z.string().optional().default(""),
  recallDesign: z.string().optional().default(""),
  approvedSample: z.string().optional().default(""),
  sampleFeedback: z.string().optional().default(""),
  stage: z
    .enum(["full", "sample", "prepare", "cards"])
    .optional()
    .default("full"),
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

type CardContract = {
  mode: StudyMode;
  slotMode: SlotMode;
  exampleSource: ExampleSource;
  preservePlaceholders: boolean;
  cueExample: string;
  targetExample: string;
  supportingInfoExample: string;
  recallDesign: unknown;
  feedback: string;
  rules: string[];
};

const knowledgeTypes = [
  "vocabulary",
  "fact",
  "concept",
  "relationship",
  "procedure",
  "formula",
  "speaking_pattern",
  "writing_pattern",
  "problem_solving_pattern",
  "example",
  "other",
] as const satisfies readonly KnowledgeType[];

const cardStrategies = [
  "production",
  "recognition",
  "concept",
  "contrast",
  "procedure",
  "application",
] as const satisfies readonly CardStrategy[];

const variableSlotSchema = z.object({
  name: z.string(),
  example: z.string(),
});

const learningUnitSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  sourceText: z.string(),
  knowledgeType: z.enum(knowledgeTypes),
  fixedPart: z.string(),
  variableSlots: z.array(variableSlotSchema),
  generalizedForm: z.string(),
  intent: z.string(),
  rationale: z.string(),
});

const analysisSchema = z.object({
  detectedGoal: z.string(),
  sourceType: z.enum(["concept", "comparison", "script", "definition", "mixed"]),
  keyTopics: z.array(z.string()),
  recommendedStrategy: z.string(),
  extractedMaterial: z.string(),
  primaryKnowledgeType: z.enum(knowledgeTypes),
  learningUnits: z.array(learningUnitSchema).min(1),
});

const organizedMaterialSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
      learningUnitIds: z.array(z.string()),
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
  learningUnitId: z.string(),
  strategy: z.enum(cardStrategies),
  sourceId: z.string(),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  rationale: z.string(),
  difficulty: z.number().int().min(1).max(5),
  qualityPassed: z.boolean(),
  qualityNotes: z.array(z.string()),
});

const cardsSchema = z.object({
  cards: z.array(cardDraftSchema).min(1),
});

type CardGenerationBaselineTrace = {
  generatedCards: Array<z.infer<typeof cardDraftSchema>>;
  criticCards: Array<z.infer<typeof cardDraftSchema>>;
};

type GenerateCardsResponse = GeneratePipelineResult & {
  baselineTrace: CardGenerationBaselineTrace;
};

const learningUnitSampleSchema = z.object({
  title: z.string(),
  cue: z.string(),
  target: z.string(),
  supportingInfo: z.string(),
});

type PipelineStep = "sample" | "analysis" | "cards" | "critic";

const stepMessages: Record<PipelineStep, string> = {
  sample: "대표 학습 예시 생성에 실패했습니다.",
  analysis: "학습 자료 분석에 실패했습니다.",
  cards: "암기 카드 생성에 실패했습니다.",
  critic: "암기 카드 품질 검사에 실패했습니다.",
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

    if (input.stage === "sample") {
      if (!input.studyGuideline || !input.recallDesign) {
        return NextResponse.json(
          {
            message: "대표 예시에 사용할 학습 영역과 인출 방식이 필요합니다.",
            step: "input",
          },
          { status: 400 },
        );
      }

      const sample = await runSampleExtraction(input, pdfs);
      return NextResponse.json({ sample });
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
      const cardGeneration = await runCardGeneration(
        input.mode,
        organizedMaterial,
        analysis,
        input.instruction,
        input.studyGuideline,
        input.recallDesign,
        input.approvedSample,
        input.sampleFeedback,
      );

      return NextResponse.json({
        analysis,
        organizedMaterial,
        cards: cardGeneration.cards,
        baselineTrace: cardGeneration.baselineTrace,
      } satisfies GenerateCardsResponse);
    }

    const analysis = await runAnalysis(input, pdfs);
    const organizedMaterial = buildReviewMaterial(input, analysis);

    if (input.stage === "prepare") {
      return NextResponse.json({
        analysis,
        organizedMaterial,
        cards: [],
      } satisfies GeneratePipelineResult);
    }

    const cardGeneration = await runCardGeneration(
      input.mode,
      organizedMaterial,
      analysis,
      input.instruction,
      input.studyGuideline,
      input.recallDesign,
      input.approvedSample,
      input.sampleFeedback,
    );

    const result: GenerateCardsResponse = {
      analysis,
      organizedMaterial,
      cards: cardGeneration.cards,
      baselineTrace: cardGeneration.baselineTrace,
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
    studyGuideline: String(formData.get("studyGuideline") ?? ""),
    recallDesign: String(formData.get("recallDesign") ?? ""),
    approvedSample: String(formData.get("approvedSample") ?? ""),
    sampleFeedback: String(formData.get("sampleFeedback") ?? ""),
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
        "primaryKnowledgeType",
        "learningUnits",
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
        primaryKnowledgeType: {
          type: "string",
          enum: knowledgeTypes,
        },
        learningUnits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "sourceText",
              "knowledgeType",
              "fixedPart",
              "variableSlots",
              "generalizedForm",
              "intent",
              "rationale",
            ],
            properties: {
              id: { type: "string" },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              sourceText: { type: "string" },
              knowledgeType: { type: "string", enum: knowledgeTypes },
              fixedPart: { type: "string" },
              variableSlots: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "example"],
                  properties: {
                    name: { type: "string" },
                    example: { type: "string" },
                  },
                },
              },
              generalizedForm: { type: "string" },
              intent: { type: "string" },
              rationale: { type: "string" },
            },
          },
        },
      },
    },
    system:
      "당신은 학습 자료를 암기 가능한 형태로 바꾸기 전에 자료의 성격과 학습 목적을 분석하는 전문가입니다. PDF가 제공되면 텍스트와 시각 정보에서 학습에 필요한 내용을 읽고, 다음 단계가 그대로 사용할 수 있는 추출 자료를 만듭니다. 결과는 한국어 JSON만 반환합니다.",
    user: buildAnalysisPrompt(input, pdfs),
    files: pdfs,
    step: "analysis",
    model: EXTRACTION_MODEL,
    reasoningEffort: EXTRACTION_REASONING_EFFORT,
  });

  return analysisSchema.parse(content);
}

function buildAnalysisPrompt(input: GenerateInput, pdfs: PdfInput[]) {
  const usesSoftBudget = hasSoftCountPolicy(input.studyGuideline);
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
    input.studyGuideline
      ? `\n사용자가 확정한 학습 가이드:\n${input.studyGuideline}`
      : "",
    "",
    "해야 할 일:",
    "- 사용자가 공부하고 외워야 할 목표를 파악합니다.",
    "- 자료에서 실제로 암기해야 할 핵심 대상을 최소하고 독립적인 learningUnits로 추출합니다.",
    "- 자료 성격을 concept, comparison, script, definition, mixed 중 하나로 분류합니다.",
    `- 각 학습 단위를 지식 유형(${knowledgeTypes.join(", ")}) 중 하나로 분류하고 전체의 primaryKnowledgeType을 정합니다.`,
    "- 특정 유형을 미리 가정하지 않습니다. 자료에 근거가 없으면 speaking_pattern으로 억지 분류하지 않습니다.",
    "- sourceId에는 PDF 파일명 또는 direct-text를, sourcePage에는 확인 가능한 PDF 페이지 번호를 기록합니다. 페이지를 확인할 수 없으면 0을 씁니다.",
    "- sourceRange에는 페이지 안에서 원문을 다시 찾을 수 있는 제목·문단·문장 범위를 기록합니다.",
    "- sourceText에는 판단 근거가 된 원문을 보존합니다.",
    "- 반복 사용 가능한 패턴만 fixedPart와 variableSlots로 분리하고 generalizedForm에 일반화합니다.",
    "- 일반화하면 의미가 손실되는 지식은 fixedPart와 generalizedForm을 빈 문자열로 둡니다.",
    "- rationale에는 이 단위를 선택하고 분류한 이유를 자료 근거 중심으로 기록합니다.",
    "- 이후 암기자료 생성을 위한 추천 전략을 제안합니다.",
    "- extractedMaterial에는 추출한 학습 단위를 원문 확인용 목록으로 정리합니다. 카드 앞면·뒷면이나 Cue·Target 형태로 만들지 않습니다.",
    "- PDF 안에 그림이나 슬라이드 구조가 의미를 가진다면 텍스트로 설명해 extractedMaterial에 포함합니다.",
    "- 확정 학습 가이드에 selectedGroup이 있으면 그 영역만 추출하고 다른 영역의 내용은 제외합니다.",
    ...(usesSoftBudget
      ? [
          "- 학습 목표에 필요한 핵심 의미 단위를 빠짐없이 추출합니다.",
          "- 하나의 LearningUnit에는 하나의 명확한 학습 의도만 둡니다.",
          "- 관련은 있지만 독립적으로 인출해야 하는 대상을 숫자에 맞추기 위해 한 LearningUnit으로 합치지 않습니다.",
          "- soft budget을 채우기 위해 낮은 가치 내용, 반복 요약, 예시의 고유 정보 또는 메타데이터를 추가하지 않습니다.",
          "- learningUnitSoftBudget은 과다·과소 추출을 점검하는 참고 범위이며 정확한 개수 계약이 아닙니다.",
          "- 의미적 완결성과 원자성이 soft budget보다 우선합니다.",
        ]
      : [
          "- selectedGroup.itemCount에 적힌 개수만큼 독립 학습 단위를 빠짐없이 구분해 추출합니다.",
        ]),
    "- 패턴, 예문, 스크립트는 요약하지 말고 PDF의 원문 표현과 번역을 그대로 보존합니다.",
    "- 이 단계에서는 카드 형식, Cue, Target, 빈칸 또는 질문·답변을 만들지 않습니다.",
    "- 대표 예시와 인출 방식은 이후 카드 생성 단계가 적용하므로 여기서는 원문 지식 구조만 추출합니다.",
    "- 불확실한 내용은 추측하지 말고 확인 가능한 내용 중심으로 씁니다.",
  ].join("\n");
}

function buildReviewMaterial(
  input: GenerateInput,
  analysis: AnalysisResult,
) : OrganizedMaterial {
  return {
    title: input.title || analysis.keyTopics[0] || fallbackTitle,
    sections: (analysis.learningUnits ?? []).map((unit, index) => ({
      heading: unit.intent || `학습 단위 ${index + 1}`,
      content: unit.generalizedForm || unit.sourceText,
      learningUnitIds: [unit.id],
    })),
  };
}

async function runCardGeneration(
  mode: StudyMode,
  organizedMaterial: OrganizedMaterial,
  analysis: AnalysisResult,
  instruction = "",
  studyGuideline = "",
  recallDesign = "",
  approvedSample = "",
  sampleFeedback = "",
) {
  const usesSoftBudget = hasSoftCountPolicy(studyGuideline);
  const cardContract = buildCardContract(
    mode,
    approvedSample,
    recallDesign,
    sampleFeedback,
  );
  const learningUnitsForCards = selectLearningUnitsForCards(
    analysis,
    organizedMaterial,
  );
  const targetCardCount = usesSoftBudget
    ? undefined
    : learningUnitsForCards.length || getSelectedUnitCount(studyGuideline);
  const analysisForCards = {
    detectedGoal: analysis.detectedGoal,
    sourceType: analysis.sourceType,
    primaryKnowledgeType: analysis.primaryKnowledgeType,
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
          ...(usesSoftBudget
            ? { minItems: 1 }
            : targetCardCount
              ? { minItems: targetCardCount, maxItems: targetCardCount }
              : {}),
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
              "learningUnitId",
              "strategy",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "rationale",
              "difficulty",
              "qualityPassed",
              "qualityNotes",
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
              learningUnitId: { type: "string" },
              strategy: { type: "string", enum: cardStrategies },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              rationale: { type: "string" },
              difficulty: { type: "integer", minimum: 1, maximum: 5 },
              qualityPassed: { type: "boolean" },
              qualityNotes: { type: "array", items: { type: "string" } },
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
      `사용자가 확정한 학습 가이드: ${studyGuideline || "없음"}`,
      `사용자가 확정한 인출 방식: ${recallDesign || "없음"}`,
      `사용자가 확인한 대표 예시: ${approvedSample || "없음"}`,
      `대표 예시에 대한 사용자 피드백: ${sampleFeedback || "없음"}`,
      "승인된 카드 계약:",
      JSON.stringify(cardContract, null, 2),
      usesSoftBudget
        ? "카드 수: 의미 coverage와 자연스러운 retrieval target 수에 따라 결과적으로 결정"
        : targetCardCount
          ? `반드시 생성할 카드 수: ${targetCardCount}장`
          : "카드 수: 자료 분량에 맞게 판단",
      "",
      "1단계 분석 결과:",
      JSON.stringify(analysisForCards, null, 2),
      "",
      "구조화된 학습 단위와 원문 출처:",
      JSON.stringify(learningUnitsForCards, null, 2),
      "",
      "사용자가 검토하고 수정한 최종 학습 내용:",
      JSON.stringify(organizedMaterial, null, 2),
      "",
      "규칙:",
      "- 카드의 사실과 표현은 사용자가 검토한 최종 학습 내용에서만 가져옵니다.",
      "- learningUnit의 reviewedText가 있으면 sourceText나 generalizedForm보다 reviewedText를 카드 내용의 최종 기준으로 사용합니다.",
      ...(usesSoftBudget
        ? [
            "- 확정 학습 가이드의 선택 범위와 모든 핵심 LearningUnit의 의미 coverage를 반드시 따릅니다.",
            "- 각 LearningUnit은 최소 하나의 명확한 retrieval target을 가져야 합니다.",
            "- 하나의 LearningUnit에 자연스럽게 여러 독립 조건 분기가 있으면 1:N 카드 변환을 허용합니다.",
            "- 1:N 변환 때문에 다른 LearningUnit이 카드화되지 않아서는 안 됩니다.",
            "- 총 카드 수를 맞추기 위해 LearningUnit을 누락하지 않습니다.",
            "- LearningUnit 수와 Card 수를 동일하게 고정하지 않고 카드 수는 결과적으로 결정합니다.",
          ]
        : [
            "- 확정 학습 가이드가 있으면 선택 영역과 독립 학습 단위 수를 반드시 따릅니다.",
            "- 선택 영역의 독립 학습 단위 하나당 카드 하나를 만들고 다른 영역의 카드는 만들지 않습니다.",
          ]),
      "- 카드 앞면은 확정 인출 방식의 Cue, 뒷면은 Target이 되도록 구성합니다.",
      `- 각 학습 단위의 지식 구조에 따라 strategy를 ${cardStrategies.join(", ")} 중에서 선택합니다.`,
      "- production은 의미나 의도를 보고 표현을 생성할 때, recognition은 표현을 보고 의미를 확인할 때 사용합니다.",
      "- concept는 정의·핵심 원리를 인출할 때, contrast는 차이를 비교할 때, procedure는 순서를 인출할 때, application은 조건에 맞게 적용할 때 사용합니다.",
      "- 사용자가 선택한 카드 UI 유형은 유지하되, 앞면과 뒷면의 인출 방향은 strategy에 맞게 설계합니다.",
      "- 승인된 대표 예시와 사용자 피드백의 구조를 모든 카드에 동일하게 적용합니다.",
      "- CardContract의 cueExample과 targetExample은 문체와 정보 배치의 고정 계약입니다.",
      "- CardContract.slotMode가 template이면 각 학습 단위의 변수 자리를 빈칸 또는 플레이스홀더로 유지하고 구체적인 값으로 채우지 않습니다.",
      "- CardContract.slotMode가 filled_example이면 각 학습 단위의 변수 자리를 문맥에 맞는 구체적인 값으로 모두 채우고 빈칸을 남기지 않습니다.",
      "- 한 카드 안에서 template 방식과 filled_example 방식을 섞지 않습니다.",
      "- cueExample에 없던 과업 설명, 접두 문장 또는 메타 지시문을 front에 추가하지 않습니다.",
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
      "- basis에는 카드 생성 근거가 된 reviewedText 또는 원문 문장을 짧게 씁니다.",
      "- learningUnitId, sourceId, sourcePage, sourceRange는 해당 학습 단위 값을 그대로 복사합니다.",
      "- rationale에는 해당 카드 전략을 선택한 이유를 씁니다.",
      "- difficulty는 인출 길이와 추상성에 따라 1부터 5까지 평가합니다.",
      "- 이 단계의 qualityPassed는 임시로 false, qualityNotes는 빈 배열로 둡니다. 다음 단계에서 별도로 검수합니다.",
    ].join("\n"),
    step: "cards",
  });

  const generated = cardsSchema.parse(content);
  const parsed = await runCardCritic(
    generated.cards,
    learningUnitsForCards,
    targetCardCount,
    cardContract,
    usesSoftBudget,
  );
  const cards = parsed.map<Card>((card) => {
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
      learningUnitId: card.learningUnitId,
      strategy: card.strategy,
      sourceId: card.sourceId,
      sourcePage: card.sourcePage,
      sourceRange: card.sourceRange,
      rationale: card.rationale,
      difficulty: card.difficulty as 1 | 2 | 3 | 4 | 5,
      qualityPassed: card.qualityPassed,
      qualityNotes: card.qualityNotes,
    };
  });

  return {
    cards,
    baselineTrace: {
      generatedCards: generated.cards,
      criticCards: parsed,
    },
  };
}

function buildCardContract(
  mode: StudyMode,
  approvedSample: string,
  recallDesign: string,
  feedback: string,
): CardContract {
  const sample = parseJsonObject(approvedSample) as Partial<LearningUnitSample>;
  const parsedRecallDesign = parseJsonObject(recallDesign);
  const selectedVariant = isRecord(parsedRecallDesign.selectedVariant)
    ? parsedRecallDesign.selectedVariant
    : {};
  const slotMode =
    selectedVariant.slotMode === "filled_example"
      ? "filled_example"
      : "template";
  const exampleSource =
    selectedVariant.exampleSource === "generated" ? "generated" : "source";
  const preservePlaceholders =
    typeof selectedVariant.preservePlaceholders === "boolean"
      ? selectedVariant.preservePlaceholders
      : slotMode === "template";
  return {
    mode,
    slotMode,
    exampleSource,
    preservePlaceholders,
    cueExample: typeof sample.cue === "string" ? sample.cue : "",
    targetExample: typeof sample.target === "string" ? sample.target : "",
    supportingInfoExample:
      typeof sample.supportingInfo === "string" ? sample.supportingInfo : "",
    recallDesign: parsedRecallDesign,
    feedback,
    rules: [
      "대표 예시의 앞면·뒷면 문체와 정보 배치를 유지한다.",
      "카드 유형으로 행동이 명확하면 과업 설명을 추가하지 않는다.",
      "예시에 없는 '다음 뜻을', '영어로 말하세요', '번역하세요' 같은 메타 지시문을 추가하지 않는다.",
      slotMode === "template"
        ? "변수 자리를 빈칸 또는 플레이스홀더로 보존하고 임의의 값으로 채우지 않는다."
        : "변수 자리를 자연스러운 구체 값으로 모두 채우고 빈칸을 남기지 않는다.",
      "빈칸 유지형과 완성 예문형을 한 카드 안에서 섞지 않는다.",
      "한 카드에는 하나의 핵심 인출만 둔다.",
      "사실 오류와 원문 왜곡만 필요한 최소 범위에서 수정한다.",
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function selectLearningUnitsForCards(
  analysis: AnalysisResult,
  organizedMaterial: OrganizedMaterial,
): LearningUnit[] {
  const availableUnits = analysis.learningUnits ?? [];
  const hasUnitMapping = organizedMaterial.sections.some((section) =>
    Array.isArray(section.learningUnitIds),
  );

  if (!hasUnitMapping) return availableUnits;

  const selectedIds = new Set(
    organizedMaterial.sections.flatMap((section) => section.learningUnitIds ?? []),
  );
  const reviewedTextByUnitId = new Map(
    organizedMaterial.sections.flatMap((section) =>
      (section.learningUnitIds ?? []).map((id) => [id, section.content] as const),
    ),
  );
  const selectedUnits = availableUnits
    .filter((unit) => selectedIds.has(unit.id))
    .map((unit) => ({
      ...unit,
      reviewedText:
        reviewedTextByUnitId.get(unit.id) ??
        (unit.generalizedForm || unit.sourceText),
    }));
  const manualUnits = organizedMaterial.sections.flatMap((section, index) => {
    if (section.learningUnitIds?.length || !section.content.trim()) return [];

    return [
      {
        id: `manual-${index + 1}`,
        sourceId: "user-edited-material",
        sourcePage: 0,
        sourceRange: section.heading,
        sourceText: section.content,
        knowledgeType: analysis.primaryKnowledgeType ?? "other",
        fixedPart: "",
        variableSlots: [],
        generalizedForm: "",
        intent: section.heading || "사용자가 추가한 학습 내용",
        rationale: "사용자가 카드 생성 전 정리본에 직접 추가한 학습 단위입니다.",
        reviewedText: section.content,
      } satisfies LearningUnit,
    ];
  });

  return [...selectedUnits, ...manualUnits];
}

async function runCardCritic(
  cards: Array<z.infer<typeof cardDraftSchema>>,
  learningUnits: LearningUnit[],
  targetCardCount?: number,
  cardContract?: CardContract,
  usesSoftBudget = false,
) {
  const content = await callOpenAIJson({
    schemaName: "reviewed_memory_cards",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          ...(targetCardCount
            ? { minItems: targetCardCount, maxItems: targetCardCount }
            : { minItems: 1 }),
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
              "learningUnitId",
              "strategy",
              "sourceId",
              "sourcePage",
              "sourceRange",
              "rationale",
              "difficulty",
              "qualityPassed",
              "qualityNotes",
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
              learningUnitId: { type: "string" },
              strategy: { type: "string", enum: cardStrategies },
              sourceId: { type: "string" },
              sourcePage: { type: "integer", minimum: 0 },
              sourceRange: { type: "string" },
              rationale: { type: "string" },
              difficulty: { type: "integer", minimum: 1, maximum: 5 },
              qualityPassed: { type: "boolean" },
              qualityNotes: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    system:
      "당신은 암기 카드 품질 검사자입니다. 원문 학습 단위와 생성된 카드를 대조해 문제가 있는 카드는 직접 수정합니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      "원문에서 추출한 구조화 학습 단위:",
      JSON.stringify(learningUnits, null, 2),
      "",
      "검사할 카드:",
      JSON.stringify(cards, null, 2),
      "",
      "승인된 카드 계약:",
      JSON.stringify(cardContract, null, 2),
      "",
      "검사 기준:",
      "- 앞면만 보고 요구되는 답을 능동적으로 인출할 수 있어야 합니다.",
      "- 카드 하나에는 하나의 핵심 인출만 있어야 합니다.",
      "- 뒷면은 불필요하게 길지 않아야 합니다.",
      "- 단순 예문 복사가 아니라 재사용 가능한 지식이어야 합니다. 단, 일반화하면 의미가 손실되는 사실은 원문을 보존합니다.",
      "- learningUnitId와 출처가 실제 원문 학습 단위와 일치해야 합니다.",
      "- 원문에 없는 사실을 추가하거나 표현을 왜곡하면 안 됩니다.",
      "- reviewedText가 있으면 사용자가 확정한 내용이므로 카드 내용은 이를 우선합니다. sourceText는 출처 대조에만 사용합니다.",
      "- strategy가 지식 유형과 인출 방향에 맞아야 합니다.",
      "- Critic의 역할은 카드를 새로 개선하는 것이 아니라 계약 위반과 명백한 오류만 최소 수정하는 것입니다.",
      "- 대표 예시의 앞면·뒷면 문체와 정보 배치를 유지합니다.",
      "- CardContract.slotMode가 template이면 변수 자리를 보존하고, filled_example이면 모든 변수 자리를 구체적인 값으로 채웁니다.",
      "- template과 filled_example을 한 카드 안에서 섞지 않습니다.",
      "- 대표 예시 cue에 없던 과업 설명, 접두 문장 또는 메타 지시문을 추가하지 않습니다.",
      "- 카드 유형으로 학습 행동이 이미 명확하면 '다음 뜻을', '영어로 말하세요', '번역하세요' 같은 설명을 추가하지 않습니다.",
      "- 문제가 있으면 문제가 있는 최소 부분만 수정하고 qualityNotes에 수정 이유를 기록합니다.",
      "- 수정 후 모든 기준을 통과하면 qualityPassed를 true로 둡니다.",
      "- 원문 자체가 불충분해 해결할 수 없는 경우만 qualityPassed를 false로 두고 이유를 기록합니다.",
      ...(usesSoftBudget
        ? [
            "- 입력된 각 카드와 UI type을 유지하며 기존 카드의 품질만 수정합니다. 새 카드를 추가하거나 누락된 LearningUnit을 복구하지 않습니다.",
          ]
        : ["- 카드 수와 각 카드의 UI type은 유지합니다."]),
    ].join("\n"),
    step: "critic",
    model: CRITIC_MODEL,
    reasoningEffort: CRITIC_REASONING_EFFORT,
  });

  return cardsSchema.parse(content).cards;
}

async function runSampleExtraction(
  input: GenerateInput,
  pdfs: PdfInput[],
): Promise<LearningUnitSample> {
  const content = await callOpenAIJson({
    schemaName: "learning_unit_sample",
    schema: {
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
    system:
      "당신은 사용자가 선택한 인출 훈련 구조를 실제 학습 예시 하나로 구현하는 전문가입니다. 선택 영역에서 대표 단위 하나만 사용하며 다른 단위나 영역을 섞지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    user: [
      "PDF 구조 분석:",
      input.analysisContext || "없음",
      "",
      "선택한 학습 영역:",
      input.studyGuideline,
      "",
      "선택한 인출 방식:",
      input.recallDesign,
      "",
      "해야 할 일:",
      "- 선택 영역의 첫 번째 또는 가장 대표적인 실제 학습 단위 하나만 사용합니다.",
      "- cue에는 사용자가 보고 인출을 시작할 앞면 정보를 넣습니다.",
      "- target에는 사용자가 보지 않고 인출해야 할 정답 전체를 넣습니다.",
      "- supportingInfo에는 인출 정답은 아니지만 예시 확인에 필요한 보조 정보를 넣고, 없으면 빈 문자열로 둡니다.",
      "- PDF 원문의 표현, 번역, 예문을 임의로 바꾸거나 요약하지 않습니다.",
      "- 아직 나머지 학습 단위는 만들지 않습니다.",
    ].join("\n"),
    files: pdfs,
    step: "sample",
  });

  return learningUnitSampleSchema.parse(content);
}

function getSelectedUnitCount(studyGuideline: string) {
  if (!studyGuideline) {
    return undefined;
  }

  try {
    const guideline = JSON.parse(studyGuideline) as {
      selectedGroup?: { itemCount?: number };
    };
    const count = guideline.selectedGroup?.itemCount;
    return typeof count === "number" && count > 0 ? count : undefined;
  } catch {
    return undefined;
  }
}

function hasSoftCountPolicy(studyGuideline: string) {
  if (!studyGuideline) {
    return false;
  }

  try {
    const guideline = JSON.parse(studyGuideline) as {
      countPolicy?: string;
    };
    return guideline.countPolicy === "soft_budget";
  } catch {
    return false;
  }
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
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
}: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: PdfInput[];
  step: PipelineStep;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}) {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
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
