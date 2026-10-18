import { NextResponse } from "next/server";
import { assertLocalCodexRequest, getCodexAppServer } from "@/lib/codex-app-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalCodexRequest(request);
    const server = await getCodexAppServer();
    const models = await server.listModels();
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "사용 가능한 모델을 조회하지 못했습니다." },
      { status: 503 },
    );
  }
}
