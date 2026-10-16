import fs from "node:fs/promises";
import path from "node:path";

import { validateLearningActivity } from "../src/lib/learning-activity.ts";
import { runActivityDesign, runCardGeneration } from "../src/lib/pipeline/generate.ts";
import type { ApiTokenUsage } from "../src/lib/api-usage.ts";
import type {
  AnalysisResult,
  LearningUnit,
  OrganizedMaterial,
} from "../src/lib/types.ts";

const MODEL = "gpt-5.6-terra";
const REASONING_EFFORT = "medium" as const;
const outlineDirectory = path.resolve("eval/local/adaptive-learning-outline-v1");
const sourceOutlineDirectory = path.resolve("eval/local/analyze-outline-v1");
const ocrDirectory = path.resolve("eval/local/pdf-ocr-v1");
const outputDirectory = path.resolve("eval/local/outline-one-question-v1");
const selectedCases = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["bill-of-rights"];

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // The explicit key check below reports the problem.
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다.");

type LearningOutlineNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  directSourceNodeIds: string[];
};

type SourceNode = {
  id: string;
  title: string;
  summary: string;
  sourceRange: string;
};

async function extractPdfPages(pdfPath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await fs.readFile(pdfPath));
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = new Map<number, string>();
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.set(pageNumber, text);
  }
  return pages;
}

function pageNumbers(sourceRange: string) {
  const numbers = [...sourceRange.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length === 2 && sourceRange.includes("~")) {
    const [start, end] = numbers;
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  }
  return [...new Set(numbers)];
}

async function latestFile(directory: string, id: string) {
  const filename = (await fs.readdir(directory))
    .filter((item) => item.endsWith(`-${id}.json`))
    .sort()
    .at(-1);
  if (!filename) throw new Error(`${id}: 필요한 실험 결과가 없습니다.`);
  return path.join(directory, filename);
}

async function latestOptionalFile(directory: string, id: string) {
  try {
    return await latestFile(directory, id);
  } catch {
    return null;
  }
}

function leafNodes(nodes: LearningOutlineNode[]) {
  const parentIds = new Set(nodes.map((node) => node.parentId).filter(Boolean));
  return nodes.filter((node) => !parentIds.has(node.id));
}

await fs.mkdir(outputDirectory, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "");
const summary = [];

