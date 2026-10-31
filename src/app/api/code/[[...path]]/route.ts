import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { languages, LANGS } from "@/lib/code/run";
import { calibration } from "@/lib/code/calibrate";
import { deleteProblem, findBySource, publicProblem, savePreparing, setPreparing, readDrafts, readProblemMeta, readSubmissions, runCustom, saveDraft, warmTests } from "@/lib/code/problems";
import { endAttempt, ensureProblemKnowledge, listProblemsWithKnowledge, recordAsked, recordHint, saveReview, submitAndRecord } from "@/lib/code/service";
import { checkUnderstand, COMPLEXITIES, complexityVerdict, psLab, quickCheck, readTrain, saveStep, setMode, sizeOf, STEPS, tryInputs } from "@/lib/code/train";
import { counterexample, explainCode, explainError, hint, makeProblem, reviewApproach, solveCheck, trainCheck, trainReview, watchAdvice } from "@/lib/assist/code-ai";
import { chapters as bakingdogChapters, fillProblem } from "@/lib/code/bakingdog";
import { resolveSource, type Resolved } from "@/lib/code/source";

type MakeInput = Parameters<typeof makeProblem>[0];
/** The full problem from an imported original, under the id the learner already has open (바로 열기, 2026-10-29). */
async function prepare(id: string, got: Resolved, rest: Omit<MakeInput, "lesson" | "sourceTitle" | "sourceUrl" | "original" | "id"> & { lesson?: string }) {
  try {
    await ensureProblemKnowledge(await makeProblem({ ...rest, id, lesson: [got.lesson, rest.lesson?.trim() ? `[학습자가 덧붙인 글]\n${rest.lesson}` : ""].filter(Boolean).join("\n\n"),
      sourceTitle: got.title, sourceUrl: got.url, ...(got.original ? { original: got.original } : {}) }));
  } catch (error) {
    const meta = await readProblemMeta(id).catch(() => null);
    if (meta?.preparing) await setPreparing(id, { ...meta.preparing, error: (error as Error).message.slice(0, 500) }).catch(() => undefined);
  }
}

