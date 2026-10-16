import { NextResponse } from "next/server";
import { beginChatGptSignIn } from "@/lib/ai/chatgpt-auth";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isLocalExperimentRequest(request)) return NextResponse.json({ error: "로컬 실험에서만 ChatGPT 연결을 사용할 수 있어요." }, { status: 403 });
    const caller = await requireExperimentPrincipal(request);
    if (caller.mode !== "local-experiment") return NextResponse.json({ error: "로컬 실험에서만 사용할 수 있어요." }, { status: 403 });
    const host = request.headers.get("host");
    if (!host) return NextResponse.json({ error: "로컬 주소를 확인하지 못했어요." }, { status: 400 });
    const result = await beginChatGptSignIn(caller.id, `http://${host}`);
    const response = NextResponse.json({ url: result.url }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("sf_chatgpt_oauth", result.cookie, { httpOnly: true, sameSite: "lax", secure: false, path: "/api/auth/chatgpt/callback", maxAge: 600 });
    return response;
  } catch {
    return NextResponse.json({ error: "ChatGPT 로그인 시작에 실패했어요." }, { status: 500 });
  }
}
