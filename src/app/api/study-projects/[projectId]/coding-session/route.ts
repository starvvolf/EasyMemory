import { NextResponse } from "next/server";
import {
  getActiveStudyCodingSession,
  startStudyCodingSession,
} from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    return NextResponse.json({ session: await getActiveStudyCodingSession(projectId) ?? null });
  } catch (error) {
    return NextResponse.json({ message: getMessage(error) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const input = await request.json() as Record<string, unknown>;
    const session = await startStudyCodingSession(projectId, {
      learningGoal: typeof input.learningGoal === "string" ? input.learningGoal : "",
      currentTask: typeof input.currentTask === "string" ? input.currentTask : "",
      workspaceLabel: typeof input.workspaceLabel === "string" ? input.workspaceLabel : undefined,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: getMessage(error) }, { status: 400 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "코딩 학습 세션을 처리하지 못했습니다.";
}
