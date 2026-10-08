import { NextResponse } from "next/server";
import {
  listCloudStudySessions,
  startCloudStudySession,
} from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { Deck, StudySession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const url = new URL(request.url);
    return NextResponse.json({
      sessions: await listCloudStudySessions(
        user.uid,
        url.searchParams.get("deckId") ?? undefined,
        Number(url.searchParams.get("limit") ?? 100),
      ),
    });
  } catch (error) {
    const failure = toUserDataError(error, "학습 세션 목록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message, currentRevision: failure.currentRevision }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const input = (await request.json()) as {
      deck?: Deck;
      session?: StudySession;
      operationId?: string;
      expectedRevision?: number;
    };
    if (!input.deck || !input.session || !input.operationId) {
      throw new Error("학습 세션 시작 요청이 올바르지 않습니다.");
    }
    const revisions = await startCloudStudySession(user.uid, input.deck, input.session, {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
    });
    return NextResponse.json({ session: input.session, ...revisions }, { status: 201 });
  } catch (error) {
    const failure = toUserDataError(error, "학습 세션을 시작하지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, currentRevision: failure.currentRevision },
      { status: failure.status },
    );
  }
}
