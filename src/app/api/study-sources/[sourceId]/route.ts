import { NextResponse } from "next/server";
import { deleteStudyProjectSource, loadStudyProjectSource } from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await context.params;
  const result = await loadStudyProjectSource(sourceId);
  if (!result) return NextResponse.json({ message: "PDF 소스를 찾지 못했습니다." }, { status: 404 });
  const encodedName = encodeURIComponent(result.source.fileName);
  return new Response(result.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(result.bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await context.params;
  return await deleteStudyProjectSource(sourceId)
    ? new Response(null, { status: 204 })
    : NextResponse.json({ message: "PDF 소스를 찾지 못했습니다." }, { status: 404 });
}
