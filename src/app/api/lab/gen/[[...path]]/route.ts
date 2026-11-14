import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { boundedJson, ExperimentRequestError, requireLocalRequest, responseError } from "@/lib/http";
import { createGen, enqueueGen, genView, GenError, listGens, readGenCalls, stepLabel } from "@/lib/study/gen/runner";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
const caller = { uid: "local-experiment" };

// 자료 엔진(recaller) 입구: 실행 목록 · 새 실행 · 한 실행 상태 · 이어 만들기 · 호출 기록. Real model calls start only with `confirmed: true`.
async function handle(request: Request, context: Context) {
  try {
    if (!isLocalExperimentRequest(request)) throw new ExperimentRequestError(403, "로컬 실험 모드에서만 사용할 수 있습니다.");
    await requireLocalRequest(request);
    const p = (await context.params).path ?? [];
    const method = request.method;
    let result: unknown;
    if (!p.length && method === "GET") {
      // ?origin=study: only materials made on the study screen.
      const origin = new URL(request.url).searchParams.get("origin");
      result = { runs: (await listGens()).filter((gen) => !origin || (gen.input.origin ?? "lab") === origin).map((gen) => ({ id: gen.id, createdAt: gen.createdAt, status: gen.status, phase: gen.phase, fileName: gen.input.fileName, sourceId: gen.input.sourceId, message: gen.message,
        pages: gen.input.pageNumbers, purpose: gen.input.purpose, provider: gen.input.provider, calls: gen.calls, forkOf: gen.forkOf ?? null, origin: gen.input.origin ?? "lab",
        method: methodOf(gen), pastExam: Boolean(gen.pastExam), sectionsDone: gen.sections.filter((section) => section.author).length, sectionCount: gen.sections.length })) };
    } else if (!p.length && method === "POST") {
      const body = z.object({ confirmed: z.boolean().optional() }).passthrough().parse(await boundedJson(request));
      const { confirmed, ...input } = body;
      if (input.provider !== "fake" && confirmed !== true) throw new ExperimentRequestError(400, "실제 모델 실행 확인이 필요합니다.");
      const gen = await createGen(input);
      await enqueueGen(gen.id, caller, { confirmedRealCalls: confirmed === true });
      result = { gen: await genView(gen.id) };
    } else if (p.length === 1 && method === "GET") {
      const gen = await genView(p[0]);
      if (!gen) throw new GenError(404, "생성을 찾을 수 없습니다.");
      // The list leaves out prompt and reply text; one call's detail has them.
      const calls = (await readGenCalls(p[0])).map((call) => ({ n: call.n, step: call.step, sectionId: call.sectionId, attempt: call.attempt, model: call.model,
        effort: call.effort, format: call.format, startedAt: call.startedAt, ms: call.ms, firstTextMs: call.firstTextMs, withPdf: call.withPdf, ok: call.ok, error: call.error, usage: call.usage, guide: call.guide }));
      result = { gen, label: stepLabel(gen), calls };
    } else if (p.length === 3 && p[1] === "calls" && /^\d+$/.test(p[2]) && method === "GET") {
      result = (await readGenCalls(p[0])).find((call) => call.n === Number(p[2]));
      if (!result) throw new GenError(404, "호출 기록을 찾을 수 없습니다.");
    } else if (p.length === 2 && p[1] === "continue" && method === "POST") {
      const body = z.object({ confirmed: z.boolean().optional() }).parse(await boundedJson(request));
      await enqueueGen(p[0], caller, { confirmedRealCalls: body.confirmed === true });
      result = { gen: await genView(p[0]) };
    } else throw new ExperimentRequestError(404, "경로를 찾을 수 없습니다.");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GenError) return NextResponse.json({ message: error.message }, { status: error.status });
    return responseError(error);
  }
}
export const GET = handle;
export const POST = handle;

/** 실험실 목록에 보일 방법 한 줄 (recaller 엔진, 11/5). */
function methodOf(gen: { input: { engine?: string; lab?: Record<string, unknown> } }) {
  const lab = gen.input.lab ?? {};
  if (gen.input.engine !== "recaller") return "";
  const how = lab.mapCards ? `목차→카드(${lab.mapUnit === "page" ? "쪽" : "주제"})${lab.flowCard === "with" ? "+흐름(같이)" : lab.flowCard === "after" ? "+흐름(다음에)" : ""}${lab.goalQuiz ? " · 목표형 문제" : ""}` : lab.conceptLines ? "개념 줄" : lab.digest ? "목차→요약→카드" : "쪽 정리";
  return `${how}${lab.quiz === "luna" ? ` · 퀴즈${lab.quizCount ?? ""}` : ""}`;
}
