import { NextResponse } from "next/server";
import { listCloudDeckSummaries, saveCloudDeck } from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { Deck } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    return NextResponse.json({ decks: await listCloudDeckSummaries(user.uid, limit) });
  } catch (error) {
    const failure = toUserDataError(error, "덱 목록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message, currentRevision: failure.currentRevision }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const input = (await request.json()) as {
      deck?: Deck;
      operationId?: string;
      expectedRevision?: number;
    };
    if (!input.deck || !input.operationId) throw new Error("덱 저장 요청이 올바르지 않습니다.");
    return NextResponse.json({
      result: await saveCloudDeck(user.uid, input.deck, {
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
      }),
    });
  } catch (error) {
    const failure = toUserDataError(error, "덱을 저장하지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, currentRevision: failure.currentRevision },
      { status: failure.status },
    );
  }
}
