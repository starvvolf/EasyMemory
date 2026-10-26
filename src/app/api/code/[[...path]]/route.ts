import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { languages, LANGS } from "@/lib/code/run";
import { deleteProblem, publicProblem, readDrafts, readProblem, readSubmissions, runCustom, saveDraft } from "@/lib/code/problems";
import { endAttempt, ensureProblemKnowledge, listProblemsWithKnowledge, recordAsked, recordHint, submitAndRecord } from "@/lib/code/service";
import { counterexample, explainCode, explainError, hint, makeProblem, reviewApproach } from "@/lib/assist/code-ai";
import { chapters as bakingdogChapters, fillProblem } from "@/lib/code/bakingdog";

export const runtime = "nodejs";
const lang = z.enum(LANGS);
const code = z.string().max(100_000);
const pid = z.string().regex(/^cp_[a-z0-9_-]{3,40}$/);
const last = z.object({ verdict: z.string().max(20).optional(), input: z.string().max(4000).optional(), expected: z.string().max(4000).optional(), got: z.string().max(4000).optional(),
  stderr: z.string().max(4000).optional(), compile: z.string().max(8000).optional() }).optional();

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);

    if (p[0] === "langs" && m === "GET") return json({ langs: await languages() });
    if (p[0] === "problems" && m === "GET") return json({ problems: await listProblemsWithKnowledge() });
    if (p[0] === "run" && m === "POST") { const b = await body(z.object({ lang, code, input: z.string().max(500_000) })); return json(await runCustom(b.lang, b.code, b.input)); }
    if (p[0] === "explain" && m === "POST") {
      const b = await body(z.object({ problemId: pid.optional(), lang, code, selection: z.string().min(1).max(8000), question: z.string().max(2000).optional() }));
      await recordAsked(b.problemId, b.question || `코드 드래그해서 물어봄: ${b.selection.split("\n")[0].slice(0, 60)}`);
      return json(await explainCode(b));
    }
    if (p[0] === "error" && m === "POST") { const b = await body(z.object({ problemId: pid.optional(), lang, code, error: z.string().min(1).max(12000) })); return json(await explainError(b)); }
    if (p[0] === "make" && m === "POST") {
      const b = await body(z.object({ topic: z.string().max(300).optional(), lesson: z.string().max(60_000).optional(), kind: z.enum(["full", "blank"]), lang: lang.optional(),
        sourceTitle: z.string().max(300).optional(), sourceUrl: z.string().max(2000).optional() }).refine((x) => x.topic?.trim() || x.lesson?.trim(), "주제나 강의 글이 필요해요."));
      const made = await ensureProblemKnowledge(await makeProblem(b));
      return json({ problem: publicProblem(made) });
    }
    // 바킹독 문제집: the built-in list, and filling one problem the first time it is picked.
    if (p[0] === "bakingdog" && p.length === 1 && m === "GET") return json({ chapters: await bakingdogChapters() });
    if (p[0] === "bakingdog" && p[2] === "fill" && m === "POST") {
      const made = await ensureProblemKnowledge(await fillProblem(z.string().regex(/^\d{1,6}$/).parse(p[1])));
      return json({ problem: publicProblem(made) });
    }
    if (p[0] === "problem" && p[1]) {
      const id = pid.parse(p[1]);
      if (p.length === 2 && m === "GET") {
        const problem = await ensureProblemKnowledge(await readProblem(id));
        const subs = (await readSubmissions(id)).slice(-30).reverse().map(({ code: c, ...rest }) => ({ ...rest, lines: c.split("\n").length }));
        return json({ problem: publicProblem(problem), drafts: await readDrafts(id), submissions: subs });
      }
      if (p.length === 2 && m === "DELETE") return json(await deleteProblem(id));
      if (p[2] === "draft" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await saveDraft(id, b.lang, b.code)); }
      if (p[2] === "submission" && p[3] && m === "GET") { const s = (await readSubmissions(id)).find((x) => x.id === p[3]); return s ? json({ submission: s }) : NextResponse.json({ message: "제출을 찾을 수 없어요." }, { status: 404 }); }
      if (p[2] === "submit" && m === "POST") {
        const b = await body(z.object({ lang, code, mode: z.enum(["example", "submit"]), hints: z.number().int().min(0).max(10).optional() }));
        return json(await submitAndRecord(id, b.lang, b.code, b.mode, b.hints ?? 0));
      }
      if (p[2] === "hint" && m === "POST") {
        const b = await body(z.object({ lang, code, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), last }));
        // Ask first, record after: recorded first, this very hint was in the "earlier misses" the model sees ("지난번에도").
        const out = await hint({ problemId: id, ...b });
        await recordHint(id, b.level);
        return json(out);
      }
      // 문제 목록으로 돌아가거나 다른 문제로: this attempt's 틀림 · 힌트 · 물어봄 go into the knowledge record now.
      if (p[2] === "end" && m === "POST") return json(await endAttempt(id));
      if (p[2] === "review" && m === "POST") { const b = await body(z.object({ lang, code, note: z.string().max(1000).optional() })); return json(await reviewApproach({ problemId: id, ...b })); }
      if (p[2] === "counter" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await counterexample({ problemId: id, ...b })); }
    }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
