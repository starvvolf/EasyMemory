import { NextResponse } from "next/server";
import { addStudyProjectSources } from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const formData = await request.formData();
    const files = formData.getAll("pdfs").filter((value): value is File => value instanceof File);
    return NextResponse.json({ sources: await addStudyProjectSources(projectId, files) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "PDF를 추가하지 못했습니다." },
      { status: 400 },
    );
  }
}
