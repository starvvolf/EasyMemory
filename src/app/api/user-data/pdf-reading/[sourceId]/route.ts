import { NextResponse } from "next/server";
import {
  getCloudPdfReadingPositionState,
  saveCloudPdfReadingPosition,
} from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    return NextResponse.json({
      ...(await getCloudPdfReadingPositionState(user.uid, sourceId)),
    });
  } catch (error) {
    const failure = toUserDataError(error, "PDF 읽기 위치를 불러오지 못했습니다.");
    return NextResponse.json(
      {
        message: failure.message,
        code: failure.code,
        currentRevision: failure.currentRevision,
      },
      { status: failure.status },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    const input = (await request.json()) as {
      page?: unknown;
      expectedRevision?: unknown;
      operationId?: unknown;
    };
    const page = typeof input.page === "number" ? input.page : Number.NaN;
    const expectedRevision =
      typeof input.expectedRevision === "number" ? input.expectedRevision : undefined;
    return NextResponse.json({
      position: await saveCloudPdfReadingPosition(
        user.uid,
        sourceId,
        page,
        expectedRevision,
        typeof input.operationId === "string" ? input.operationId : undefined,
      ),
    });
  } catch (error) {
    const failure = toUserDataError(error, "PDF 읽기 위치를 저장하지 못했습니다.");
    return NextResponse.json(
      {
        message: failure.message,
        code: failure.code,
        currentRevision: failure.currentRevision,
      },
      { status: failure.status },
    );
  }
}
