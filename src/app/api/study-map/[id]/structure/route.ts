// 자료 지도 [구조] (src/lib/study/structure.ts): GET 저장된 구조(없으면 null, 카드가 바뀌었으면 stale) · POST 만들기(AI 1번, terra low).
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { loadGen } from "@/lib/study/gen/runner";
import { materialMap } from "@/lib/study/material-map";
import { cardSig, loadStructure, makeStructure } from "@/lib/study/structure";

export const runtime = "nodejs";
async function mapOf(id: string) {
  if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!map) throw Object.assign(new Error("이 자료는 아직 카드가 없어 구조를 만들 수 없어요."), { status: 422 });
  return map;
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const [map, structure] = await Promise.all([mapOf(id), loadStructure(id)]);
    return NextResponse.json({ structure, stale: Boolean(structure && structure.sig !== cardSig(map)) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const map = await mapOf(id);
    if (map.status === "queued" || map.status === "running") return NextResponse.json({ message: "자료를 다 만든 뒤에 구조를 만들 수 있어요." }, { status: 409 });
    return NextResponse.json({ structure: await makeStructure(id, map), stale: false });
  } catch (error) { return fail(error); }
}
