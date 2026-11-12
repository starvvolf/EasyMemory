import { NextResponse } from "next/server";
import { findProblems } from "@/lib/code/find";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { languages, LANGS } from "@/lib/code/run";
import { calibration } from "@/lib/code/calibrate";
import { deleteProblem, findBySource, publicProblem, savePreparing, setPreparing, readDrafts, readProblem, readProblemMeta, readSubmissions, runCustom, saveDraft, warmTests } from "@/lib/code/problems";
import { endAttempt, ensureProblemKnowledge, idleAttempts, listProblemsWithKnowledge, noteAnswer, recordAsked, recordHint, saveReview, submitAndRecord } from "@/lib/code/service";
import { closeSheet, distillLater, readLabRuns, readSheets, REVIEW_SYSTEM, reviewFacts, reviewFor, reviewMaterial, reviewUser, runReviewLab, waitSheet } from "@/lib/code/tutor/sheets";
import { costOf } from "@/lib/ai/prices";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { keepTalk } from "@/lib/code/tutor/talk";
import { checkUnderstand, COMPLEXITIES, complexityVerdict, psLab, quickCheck, readTrain, saveStep, setMode, sizeOf, STEPS, tryInputs } from "@/lib/code/train";
import { counterexample, explainCode, explainError, hint, makeProblem, reviewApproach, solveCheck, trainAsk, trainCheck, trainReview, watchAdvice } from "@/lib/assist/code-ai";
import { chapters as bakingdogChapters, fillProblem } from "@/lib/code/bakingdog";
import { resolveSource, type Resolved } from "@/lib/code/source";
import { withTrace } from "@/lib/ai/trace";
import { LADDER, needsOf } from "@/lib/code/grade";
import { keptLevel, keptLevels, knownLevelOf, selfLevelOf } from "@/lib/assist/code-level";
import { mistakesToCatch, notePlainSolve, syncTutorImplement } from "@/lib/code/tutor/service";
import { helpState, openHelp } from "@/lib/code/tutor/help";
import { fillPredict, modelForProblem } from "@/lib/code/tutor/problem-model";