export const runtime = "nodejs";
const lang = z.enum(LANGS);
const code = z.string().max(100_000);
const pid = z.string().regex(/^cp_[a-z0-9_-]{3,40}$/);
// The last run the tutor sees: a max-size test can be megabytes, so long fields are cut, not refused.
const cut = (n: number) => z.string().transform((s) => s.length > n ? `${s.slice(0, n - 30)}\n… (${s.length - n + 30}자 더)` : s);
const last = z.object({ verdict: z.string().max(20).optional(), input: cut(4000).optional(), expected: cut(4000).optional(), got: cut(4000).optional(),
  stderr: cut(4000).optional(), compile: cut(8000).optional() }).optional();

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);

    if (p[0] === "lab" && m === "GET") return json(psLab());
    if (p[0] === "langs" && m === "GET") { void calibration(); return json({ langs: await languages() }); } // measure in the background while the tab opens
    if (p[0] === "calibration" && m === "GET") return json({ calibration: await calibration() });
    if (p[0] === "calibration" && m === "POST") return json({ calibration: await calibration(true) });
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
        sourceTitle: z.string().max(300).optional(), sourceUrl: z.string().max(2000).optional(),
        /** 주소로 가져오기: a blog or problem page address, or a Baekjoon number (src/lib/code/source.ts). */
        from: z.string().max(2000).optional(),
        /** Make it again even when a problem from the same address is there (otherwise that one is offered). */
        again: z.boolean().optional(),
        /** 실험: the draft's model for this request only (e.g. "gpt-5.6-luna"). */
        model: z.string().regex(/^[a-z0-9.-]{3,40}$/).optional(),
        /** 실험: the draft's thinking effort for this request only. */
        effort: z.enum(["low", "medium", "high"]).optional(),
        /** 실험: the faulty solutions' model for this request only. */
        mutantsModel: z.string().regex(/^[a-z0-9.-]{3,40}$/).optional(),
        /** Wait for the whole problem even when it could open at once (time measurements). */
        wait: z.boolean().optional() }).refine((x) => x.topic?.trim() || x.lesson?.trim() || x.from?.trim(), "주제나 강의 글, 주소가 필요해요."));
      const { from, again, wait, ...rest } = b;
      const got = from?.trim() ? await resolveSource(from) : null;
      const existing = got && !again ? await findBySource(got.url, rest.kind) : null;
      if (existing) return json({ existing });
      // 바로 열기: an imported original is shown at once (read it, run the examples); the hidden tests follow in the background.
      if (got?.original && rest.kind === "full" && !wait) {
        const pending = await savePreparing({ title: got.title.replace(/^BOJ (\d+) /, "BOJ $1번: "), statement: got.original.statement, inputText: got.original.inputText, outputText: got.original.outputText,
          examples: got.original.examples, folder: "알고리즘", source: { kind: "ai", title: got.title, url: got.url }, from: from!.trim() });
        void prepare(pending.id, got, rest);
        return json({ problem: publicProblem(pending) });
      }
      const made = await ensureProblemKnowledge(await makeProblem(got ? { ...rest, lesson: [got.lesson, rest.lesson?.trim() ? `[학습자가 덧붙인 글]\n${rest.lesson}` : ""].filter(Boolean).join("\n\n"),
        sourceTitle: got.title, sourceUrl: got.url, ...(got.original ? { original: got.original } : {}) } : rest));
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
        warmTests(id); // read the hidden tests now, so 제출 doesn't wait for them
        const problem = await ensureProblemKnowledge(await readProblemMeta(id));
        const subs = (await readSubmissions(id)).slice(-30).reverse().map(({ code: c, ...rest }) => ({ ...rest, lines: c.split("\n").length }));
        return json({ problem: publicProblem(problem), drafts: await readDrafts(id), submissions: subs });
      }
      if (p.length === 2 && m === "DELETE") return json(await deleteProblem(id));
      if (p[2] === "draft" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await saveDraft(id, b.lang, b.code)); }
      if (p[2] === "submission" && p[3] && m === "GET") { const s = (await readSubmissions(id)).find((x) => x.id === p[3]); return s ? json({ submission: s }) : NextResponse.json({ message: "제출을 찾을 수 없어요." }, { status: 404 }); }
      if (p[2] === "submit" && m === "POST") {
        const b = await body(z.object({ lang, code, mode: z.enum(["example", "submit"]), hints: z.number().int().min(0).max(10).optional(), advice: z.number().int().min(0).max(20).optional() }));
        return json(await submitAndRecord(id, b.lang, b.code, b.mode, b.hints ?? 0, b.advice ?? 0));
      }
      if (p[2] === "hint" && m === "POST") {
        const b = await body(z.object({ lang, code, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), last }));
        // Ask first, record after: recorded first, this very hint was in the "earlier misses" the model sees ("지난번에도").
        const out = await hint({ problemId: id, ...b });
        await recordHint(id, b.level);
        return json(out);
      }
      // 문제 목록으로 돌아가거나 다른 문제로: this attempt's 틀림 · 힌트 · 물어봄 go into the knowledge record now.
      // 실험: one model call — which model writes the independent solution (안전장치 ⑤) best.
      if (p[2] === "solve-check" && m === "POST") { const b = await body(z.object({ model: z.string().regex(/^[a-z0-9.-]{3,40}$/), effort: z.enum(["low", "medium", "high"]).optional() })); return json(await solveCheck(id, b.model, b.effort)); }
      if (p[2] === "end" && m === "POST") return json(await endAttempt(id));
      // 바로 열기 failed: make the hidden tests again from the same address.
      if (p[2] === "prepare" && m === "POST") {
        const meta = await readProblemMeta(id);
        if (!meta.preparing) return json({ ok: true });
        const got = await resolveSource(meta.preparing.from);
        await setPreparing(id, { from: meta.preparing.from, since: new Date().toISOString() });
        void prepare(id, got, { kind: "full" });
        return json({ ok: true });
      }
      // 훈련 모드 · 지켜보기 (2026-10-31, PS 루트 실험): only on a server that switched them on (scripts/run-lab.mjs ps).
      if (p[2] === "train" || p[2] === "watch") {
        const lab = psLab();
        if (p[2] === "watch" ? !lab.watch : !lab.train) return NextResponse.json({ message: "이 서버에서는 꺼져 있어요." }, { status: 404 });
        if (p[2] === "watch" && p[3] === "check" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await quickCheck(id, b.lang, b.code)); }
        if (p[2] === "watch" && p[3] === "advice" && m === "POST") {
          const b = await body(z.object({ lang, code, facts: z.record(z.string(), z.string().max(40).optional()).optional() }));
          return json(await watchAdvice({ problemId: id, ...b }));
        }
        if (p.length === 3 && m === "GET") return json({ train: await readTrain(id), size: await sizeOf(id), complexities: Object.keys(COMPLEXITIES) });
        if (p[3] === "mode" && m === "POST") { const b = await body(z.object({ mode: z.enum(["base", "train"]) })); return json({ train: await setMode(id, b.mode) }); }
        if (p[3] === "understand" && m === "POST") {
          const b = await body(z.object({ maxN: z.number().nonnegative().max(1e19).optional(), timeSec: z.number().min(0).max(100).optional(), output: z.string().max(500).optional(),
            input: z.string().max(5000).optional(), myAnswer: z.string().max(2000).optional() }));
          const result = await checkUnderstand(id, b);
          await saveStep(id, "understand", { answer: b, result });
          return json({ result, size: await sizeOf(id) });
        }
        if (p[3] === "complexity" && m === "POST") {
          const b = await body(z.object({ time: z.string().max(20), space: z.string().max(20).optional(), n: z.number().int().positive().max(1e9).optional(), save: z.boolean().optional() }));
          const meta = await readProblemMeta(id);
          const n = b.n ?? await sizeOf(id);
          if (!n) return NextResponse.json({ message: "N의 최대를 알 수 없어요. 1단계에서 먼저 적어 주세요." }, { status: 400 });
          const result = complexityVerdict(b.time, n, meta.timeLimitMs);
          if (b.save !== false) await saveStep(id, "complexity", { answer: { time: b.time, space: b.space }, result });
          return json({ result });
        }
        if (p[3] === "inputs" && m === "POST") {
          const b = await body(z.object({ inputs: z.array(z.string().max(5000)).max(8), lang: lang.optional(), code: code.optional(), step: z.enum(["correct", "implement"]).optional() }));
          return json(await tryInputs(id, b.inputs, b.lang && b.code ? { lang: b.lang, code: b.code } : undefined));
        }
        if (p[3] === "check" && m === "POST") {
          const b = await body(z.object({ step: z.enum(["model", "approach", "correct"]), answer: z.record(z.string(), z.string().max(1000)) }));
          const result = await trainCheck({ problemId: id, step: b.step, answer: b.answer });
          await saveStep(id, b.step, { answer: b.answer, result });
          return json({ result });
        }
        if (p[3] === "step" && m === "POST") {
          const b = await body(z.object({ step: z.enum(STEPS), answer: z.record(z.string(), z.unknown()).optional(), skipped: z.boolean().optional() }));
          return json({ train: await saveStep(id, b.step, { answer: b.answer ?? {}, ...(b.skipped ? { skipped: true } : {}) }) });
        }
        if (p[3] === "review-draft" && m === "POST") {
          const subs = (await readSubmissions(id)).filter((s) => s.mode === "submit");
          const firstWrong = subs.find((s) => s.verdict !== "AC")?.code, passed = [...subs].reverse().find((s) => s.verdict === "AC")?.code;
          const steps = Object.fromEntries(Object.entries((await readTrain(id)).steps).map(([k, v]) => [k, v?.answer]));
          return json({ draft: await trainReview({ problemId: id, steps, firstWrong, passed }) });
        }
        if (p[3] === "review" && m === "POST") {
          const b = await body(z.object({ idea: z.string().max(400).optional(), stuck: z.string().max(400).optional(), transfer: z.string().max(400).optional() }));
          return json(await saveReview(id, b));
        }
      }
      if (p[2] === "review" && m === "POST") { const b = await body(z.object({ lang, code, note: z.string().max(1000).optional() })); return json(await reviewApproach({ problemId: id, ...b })); }
      if (p[2] === "counter" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await counterexample({ problemId: id, ...b })); }
    }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
