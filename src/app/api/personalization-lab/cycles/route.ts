import { NextResponse } from "next/server";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { listObjectiveCycles, loadObjectiveCycle } from "@/lib/personalization-lab/cycles";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ cycles: await listObjectiveCycles() }, { headers: { "Cache-Control": "private, no-store" } });
    const cycle = await loadObjectiveCycle(id);
    if (!cycle) return NextResponse.json({ message: "학습설계 실행 기록을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ cycle }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = toUserDataError(error, "학습설계 기록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
