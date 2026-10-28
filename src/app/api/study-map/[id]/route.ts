// 자료 지도 (src/lib/study/material-map.ts): one material's outline, cards and the learner's state on them. Read-only.
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { itemsForRefs } from "@/lib/knowledge/api";
import { loadGen } from "@/lib/study/gen/runner";
import { materialMap } from "@/lib/study/material-map";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    if (!/^gen_[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    const state = await loadGen(id);
    if (!state) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    const refs = state.sections.flatMap((s) => (state.recaller?.units[s.id]?.cards ?? []).map((c) => `${id}:${c.id}`));
    const map = materialMap(state, refs.length ? await itemsForRefs(refs) : {});
    if (!map) return NextResponse.json({ message: "이 자료는 예전 엔진으로 만들어서 지도를 그릴 수 없어요." }, { status: 422 });
    return NextResponse.json({ map });
  } catch (error) { return fail(error); }
}
