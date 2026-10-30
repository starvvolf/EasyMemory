// 실시간 카드 (사용자 10/30): the pages in order and each page's cards as they are being written (src/lib/study/gen/runner.ts genLive).
// Polled by the map a few times a second while the material is being made; `since` returns only pages changed after it.
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { genLive } from "@/lib/study/gen/runner";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    if (!/^gen_[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    const since = Number(new URL(request.url).searchParams.get("since") ?? 0) || 0;
    return NextResponse.json(await genLive(id, since));
  } catch (error) { return fail(error); }
}
