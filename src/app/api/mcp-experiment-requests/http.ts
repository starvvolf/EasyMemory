import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { UserDataHttpError } from "@/lib/server-user";

export async function requireLocalRequest(request: Request) {
  const principal = await requireExperimentPrincipal(request);
  if (principal.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있습니다.");
}

export async function boundedJson(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new ExperimentRequestError(413, "요청 본문이 너무 큽니다.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new ExperimentRequestError(413, "요청 본문이 너무 큽니다.");
  try { return JSON.parse(text) as unknown; }
  catch { throw new ExperimentRequestError(400, "올바른 JSON이 아닙니다."); }
}

export function responseError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ message: "입력값이 올바르지 않습니다.", issues: error.issues }, { status: 400 });
  if (error instanceof ExperimentRequestError || error instanceof UserDataHttpError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json({ message: "요청을 처리하지 못했습니다." }, { status: 500 });
}