type MakeInput = Parameters<typeof makeProblem>[0];
/** The full problem from an imported original, under the id the learner already has open (바로 열기, 2026-10-29). */
async function prepare(id: string, got: Resolved, rest: Omit<MakeInput, "lesson" | "sourceTitle" | "sourceUrl" | "original" | "id"> & { lesson?: string }) {
  try {
    const made = await ensureProblemKnowledge(await makeProblem({ ...rest, id, lesson: [got.lesson, rest.lesson?.trim() ? `[학습자가 덧붙인 글]\n${rest.lesson}` : ""].filter(Boolean).join("\n\n"),
      sourceTitle: got.title, sourceUrl: got.url, ...(got.original ? { original: got.original } : {}) }));
    // PS 튜터 재료는 원문을 받을 때 같이 시작했다(아래). 모범 풀이가 검증됐으니 예측 질문의 답을 채운다(AI 없이 실행만, 11/10).
    void readProblem(made.id).then((full) => fillPredict(full)).catch(() => undefined);
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

// AI 호출 실험실(11/6): 이 API에서 나간 AI 호출에 "알고리즘 · 어느 동작 · 어느 문제" 표시를 붙인다(lib/ai/trace.ts).
async function handle(request: Request, context: RouteContext) {
  const p0 = (await context.params).path ?? [];
  return withTrace({ area: "code", action: p0.filter((x) => !/^cp_/.test(x)).join("/"), ...(p0[0] === "problem" && p0[1] ? { ref: p0[1] } : {}) }, () => inner(request, context));
}
async function inner(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);

    if (p[0] === "lab" && m === "GET") return json(psLab());
    // 총정리 실험실(11/12 사용자 "단위 작게 할 수 있게 해서 프롬프트랑 모델 조정하면서"): 로컬 실험 모드에서만. 제품 총정리에는 쓰지 않는다.
    if (p[0] === "review-lab") {
      if (!isLocalExperimentRequest(request)) return json({ error: "로컬 실험 모드에서만" });
      const cost = (r: { model: string; tokens?: { in?: number; cached?: number; out?: number } }) => costOf(r.model, r.tokens ? { inputTokens: r.tokens.in, cachedInputTokens: r.tokens.cached, outputTokens: r.tokens.out } : undefined);
      if (!p[1] && m === "GET") {
        const ids = [...new Set((await readSheets()).filter((x) => x.asked > 0 || x.submits > 0).map((x) => x.problemId))];
        const list = await Promise.all(ids.map(async (id) => { const mat = await reviewMaterial(id).catch(() => null); return mat ? { id, title: mat.meta.title, talks: mat.talk.length, at: mat.sheet.at } : null; }));
        return json({ problems: list.filter(Boolean).sort((a, b) => b!.at.localeCompare(a!.at)), system: REVIEW_SYSTEM, models: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra"], efforts: ["low", "medium", "high"] });
      }
      const id = pid.parse(p[1]);
      if (p[2] === "runs" && m === "GET") return json({ runs: (await readLabRuns(id)).map((r) => ({ ...r, cost: cost(r) })) });
      if (!p[2] && m === "GET") {
        const mat = await reviewMaterial(id);
        if (!mat) return json({ error: "정리할 풀이 기록이 없어요." });
        const range = new URL(request.url).searchParams.get("range");
        const rg = range && /^\d+-\d+$/.test(range) ? { from: Number(range.split("-")[0]), to: Number(range.split("-")[1]) } : undefined;
        return json({ title: mat.meta.title, talks: mat.talk.map((t, i) => ({ i, at: t.at, kind: t.kind, q: t.q.slice(0, 160), a: t.a.slice(0, 200), verdict: t.verdict ?? "" })), user: reviewUser(mat, rg) });
      }
      if (!p[2] && m === "POST") {
        const b = await body(z.object({ system: z.string().min(20).max(20_000), model: z.string().max(40), effort: z.enum(["low", "medium", "high"]), note: z.string().max(200).optional(),
          range: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional() }));
        const run = await runReviewLab({ problemId: id, ...b });
        return json({ run: { ...run, cost: cost(run) } });
      }
    }
    if (p[0] === "langs" && m === "GET") { void calibration(); return json({ langs: await languages() }); } // measure in the background while the tab opens
    if (p[0] === "calibration" && m === "GET") return json({ calibration: await calibration() });
    if (p[0] === "calibration" && m === "POST") return json({ calibration: await calibration(true) });
    if (p[0] === "problems" && m === "GET") {
      // 난이도(11/8): 받아 둔 AI 판단을 같이 보낸다(새로 묻지 않음).
      // 두 시간 그대로인 풀이는 먼저 문제 한 장으로(AI는 미룸), 앱을 끄느라 미룬 정리는 뒤에서 하나씩.
      for (const pid of await idleAttempts()) await closeSheet(pid, "paused", { later: true }).catch(() => undefined);
      void distillLater().catch(() => undefined);
      const [problems, levels] = await Promise.all([listProblemsWithKnowledge(), keptLevels()]);
      return json({ problems: problems.map((x) => { const l = levels[x.id]; return l?.self ? { ...x, level: { self: l.self.level, ...(l.known?.site && !l.known.similar ? { known: { site: l.known.site, rating: l.known.rating } } : {}) } } : x; }) });
    }
    if (p[0] === "ladder" && m === "GET") return json({ ladder: LADDER.map((s) => ({ step: s.step, name: s.name, what: s.what, abilities: s.abilities.map((a) => ({ id: a.id, name: a.name, what: a.what })) })) });
    if (p[0] === "run" && m === "POST") { const b = await body(z.object({ lang, code, input: z.string().max(500_000) })); return json(await runCustom(b.lang, b.code, b.input)); }
    if (p[0] === "explain" && m === "POST") {
      const b = await body(z.object({ problemId: pid.optional(), lang, code, selection: z.string().min(1).max(8000), question: z.string().max(2000).optional(),
        history: z.array(z.object({ q: z.string().max(2000), a: z.string().max(4000) })).max(200).optional(),
        /** 마지막 채점 결과(11/11): 튜터가 "왜 틀렸어요?"에 답할 수 있게 */ last: last.optional() }));
      await recordAsked(b.problemId, b.question || `코드 드래그해서 물어봄: ${b.selection.split("\n")[0].slice(0, 60)}`);
      // 대화 장부(11/11): 물은 말·답 원문 그대로(talk.ts). 질문 없이 드래그만 했으면 무엇을 했는지로.
      const talk = (a: string) => { if (b.problemId) keepTalk({ problemId: b.problemId, kind: "질문", q: b.question || "드래그한 코드 설명해 줘", a, selection: b.selection, code: b.code, ...(b.last?.verdict ? { verdict: b.last.verdict } : {}) }); };
      // 스트리밍(11/11 사용자 "AI 튜터 답 오는 것도 스트리밍으로"): ?stream=1이면 지금까지의 글을 한 줄씩(JSON) 흘려보내고, 끝나면 {done, text}.
      if (new URL(request.url).searchParams.get("stream") === "1") {
        const enc = new TextEncoder();
        const stream = new ReadableStream({ start(ctrl) {
          let last = ""; let usage: unknown = null;
          const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* 화면이 닫힘 */ } };
          void explainCode(b, (t) => { if (t.length > last.length) { send({ delta: t.slice(last.length) }); last = t; } }, (u) => { usage = u; })
            .then((out) => { if (out.text.length > last.length && out.text.startsWith(last)) send({ delta: out.text.slice(last.length) }); send({ done: true, text: out.text, usage });
              if (b.problemId) void noteAnswer(b.problemId, out.text).catch(() => undefined); talk(out.text); })
            .catch((e) => send({ error: (e as Error)?.message || "답을 받지 못했어요." }))
            .finally(() => { try { ctrl.close(); } catch { /* 이미 닫힘 */ } });
        } });
        return new NextResponse(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
      }
      const out = await explainCode(b);
      // 11/8: AI에게 배운 것은 PS 튜터 문제일 때 그 패턴의 기억으로(tutor/service.ts noteAiHelp).
      if (b.problemId) void noteAnswer(b.problemId, out.text).catch(() => undefined);
      talk(out.text);
      return json(out);
    }
    if (p[0] === "error" && m === "POST") {
      const b = await body(z.object({ problemId: pid.optional(), lang, code, error: z.string().min(1).max(12000) }));
      const out = await explainError(b);
      if (b.problemId) keepTalk({ problemId: b.problemId, kind: "오류 설명", q: b.error.slice(0, 600), a: out.text, code: b.code });
      return json(out);
    }
    // 문제 찾아오기(11/11): AI 웹 검색 1번 → 후보 3개(이미 있는 문제는 코드가 거름). 고르면 화면이 make(from)로 만든다.
    if (p[0] === "find" && m === "POST") { const b = await body(z.object({ query: z.string().max(300) })); return json(await findProblems(b.query)); }
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
        // 백준 문제면 PS 튜터 재료를 숨은 테스트와 같이 만든다(11/10 사용자 "같이 만들어", AI 1번).
        void modelForProblem(pending).catch(() => undefined);
        return json({ problem: publicProblem(pending) });
      }
      const made = await ensureProblemKnowledge(await makeProblem(got ? { ...rest, lesson: [got.lesson, rest.lesson?.trim() ? `[학습자가 덧붙인 글]\n${rest.lesson}` : ""].filter(Boolean).join("\n\n"),
        sourceTitle: got.title, sourceUrl: got.url, ...(got.original ? { original: got.original } : {}) } : rest));
      void readProblem(made.id).then((full) => modelForProblem(full)).catch(() => undefined);
      return json({ problem: publicProblem(made) });
    }
    // 바킹독 문제집: the built-in list, and filling one problem the first time it is picked.
    if (p[0] === "bakingdog" && p.length === 1 && m === "GET") return json({ chapters: await bakingdogChapters() });
    if (p[0] === "bakingdog" && p[2] === "fill" && m === "POST") {
      // 11/9: 바로 열기(원문 먼저, 숨은 테스트는 뒤에서). 튜터 문제면 교육용 모델의 틀린 접근을 틀린 풀이에 넣는다.
      const n = z.string().regex(/^\d{1,6}$/).parse(p[1]);
      const made = await ensureProblemKnowledge(await fillProblem(n, undefined, { avoid: await mistakesToCatch(n).catch(() => []) }));
      return json({ problem: publicProblem(made) });
    }
    if (p[0] === "problem" && p[1]) {
      const id = pid.parse(p[1]);
      if (p.length === 2 && m === "GET") {
        warmTests(id); // read the hidden tests now, so 제출 doesn't wait for them
        const problem = await ensureProblemKnowledge(await readProblemMeta(id));
        const subs = (await readSubmissions(id)).slice(-30).reverse().map(({ code: c, ...rest }) => ({ ...rest, lines: c.split("\n").length }));
        const level = await keptLevel(problem);
        const needs = needsOf({ reference: problem.reference?.code, picked: level?.self?.abilities, knowledge: problem.knowledge });
        return json({ problem: publicProblem(problem), drafts: await readDrafts(id), submissions: subs, level, needs });
      }
      // 난이도(11/8): 처음 열 때 화면이 self를 부르고, 알려진 등급이 비었으면 known을 잇는다. 받은 것은 code/levels.json에(code-level.ts).
      //   self: 자체 판단 + 필요한 능력 + AI가 아는 등급, AI 1번(terra low, 검색 없음). known: 그 등급이 없을 때만 AI 1번(웹 검색).
      if (p[2] === "level" && p[3] === "self" && m === "POST") {
        const problem = await readProblemMeta(id);
        const self = await selfLevelOf(problem);
        // AI가 알던 등급이 있으면 같이 보낸다. 없으면 화면이 이어서 …/level/known(웹 검색)을 부른다.
        return json({ self, known: (await keptLevel(problem))?.known ?? null, needs: needsOf({ reference: problem.reference?.code, picked: self.abilities, knowledge: problem.knowledge }) });
      }
      if (p[2] === "level" && p[3] === "known" && m === "POST") return json({ known: await knownLevelOf(await readProblemMeta(id)) });
      if (p.length === 2 && m === "DELETE") return json(await deleteProblem(id));
      if (p[2] === "draft" && m === "POST") { const b = await body(z.object({ lang, code })); return json(await saveDraft(id, b.lang, b.code)); }
      if (p[2] === "submission" && p[3] && m === "GET") { const s = (await readSubmissions(id)).find((x) => x.id === p[3]); return s ? json({ submission: s }) : NextResponse.json({ message: "제출을 찾을 수 없어요." }, { status: 404 }); }
      if (p[2] === "submit" && m === "POST") {
        const b = await body(z.object({ lang, code, mode: z.enum(["example", "submit"]), hints: z.number().int().min(0).transform((n) => Math.min(n, 999)).optional(), advice: z.number().int().min(0).transform((n) => Math.min(n, 999)).optional() }));
        const result = await submitAndRecord(id, b.lang, b.code, b.mode, b.hints ?? 0, b.advice ?? 0);
        // 튜터에서 "직접 짜기"로 연 문제면 맞히는 순간 튜터 기록에 남긴다(11/10, 전에는 튜터 탭으로 돌아와야 남았다).
        // 튜터를 거치지 않고 바로 푼 문제도 재료가 있으면 풀이로 남는다(11/11).
        // 맞았으면 튜터 기록 다음에 문제 한 장으로 정리(11/11, AI 1번은 화면을 기다리게 하지 않음. 화면은 /sheet로 기다린다).
        if (b.mode === "submit") {
          const synced = notePlainSolve(id).then(() => syncTutorImplement()).catch(() => undefined);
          if (result.verdict === "AC") void closeSheet(id, "solved", { after: synced }).catch(() => undefined);
        }
        return json(result);
      }
      // 도움 네 칸(11/11): 1 눈여겨볼 곳 · 2 방법 이름 · 3 계획(AI 없음) · 4 뼈대 코드(처음이면 AI 1번 + 채점). 연 칸은 튜터 기록에 남는다.
      if (p[2] === "help" && m === "GET") return json({ help: await helpState(id) });
      if (p[2] === "help" && m === "POST") {
        const b = await body(z.object({ rung: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), lang }));
        const out = await openHelp(id, b.rung, b.lang);
        keepTalk({ problemId: id, kind: "도움 칸", q: `도움 ${b.rung}칸: ${out.label}`, a: [out.text, "skeleton" in out && out.skeleton ? `[뼈대 코드]\n${out.skeleton}` : ""].filter(Boolean).join("\n\n") });
        return json(out);
      }
      if (p[2] === "hint" && m === "POST") {
        const b = await body(z.object({ lang, code, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), last }));
        // Ask first, record after: recorded first, this very hint was in the "earlier misses" the model sees ("지난번에도").
        const out = await hint({ problemId: id, ...b });
        await recordHint(id, b.level);
        void noteAnswer(id, out.text, "hint").catch(() => undefined); // 11/11: 카드 정리는 끝날 때 문제 한 장에서 한 번(tutor/sheets.ts)
        keepTalk({ problemId: id, kind: "힌트", q: `힌트 ${b.level}단계`, a: out.text, code: b.code, ...(b.last?.verdict ? { verdict: b.last.verdict } : {}) });
        return json(out);
      }
      // 문제 목록으로 돌아가거나 다른 문제로: this attempt's 틀림 · 힌트 · 물어봄 go into the knowledge record now.
      // 실험: one model call — which model writes the independent solution (안전장치 ⑤) best.
      if (p[2] === "solve-check" && m === "POST") { const b = await body(z.object({ model: z.string().regex(/^[a-z0-9.-]{3,40}$/), effort: z.enum(["low", "medium", "high"]).optional() })); return json(await solveCheck(id, b.model, b.effort)); }
      // 나가기(11/11 "인터랙션이 있이 나갔으면 저장"): 쓰던 코드를 남기고, 한 게 있으면 문제 한 장(하다가 나감)으로. 앱을 끄는 중이면 AI는 다음에 켤 때.
      if (p[2] === "end" && m === "POST") {
        const b = await body(z.object({ lang: lang.optional(), code: z.string().max(200_000).optional(), touched: z.boolean().optional(), quit: z.boolean().optional(), since: z.string().max(40).optional() }));
        if (!b.touched) return json({ ...(await endAttempt(id)), sheet: null }); // 보기만 하고 나감: 예전처럼 이번 풀이만 닫는다
        if (b.lang && b.code !== undefined) await saveDraft(id, b.lang, b.code).catch(() => undefined);
        const sheet = await closeSheet(id, "paused", { later: Boolean(b.quit), ...(b.code ? { code: b.code } : {}), ...(b.since ? { since: b.since } : {}) }).catch(() => null);
        await endAttempt(id);
        return json({ sheet });
      }
      if (p[2] === "sheet" && m === "GET") return json({ sheet: await waitSheet(id) });
      // 총정리(11/12): 이 문제의 마지막 장. 없으면 만든다(AI 1번, 보통 4~6초).
      if (p[2] === "review" && m === "GET") {
        const facts = await reviewFacts(id);
        // 처음 만들 때는 스트리밍(11/12 사용자 "총정리 처음 만들 때 스트리밍으로"): 지금까지 받은 JSON 글을 {t} 줄로, 끝나면 {done, review, facts}.
        if (new URL(request.url).searchParams.get("stream") === "1") {
          const enc = new TextEncoder();
          const stream = new ReadableStream({ start(ctrl) {
            const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* 화면이 닫힘 */ } };
            let last = 0;
            void reviewFor(id, (t) => { if (t.length - last >= 24) { last = t.length; send({ t }); } })
              .then((review) => send({ done: true, review, facts })).catch((e) => send({ error: (e as Error)?.message || "정리하지 못했어요." }))
              .finally(() => { try { ctrl.close(); } catch { /* 이미 닫힘 */ } });
          } });
          return new NextResponse(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
        }
        return json({ review: await reviewFor(id), facts });
      }
      // 바로 열기 failed: make the hidden tests again from the same address.
      if (p[2] === "prepare" && m === "POST") {
        const meta = await readProblemMeta(id);
        if (!meta.preparing) return json({ ok: true });
        const got = await resolveSource(meta.preparing.from);
        await setPreparing(id, { from: meta.preparing.from, since: new Date().toISOString() });
        void prepare(id, got, { kind: "full" });
        return json({ ok: true });
      }
      // 훈련 모드 · 지켜보기 (2026-10-31, PS 루트 실험): only on a server that switched them on (lab/run-lab.mjs ps).
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
          const before = (await readTrain(id)).steps.understand;
          await saveStep(id, "understand", { answer: { ...(before?.answer ?? {}), ...b }, result: { ...result, fields: (before?.result as { fields?: unknown } | undefined)?.fields } });
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
          const b = await body(z.object({ step: z.enum(["understand", "model", "approach", "correct"]), answer: z.record(z.string(), z.string().max(1000)), field: z.string().max(20).optional() }));
          const result = await trainCheck({ problemId: id, step: b.step, answer: b.answer, ...(b.field ? { field: b.field } : {}) });
          // A box check keeps the step's own result and adds the box's under fields; a whole-step check keeps the boxes'.
          const before = (await readTrain(id)).steps[b.step];
          const prior = (before?.result ?? {}) as { fields?: Record<string, unknown> };
          await saveStep(id, b.step, b.field
            ? { answer: { ...(before?.answer ?? {}), ...b.answer }, result: { ...prior, fields: { ...(prior.fields ?? {}), [b.field]: result } } }
            : { answer: b.answer, result: { ...result, ...(prior.fields ? { fields: prior.fields } : {}) } });
          return json({ result });
        }
        if (p[3] === "ask" && m === "POST") {
          const b = await body(z.object({ step: z.enum(["understand", "model", "approach", "correct", "complexity"]), question: z.string().min(1).max(2000) }));
          await recordAsked(id, `[훈련] ${b.question}`);
          const answers = Object.fromEntries(Object.entries((await readTrain(id)).steps).map(([k, v]) => [k, v?.answer]));
          const out = await trainAsk({ problemId: id, step: b.step, answers, question: b.question });
          keepTalk({ problemId: id, kind: "훈련 질문", q: b.question, a: out.text });
          return json(out);
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
      if (p[2] === "review" && m === "POST") {
        const b = await body(z.object({ lang, code, note: z.string().max(1000).optional() }));
        const out = await reviewApproach({ problemId: id, ...b });
        keepTalk({ problemId: id, kind: "맞는지 봐 줘", q: b.note?.trim() || "이 방향이 맞는지 봐 줘", a: out.text, code: b.code });
        return json(out);
      }
      if (p[2] === "counter" && m === "POST") {
        const b = await body(z.object({ lang, code }));
        const out = await counterexample({ problemId: id, ...b });
        const c = out.found ? out.case : undefined;
        keepTalk({ problemId: id, kind: "반례", q: "반례 찾아 줘", code: b.code, a: c ? `깨지는 입력을 찾았어요 (${out.tried}개 중).\n[입력]\n${c.input.slice(0, 1500)}\n[기대]\n${c.expected.slice(0, 600)}\n[내 출력]\n${c.got.slice(0, 600)}${c.stderr ? `\n[에러]\n${c.stderr.slice(0, 600)}` : ""}` : `입력 ${out.tried}개로 돌려 봤는데 깨지는 것을 못 찾았어요.${out.compile ? `\n[컴파일]\n${out.compile.slice(0, 600)}` : ""}` });
        return json(out);
      }
    }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
