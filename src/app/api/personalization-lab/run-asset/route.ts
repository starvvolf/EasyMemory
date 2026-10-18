import { NextResponse } from "next/server";
import { readArtifactAsset } from "@/lib/personalization-lab/artifacts";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    const params = new URL(request.url).searchParams;
    const svg = await readArtifactAsset(params.get("id") ?? "", params.get("path") ?? "");
    if (!svg) return NextResponse.json({ message: "그림을 찾지 못했거나 기록과 달라졌습니다." }, { status: 404 });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const failure = toUserDataError(error, "그림을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
