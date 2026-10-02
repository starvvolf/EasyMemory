import { NextResponse } from "next/server";
import { getMcpRunView } from "@/lib/mcp-run-view";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    await requireExperimentPrincipal(request);
    const { runId } = await context.params;
    const run = await getMcpRunView(runId);
    if (!run) return NextResponse.json({ message: "실행 기록을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    const failure = toUserDataError(error, "실행 기록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
