import { NextResponse } from "next/server";
import { deleteCloudDeck, loadCloudDeck } from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ deckId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { deckId } = await context.params;
    const result = await loadCloudDeck(user.uid, deckId);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ message: "덱을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "덱을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deckId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { deckId } = await context.params;
    const input = (await request.json()) as {
      operationId?: string;
      expectedRevision?: number;
    };
    if (!input.operationId) throw new Error("덱 삭제 작업 ID가 없습니다.");
    return (await deleteCloudDeck(user.uid, deckId, {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
    }))
      ? new Response(null, { status: 204 })
      : NextResponse.json({ message: "덱을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "덱을 삭제하지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, currentRevision: failure.currentRevision },
      { status: failure.status },
    );
  }
}
