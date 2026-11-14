// 자료 한 편을 recaller 엔진(recaller.ts)으로 돌린다: 전처리 → 줄기 계획 → 기억 채우기.
// 하는 일마다 바로 저장하므로, 멈춰도(사용량 한도 · 로그인 · 호출 상한 · 서버 재시작) 빠진 것부터 이어 간다.
// (11/15 리팩토링: 예전 엔진 v2 · v3 · v4 · v5 · alpha · astra와 문제 만들기 · 정리 글 · 실시간 쪽 카드 갈래를 뺐다)
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, ModelError, type ModelCaller, type ModelRequest } from "../../ai/model.ts";
import { redactCallText } from "../lab-contract.ts";
import { replyJsonSchema, RunawayReply } from "./json-reply.ts";
import { cropFigures, pageEmphasis, renderPageFigures, renderPageImages } from "./pages.ts";
import { preparePdf, preparePdfFast, prepFromTexts, prepRouters, type PrepResult } from "./prep.ts";
import { recallerFakeReply, runRecaller } from "./recaller.ts";
import type { SummaryState } from "./summary.ts";
import { DEFAULT_GEN_MODELS, genStepLabel, genSteps, purposes, type GenCall, type GenInput, type GenMark, type GenState, type GenStep, type Section } from "./types.ts";

export const dataRoot = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-gen");
const idPattern = /^gen_[a-f0-9]{32}$/;
const dirOf = (id: string) => { if (!idPattern.test(id)) throw new GenError(400, "생성 ID가 올바르지 않습니다."); return path.join(dataRoot(), id); };

export class GenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** 만드는 동안 지도가 읽는 것: 실행 상태와 줄기(목차 · 기억 줄). 예전 실행의 정리 글(summary.json)도 같이. */
export async function genLive(id: string) {
  const state = await loadGen(id);
  const outline = (state?.recaller?.prep?.pages ?? []).map((p) => ({ page: p.page, title: p.title }));
  return { now: Date.now(), status: state?.status ?? "failed", live: false, outline, pages: [], summary: await loadSummary(id), digest: state?.recaller?.digest ?? null };
}
/** 예전 실행의 정리 글 (10/31 실험, 지금은 만들지 않는다). */
export async function loadSummary(id: string): Promise<SummaryState | null> {
  try { return JSON.parse(await readFile(path.join(dirOf(id), "summary.json"), "utf8")) as SummaryState; } catch { return null; }
}

class Stop extends Error {
  readonly status: GenState["status"];
  /** 연결이나 서버가 잠깐 끊긴 것(호출 상한 · 한도 · 형식 오류가 아님): 실행이 저절로 다시 이어 간다. */
  transient = false;
  constructor(status: GenState["status"], message: string) { super(message); this.status = status; }
}
/** 같은 짧은 글(1~12자)을 끝에서 40번 넘게 되풀이하는 답. */
export function repeating(text: string) {
  const tail = text.slice(-600);
  return tail.length >= 200 && /([\s\S]{1,12}?)\1{39,}$/.test(tail);
}
const AUTO_RESUMES = 3;
const AUTO_RESUME_MS = 10_000;
const TRANSIENT_WAITS = [2000, 5000, 12000];

