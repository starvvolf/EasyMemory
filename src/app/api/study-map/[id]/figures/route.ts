// 카드 그림 다시 자르기 (11/8, AI 호출 없음): POST → { hinted, quoted, files, ms }
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { recropFigures } from "@/lib/study/gen/runner";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    if (!/^gen_[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    return NextResponse.json(await recropFigures(id));
  } catch (error) { return fail(error); }
}
