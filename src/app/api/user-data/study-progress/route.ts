import { NextResponse } from "next/server";
import { saveCloudStudyProgress } from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { Deck, StudyAttempt, StudySession } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const input = (await request.json()) as {
      deck?: Deck;
      session?: StudySession;
      attempt?: StudyAttempt;
      operationId?: string;
      expectedRevision?: number;
    };
    if (!input.deck || !input.session || !input.attempt || !input.operationId) {
      throw new Error("학습 진행 저장 요청이 올바르지 않습니다.");
    }
    const revisions = await saveCloudStudyProgress(
      user.uid,
      { deck: input.deck, session: input.session, attempt: input.attempt },
      { operationId: input.operationId, expectedRevision: input.expectedRevision },
    );
    return NextResponse.json({ ok: true, ...revisions });
  } catch (error) {
    const failure = toUserDataError(error, "학습 진행을 저장하지 못했습니다.");
    return NextResponse.json({ message: failure.message, currentRevision: failure.currentRevision }, { status: failure.status });
  }
}
