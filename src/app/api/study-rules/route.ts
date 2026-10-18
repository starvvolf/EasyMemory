import { NextResponse } from "next/server";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { loadAgentRules, loadStudyRules } from "@/lib/study/rules";

export const runtime = "nodejs";

/** 학습규칙/: the day-plan rules (parsed, with warnings) and the agent rule lines. */
export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    const [today, agent] = await Promise.all([loadStudyRules(), loadAgentRules()]);
    return NextResponse.json({ today, agent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof UserDataHttpError ? error.status : 500;
    return NextResponse.json({ message: status === 500 ? "학습규칙을 읽지 못했어요." : (error as Error).message }, { status });
  }
}
