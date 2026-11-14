// 상황 재현 복습 API (src/lib/scene/):
//   GET  /api/scene/today              오늘 볼 빈틈(낮은 층부터, 약 10분)
//   GET  /api/scene/gaps?problem=<id>  한 풀이의 빈틈
//   POST /api/scene/extract {problemId, force?}   풀이 기록 → 빈틈 (AI 1번)
//   POST /api/scene/next {gapId}                  그 빈틈의 다음 장면 (똑같이 = AI 0번, 비슷하게 · 응용 = AI 1번)
//   POST /api/scene/run {sceneId, answer}         보이는 입력에서만 미리 실행
//   POST /api/scene/answer {sceneId, answer, hinted?, gaveUp?}  채점(코드 실행) → 판정 넷 · 사다리
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, responseError } from "@/lib/http";
import { answer, extract, gapsOf, next, preview, today } from "@/lib/scene/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
const sceneId = z.string().regex(/^sc_[a-f0-9]{12}$/);
const fail = (error: unknown) => error instanceof Error && !(error instanceof z.ZodError) && !("status" in error) ? NextResponse.json({ message: error.message }, { status: 400 }) : responseError(error);

export async function GET(request: Request, context: Context) {
  try {
    const [p] = (await context.params).path ?? [];
    if (p === "today") return NextResponse.json(await today());
    if (p === "gaps") return NextResponse.json({ gaps: await gapsOf(z.string().regex(/^cp_[a-z0-9_-]{3,40}$/).parse(new URL(request.url).searchParams.get("problem"))) });
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const [p] = (await context.params).path ?? [];
    const body = await boundedJson(request);
    if (p === "extract") { const b = z.object({ problemId: z.string().regex(/^cp_[a-z0-9_-]{3,40}$/), force: z.boolean().optional() }).parse(body); return NextResponse.json({ gaps: await extract(b.problemId, { force: b.force }) }); }
    if (p === "next") return NextResponse.json(await next(z.object({ gapId: z.string().regex(/^gap_[a-f0-9]{12}$/) }).parse(body).gapId));
    if (p === "run") { const b = z.object({ sceneId, answer: z.string().max(20000) }).parse(body); return NextResponse.json(await preview(b.sceneId, b.answer)); }
    if (p === "answer") { const b = z.object({ sceneId, answer: z.string().max(20000), hinted: z.boolean().optional(), gaveUp: z.boolean().optional() }).parse(body); return NextResponse.json(await answer(b.sceneId, b)); }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
