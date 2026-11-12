// /api/study-map/<id>/quiz-lab 의 몸 (quiz-plan.ts 시험): GET ?o=<설정 JSON>&label= 계획(AI 없음) + 저장된 결과
// · POST {options?, label?, only?, units?, noRetry?, noBlind?} 만들고 따로 풀기.
import { NextResponse } from "next/server";
import { boundedJson } from "../../assist/http.ts";
import { loadGen } from "../gen/runner.ts";
import { materialMap } from "../material-map.ts";
import { loadStructure } from "../structure.ts";
import { loadQuizRun, makeQuiz, planQuiz, type QuizOptions } from "../quiz-plan.ts";

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
export async function quizLab(request: Request, id: string) {
  const { map, structure, texts } = await inputs(id);
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    const options = q.get("o") ? JSON.parse(q.get("o")!) as Partial<QuizOptions> : {};
    return NextResponse.json({ plan: planQuiz(map, structure, options), run: await loadQuizRun(id, label(q.get("label"))) });
  }
  const b = await boundedJson(request).catch(() => ({})) as { only?: number; options?: Partial<QuizOptions>; label?: string; units?: number[]; noRetry?: boolean; noBlind?: boolean };
  return NextResponse.json({ run: await makeQuiz(id, map, structure, texts, { make: true, ...(Number(b.only) > 0 ? { only: Number(b.only) } : {}), ...(b.options ? { options: b.options } : {}),
    ...(label(b.label) ? { label: label(b.label) } : {}), ...(Array.isArray(b.units) ? { units: b.units.map(Number).filter((n) => n > 0) } : {}), noRetry: Boolean(b.noRetry), noBlind: Boolean(b.noBlind) }) });
}
