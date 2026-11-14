import { NextResponse } from "next/server";
import { modelBackend } from "@/lib/ai/model";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";

export const runtime = "nodejs";

// 머리의 ChatGPT 칩(AccountChip): 지금 AI를 부를 수 있는지. (11/15 리팩토링: 예전 /api/study-executor GET 자리)
export async function GET(request: Request) {
  try {
    const who = await requireExperimentPrincipal(request);
    const backend = modelBackend();
    const model = await backend.status({ uid: who.id });
    return NextResponse.json({ provider: backend.name, model: { ready: model.ready, message: model.message } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof UserDataHttpError ? error.status : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "상태를 읽지 못했어요." }, { status });
  }
}
