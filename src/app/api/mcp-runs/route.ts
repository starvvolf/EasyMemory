import { NextResponse } from "next/server";
import { listMcpRunViews } from "@/lib/mcp-run-view";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    return NextResponse.json({ runs: await listMcpRunViews() });
  } catch (error) {
    const failure = toUserDataError(error, "실행 기록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
