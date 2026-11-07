// AI 호출 실험실 API (2026-11-06 사용자 "PDF 엔진은 다이어그램처럼 호출마다 비용·시간·모델, 입출력 보기 좋게 + 지시문 요약,
// 실습·알고리즘은 화면 통째로 붙이고 입출력 단계 실시간, 방식 바꾸면 갱신"). 로컬 실험 모드에서만.
//   GET  catalog                     호출 종류 이름·지시문 요약, 가격표, 실험실 설정
//   POST settings {purpose, model?, effort?}   이 호출 종류의 모델·강도(비우면 원래대로)
//   GET  calls?area=&ref=&since=     최근 호출 요약(새것부터, 비용 포함) · GET calls/<id> 원문
//   GET  pdf                         PDF 실행 목록 · GET pdf/<id> 실행 하나(단계·호출·비용) · GET pdf/<id>/calls/<n> 원문
//   GET  trials?gen=<id>&n=<n> | ?call=<id>   이 호출을 바꿔 다시 부른 시도들 · POST trial {base, step, system, user, model, effort, json, note}  AI 1번
//   GET  practice                    대화 실습 목록 · GET practice/<runId> 차례 기록 · POST practice/<runId>/model {model}
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { readCalls } from "@/lib/ai/trace";
import { costOf } from "@/lib/ai/prices";
import { labSettings, saveLabChoice } from "@/lib/ai/lab-settings";
import { ASSIST_CATALOG, GEN_CATALOG, TUTOR_CATALOG } from "@/lib/ai/catalog";
import { listGens, loadGen, readGenCalls } from "@/lib/study/gen/runner";
import { genStepLabel } from "@/lib/study/gen/types";
import { listPromptVersions, listTrials, runTrial, savePromptVersion, type TrialBase } from "@/lib/ai/trials";
import { EDITABLE_PROMPTS } from "@/lib/study/gen/prompt-registry";

