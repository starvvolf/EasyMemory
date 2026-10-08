import { createHash } from "node:crypto";
import type { PdfAnalysisResult } from "../../src/lib/types.ts";
import {
  getActiveStudyCodingSession,
  getStudyProject,
  listStudyProjects,
  loadStudyProjectSource,
  saveStudyProjectSourceAnalysis,
} from "../../src/lib/study-project-store.ts";
import type { StudyProjectDetail } from "../../src/lib/study-project-types.ts";
import type { MaterialRecord, ProjectGenerationConfig } from "./types.ts";

export type ResolvedProjectMaterial = {
  material: MaterialRecord;
  projectId: string;
  sourceIds: string[];
  sourceChecksums: Record<string, string>;
  sources: Array<{
    sourceId: string;
    fileName: string;
    mimeType: string;
    content: string;
    checksum: string;
    cachedAnalysis?: PdfAnalysisResult;
  }>;
};

export class ProjectSourceAdapter {
  async listProjects() {
    return listStudyProjects();
  }

  async getProject(projectId: string) {
    const detail = await getStudyProject(projectId);
    if (!detail) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    return summarizeProject(detail);
  }

  async getActiveCodingSession(projectId?: string) {
    return getActiveStudyCodingSession(projectId);
  }

  async resolve(
    projectId: string,
    sourceIds: string[],
    config: ProjectGenerationConfig,
  ): Promise<ResolvedProjectMaterial> {
    const detail = await getStudyProject(projectId);
    if (!detail) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    const uniqueSourceIds = [...new Set(sourceIds)];
    if (uniqueSourceIds.length === 0) throw new Error("sourceIds를 한 개 이상 선택하세요.");
    if (uniqueSourceIds.length !== sourceIds.length) throw new Error("sourceIds에 중복이 있습니다.");
    if (uniqueSourceIds.length > 20) throw new Error("한 run에는 PDF를 최대 20개까지 선택할 수 있습니다.");
    const sourceById = new Map(detail.sources.map((source) => [source.id, source]));
    const selected = uniqueSourceIds.map((sourceId) => {
      const source = sourceById.get(sourceId);
      if (!source) throw new Error(`프로젝트에 속하지 않은 PDF 소스입니다: ${sourceId}`);
      return source;
    });
    const sources = await Promise.all(selected.map(async (source) => {
      const loaded = await loadStudyProjectSource(source.id);
      if (!loaded) throw new Error(`PDF 소스를 찾지 못했습니다: ${source.id}`);
      const actualChecksum = sha256Hex(loaded.bytes);
      if (actualChecksum !== source.checksum) {
        throw new Error(`${source.fileName} 원본 체크섬이 변경되었습니다. PDF를 다시 추가하세요.`);
      }
      const content = await extractPdfText(loaded.bytes);
      if (!content) throw new Error(`${source.fileName}에서 텍스트를 추출하지 못했습니다. OCR은 아직 지원하지 않습니다.`);
      return {
        sourceId: source.id,
        fileName: source.fileName,
        mimeType: source.mimeType,
        content,
        checksum: source.checksum,
        cachedAnalysis: source.analysis?.sourceChecksum === source.checksum
          ? source.analysis.result
          : undefined,
      };
    }));
    const sourceChecksums = Object.fromEntries(sources.map((source) => [source.sourceId, source.checksum]));
    const materialId = `project-${projectId}-${sha256Hex(Buffer.from(uniqueSourceIds.join("\n"))).slice(0, 12)}`;
    const combinedContent = sources.map((source) => (
      `[자료 ${source.fileName} | sourceId=${source.sourceId}]\n${source.content}`
    )).join("\n\n");
    return {
      projectId,
      sourceIds: uniqueSourceIds,
      sourceChecksums,
      sources,
      material: {
        id: materialId,
        title: config.title?.trim() || detail.project.name,
        description: config.description ?? "",
        learningGoal: config.learningGoal,
        instruction: config.instruction,
        mode: config.mode,
        subject: config.subject,
        tags: config.tags,
        sourceExpressionMode: config.sourceExpressionMode ?? "adapt",
        activitySelectionMode: config.activitySelectionMode ?? "automatic",
        source: {
          fileName: sources.map((source) => source.fileName).join(", "),
          mimeType: "application/pdf",
          content: combinedContent,
        },
      },
    };
  }

  async saveStudyAnalysis(sourceId: string, result: PdfAnalysisResult) {
    await saveStudyProjectSourceAnalysis(sourceId, result, "study");
  }
}

function summarizeProject(detail: StudyProjectDetail) {
  return {
    project: detail.project,
    sources: detail.sources.map((source) => ({
      ...source,
      analysisAvailable: source.analysis?.sourceChecksum === source.checksum,
      readingAnalysisAvailable: source.readingAnalysis?.sourceChecksum === source.checksum,
    })),
  };
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  if (document.numPages > 500) throw new Error("PDF는 최대 500쪽까지 처리할 수 있습니다.");
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(`[PDF ${pageNumber}쪽]\n${text}`);
      page.cleanup();
    }
  } finally {
    await document.cleanup();
  }
  return pages.join("\n\n").trim();
}

function sha256Hex(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
