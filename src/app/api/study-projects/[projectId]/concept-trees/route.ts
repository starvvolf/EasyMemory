import { NextResponse } from "next/server";
import { saveFirebaseStudyProjectConceptTree } from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { LearningConceptTree } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { projectId } = await context.params;
    const body = await request.json() as {
      tree?: LearningConceptTree;
      sourceIds?: string[];
    };
    if (!body.tree) {
      return NextResponse.json({ message: "저장할 학습트리가 없습니다." }, { status: 400 });
    }
    const conceptTree = await saveFirebaseStudyProjectConceptTree(
      user.uid,
      projectId,
      body.tree,
      Array.isArray(body.sourceIds) ? body.sourceIds : [],
    );
    return NextResponse.json({ conceptTree });
  } catch (error) {
    const failure = toUserDataError(error, "학습트리를 저장하지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status === 500 ? 400 : failure.status });
  }
}
