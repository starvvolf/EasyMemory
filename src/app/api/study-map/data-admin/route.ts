// 데이터 관리 (src/lib/data-admin.ts): GET 지금 데이터·동기화 상태 · POST {action: archive|archiveAll|deleteArchive|sync|push}. /api/study-map 아래에 둔 것은 로컬 실험 경로 목록(local-experiment-mode.ts)에 이미 있어서.
import { NextResponse } from "next/server";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { archiveAll, archiveItems, dataView, deleteArchive, pushNow, setSync } from "@/lib/data-admin";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await guard(request); return NextResponse.json(await dataView()); } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await guard(request);
    const b = await boundedJson(request) as { action?: string; paths?: string[]; name?: string; on?: boolean };
    if (b.action === "archive") return NextResponse.json(await archiveItems(Array.isArray(b.paths) ? b.paths.map(String) : []));
    if (b.action === "archiveAll") return NextResponse.json(await archiveAll());
    if (b.action === "deleteArchive") { await deleteArchive(String(b.name ?? "")); return NextResponse.json({ ok: true }); }
    if (b.action === "sync") { await setSync(b.on === true); return NextResponse.json({ ok: true }); }
    if (b.action === "push") return NextResponse.json(await pushNow());
    return NextResponse.json({ message: "알 수 없는 요청이에요." }, { status: 400 });
  } catch (error) { return fail(error); }
}
