import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { boundedJson, requireLocalRequest, responseError } from "../../../mcp-experiment-requests/http";
import { confirmObjectives, createGen, enqueueGen, forkGen, loadGen, genView, GenError, listGens, readGenCalls, readSectionDocument, stepLabel, studyDocument } from "@/lib/study/gen/runner";
import { scorecard } from "@/lib/study/gen/scorecard";
import { listJudges, loadJudge, readJudgeCalls, startJudge } from "@/lib/study/gen/judge";
import { listVisionProbes, readVisionImage, runVisionProbe } from "@/lib/study/gen/vision";
import { renderInteractiveDocument } from "../../../../../../tools/problem-authoring-lab/renderer";
import type { AuthoringDocument } from "../../../../../../tools/problem-authoring-lab/contract";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
const caller = { uid: "local-experiment" };

// Lab entry for the v2 engine (docs/DECISIONS.md 2026-10-12). Real model calls start only with `confirmed: true`.
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
      result = { runs: (await listGens()).filter((gen) => !origin || (gen.input.origin ?? "lab") === origin).map((gen) => ({ id: gen.id, createdAt: gen.createdAt, status: gen.status, phase: gen.phase, fileName: gen.input.fileName,
        pages: gen.input.pageNumbers, purpose: gen.input.purpose, provider: gen.input.provider, calls: gen.calls, forkOf: gen.forkOf ?? null, origin: gen.input.origin ?? "lab",
        sectionsDone: gen.sections.filter((section) => section.author).length, sectionCount: gen.sections.length })) };
    } else if (p[0] === "vision") {
      // Image reading probe: render one page, ask the model to read it, compare with the text layer.
      if (p.length === 1 && method === "GET") result = { probes: await listVisionProbes() };
      else if (p.length === 1 && method === "POST") result = { probe: await runVisionProbe(await boundedJson(request), caller) };
      else if (p.length === 3 && p[2] === "image" && method === "GET") result = { image: await readVisionImage(p[1]) };
      else throw new ExperimentRequestError(404, "경로를 찾을 수 없습니다.");
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
        effort: call.effort, format: call.format, startedAt: call.startedAt, ms: call.ms, ok: call.ok, error: call.error, usage: call.usage, guide: call.guide }));
      result = { gen, label: stepLabel(gen), calls };
    } else if (p.length === 2 && p[1] === "study" && method === "GET") {
      // The study screen's deck: all sections as one document.
      const deck = await studyDocument(p[0]);
      if (!deck) throw new GenError(404, "아직 만들어진 문제가 없습니다.");
      result = deck;
    } else if (p.length === 2 && p[1] === "score" && method === "GET") {
      const gen = await genView(p[0]);
      if (!gen) throw new GenError(404, "생성을 찾을 수 없습니다.");
      const documents = new Map(await Promise.all(gen.sections.map(async (section) =>
        [section.id, await readSectionDocument(gen.id, section.id) as AuthoringDocument | null] as const)));
      const latest = (await listJudges(gen.id)).find((run) => run.status === "done") ?? null;
      result = { score: scorecard(gen, await readGenCalls(gen.id), documents, latest) };
    } else if (p.length === 2 && p[1] === "judge" && method === "GET") {
      result = { runs: (await listJudges(p[0])).map(({ results: _results, ...run }) => ({ ...run, questions: _results.length })) };
    } else if (p.length === 2 && p[1] === "judge" && method === "POST") {
      const { run } = await startJudge(p[0], await boundedJson(request), caller);
      result = { run };
    } else if (p.length === 3 && p[1] === "judge" && method === "GET") {
      const run = await loadJudge(p[0], p[2]);
      if (!run) throw new GenError(404, "판정을 찾을 수 없습니다.");
      result = { run };
    } else if (p.length === 5 && p[1] === "judge" && p[3] === "calls" && /^\d+$/.test(p[4]) && method === "GET") {
      result = (await readJudgeCalls(p[0], p[2])).find((call) => call.n === Number(p[4]));
      if (!result) throw new GenError(404, "호출 기록을 찾을 수 없습니다.");
    } else if (p.length === 3 && p[1] === "calls" && /^\d+$/.test(p[2]) && method === "GET") {
      result = (await readGenCalls(p[0])).find((call) => call.n === Number(p[2]));
      if (!result) throw new GenError(404, "호출 기록을 찾을 수 없습니다.");
    } else if (p.length === 3 && p[1] === "sections" && method === "GET") {
      const document = await readSectionDocument(p[0], p[2]) as AuthoringDocument | null;
      if (!document) throw new GenError(404, "이 목차의 문제 문서가 아직 없습니다.");
      const html = renderInteractiveDocument(document).replaceAll("../../../assets/katex/", "/api/personalization-lab/assets/katex/").replaceAll("../../../assets/fonts/", "/api/personalization-lab/assets/fonts/");
      result = { document, html };
    } else if (p.length === 2 && p[1] === "confirm" && method === "POST") {
      const body = z.object({ objectiveIds: z.array(z.string().max(40)).max(500), confirmed: z.boolean().optional() }).parse(await boundedJson(request));
      const gen = await confirmObjectives(p[0], body.objectiveIds);
      if (gen.status === "queued") await enqueueGen(gen.id, caller, { confirmedRealCalls: body.confirmed === true });
      result = { gen: await genView(gen.id) };
    } else if (p.length === 2 && p[1] === "fork" && method === "POST") {
      // Fixed-prefix rerun: same outline and classification (and objectives, from "author"), later steps redone.
      const body = z.object({ confirmed: z.boolean().optional() }).passthrough().parse(await boundedJson(request));
      const { confirmed, ...options } = body;
      const base = await loadGen(p[0]);
      if (!base) throw new GenError(404, "기준 실행을 찾을 수 없습니다.");
      if (base.input.provider !== "fake" && confirmed !== true) throw new ExperimentRequestError(400, "실제 모델 실행 확인이 필요합니다.");
      const gen = await forkGen(p[0], options);
      if (gen.status === "queued") await enqueueGen(gen.id, caller, { confirmedRealCalls: confirmed === true });
      result = { gen: await genView(gen.id) };
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
