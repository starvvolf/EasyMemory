import { NextResponse } from "next/server";
import { getStudyProject } from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const detail = await getStudyProject(projectId);
    return detail
      ? NextResponse.json(detail)
      : NextResponse.json({ message: "학습 프로젝트를 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "학습 프로젝트를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
