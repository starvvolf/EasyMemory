// 구조 단위 출제 시험 (src/lib/study/quiz-plan.ts): GET 계획만(AI 없음) + 저장된 결과 · POST {only?} 계획대로 만들고 따로 풀기(AI 단위마다 2번).
import { NextResponse } from "next/server";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { loadGen } from "@/lib/study/gen/runner";
import { materialMap } from "@/lib/study/material-map";
import { loadStructure } from "@/lib/study/structure";
import { loadQuizRun, makeQuiz, planQuiz } from "@/lib/study/quiz-plan";

export const runtime = "nodejs";
async function inputs(id: string) {
  if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  const structure = await loadStructure(id);
  if (!state || !map || !structure) throw Object.assign(new Error("카드와 구조가 있어야 출제 계획을 세울 수 있어요."), { status: 422 });
  const texts = (state as unknown as { recaller?: { texts?: Record<string, string> } }).recaller?.texts ?? {};
  return { map, structure, texts };
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const { map, structure } = await inputs(id);
    return NextResponse.json({ plan: planQuiz(map, structure), run: await loadQuizRun(id) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const body = await boundedJson(request).catch(() => ({})) as { only?: number };
    const { map, structure, texts } = await inputs(id);
    return NextResponse.json({ run: await makeQuiz(id, map, structure, texts, { make: true, ...(Number(body.only) > 0 ? { only: Number(body.only) } : {}) }) });
  } catch (error) { return fail(error); }
}
