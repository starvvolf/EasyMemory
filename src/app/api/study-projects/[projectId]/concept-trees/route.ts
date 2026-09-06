import { NextResponse } from "next/server";
import { saveStudyProjectConceptTree } from "@/lib/study-project-store";
import type { LearningConceptTree } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const body = await request.json() as {
      tree?: LearningConceptTree;
      sourceIds?: string[];
    };
    if (!body.tree) {
      return NextResponse.json({ message: "저장할 학습트리가 없습니다." }, { status: 400 });
    }
    const conceptTree = await saveStudyProjectConceptTree(
      projectId,
      body.tree,
      Array.isArray(body.sourceIds) ? body.sourceIds : [],
    );
    return NextResponse.json({ conceptTree });
  } catch (error) {
    const message = error instanceof Error ? error.message : "학습트리를 저장하지 못했습니다.";
    const status = message.includes("찾지 못") ? 404 : 400;
    return NextResponse.json({ message }, { status });
  }
}
