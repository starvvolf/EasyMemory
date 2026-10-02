import { NextResponse } from "next/server";
import { getFirebaseStudyProject } from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { projectId } = await context.params;
    const detail = await getFirebaseStudyProject(user.uid, projectId);
    return detail
      ? NextResponse.json(detail)
      : NextResponse.json({ message: "학습 프로젝트를 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "학습 프로젝트를 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
