import { NextResponse } from "next/server";
import { localExperimentStatusPayload } from "@/lib/local-experiment-mode";

export const runtime = "nodejs";

export function GET(request: Request) {
  return NextResponse.json(localExperimentStatusPayload(request, {
    serverPid: process.pid,
    projectRoot: process.cwd(),
  }), {
    headers: { "Cache-Control": "no-store" },
  });
}
