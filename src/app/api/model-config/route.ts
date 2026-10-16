import { NextResponse } from "next/server";
import { getPublicModelConfig } from "@/lib/model-config";

export function GET() {
  return NextResponse.json(getPublicModelConfig());
}
