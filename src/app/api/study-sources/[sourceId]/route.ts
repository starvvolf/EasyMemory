import { NextResponse } from "next/server";
import {
  deleteFirebaseStudyProjectSource,
  loadFirebaseStudyProjectSource,
} from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    const result = await loadFirebaseStudyProjectSource(user.uid, sourceId);
    if (!result) return NextResponse.json({ message: "PDF 소스를 찾지 못했습니다." }, { status: 404 });
    const encodedName = encodeURIComponent(result.source.fileName);
    return new Response(Uint8Array.from(result.bytes), {
      headers: {
        "Content-Type": result.source.mimeType,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    const failure = toUserDataError(error, "PDF 소스를 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sourceId } = await context.params;
    return await deleteFirebaseStudyProjectSource(user.uid, sourceId)
      ? new Response(null, { status: 204 })
      : NextResponse.json({ message: "PDF 소스를 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    const failure = toUserDataError(error, "PDF 소스를 삭제하지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
