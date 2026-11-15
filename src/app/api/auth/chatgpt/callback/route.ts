import { NextRequest, NextResponse } from "next/server";
import { finishChatGptSignIn } from "@/lib/ai/chatgpt-auth";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isLocalExperimentRequest(request)) return NextResponse.json({ error: "로컬 실험에서만 사용할 수 있어요." }, { status: 403 });
  const host = request.headers.get("host")!;
  let outcome = "connected";
  try {
    await finishChatGptSignIn(new URL(request.url).searchParams, request.cookies.get("sf_chatgpt_oauth")?.value);
  } catch { outcome = "connection-failed"; }
  // 평소 브라우저에서 시작한 로그인(begin): 앱을 브라우저에 다시 띄우지 않고, Recaller 창으로 돌아가라고만 알린다
  const external = request.cookies.get("sf_chatgpt_external")?.value === "1";
  const response = external
    ? new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Recaller</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#17191F;background:#F2F3F6"><div style="text-align:center"><h2>${outcome === "connected" ? "ChatGPT 연결이 끝났어요" : "ChatGPT 연결을 마치지 못했어요"}</h2><p>${outcome === "connected" ? "이 탭을 닫고 Recaller 창으로 돌아가세요." : "Recaller 창에서 [ChatGPT 로그인]을 다시 눌러 주세요."}</p></div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } })
    : NextResponse.redirect(`http://${host}/study?chatgpt=${outcome}`);
  response.cookies.set("sf_chatgpt_external", "", { httpOnly: true, sameSite: "lax", secure: false, path: "/api/auth/chatgpt/callback", maxAge: 0 });
  response.cookies.set("sf_chatgpt_oauth", "", { httpOnly: true, sameSite: "lax", secure: false, path: "/api/auth/chatgpt/callback", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
