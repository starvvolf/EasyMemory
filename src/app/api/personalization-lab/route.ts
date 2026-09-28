import { NextResponse } from "next/server";
import { listArtifacts, loadArtifact } from "@/lib/personalization-lab/artifacts";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireExperimentPrincipal(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ artifacts: await listArtifacts() }, { headers: { "Cache-Control": "private, no-store" } });
    const artifact = await loadArtifact(id);
    if (!artifact) return NextResponse.json({ message: "허용된 실험 문서를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ meta: artifact.meta, document: artifact.document, html: artifact.html }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = toUserDataError(error, "실험 문서를 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
