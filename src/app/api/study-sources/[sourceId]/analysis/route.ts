import { NextResponse } from "next/server";
import type { PdfAnalysisResult } from "@/lib/types";
import { saveStudyProjectSourceAnalysis } from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const { sourceId } = await context.params;
    const input = await request.json() as {
      analysis?: PdfAnalysisResult;
      purpose?: "study" | "reading";
    };
    if (!input.analysis?.fileName || !input.analysis.sourceOutline) {
      throw new Error("저장할 PDF 분석 결과가 올바르지 않습니다.");
    }
    return NextResponse.json({
      source: await saveStudyProjectSourceAnalysis(
        sourceId,
        input.analysis,
        input.purpose === "reading" ? "reading" : "study",
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "AI 강조 결과를 저장하지 못했습니다." },
      { status: 400 },
    );
  }
}