export const runtime = "nodejs";
const COURSE = (process.env.PROJECT_COURSE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");
const PRICES = [
  { model: "gpt-6.1-terra", in: 1, cached: 0.05, out: 5 }, { model: "gpt-6.1-sol", in: 2, cached: 0.1, out: 10 },
  { model: "gpt-6-sol", in: 2, cached: 0.2, out: 10 }, { model: "gpt-6-luna", in: 0.1, cached: 0.01, out: 0.5 },
];
const MODELS = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"];
const EFFORTS = ["low", "medium", "high"];

async function course(pathname: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${COURSE}${pathname}`, { method: init?.method ?? "GET", cache: "no-store", signal: AbortSignal.timeout(6000),
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) })
    .catch(() => { throw Object.assign(new Error("실습 서버(4100)가 꺼져 있어요."), { status: 502 }); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `실습 서버 오류 (${res.status})`), { status: 502 });
  return data;
}
const tokenCost = (model: string, t?: { in?: number; cached?: number; out?: number }) => costOf(model, t ? { inputTokens: t.in, cachedInputTokens: t.cached, outputTokens: t.out } : undefined);

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const q = new URL(request.url).searchParams;
    const json = (v: unknown) => NextResponse.json(v);

    if (p[0] === "catalog" && m === "GET") return json({ assist: ASSIST_CATALOG, gen: GEN_CATALOG, genLabels: genStepLabel, tutor: TUTOR_CATALOG,
      // 지시문이 system·user에 나뉘어 들어간 단계를 색으로 나눠 보이려고(11/7): 엔진의 이름 붙은 지시문 원문
      genPrompts: EDITABLE_PROMPTS.filter((x) => x.text.trim()).map((x) => ({ name: x.name, label: x.label, step: x.step, text: x.text })), prices: PRICES, models: MODELS, efforts: EFFORTS, settings: labSettings() });
    if (p[0] === "settings" && m === "POST") {
      const b = z.object({ purpose: z.string().min(2).max(60), model: z.string().max(40).optional(), effort: z.string().max(10).optional() }).parse(await boundedJson(request));
      return json({ settings: saveLabChoice(b.purpose, b.model || b.effort ? { model: b.model, effort: b.effort } : null) });
    }
    if (p[0] === "calls" && p.length === 1 && m === "GET") {
      const calls = await readCalls({ area: q.get("area") || undefined, ref: q.get("ref") || undefined, since: q.get("since") || undefined, limit: Math.min(500, Number(q.get("limit")) || 200) });
      return json({ calls: calls.map((c) => ({ ...c, cost: tokenCost(c.model, c.tokens) })) });
    }
    if (p[0] === "calls" && p[1] && m === "GET") {
      const [c] = await readCalls({ id: p[1], days: 14 });
      if (!c) return NextResponse.json({ message: "그 호출 기록이 없어요." }, { status: 404 });
      return json({ call: { ...c, cost: tokenCost(c.model, c.tokens) } });
    }

    if (p[0] === "pdf" && p.length === 1 && m === "GET") {
      const gens = (await listGens()).filter((g) => (g.input.engine ?? "") === "recaller").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80);
      return json({ runs: gens.map((g) => ({ id: g.id, createdAt: g.createdAt, status: g.status, fileName: g.input.fileName, pages: g.input.pageNumbers.length, calls: g.calls, origin: g.input.origin ?? "lab" })) });
    }
    if (p[0] === "pdf" && p[1] && p.length === 2 && m === "GET") {
      const gen = await loadGen(p[1]);
      if (!gen) return NextResponse.json({ message: "그 실행이 없어요." }, { status: 404 });
      const calls = (await readGenCalls(p[1])).map((c) => ({ n: c.n, step: c.step, sectionId: c.sectionId, attempt: c.attempt, model: c.model, effort: c.effort, startedAt: c.startedAt,
        ms: c.ms, firstTextMs: c.firstTextMs, ok: c.ok, error: c.error, usage: c.usage, cost: costOf(c.model, c.usage), systemChars: c.system.length, userChars: c.user.length, replyChars: c.reply?.length ?? 0 }));
      const r = (gen as unknown as { recaller?: { prep?: { pages?: Array<{ page: number; route: string; title?: string; reasons?: string[] }>; ms?: number }; timing?: Record<string, number> } }).recaller;
      return json({ gen: { id: gen.id, createdAt: gen.createdAt, updatedAt: gen.updatedAt, status: gen.status, phase: gen.phase, fileName: gen.input.fileName, pages: gen.input.pageNumbers, models: (gen.input as { models?: unknown }).models ?? null },
        prep: r?.prep ? { pages: (r.prep.pages ?? []).map((x) => ({ page: x.page, route: x.route, title: x.title ?? "", reasons: x.reasons ?? [] })), ms: r.prep.ms ?? null } : null, timing: r?.timing ?? null, calls });
    }
    if (p[0] === "pdf" && p[1] && p[2] === "calls" && /^\d+$/.test(p[3] ?? "") && m === "GET") {
      const c = (await readGenCalls(p[1])).find((x) => x.n === Number(p[3]));
      if (!c) return NextResponse.json({ message: "그 호출이 없어요." }, { status: 404 });
      return json({ call: { ...c, cost: costOf(c.model, c.usage) } });
    }

    // 이 호출만 다시 (11/7): 제품 지시문은 그대로, 바꾼 것으로 한 번 부르고 lab/trials/에 남긴다
    if (p[0] === "trials" && m === "GET") {
      const base: TrialBase | null = q.get("gen") && q.get("n") ? { kind: "gen", genId: q.get("gen")!, n: Number(q.get("n")) } : q.get("call") ? { kind: "call", id: q.get("call")! } : null;
      if (!base) return NextResponse.json({ message: "어느 호출인지 알려 주세요." }, { status: 400 });
      return json({ trials: await listTrials(base) });
    }
    if (p[0] === "trial" && m === "POST") {
      const b = z.object({ base: z.union([z.object({ kind: z.literal("gen"), genId: z.string().regex(/^gen_\w{6,80}$/), n: z.number().int().min(1) }), z.object({ kind: z.literal("call"), id: z.string().regex(/^\w{4,40}$/) })]),
        step: z.string().min(1).max(80), note: z.string().max(300).optional(), system: z.string().max(80_000), user: z.string().min(1).max(900_000),
        model: z.string().min(3).max(40), effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]), json: z.boolean(),
        // 쪽 그림을 같이 (11/8 그림 위치 시험): 그 실행의 원본 PDF에서 쪽을 그려 붙인다(호출 기록에는 그림이 없어서)
        pages: z.array(z.number().int().min(1).max(2000)).max(12).optional(), imageWidth: z.number().int().min(256).max(2048).optional() }).parse(await boundedJson(request));
      let images: Array<{ label: string; dataUrl: string }> | undefined;
      if (b.pages?.length && b.base.kind === "gen") {
        const gen = await loadGen(b.base.genId);
        const { readRegisteredMcpSourcePdf } = await import("@/lib/mcp-source-registry");
        const bytes = gen ? await readRegisteredMcpSourcePdf(gen.input.sourceId) : null;
        if (!bytes) return NextResponse.json({ message: "그 실행의 원본 PDF를 읽을 수 없어요." }, { status: 404 });
        const { renderPageImages } = await import("@/lib/study/gen/pages");
        const drawn = await renderPageImages(bytes, b.pages, b.imageWidth ?? 1024);
        images = b.pages.filter((n) => drawn.get(n)).map((n) => ({ label: `원문 p.${n}`, dataUrl: drawn.get(n)! }));
      }
      return json({ trial: await runTrial({ ...b, images }) });
    }
    // 지시문 조각 버전 (11/7): GET prompt-versions?key= · POST prompt-versions {key, step, label, text, note}
    if (p[0] === "prompt-versions" && m === "GET") return json({ versions: await listPromptVersions(z.string().min(1).max(160).parse(q.get("key"))) });
    if (p[0] === "prompt-versions" && m === "POST") {
      const b = z.object({ key: z.string().min(1).max(160), step: z.string().max(80), label: z.string().max(120), text: z.string().max(200_000), note: z.string().max(200).optional() }).parse(await boundedJson(request));
      return json({ version: await savePromptVersion(b) });
    }
    if (p[0] === "practice" && p.length === 1 && m === "GET") return json({ chats: await course("/api/chats") });
    if (p[0] === "practice" && p[1] && p.length === 2 && m === "GET") {
      const d = await course(`/api/lab/practice/${encodeURIComponent(p[1])}`) as { turns?: Array<Record<string, unknown>> };
      for (const t of d.turns ?? []) { const u = t.usage as { input?: number; cached?: number; output?: number } | undefined; t.cost = u ? costOf(String(t.model ?? ""), { inputTokens: u.input, cachedInputTokens: u.cached, outputTokens: u.output }) : null; }
      return json(d);
    }
    if (p[0] === "practice" && p[1] && p[2] === "model" && m === "POST") {
      const b = z.object({ model: z.string().max(40) }).parse(await boundedJson(request));
      return json(await course(`/api/runs/${encodeURIComponent(p[1])}/chat-options`, { method: "POST", body: { model: b.model } }));
    }
    return NextResponse.json({ message: "없는 주소예요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
