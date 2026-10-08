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
  const response = NextResponse.redirect(`http://${host}/study?chatgpt=${outcome}`);
  response.cookies.set("sf_chatgpt_oauth", "", { httpOnly: true, sameSite: "lax", secure: false, path: "/api/auth/chatgpt/callback", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
