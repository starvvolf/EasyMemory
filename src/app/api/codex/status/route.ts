import { NextResponse } from "next/server";
import { assertLocalCodexRequest, getCodexAppServer } from "@/lib/codex-app-server";
import { toCodexHttpError } from "@/lib/ai/codex-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalCodexRequest(request);
    const server = await getCodexAppServer();
    const account = await server.getAccount();
    let rateLimits: Record<string, unknown> | null = null;
    if (account.account?.type === "chatgpt") {
      try {
        rateLimits = await server.getRateLimits();
      } catch {
        rateLimits = null;
      }
    }
    return NextResponse.json({ connected: true, ...account, rateLimits });
  } catch (error) {
    const failure = toCodexHttpError(error, "Codex 연결 상태를 확인하지 못했습니다.");
    return NextResponse.json(
      {
        connected: false,
        account: null,
        message: failure.message,
        code: failure.code,
      },
      { status: failure.status === 500 ? 503 : failure.status },
    );
  }
}
