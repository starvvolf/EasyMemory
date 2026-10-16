import { NextResponse } from "next/server";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { readMcpSourcePdf } from "@/lib/mcp-source-catalog";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    await requireExperimentPrincipal(request);
    const { sourceId } = await context.params;
    const bytes = await readMcpSourcePdf(sourceId);
    if (!bytes) return NextResponse.json({ message: "등록된 원본 PDF를 찾지 못했거나 파일이 변경되었습니다." }, { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const failure = toUserDataError(error, "원본 PDF를 열지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
