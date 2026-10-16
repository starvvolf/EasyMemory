import { NextResponse } from "next/server";
import { failExperimentRequest } from "@/lib/mcp-experiment-requests";
import { boundedJson, requireLocalRequest, responseError } from "../../http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json({ request: await failExperimentRequest((await context.params).requestId, await boundedJson(request)) });
  } catch (error) { return responseError(error); }
}
