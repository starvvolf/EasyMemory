import { NextResponse } from "next/server";
import {
  loadCloudStudySession,
  saveCloudStudySession,
} from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { StudySession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sessionId } = await context.params;
    const result = await loadCloudStudySession(user.uid, sessionId);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ message: "학습 세션을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "학습 세션을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sessionId } = await context.params;
    const input = (await request.json()) as {
      session?: StudySession;
      operationId?: string;
      expectedRevision?: number;
    };
    if (!input.session || input.session.id !== sessionId || !input.operationId) {
      throw new Error("학습 세션 저장 요청이 올바르지 않습니다.");
    }
    const revision = await saveCloudStudySession(user.uid, input.session, {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
    });
    return NextResponse.json({ session: input.session, revision });
  } catch (error) {
    const failure = toUserDataError(error, "학습 세션을 저장하지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, currentRevision: failure.currentRevision },
      { status: failure.status },
    );
  }
}
