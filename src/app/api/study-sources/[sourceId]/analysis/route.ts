import { NextResponse } from "next/server";
import type { PdfAnalysisResult } from "@/lib/types";
import {
  getFirebaseStudyProjectSourceAnalysis,
  saveFirebaseStudyProjectSourceAnalysis,
} from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    const result = await getFirebaseStudyProjectSourceAnalysis(user.uid, sourceId);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ message: "PDF 소스를 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "PDF 분석 결과를 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    const input = await request.json() as {
      analysis?: PdfAnalysisResult;
      purpose?: "study" | "reading";
    };
    if (!input.analysis?.fileName || !input.analysis.sourceOutline) {
      throw new Error("저장할 PDF 분석 결과가 올바르지 않습니다.");
    }
    return NextResponse.json({
      source: await saveFirebaseStudyProjectSourceAnalysis(
        user.uid,
        sourceId,
        input.analysis,
        input.purpose === "reading" ? "reading" : "study",
      ),
    });
  } catch (error) {
    const failure = toUserDataError(error, "AI 강조 결과를 저장하지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status === 500 ? 400 : failure.status });
  }
}