for (const id of selectedCases) {
  const outlinePath = await latestFile(outlineDirectory, id);
  const sourceOutlinePath = await latestFile(sourceOutlineDirectory, id);
  const ocrPath = await latestOptionalFile(ocrDirectory, id);
  const outlineArtifact = JSON.parse(await fs.readFile(outlinePath, "utf8")) as {
    source: { filename: string };
    result: { title: string; summary: string; nodes: LearningOutlineNode[] };
  };
  const sourceArtifact = JSON.parse(await fs.readFile(sourceOutlinePath, "utf8")) as {
    source: { pdfPath?: string };
    result: { nodes: SourceNode[] };
  };
  const ocrArtifact = ocrPath
    ? JSON.parse(await fs.readFile(ocrPath, "utf8")) as {
        pages: Array<{ pageNumber: number; text: string }>;
      }
    : null;
  const pdfPages = ocrArtifact
    ? new Map(ocrArtifact.pages.map((page) => [page.pageNumber, page.text]))
    : sourceArtifact.source.pdfPath
      ? await extractPdfPages(sourceArtifact.source.pdfPath)
      : new Map<number, string>();
  const sourceById = new Map(sourceArtifact.result.nodes.map((node) => [node.id, node]));
  const leaves = leafNodes(outlineArtifact.result.nodes);
  const learningUnits: LearningUnit[] = leaves.map((node) => {
    const evidence = node.directSourceNodeIds
      .map((sourceId) => sourceById.get(sourceId))
      .filter((source): source is SourceNode => Boolean(source));
    const finalContent = [
      `목차: ${node.title}`,
      `목차가 담는 내용: ${node.summary}`,
      ...evidence.map((source) => `원문 근거 — ${source.title}: ${source.summary}`),
      ...[...new Set(evidence.flatMap((source) => pageNumbers(source.sourceRange)))]
        .flatMap((pageNumber) => {
          const text = pdfPages.get(pageNumber);
          return text ? [`해당 원문 페이지 ${pageNumber}: ${text}`] : [];
        }),
    ].join("\n");
    return {
      id: node.id,
      sourceId: outlineArtifact.source.filename,
      sourcePage: 0,
      sourceRange: [...new Set(evidence.map((source) => source.sourceRange))].join("; "),
      sourceText: finalContent,
      reviewedText: finalContent,
      knowledgeType: "other",
      fixedPart: "",
      variableSlots: [],
      generalizedForm: "",
      target: node.summary,
      successCriterion: `${node.title} 목차의 핵심 내용을 문제의 요구에 맞게 정확히 답한다.`,
      rationale: "적응형 학습 목차의 마지막 항목 하나를 문제 하나로 변환",
    };
  });
  const analysis: AnalysisResult = {
    detectedGoal: outlineArtifact.result.summary,
    sourceType: "mixed",
    keyTopics: leaves.map((node) => node.title),
    recommendedStrategy: "최종 목차 하나당 현재 앱이 직접 채점할 수 있는 문제 하나",
    learningUnits,
  };
  const material: OrganizedMaterial = {
    title: outlineArtifact.result.title,
    sections: learningUnits.map((unit) => ({
      heading: leaves.find((node) => node.id === unit.id)?.title ?? unit.id,
      content: unit.reviewedText ?? unit.sourceText,
      learningUnitIds: [unit.id],
    })),
  };
  let designUsage: ApiTokenUsage | null = null;
  const design = await runActivityDesign(analysis, material, {
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    sourceName: outlineArtifact.source.filename,
    experimentId: `outline-one-question-design-${runStamp}-${id}`,
    onUsage: (usage) => {
      designUsage = usage;
    },
  });
  const generationDesign = {
    recommendations: design.recommendations.map((item) => ({
      ...item,
      includeInGeneration:
        item.recommendedType !== null && item.supportLevel !== "unsupported",
    })),
  };
  const cardUsage: ApiTokenUsage[] = [];
  const generatableCount = generationDesign.recommendations.filter(
    (item) => item.includeInGeneration,
  ).length;
  const generation = generatableCount > 0
    ? await runCardGeneration(
        "flashcard",
        material,
        analysis,
        "최종 목차 하나당 문제 하나만 생성한다. 목차의 일부만 임의로 골라 범위를 축소하지 않는다.",
        "",
        "",
        "",
        "",
        JSON.stringify(generationDesign),
        {
          activitySelectionMode: "manual",
          cards: {
            model: MODEL,
            reasoningEffort: REASONING_EFFORT,
            compactInput: true,
            sourceName: outlineArtifact.source.filename,
            experimentId: `outline-one-question-cards-${runStamp}-${id}`,
            onUsage: (usage) => {
              cardUsage.push(usage);
            },
          },
        },
      )
    : { cards: [], baselineTrace: { generatedCards: [], criticCards: [] } };
  const machineIssues = generation.cards.flatMap((card) =>
    validateLearningActivity(card).map((issue) => `${card.learningUnitId}: ${issue}`),
  );
  if (generation.cards.length !== generatableCount) {
    machineIssues.push("문제 생성 대상으로 선택한 목차 수와 생성 문제 수가 다릅니다.");
  }
  const outputPath = path.join(outputDirectory, `${runStamp}-${id}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({
      artifactType: "study-forge-outline-one-question-smoke",
      artifactVersion: "v1",
      completedAt: new Date().toISOString(),
      source: { id, filename: outlineArtifact.source.filename, outlinePath, sourceOutlinePath, ocrPath },
      model: { name: MODEL, reasoningEffort: REASONING_EFFORT, criticEnabled: false },
      leafOutlines: leaves,
      analysis,
      activityDesign: design,
      generationDesign,
      generatedCards: generation.cards,
      machineIssues,
      usage: { design: designUsage, cards: cardUsage },
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const supportCounts = design.recommendations.reduce<Record<string, number>>((counts, item) => {
    counts[item.supportLevel] = (counts[item.supportLevel] ?? 0) + 1;
    return counts;
  }, {});
  summary.push({
    id,
    outputPath,
    leafOutlineCount: leaves.length,
    supportCounts,
    generatedCardCount: generation.cards.length,
    machineIssues,
    usage: { design: designUsage, cards: cardUsage },
  });
  console.log(JSON.stringify(summary.at(-1)));
}

const summaryPath = path.join(outputDirectory, `${runStamp}-summary.json`);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({ summaryPath }));
