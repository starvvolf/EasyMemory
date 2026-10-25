import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ModelError } from "@/lib/ai/model";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { requireLocalRequest } from "@/app/api/mcp-experiment-requests/http";

export { boundedJson } from "@/app/api/mcp-experiment-requests/http";
export type RouteContext = { params: Promise<{ path?: string[] }> };

/** The new study routes are local only, like the lab: loopback, launched in local experiment mode, same origin. */
export async function guard(request: Request) {
  if (!isLocalExperimentRequest(request)) throw Object.assign(new Error("로컬 실험 모드에서만 사용할 수 있어요."), { status: 403 });
  await requireLocalRequest(request);
}
export function fail(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ message: "입력값이 올바르지 않아요.", issues: error.issues.slice(0, 5) }, { status: 400 });
  if (error instanceof ModelError) {
    const status = error.code === "usage_limit" ? 429 : error.code === "login_required" || error.code === "not_configured" ? 401 : 502;
    return NextResponse.json({ message: error.message, code: error.code }, { status });
  }
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했어요.";
  return NextResponse.json({ message: status === 500 && !(error instanceof Error) ? "요청을 처리하지 못했어요." : message }, { status });
}
