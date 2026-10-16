import fs from "node:fs/promises";
import path from "node:path";

import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  EXTRACTION_MODEL,
  EXTRACTION_REASONING_EFFORT,
} from "../src/lib/model-config.ts";
import {
  buildReviewMaterial,
  runActivityDesign,
  runAnalysis,
  runCardGeneration,
  type GenerateInput,
} from "../src/lib/pipeline/generate.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below gives the useful error.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

const stamp = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = path.resolve("eval/local/actual-engine-student-smoke");

const cases = [
  {
    id: "social-game-economy-student",
    sourceName: "KDI 학생용 워크북 「게임, 경제를 캐리하라!」 읽기자료",
    pdfPath: "tmp/high-school-student-samples/kdi-game-economy-student.pdf",
    ocrArtifact:
      "eval/local/pdf-ocr-v1/2026-08-16T153220713Z-kdi-game-economy-student-selected.json",
    learningGoal:
      "GDP와 경제 성장의 뜻, 생산 요소 증가·혁신·산업 연관 효과를 이해하고, 게임 산업의 사례가 경제 성장에 기여하는 방식을 근거와 함께 구분해 설명한다.",
    advice:
      "GDP의 포함·제외 기준, 생산 요소 증가와 혁신의 차이, 산업 연관 효과의 뜻과 종류, 게임 산업 사례를 근거에 연결하는 판단을 우선한다. 특정 연도 매출 수치, 프로그램 안내, 빈 활동지는 그 자체를 암기 대상으로 만들지 않는다.",
    maxUnits: 12,
  },
  {
    id: "science-stars-spectrum-student",
    sourceName: "고등학교 1학년 학생용 통합과학·정보 교재의 별과 스펙트럼 단원",
    pdfPath: "tmp/high-school-student-samples/kosac-integrated-science-info-student.pdf",
    pageNumbers: [34, 35, 36, 37, 39, 40],
    learningGoal:
      "별의 형성과 핵융합에 따른 원소 형성을 설명하고, 연속·선·흡수 스펙트럼의 생성 조건을 구분하여 관측된 스펙트럼으로 천체 정보를 해석한다.",
    advice:
      "원시별 형성, 핵융합과 원소 생성, 별의 질량에 따른 생성 원소의 차이, 세 스펙트럼의 모습과 생성 조건, 흡수선으로 알 수 있는 정보를 우선한다. 그림자 예술 활동 절차와 자기평가표는 암기 대상으로 만들지 않는다.",
    maxUnits: 10,
  },
] as const;

async function extractPdfPages(pdfPath: string, pageNumbers: readonly number[]) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await fs.readFile(path.resolve(pdfPath)));
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (const pageNumber of pageNumbers) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({
      pageNumber,
      text: content.items
        .map((item) => "str" in item ? item.str : "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return pages;
}

async function loadPages(evalCase: typeof cases[number]) {
  if ("ocrArtifact" in evalCase) {
    const artifact = JSON.parse(
      await fs.readFile(path.resolve(evalCase.ocrArtifact), "utf8"),
    ) as { pages: Array<{ pageNumber: number; text: string }> };
    return artifact.pages;
  }
  return extractPdfPages(evalCase.pdfPath, evalCase.pageNumbers);
}

function summarizeCounts(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

await fs.mkdir(outputDirectory, { recursive: true });

for (const evalCase of cases) {
  const pages = await loadPages(evalCase);
  const sourceText = pages
    .map((page) => `[PDF ${page.pageNumber}쪽]\n${page.text}`)
    .join("\n\n");
  const instruction = [
    `학습 목표: ${evalCase.learningGoal}`,
    `문제 만들기 방향: ${evalCase.advice}`,
  ].join("\n");
  const studyGuideline = JSON.stringify({
    countPolicy: "soft_budget",
    wholeDocumentCore: {
      learningGoal: evalCase.learningGoal,
      maxLearningUnitCount: evalCase.maxUnits,
    },
    learningUnitSoftBudget: { max: evalCase.maxUnits },
  });
  const generateInput: GenerateInput = {
    title: evalCase.sourceName,
    subject: "",
    tags: [],
    sourceText,
    instruction,
    analysisContext: "학생이 직접 읽는 고등학교 학습자료의 선택 단원",
    studyGuideline,
    activityDesign: "",
    activitySelectionMode: "automatic",
    stage: "prepare",
    preparedAnalysis: "",
    preparedMaterial: "",
    mode: "flashcard",
  };
  const usage: ApiTokenUsage[] = [];
  const analysis = await runAnalysis(generateInput, [], {
    model: EXTRACTION_MODEL,
    reasoningEffort: EXTRACTION_REASONING_EFFORT,
    sourceName: evalCase.sourceName,
    experimentId: `${evalCase.id}-${stamp}`,
    usageStage: "prepare",
    onUsage: (value) => {
      usage.push(value);
    },
  });
  const material = buildReviewMaterial(generateInput, analysis);
  const design = await runActivityDesign(analysis, material, {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    instruction,
    sourceName: evalCase.sourceName,
    experimentId: `${evalCase.id}-${stamp}`,
    onUsage: (value) => {
      usage.push(value);
    },
  });
  const generation = await runCardGeneration(
    "flashcard",
    material,
    analysis,
    instruction,
    studyGuideline,
    "",
    "",
    "",
    JSON.stringify(design),
    {
      activitySelectionMode: "automatic",
      cards: {
        model: DEFAULT_MODEL,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        compactInput: true,
        sourceName: evalCase.sourceName,
        experimentId: `${evalCase.id}-${stamp}`,
        onUsage: (value) => {
          usage.push(value);
        },
      },
    },
  );
  const includedRecommendations = design.recommendations.filter(
    (item) => item.includeInGeneration,
  );
  const generatedUnitIds = generation.cards.map((card) => card.learningUnitId ?? "");
  const machineIssues = generation.cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  if (new Set(generatedUnitIds).size !== generatedUnitIds.length) {
    machineIssues.push("하나의 학습내용에서 문제가 둘 이상 생성되었습니다.");
  }
  if (generation.cards.length !== includedRecommendations.length) {
    machineIssues.push("선택된 문제 설계서 수와 최종 문제 수가 다릅니다.");
  }
  const outputPath = path.join(outputDirectory, `${evalCase.id}-${stamp}.json`);
  const result = {
    artifactType: "study-forge-actual-engine-student-smoke",
    completedAt: new Date().toISOString(),
    source: {
      name: evalCase.sourceName,
      pdfPath: path.resolve(evalCase.pdfPath),
      selectedPages: pages.map((page) => page.pageNumber),
    },
    input: {
      learningGoal: evalCase.learningGoal,
      advice: evalCase.advice,
      maxUnits: evalCase.maxUnits,
    },
    analysis,
    material,
    activityDesign: design,
    cards: generation.cards,
    baselineTrace: generation.baselineTrace,
    checks: {
      learningUnitCount: analysis.learningUnits?.length ?? 0,
      includedProblemCount: includedRecommendations.length,
      cardCount: generation.cards.length,
      operationCounts: summarizeCounts(
        (analysis.learningUnits ?? []).map((unit) => unit.operation ?? "recall"),
      ),
      activityTypeCounts: summarizeCounts(
        generation.cards.map((card) => card.activityType ?? "flashcard"),
      ),
      machineIssues,
    },
    usage,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(JSON.stringify({ id: evalCase.id, outputPath, checks: result.checks, usage }));
}
