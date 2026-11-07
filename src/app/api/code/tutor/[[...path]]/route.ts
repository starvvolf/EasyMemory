// PS 튜터 API (2026-11-08, src/lib/code/tutor/).
//   GET  /api/code/tutor            패턴별 상태 · 다음 할 일 · 교육용 모델 준비 상태 (AI 없음)
//   POST /api/code/tutor/prepare    교육용 문제 모델을 아직 없는 문제만큼 만든다(문제당 AI 1번, 백그라운드, 동시에 3개)
//   POST /api/code/tutor/answer     드릴·설계·예측·대조 답, 구현 시작·그만하기 (AI 없음, 코드가 대조)
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { withTrace } from "@/lib/ai/trace";
import { answer, startPrepare, tutorOverview, type Answer } from "@/lib/code/tutor/service";

export const runtime = "nodejs";
const num = z.string().regex(/^\d{1,6}$/);
const pat = z.string().regex(/^[a-z0-9-]{2,40}$/);
const ANSWER = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("walkthrough"), number: num, pattern: pat, predict: z.string().max(2000).optional(), skipped: z.boolean().optional() }),
  z.object({ kind: z.literal("drill"), number: num, pattern: pat, mixed: z.boolean(), choice: z.string().max(200), hinted: z.boolean().optional(), ms: z.number().int().min(0).max(36e5).optional() }),
  z.object({ kind: z.literal("design"), number: num, pattern: pat, mixed: z.boolean(), state: z.string().max(200), complexity: z.string().max(20), update: z.string().max(500).optional(), hinted: z.boolean().optional(), ms: z.number().int().min(0).max(36e5).optional() }),
  z.object({ kind: z.literal("contrast"), number: num, pattern: pat, picks: z.record(num, pat) }),
  z.object({ kind: z.literal("implement"), number: num, pattern: pat, mixed: z.boolean(), action: z.enum(["start", "giveup"]) }),
]);

async function handle(request: Request, context: RouteContext) {
  const p = (await context.params).path ?? [];
  return withTrace({ area: "code", action: `tutor/${p.join("/")}` }, async () => {
    try {
      await guard(request);
      if (!p.length && request.method === "GET") return NextResponse.json(await tutorOverview());
      if (p[0] === "prepare" && request.method === "POST") {
        const b = z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(await boundedJson(request));
        return NextResponse.json({ prep: await startPrepare(b.limit) });
      }
      if (p[0] === "answer" && request.method === "POST") return NextResponse.json(await answer(ANSWER.parse(await boundedJson(request)) as Answer));
      return NextResponse.json({ message: "없는 주소예요." }, { status: 404 });
    } catch (error) { return fail(error); }
  });
}
export const GET = handle;
export const POST = handle;
