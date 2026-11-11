// PS 튜터 API (2026-11-08, src/lib/code/tutor/).
//   GET  /api/code/tutor            패턴별 상태 · 다음 할 일 · 교육용 모델 준비 상태 (AI 없음)
//   GET  /api/code/tutor/journal    학습 관찰일지(사건 + 배운 것 카드, AI 없음)
//   POST /api/code/tutor/prepare    교육용 문제 모델을 아직 없는 문제만큼 만든다(문제당 AI 1번, 백그라운드, 동시에 6개)
//   POST /api/code/tutor/profile    설문(모름/알아요/잘해요) 저장 · 확인 미루기 · 분야 집중 시작/끝 (11/11, AI 없음)
//   GET  /api/code/tutor/logs       풀이 일지(문제마다 한 장) + 이번 주 한 줄 (11/11, AI 없음)
//   POST /api/code/tutor/lesson     "뭐가 막았나" 한 줄을 확인(맞아요)하거나 고침
//   POST /api/code/tutor/fill       뼈대 코드 준비(처음이면 AI 1번 + 채점) → 문제 화면의 쓰던 코드로
//   POST /api/code/tutor/answer     드릴·설계·예측·대조 답, 구현 시작·그만하기 (AI 없음, 코드가 대조)
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { withTrace } from "@/lib/ai/trace";
import { answer, setProfile, startFill, startPrepare, tutorOverview, type Answer, type ProfileOp } from "@/lib/code/tutor/service";
import { journal, solveLogs, weekLine } from "@/lib/code/tutor/journal";
import { confirmLesson, readLessons } from "@/lib/code/tutor/lessons";
import { readEvents } from "@/lib/code/tutor/state";
import { LANGS } from "@/lib/code/run";
import { readModels } from "@/lib/code/tutor/problem-model";
import { readTalkWithNotes } from "@/lib/code/tutor/talk";

export const runtime = "nodejs";
const num = z.string().regex(/^\d{1,6}$/);
const pat = z.string().regex(/^[a-z0-9-]{2,40}$/);
const ANSWER = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("walkthrough"), number: num, pattern: pat, predict: z.string().max(2000).optional(), skipped: z.boolean().optional() }),
  z.object({ kind: z.literal("drill"), number: num, pattern: pat, mixed: z.boolean(), choice: z.string().max(200), choices: z.array(z.string().max(60)).max(6).optional(), hinted: z.boolean().optional(), ms: z.number().int().min(0).max(36e5).optional(), dunno: z.boolean().optional() }),
  z.object({ kind: z.literal("design"), number: num, pattern: pat, mixed: z.boolean(), state: z.string().max(200), complexity: z.string().max(20), update: z.string().max(500).optional(), hinted: z.boolean().optional(), ms: z.number().int().min(0).max(36e5).optional() }),
  z.object({ kind: z.literal("contrast"), number: num, pattern: pat, picks: z.record(num, pat) }),
  z.object({ kind: z.literal("implement"), number: num, pattern: pat, mixed: z.boolean(), action: z.enum(["start", "giveup"]), fill: z.boolean().optional(), redo: z.boolean().optional(), lang: z.enum(LANGS).optional() }),
]);

const PROFILE = z.discriminatedUnion("op", [
  z.object({ op: z.literal("survey"), levels: z.record(pat, z.enum(["none", "know", "good"])) }),
  z.object({ op: z.literal("later"), pattern: pat }),
  z.object({ op: z.literal("focus"), patterns: z.array(pat).min(1).max(12) }),
  z.object({ op: z.literal("unfocus") }),
]);

async function handle(request: Request, context: RouteContext) {
  const p = (await context.params).path ?? [];
  return withTrace({ area: "code", action: `tutor/${p.join("/")}` }, async () => {
    try {
      await guard(request);
      if (!p.length && request.method === "GET") return NextResponse.json(await tutorOverview());
      // 학습 관찰일지(11/8): 사건 기록 + 배운 것 카드 → 한 줄씩(AI 없음).
      if (p[0] === "journal" && request.method === "GET") {
        const models = await readModels();
        return NextResponse.json({ entries: await journal(Object.fromEntries(Object.values(models).map((m) => [m.number, m.title]))) });
      }
      // 대화 장부(11/11): 문제 화면에서 AI와 주고받은 원문, 시간순. 한 번마다 두 줄 요약(note: 무엇을 몰랐나 · AI가 준 것)을 붙인다(없으면 AI 1번). ?problem=<문제 id> 또는 ?number=<백준 번호>.
      if (p[0] === "talk" && request.method === "GET") {
        const q = new URL(request.url).searchParams;
        const problem = q.get("problem")?.trim(), number = q.get("number")?.trim();
        if (!problem && !number) return NextResponse.json({ message: "problem이나 number가 필요해요." }, { status: 400 });
        return NextResponse.json({ items: await readTalkWithNotes({ ...(problem ? { problemId: problem } : {}), ...(number && /^\d{1,6}$/.test(number) ? { number } : {}) }) });
      }
      if (p[0] === "logs" && request.method === "GET") {
        const [models, events, lessons] = await Promise.all([readModels(), readEvents(), readLessons()]);
        const logs = solveLogs(events, lessons, Object.fromEntries(Object.values(models).map((m) => [m.number, m.title])));
        return NextResponse.json({ logs, week: weekLine(logs) });
      }
      if (p[0] === "lesson" && request.method === "POST") {
        const b = z.object({ id: z.string().regex(/^ls_[a-f0-9]{6,20}$/), gap: z.string().max(200).optional() }).parse(await boundedJson(request));
        await confirmLesson(b.id, b.gap);
        return NextResponse.json({ ok: true });
      }
      if (p[0] === "fill" && request.method === "POST") {
        const b = z.object({ number: num, lang: z.enum(LANGS) }).parse(await boundedJson(request));
        return NextResponse.json(await startFill(b.number, b.lang));
      }
      if (p[0] === "prepare" && request.method === "POST") {
        const b = z.object({ limit: z.number().int().min(1).max(200).optional(), workers: z.number().int().min(1).max(8).optional() }).parse(await boundedJson(request));
        return NextResponse.json({ prep: await startPrepare(b.limit, b.workers) });
      }
      if (p[0] === "profile" && request.method === "POST") { await setProfile(PROFILE.parse(await boundedJson(request)) as ProfileOp); return NextResponse.json(await tutorOverview()); }
      if (p[0] === "answer" && request.method === "POST") return NextResponse.json(await answer(ANSWER.parse(await boundedJson(request)) as Answer));
      return NextResponse.json({ message: "없는 주소예요." }, { status: 404 });
    } catch (error) { return fail(error); }
  });
}
export const GET = handle;
export const POST = handle;
