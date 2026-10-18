import { NextResponse } from "next/server";
import { claimExperimentRequest } from "@/lib/mcp-experiment-requests";
import { requireLocalRequest, responseError } from "../../http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json(await claimExperimentRequest((await context.params).requestId));
  } catch (error) { return responseError(error); }
}
