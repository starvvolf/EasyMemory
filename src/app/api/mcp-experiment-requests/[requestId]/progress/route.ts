import { NextResponse } from "next/server";
import { recordExperimentProgress } from "@/lib/mcp-experiment-requests";
import { boundedJson, requireLocalRequest, responseError } from "../../http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json({ request: await recordExperimentProgress((await context.params).requestId, await boundedJson(request)) });
  } catch (error) { return responseError(error); }
}
