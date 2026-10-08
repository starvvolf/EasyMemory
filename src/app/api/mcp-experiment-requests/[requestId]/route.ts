import { NextResponse } from "next/server";
import { getExperimentRequest } from "@/lib/mcp-experiment-requests";
import { requireLocalRequest, responseError } from "../http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json({ request: await getExperimentRequest((await context.params).requestId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
