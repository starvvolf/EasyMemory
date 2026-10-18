import { NextResponse } from "next/server";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { serverPlan } from "@/lib/study/plan-server";

export const runtime = "nodejs";

/**
 * 오늘 할 것 for agents (docs/학습흐름_자동화.md): the plan, subjects, materials, materials still being made, memory files
 * and rules. ?date=YYYY-MM-DD plans that day as of 8 a.m. (e.g. tomorrow, for an evening brief). Read only.
 */
export async function GET(request: Request) {
  try {
    const who = await requireExperimentPrincipal(request);
    if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
    const date = new URL(request.url).searchParams.get("date");
    const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
    if (date && !match) throw new UserDataHttpError(400, "date는 YYYY-MM-DD 형식이어야 해요.");
    const now = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 8).getTime() : Date.now();
    return NextResponse.json(await serverPlan(who.id, now), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof UserDataHttpError ? error.status : 500;
    return NextResponse.json({ message: status === 500 ? "오늘 할 것을 계산하지 못했어요." : (error as Error).message }, { status });
  }
}
