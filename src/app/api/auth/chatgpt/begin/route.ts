// ChatGPT 로그인을 평소 브라우저에서 시작하기 (11/15, 데스크톱 창에서 "여는 중…"에 멈추던 것):
// 데스크톱 창은 로그인 페이지를 평소 브라우저로 넘기는데, 로그인 확인 쿠키는 창 안에만 있어서 돌아온 브라우저가 확인을 못 했다.
// 그래서 브라우저가 이 주소부터 열어 쿠키를 브라우저에 받고 ChatGPT로 넘어간다. 끝나면 callback이 "창으로 돌아가세요" 글을 보여 준다.
import { NextResponse } from "next/server";
import { beginChatGptSignIn } from "@/lib/ai/chatgpt-auth";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!isLocalExperimentRequest(request)) return NextResponse.json({ error: "로컬 실험에서만 ChatGPT 연결을 사용할 수 있어요." }, { status: 403 });
    const caller = await requireExperimentPrincipal(request);
    if (caller.mode !== "local-experiment") return NextResponse.json({ error: "로컬 실험에서만 사용할 수 있어요." }, { status: 403 });
    const host = request.headers.get("host");
    if (!host) return NextResponse.json({ error: "로컬 주소를 확인하지 못했어요." }, { status: 400 });
    const result = await beginChatGptSignIn(caller.id, `http://${host}`);
    const response = NextResponse.redirect(result.url, { headers: { "Cache-Control": "no-store" } });
    const opts = { httpOnly: true, sameSite: "lax" as const, secure: false, path: "/api/auth/chatgpt/callback", maxAge: 600 };
    response.cookies.set("sf_chatgpt_oauth", result.cookie, opts);
    response.cookies.set("sf_chatgpt_external", "1", opts);
    return response;
  } catch {
    return NextResponse.json({ error: "ChatGPT 로그인 시작에 실패했어요." }, { status: 500 });
  }
}
