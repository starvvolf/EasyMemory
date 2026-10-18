import { NextResponse } from "next/server";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { listMcpSourceCatalog } from "@/lib/mcp-source-catalog";
import { toUserDataError } from "@/lib/server-user";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { McpSourceError, registerMcpSource } from "@/lib/mcp-source-registry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    return NextResponse.json({ sources: await listMcpSourceCatalog() });
  } catch (error) {
    const failure = toUserDataError(error, "자료 목록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    if (!isLocalExperimentRequest(request)) {
      return NextResponse.json({ message: "로컬 실험에서만 자료를 등록할 수 있습니다." }, { status: 403 });
    }
    const declaredBytes = Number(request.headers.get("content-length") || 0);
    if (declaredBytes > 51 * 1024 * 1024) return NextResponse.json({ message: "요청 크기가 너무 큽니다." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) return NextResponse.json({ message: "pdf 파일이 필요합니다." }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ message: "PDF는 50MB 이하여야 합니다." }, { status: 413 });
    const source = await registerMcpSource(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    if (error instanceof McpSourceError) return NextResponse.json({ message: error.message }, { status: error.status });
    const failure = toUserDataError(error, "원본 PDF를 등록하지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
