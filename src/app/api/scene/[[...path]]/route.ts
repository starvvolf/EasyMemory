// 상황 재현 복습 API (src/lib/scene/):
//   GET  /api/scene/today              오늘 볼 빈틈(낮은 층부터, 약 10분)
//   GET  /api/scene/gaps?problem=<id>  한 풀이의 빈틈
//   GET  /api/scene/follow?problem=<id> 생각 따라가기 결과(생각 묶음 · 순서 · 흐름, 11/16)
//   GET  /api/scene/progress?problem=<id> 놓친 생각 찾기가 지금 무엇을 하는지
//   POST /api/scene/extract {problemId, force?}   풀이 기록 → 빈틈 (AI 1번)
//   POST /api/scene/next {gapId}                  그 빈틈의 다음 장면 (똑같이 = AI 0번, 비슷하게 · 응용 = AI 1번)
//   POST /api/scene/run {sceneId, answer}         보이는 입력에서만 미리 실행
//   POST /api/scene/answer {sceneId, answer, hinted?, gaveUp?}  채점(코드 실행) → 판정 넷 · 사다리
//   GET  /api/scene/gaps?run=<id>      한 실습의 빈틈
//   GET  /api/scene/then?gap=<id>      [그때 내 코드 보기]
//   GET  /api/scene/tutor?gap=<id>     [튜터와 다시 보기] 열 곳 · 건넬 말
//   POST /api/scene/why {sceneId, text?}           왜인지 한 줄: text 없으면 질문, 있으면 채점(AI 1번)
//   POST /api/scene/mark {gapId, kind}             [이건 아는 거였어요](known) · 다시 볼 것(doubt) · 되돌리기(undo)
//   GET  /api/scene/progress?gap=<id>  장면을 만드는 중이면 지금 무엇을 하는지(화면의 "…" 옆 글)
//   POST /api/scene/prefetch {gapIds}  추천 거리의 장면을 뒤에서 미리 만들어 둠(기다리지 않음)
//   POST /api/scene/next {gapId, distance?}        distance를 주면 추천 대신 고른 거리로
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, responseError } from "@/lib/http";
import { followProgress, readFollow } from "@/lib/scene/follow";
import { answer, extract, gapsOf, gapsOfRun, mark, next, prefetch, preview, progress, thenView, today, tutorLink, why, whyQuestion } from "@/lib/scene/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
const sceneId = z.string().regex(/^sc_[a-f0-9]{12}$/);
const fail = (error: unknown) => error instanceof Error && !(error instanceof z.ZodError) && !("status" in error) ? NextResponse.json({ message: error.message }, { status: 400 }) : responseError(error);

export async function GET(request: Request, context: Context) {
  try {
    const [p] = (await context.params).path ?? [];
    if (p === "today") return NextResponse.json(await today());
    const q = new URL(request.url).searchParams;
    const gapId = z.string().regex(/^gap_[a-f0-9]{12}$/);
    if (p === "gaps" && q.get("run")) return NextResponse.json({ gaps: await gapsOfRun(z.string().regex(/^[A-Za-z0-9_-]{3,60}$/).parse(q.get("run"))) });
    if (p === "follow") return NextResponse.json({ follow: (await readFollow(z.string().regex(/^cp_[a-z0-9_-]{3,40}$/).parse(q.get("problem"))))?.reply ?? null });
    if (p === "gaps") return NextResponse.json({ gaps: await gapsOf(z.string().regex(/^cp_[a-z0-9_-]{3,40}$/).parse(q.get("problem"))) });
    if (p === "then") return NextResponse.json(await thenView(gapId.parse(q.get("gap"))));
    if (p === "tutor") return NextResponse.json(await tutorLink(gapId.parse(q.get("gap"))));
    if (p === "progress" && q.get("problem")) return NextResponse.json({ progress: followProgress(z.string().regex(/^cp_[a-z0-9_-]{3,40}$/).parse(q.get("problem"))) });
    if (p === "progress") return NextResponse.json({ progress: progress(gapId.parse(q.get("gap"))) });
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const [p] = (await context.params).path ?? [];
    const body = await boundedJson(request);
    if (p === "extract") { const b = z.object({ problemId: z.string().regex(/^cp_[a-z0-9_-]{3,40}$/), force: z.boolean().optional() }).parse(body); return NextResponse.json({ gaps: await extract(b.problemId, { force: b.force }) }); }
    if (p === "next") { const b = z.object({ gapId: z.string().regex(/^gap_[a-f0-9]{12}$/), distance: z.enum(["same", "near", "far"]).optional() }).parse(body); return NextResponse.json(await next(b.gapId, b.distance ? { distance: b.distance } : {})); }
    if (p === "prefetch") return NextResponse.json(prefetch(z.object({ gapIds: z.array(z.string().regex(/^gap_[a-f0-9]{12}$/)).max(40) }).parse(body).gapIds));
    if (p === "run") { const b = z.object({ sceneId, answer: z.string().max(20000) }).parse(body); return NextResponse.json(await preview(b.sceneId, b.answer)); }
    if (p === "why") { const b = z.object({ sceneId, text: z.string().max(2000).optional() }).parse(body); return NextResponse.json(b.text?.trim() ? await why(b.sceneId, b.text) : await whyQuestion(b.sceneId)); }
    if (p === "mark") { const b = z.object({ gapId: z.string().regex(/^gap_[a-f0-9]{12}$/), kind: z.enum(["known", "doubt", "undo"]), note: z.string().max(200).optional() }).parse(body); return NextResponse.json({ gap: await mark(b.gapId, b.kind, b.note) }); }
    if (p === "answer") { const b = z.object({ sceneId, answer: z.string().max(20000), hinted: z.boolean().optional(), gaveUp: z.boolean().optional() }).parse(body); return NextResponse.json(await answer(b.sceneId, b)); }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
