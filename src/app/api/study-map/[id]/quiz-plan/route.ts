// 구조 단위 출제 시험 (src/lib/study/quiz-plan.ts): GET ?o=<설정 JSON>&label= 계획만(AI 없음) + 저장된 결과 (11/8)
// · POST {options?, label?, only?, units?, noRetry?, noBlind?} 계획대로 만들고 따로 풀기(AI 단위마다 2~5번).
import { NextResponse } from "next/server";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { loadGen } from "@/lib/study/gen/runner";
import { materialMap } from "@/lib/study/material-map";
import { loadStructure } from "@/lib/study/structure";
import { loadQuizRun, makeQuiz, planQuiz, type QuizOptions } from "@/lib/study/quiz-plan";

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
const label = (s: unknown) => typeof s === "string" && /^[\w-]{1,40}$/.test(s) ? s : undefined;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const q = new URL(request.url).searchParams;
    const { map, structure } = await inputs(id);
    const options = q.get("o") ? JSON.parse(q.get("o")!) as Partial<QuizOptions> : {};
    return NextResponse.json({ plan: planQuiz(map, structure, options), run: await loadQuizRun(id, label(q.get("label"))) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const { id } = await context.params;
    const b = await boundedJson(request).catch(() => ({})) as { only?: number; options?: Partial<QuizOptions>; label?: string; units?: number[]; noRetry?: boolean; noBlind?: boolean };
    const { map, structure, texts } = await inputs(id);
    return NextResponse.json({ run: await makeQuiz(id, map, structure, texts, { make: true, ...(Number(b.only) > 0 ? { only: Number(b.only) } : {}), ...(b.options ? { options: b.options } : {}),
      ...(label(b.label) ? { label: label(b.label) } : {}), ...(Array.isArray(b.units) ? { units: b.units.map(Number).filter((n) => n > 0) } : {}), noRetry: Boolean(b.noRetry), noBlind: Boolean(b.noBlind) }) });
  } catch (error) { return fail(error); }
}
