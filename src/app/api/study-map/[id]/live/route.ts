// 만드는 동안 지도가 읽는 것: 실행 상태 · 줄기(src/lib/study/gen/runner.ts genLive). 쪽 카드 실시간(10/30)은 11/15에 뺐다.
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { genLive } from "@/lib/study/gen/runner";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    if (!/^gen_[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    return NextResponse.json(await genLive(id));
  } catch (error) { return fail(error); }
}