// ---- 저장 -------------------------------------------------------------------------------------------------
const writes = (globalThis as typeof globalThis & { __studyGenWrites?: Map<string, Promise<void>> });
async function saveJson(file: string, value: unknown) {
  const queue = (writes.__studyGenWrites ??= new Map());
  const pending = (queue.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, file); break; }
      catch (error) {
        // 윈도우에서 읽는 프로그램 · 백신이 잠깐 붙잡고 있을 수 있다.
        if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= 5) { await rm(temporary, { force: true }); throw error; }
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  });
  queue.set(file, pending);
  try { await pending; } finally { if (queue.get(file) === pending) queue.delete(file); }
}
async function saveState(state: GenState) { state.updatedAt = new Date().toISOString(); await saveJson(path.join(dirOf(state.id), "state.json"), state); }
export async function loadGen(id: string): Promise<GenState | null> {
  try { return JSON.parse(await readFile(path.join(dirOf(id), "state.json"), "utf8")) as GenState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function readGenCalls(id: string): Promise<GenCall[]> {
  let files: string[];
  try { files = await readdir(path.join(dirOf(id), "calls")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(files.filter((file) => /^\d+\.json$/.test(file)).sort((a, b) => parseInt(a) - parseInt(b))
    .map(async (file) => JSON.parse(await readFile(path.join(dirOf(id), "calls", file), "utf8")) as GenCall));
}
export async function listGens(): Promise<GenState[]> {
  let names: string[];
  try { names = await readdir(dataRoot()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const states = await Promise.all(names.filter((name) => idPattern.test(name)).map((name) => loadGen(name).catch(() => null)));
  return states.filter((state): state is GenState => Boolean(state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- 새 실행 -------------------------------------------------------------------------------------------
const modelChoice = z.object({ model: z.string().trim().min(1).max(80), effort: z.enum(["low", "medium", "high", "xhigh"]) });
export const genInputSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  pageNumbers: z.array(z.number().int().positive().max(500)).min(1).max(500),
  purpose: z.enum(purposes).default("core"),
  note: z.string().max(2000).default(""),
  provider: z.enum(["chatgpt", "codex", "fake"]).default("chatgpt"),
  models: z.partialRecord(z.enum(genSteps), modelChoice).default({}),
  origin: z.enum(["lab", "study"]).default("study"),
  /** 공부 화면: 카드까지만(문제 만들기는 11/15에 지웠다). 옛 클라이언트가 보내도 받는다. */
  questionsLater: z.boolean().optional(),
  /** 강의 준비: 자료를 다 만들면 강의 첫 영역을 뒤에서 써 둔다(lecture-areas.ts). */
  lecture: z.boolean().optional(),
  engine: z.literal("recaller").default("recaller"),
  lab: z.strictObject({ router: z.enum(prepRouters).optional(), fastPrep: z.number().int().min(1).max(16).optional(), imageWidth: z.number().int().min(512).max(2400).optional(),
    figures: z.boolean().optional(), callCap: z.number().int().min(10).max(2000).optional() }).optional(),
});

export async function createGen(raw: unknown): Promise<GenState> {
  const parsed = genInputSchema.parse(raw);
  const input: GenInput = { ...parsed, autoConfirm: false, signals: { weakSpots: [], reports: [] }, lab: parsed.lab ?? studyLab() };
  input.pageNumbers = [...new Set(input.pageNumbers)].sort((a, b) => a - b);
  const now = new Date().toISOString();
  const state: GenState = { id: `gen_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now, input, status: "queued", phase: "outline", message: "", calls: 0, sections: [] };
  await saveState(state);
  return state;
}
/** 앱 기본값: 쪽 순서는 코드(prep-2), 쪽 그리기는 작업 프로세스 8개 · 1024px, 카드에 그림 붙이기. */
export function studyLab(): NonNullable<GenInput["lab"]> {
  return { router: "prep-2", fastPrep: 8, imageWidth: 1024, figures: true };
}

const queue = globalThis as typeof globalThis & { __studyGenQueue?: Promise<unknown>; __studyGenQueued?: Set<string> };
/** queued/running으로 저장됐는데 이 프로세스의 대기열에 없으면: 서버가 도중에 꺼진 것. */
export async function genView(id: string): Promise<GenState | null> {
  const state = await loadGen(id);
  if (state && (state.status === "queued" || state.status === "running") && !queue.__studyGenQueued?.has(id)) {
    return { ...state, status: "interrupted", message: "서버가 다시 시작돼 생성이 멈췄어요. 다시 시작하면 멈춘 곳부터 이어가요." };
  }
  return state;
}

export type RunOptions = {
  /** 쪽 글(테스트 · 글 자료). 없으면 등록된 PDF를 읽는다. */
  pages?: (input: GenInput) => Promise<Map<number, string>>;
  /** 가짜 답(단계마다). provider가 fake면 기본 가짜 모델. */
  fakeReply?: (step: GenStep, user: string, attempt: number) => string;
  /** 쪽 그림(data URL). 없으면 등록된 PDF를 그린다. */
  pageImages?: (input: GenInput, pages: number[]) => Promise<Map<number, string>>;
  /** PDF 바이트. 없으면 등록된 PDF. null이면 글 자료로 간다. */
  pdf?: (input: GenInput) => Promise<Uint8Array | null>;
  prep?: (pdf: Uint8Array | null, pages: number[]) => Promise<PrepResult>;
};

async function registeredPdfBytes(input: GenInput) {
  const { readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  return readRegisteredMcpSourcePdf(input.sourceId);
}
async function registeredImages(input: GenInput, pages: number[]) {
  const bytes = await registeredPdfBytes(input);
  if (!bytes) throw new Stop("failed", "등록된 원본 PDF를 읽을 수 없어요.");
  return renderPageImages(bytes, pages, input.lab?.imageWidth);
}
/** 등록된 PDF가 없을 때의 쪽 글: 글 자료(유튜브 자막 같은 것)는 같은 id로 쪽 글을 둔다(text-sources.ts). */
async function registeredPages(input: GenInput) {
  const { readTextSource } = await import("../text-sources.ts");
  const pages = await readTextSource(input.sourceId);
  if (!pages) throw new Stop("failed", "등록된 원본 자료를 읽을 수 없어요.");
  return new Map([...pages].filter(([page]) => input.pageNumbers.includes(page)));
}

/** 강의 준비를 골랐으면(input.lecture) 다 만든 뒤 강의 첫 영역을 뒤에서 부른다. 실패해도 자료에는 영향 없음. */
async function lectureAfter(state: GenState) {
  if (state?.status !== "done" || !state.input.lecture) return state;
  void (async () => { const { context } = await import("../lecture-steps.ts"); const { startArea } = await import("../lecture-areas.ts");
    const first = (await context(state.id)).sections[0]; if (first) await startArea(state.id, first.id); })().catch(() => undefined);
  return state;
}
/** 이 서버 프로세스에서 한 번에 하나씩. 돌릴 수 없는 요청은 대기열에 넣기 전에 오류. */
export async function enqueueGen(id: string, caller: ModelCaller, options: RunOptions & { confirmedRealCalls?: boolean } = {}) {
  const queued = (queue.__studyGenQueued ??= new Set());
  if (queued.has(id)) return;
  const state = await loadGen(id);
  if (!state) throw new GenError(404, "생성을 찾을 수 없습니다.");
  if (state.status === "done" || state.status === "failed" || state.status === "awaiting-confirm") return;
  if (state.input.provider !== "fake" && !options.confirmedRealCalls) throw new GenError(400, "실제 모델 호출 확인이 필요합니다.");
  queued.add(id);
  state.status = "queued"; state.message = "";
  await saveState(state);
  const finished = (queue.__studyGenQueue ?? Promise.resolve()).then(() => runGen(id, caller, options)).then(lectureAfter).catch(() => undefined).finally(() => queued.delete(id));
  queue.__studyGenQueue = finished;
  return { finished };
}

// ---- 실행 ---------------------------------------------------------------------------------------------
export async function runGen(id: string, caller: ModelCaller, options: RunOptions = {}): Promise<GenState> {
  const stored = await loadGen(id);
  if (!stored) throw new GenError(404, "생성을 찾을 수 없습니다.");
  const state: GenState = stored;
  if (state.status === "done" || state.status === "failed" || state.status === "awaiting-confirm") return state;
  const input = state.input;
  // 동시에 도는 호출 중 하나가 멈춤(한도 · 로그인 · 상한)에 닿으면 나머지도 끊는다.
  const abort = new AbortController();
  let failure: Stop | undefined;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (error: unknown): Stop => {
    const stop = error instanceof Stop ? error
      : error instanceof ModelError && error.code === "usage_limit" ? new Stop("paused-usage-limit", "ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 시작해 주세요.")
        : error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured") ? new Stop("paused-login", error.message)
          : Object.assign(new Stop("paused-invalid", error instanceof Error ? error.message : String(error)), { transient: error instanceof ModelError && error.code === "transient" });
    failure ??= stop;
    abort.abort();
    return failure;
  };
  state.liveCalls = [];
  let callsThisStart = 0;
  // 상한: 쪽마다 8번 + 40번. 44쪽 자료도 한 번에 끝나고, 도는 실행은 멈춘다.
  const cap = input.lab?.callCap ?? Math.max(60, input.pageNumbers.length * 8 + 40);

  const ask = async (step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown> | null,
    extra: { images?: ModelRequest["images"]; page?: number; maxChars?: number; cacheKey?: string; onPartial?: (text: string) => void } = {}) => {
    if (failure) throw failure;
    if (callsThisStart >= cap) throw fail(new Stop("paused-invalid", `한 번에 쓸 수 있는 호출 수(${cap})를 다 썼어요. 다시 시작하면 멈춘 곳부터 이어가요.`));
    if (input.provider === "fake" && process.env.NODE_ENV === "production") throw new Stop("failed", "가짜 모델은 개발 환경에서만 쓸 수 있어요.");
    callsThisStart += 1;
    state.calls += 1;
    const n = state.calls;
    const started = Date.now();
    const live: NonNullable<GenState["liveCalls"]>[number] = { n, step, startedAt: new Date(started).toISOString(), receivedChars: 0 };
    state.liveCalls!.push(live);
    const choice = input.models[step] ?? DEFAULT_GEN_MODELS[step];
    const model = choice?.model ?? (process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol");
    const effort = choice?.effort ?? (process.env.STUDY_FORGE_EXECUTOR_EFFORT?.trim() || "medium");
    state.current = { step, ...(sectionId ? { sectionId } : {}), ...(extra.page ? { page: extra.page } : {}), attempt };
    await saveState(state);
    const record: GenCall = { n, step, sectionId, attempt, model, effort, format: null, startedAt: new Date(started).toISOString(), ms: 0, ok: false,
      system: redactCallText(system), user: redactCallText(user), reply: null, error: null };
    const callFile = path.join(dirOf(id), "calls", `${n}.json`);
    // 끝없이 이어지는 답(같은 칸 · 공백 되풀이)은 maxChars를 넘으면 끊고, 받은 것은 호출 기록에 남긴다.
    const cut = extra.maxChars ? new AbortController() : undefined;
    let partial = "", runaway = false;
    const guardText = (text: string) => {
      partial = text;
      if (cut && !runaway && (text.length > extra.maxChars! || /\s{1500}$/.test(text) || repeating(text))) { runaway = true; cut.abort(); return; }
      extra.onPartial?.(text);
    };
    const request: ModelRequest = { purpose: `gen:${step}`, system, user, json: Boolean(schema), ...(cut || extra.onPartial ? { onText: guardText } : {}), ...(schema ? { schema, schemaName: `recaller_${step.replace(/-/g, "_")}` } : {}),
      model, effort, caller, provider: input.provider, ...(extra.images ? { images: extra.images } : {}), ...(extra.cacheKey ? { cacheKey: extra.cacheKey } : {}) };
    request.signal = abort.signal;
    request.onProgress = (receivedChars) => {
      if (abort.signal.aborted) return;
      live.receivedChars = receivedChars;
      if (!live.firstTextAt) { live.firstTextAt = new Date().toISOString(); record.firstTextMs = Date.now() - started; }
      if (!progressTimer) progressTimer = setTimeout(() => { progressTimer = undefined; void saveState(state).catch(fail); }, 1000);
    };
    if (cut) { abort.signal.addEventListener("abort", () => cut.abort(), { once: true }); request.signal = cut.signal; }
    try {
      if (input.provider === "fake") request.fakeReply = (options.fakeReply ?? ((s: GenStep, u: string) => recallerFakeReply(s, u)))(step, user, attempt);
      // 가짜 모델은 흘려 보내지 않으니 조각으로 넘겨, 끊기 검사가 진짜처럼 돈다.
      if (request.fakeReply !== undefined && (cut || extra.onPartial)) for (let at = 200; at < request.fakeReply.length + 200 && !runaway; at += 200) guardText(request.fakeReply.slice(0, at));
      if (runaway) throw new Error("cut");
      let reply: Awaited<ReturnType<typeof callModel>>;
      for (let retry = 0; ; retry++) {
        try { reply = await callModel(request); break; }
        catch (error) {
          // 연결이 잠깐 끊긴 것은 몇 번, 간격을 흩어서 다시.
          if (retry >= TRANSIENT_WAITS.length || runaway || request.signal?.aborted || !(error instanceof ModelError) || error.code !== "transient") throw error;
          partial = "";
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_WAITS[retry] * (0.75 + Math.random() / 2)));
          if (request.signal?.aborted) throw error;
        }
      }
      Object.assign(record, { ok: true, reply: redactCallText(reply.text), model: reply.model, usage: reply.usage, format: reply.format ?? null, ms: Date.now() - started });
      await saveJson(callFile, record);
      return schema ? reply.data : reply.text;
    } catch (error) {
      if (runaway) {
        const kept = partial.length > 24000 ? `${partial.slice(0, 12000)}\n…(중략 ${partial.length - 24000}자)…\n${partial.slice(-12000)}` : partial;
        Object.assign(record, { reply: redactCallText(kept), error: repeating(partial) ? `응답이 같은 글을 되풀이해 ${partial.length.toLocaleString()}자에서 끊었어요.` : `응답이 ${partial.length.toLocaleString()}자로 상한 ${extra.maxChars!.toLocaleString()}자를 넘어 끊었어요.`, ms: Date.now() - started });
        await saveJson(callFile, record);
        throw new RunawayReply(extra.maxChars!, partial.length);
      }
      fail(error);
      const raw = (error as { rawText?: string }).rawText;
      Object.assign(record, { reply: raw === undefined ? null : redactCallText(raw), error: redactCallText(error instanceof Error ? error.message : String(error)), ms: Date.now() - started });
      await saveJson(callFile, record);
      throw failure ?? error;
    } finally {
      state.liveCalls = state.liveCalls!.filter((call) => call.n !== n);
      await saveState(state);
    }
  };
  /** 형식이 안 맞는 답이나 끊긴 연결은 한 번의 시도로 센다. */
  const askParsed = async <T>(step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown>, parser: z.ZodType<T>,
    extra: { images?: ModelRequest["images"]; maxChars?: number; cacheKey?: string } = {}) => {
    try {
      const parsed = parser.safeParse(await ask(step, sectionId, attempt, system, user, schema, extra));
      return parsed.success ? { ok: true as const, value: parsed.data } : { ok: false as const, problem: "응답이 정해진 JSON 형식과 다릅니다." };
    } catch (error) {
      if (error instanceof Stop || error instanceof RunawayReply) throw error;
      return { ok: false as const, problem: error instanceof Error ? error.message : String(error) };
    }
  };

  const mark = (event: GenMark["event"], extra: Omit<GenMark, "at" | "event"> = {}) => { (state.timeline ??= []).push({ at: new Date().toISOString(), event, ...extra }); };
  try {
    if (input.engine !== "recaller") throw new Stop("failed", "예전 엔진으로 만든 실행이라 이어 만들 수 없어요. 새 자료로 다시 만들어 주세요.");
    state.status = "running"; state.message = "";
    mark("start", { note: state.phase });
    await saveState(state);
    const pdf = await (options.pdf ?? registeredPdfBytes)(input).catch(() => null);
    // 글 자료(txt_): 쪽 글이 아직 없으면(유튜브는 자막 → 내용 정리) 먼저 만든다. 쪽 수는 그때 정해진다.
    if (!pdf && !options.pages && !state.recaller?.prep && input.sourceId.startsWith("txt_")) {
      const { readyTextSource } = await import("../text-sources.ts");
      const pages = await readyTextSource(input.sourceId, (step, system, user, onPartial) => ask(step, null, 1, system, user, null, { onPartial }).then(String));
      if (pages.length) { input.pageNumbers = pages; await saveState(state); }
    }
    let outlined = state.sections.length > 0;
    // 빠른 전처리: 전처리가 그려 둔 쪽 그림과 그림 영역(이 실행에서만).
    const drawn = new Map<number, string>(), drawnFigures = new Map<number, number[][]>();
    let fastEmphasis: Map<number, string[]> | undefined;
    await runRecaller({
      state, pdf,
      ask: async (step, sectionId, attempt, system, user, parser, extra = {}) => {
        const schema = replyJsonSchema(parser);
        let result = await askParsed(step, sectionId, attempt, system, user, schema, parser, extra);
        // 형식이 안 맞으면 조용히 한 번 더, 그래도 안 맞으면 그 자리에서 멈춘다.
        if (!result.ok) result = await askParsed(step, sectionId, attempt, system, `${user}\n\n[앞 응답 문제] ${result.problem} 정해진 JSON 형식으로만 다시 답한다.`, schema, parser, extra);
        if (!result.ok) throw fail(new Stop("paused-invalid", `${genStepLabel[step]}: ${result.problem} 완료 단계는 보존됩니다.`));
        return result.value;
      },
      askText: async (step, page, attempt, system, user, images) => String(await ask(step, null, attempt, system, user, null, { images, ...(page ? { page } : {}) })),
      saveFigure: async (name, jpeg) => { const dir = path.join(dirOf(id), "figures"); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, name.replace(/[^\w.-]/g, "_")), jpeg); },
      prepare: options.prep ?? (async (bytes, pages) => {
        if (!bytes) return prepFromTexts(await (options.pages ?? registeredPages)(input), pages);
        if (!input.lab?.fastPrep) return preparePdf(bytes, pages, input.lab?.router);
        const fast = await preparePdfFast(bytes, pages, input.lab.router ?? "prep-1", { procs: input.lab.fastPrep, width: input.lab.imageWidth ?? 1024, workerPath: path.join(process.cwd(), "src/lib/study/gen/prep-worker.ts") });
        for (const [n, image] of fast.images) drawn.set(n, image);
        fastEmphasis = fast.emphasis;
        for (const p of fast.prep.pages) if (p.figures) drawnFigures.set(p.page, p.figures);
        if (fast.failed.length) state.recaller?.warnings.push({ severity: "warning", code: "rc-draw-failed", message: `p.${fast.failed.join(", ")}를 그리지 못해 글자 층만 써요.` });
        return fast.prep;
      }),
      emphasis: async (pages) => fastEmphasis ?? (pdf ? pageEmphasis(pdf, pages) : new Map()),
      pageImages: async (wanted) => {
        const missing = wanted.filter((p) => !drawn.has(p));
        const more = missing.length && !input.lab?.fastPrep ? await (options.pageImages ?? registeredImages)(input, missing) : new Map<number, string>();
        return new Map(wanted.map((p) => [p, drawn.get(p) ?? more.get(p)]).filter((e): e is [number, string] => Boolean(e[1])));
      },
      pageFigures: async (wanted) => {
        if (!pdf) return new Map();
        if (!input.lab?.fastPrep) return renderPageFigures(pdf, wanted, input.lab?.imageWidth);
        return new Map(await Promise.all(wanted.filter((p) => drawn.has(p)).map(async (p) => [p, drawnFigures.has(p) ? await cropFigures(p, drawn.get(p)!, drawnFigures.get(p)!) : []] as const)));
      },
      save: () => { if (!outlined && state.sections.length) { outlined = true; mark("outline"); } return saveState(state); },
    }).catch((error) => { throw error instanceof Stop ? error : fail(error); });
    if (progressTimer) clearTimeout(progressTimer);
    if (failure) throw failure;
    if ((state.status as string) === "done") { mark("done"); await saveState(state); }
    return state;
  } catch (error) {
    if (progressTimer) clearTimeout(progressTimer);
    const stop = failure ?? (error instanceof Stop ? error : new Stop("failed", error instanceof Error ? error.message : String(error)));
    state.status = stop.status; state.message = stop.message;
    mark("stopped", { note: stop.status });
    // 연결이 끊긴 뒤에는 몇 번 저절로 이어 간다(한 것은 그대로). 호출 상한 · 한도 · 로그인은 학습자를 기다린다.
    const again = stop.transient && input.provider !== "fake" && (state.autoResumes ?? 0) < AUTO_RESUMES;
    if (again) {
      state.autoResumes = (state.autoResumes ?? 0) + 1;
      state.message = `연결이 잠깐 끊겼어요. ${AUTO_RESUME_MS / 1000}초 뒤 멈춘 곳부터 저절로 이어 가요.`;
    }
    await saveState(state);
    if (again) setTimeout(() => { void enqueueGen(id, caller, { ...options, confirmedRealCalls: true }).catch(() => undefined); }, AUTO_RESUME_MS).unref?.();
    return state;
  }
}

/** 지금 하는 단계 한 줄(실험 목록) */
export function stepLabel(state: GenState) {
  if (!state.current) return "";
  const section = state.sections.find((candidate) => candidate.id === state.current?.sectionId);
  return `${genStepLabel[state.current.step] ?? state.current.step}${section ? ` · ${section.title}` : ""}${state.current.attempt > 1 ? ` (${state.current.attempt}번째)` : ""}`;
}
export type { Section };
