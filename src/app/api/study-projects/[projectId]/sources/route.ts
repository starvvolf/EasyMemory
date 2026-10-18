import { NextResponse } from "next/server";
import { addFirebaseStudyProjectSources } from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { projectId } = await context.params;
    const formData = await request.formData();
    const files = formData.getAll("pdfs").filter((value): value is File => value instanceof File);
    return NextResponse.json({ sources: await addFirebaseStudyProjectSources(user.uid, projectId, files) }, { status: 201 });
  } catch (error) {
    const failure = toUserDataError(error, "PDF를 추가하지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status === 500 ? 400 : failure.status });
  }
}
