import { NextResponse } from "next/server";
import { signOutChatGpt } from "@/lib/ai/chatgpt-auth";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isLocalExperimentRequest(request)) return NextResponse.json({ error: "로컬 실험에서만 사용할 수 있어요." }, { status: 403 });
    const caller = await requireExperimentPrincipal(request);
    const result = await signOutChatGpt(caller.id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ChatGPT 로그아웃에 실패했어요." }, { status: 500 });
  }
}
