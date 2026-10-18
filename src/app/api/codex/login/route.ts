import { NextResponse } from "next/server";
import { assertLocalCodexRequest, getCodexAppServer } from "@/lib/codex-app-server";
import { toCodexHttpError } from "@/lib/ai/codex-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalCodexRequest(request);
    const server = await getCodexAppServer();
    const result = await server.startChatGptLogin();
    return NextResponse.json(result);
  } catch (error) {
    const failure = toCodexHttpError(error, "ChatGPT 로그인을 시작하지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, code: failure.code },
      { status: failure.status },
    );
  }
}
