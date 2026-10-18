import { NextResponse } from "next/server";
import { createExperimentRequest, listExperimentRequests } from "@/lib/mcp-experiment-requests";
import { boundedJson, requireLocalRequest, responseError } from "./http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json({ requests: await listExperimentRequests() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    await requireLocalRequest(request);
    return NextResponse.json({ request: await createExperimentRequest(await boundedJson(request)) }, { status: 201 });
  } catch (error) { return responseError(error); }
}
