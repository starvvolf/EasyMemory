// Runs one generation (docs/DECISIONS.md 2026-10-12): outline → per-section classify+design (in parallel)
// → wait for the one confirmation → author section by section in order. Everything is saved as it happens,
// so a stop (usage limit, login, call cap, server restart) resumes from what is missing.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, ModelError, type ModelCaller, type ModelRequest } from "../../ai/model.ts";
import { redactCallText } from "../lab-contract.ts";
import { checkClassify, checkDesign, cleanPageText, mergeAcrossSections, normalizeOutline, sectionPageTexts } from "./checks.ts";
import { genFakeReply } from "./fake.ts";
import { answerShapeProblem, inspectQuestion, layoutQuestion, metaLabels, sectionDocument } from "./layout.ts";
import { needsImage, renderPageImages, TRANSCRIBE_SYSTEM } from "./pages.ts";
import { DEFAULT_GUIDE_DIR, guideDirPattern, loadGuide, type LoadedGuide } from "./guide.ts";
import { authorPrompt, classifyPrompt, designPrompt, outlinePrompt, retryUser } from "./prompts.ts";
import { authoredQuestion, authorReply, authorSchema, classifyReply, classifySchema, designReply, designSchema, outlineReply, outlineSchema } from "./schemas.ts";
import { defaultChosen, forkFroms, genStepLabel, purposes, type GenCall, type GenInput, type GenState, type GenStep, type Issue, type Objective, type Section, type SectionState } from "./types.ts";
import type { AuthoredQuestion } from "../../../../tools/problem-authoring-lab/contract.ts";

/** Model calls allowed per start or restart; the total is kept in `calls`. */
export const MAX_CALLS_PER_START = 60;
/** Per page and total characters sent; a 44-page deck stays well inside one call. */
const PAGE_TEXT_LIMIT = 3500, TOTAL_TEXT_LIMIT = 60_000;
export function pageBlock(texts: Map<number, string>) {
  let budget = TOTAL_TEXT_LIMIT;
  const lines: string[] = [];
  const cut: number[] = [];
  for (const [page, text] of [...texts.entries()].sort((a, b) => a[0] - b[0])) {
    const body = text || "(이 쪽은 추출된 글자가 없음)";
    const clipped = body.slice(0, Math.min(PAGE_TEXT_LIMIT, Math.max(0, budget)));
    budget -= clipped.length;
    if (clipped.length) lines.push(`[p.${page}]\n${clipped}`);
    if (clipped.length < body.length) cut.push(page);
  }
  if (cut.length) lines.push(`[길이 제한] p.${cut.join(", ")}는 길이 제한으로 일부 또는 전체가 빠졌음`);
  return { text: lines.join("\n\n"), cut };
}
/** Sections designed at the same time. */
const PARALLEL = 3;

export const dataRoot = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-gen");
const idPattern = /^gen_[a-f0-9]{32}$/;
const dirOf = (id: string) => { if (!idPattern.test(id)) throw new GenError(400, "생성 ID가 올바르지 않습니다."); return path.join(dataRoot(), id); };

export class GenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
class Stop extends Error {
  readonly status: GenState["status"];
  constructor(status: GenState["status"], message: string) { super(message); this.status = status; }
}

// ---- storage -------------------------------------------------------------------------------------------
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
        // Windows readers and virus scanners can hold the destination for a moment.
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
export async function readSectionDocument(id: string, sectionId: string) {
  if (!/^s\d+$/.test(sectionId)) throw new GenError(400, "목차 ID가 올바르지 않습니다.");
  try { return JSON.parse(await readFile(path.join(dirOf(id), "sections", sectionId, "document.json"), "utf8")) as unknown; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listGens(): Promise<GenState[]> {
  let names: string[];
  try { names = await readdir(dataRoot()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const states = await Promise.all(names.filter((name) => idPattern.test(name)).map((name) => loadGen(name).catch(() => null)));
  return states.filter((state): state is GenState => Boolean(state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- creation and view ---------------------------------------------------------------------------------
const modelChoice = z.object({ model: z.string().trim().min(1).max(80), effort: z.enum(["low", "medium", "high", "xhigh"]) });
export const genInputSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  pageNumbers: z.array(z.number().int().positive().max(500)).min(1).max(500),
  purpose: z.enum(purposes),
  note: z.string().max(2000).default(""),
  autoConfirm: z.boolean().default(false),
  provider: z.enum(["chatgpt", "codex", "fake"]).default("chatgpt"),
  models: z.partialRecord(z.enum(["transcribe", "outline", "classify", "design", "author"]), modelChoice).default({}),
  signals: z.object({ weakSpots: z.array(z.string().max(300)).max(30), reports: z.array(z.string().max(300)).max(30) }).default({ weakSpots: [], reports: [] }),
  /** 출제기준 folder; a candidate copy (출제기준-후보) lets one run compare criteria without touching the main folder. */
  guideDir: z.string().regex(guideDirPattern).default(DEFAULT_GUIDE_DIR),
  origin: z.enum(["lab", "study"]).default("lab"),
  readImages: z.boolean().default(false),
});

export async function createGen(raw: unknown): Promise<GenState> {
  const input = genInputSchema.parse(raw) as GenInput;
  input.pageNumbers = [...new Set(input.pageNumbers)].sort((a, b) => a - b);
  const now = new Date().toISOString();
  const state: GenState = { id: `gen_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now, input, status: "queued", phase: "outline", message: "", calls: 0, sections: [] };
  await saveState(state);
  return state;
}

export const forkInputSchema = z.strictObject({
  from: z.enum(forkFroms),
  /** Only the steps that run again matter; earlier steps keep the base run's results. */
  models: z.partialRecord(z.enum(["design", "author"]), modelChoice).default({}),
  guideDir: z.string().regex(guideDirPattern).optional(),
  autoConfirm: z.boolean().default(true),
  /** With "author": only these objectives, e.g. the ones a learner reported. The earlier questions go to the prompt. */
  objectiveIds: z.array(z.string().max(40)).min(1).max(200).optional(),
});

/** Plain text of a question as the learner saw it, plus its answer: what a remake should not repeat. */
function questionText(question: AuthoredQuestion) {
  const stem = question.blocks.map((block) => block.kind === "text" ? block.text : block.kind === "math" ? `$${block.latex}$` : block.kind === "table" ? block.rows.map((row) => row.join(" | ")).join(" / ") : "")
    .filter(Boolean).join(" ");
  const response = question.responses[0];
  const answer = response.kind === "single-choice" ? response.options.find((option) => option.id === response.correctOptionId)?.text ?? "" : response.acceptedAnswers[0] ?? "";
  return `${stem} → 답: ${answer}`.slice(0, 600);
}

/**
 * Fixed-prefix rerun: copies the base run's outline and classification (and, from "author", its objectives and
 * the chosen set) into a new run, so only the later steps differ. Comparisons of models or criteria then see the
 * same input instead of a different classification by chance, and the copied steps cost no calls.
 */
export async function forkGen(baseId: string, raw: unknown): Promise<GenState> {
  const options = forkInputSchema.parse(raw);
  const base = await loadGen(baseId);
  if (!base) throw new GenError(404, "기준 실행을 찾을 수 없습니다.");
  if (base.input.purpose === "read") throw new GenError(400, "그냥 읽기 실행은 다시 돌릴 설계·출제가 없습니다.");
  const sections = structuredClone(base.sections);
  if (!sections.length || sections.some((section) => !section.classify)) throw new GenError(409, "기준 실행의 내용 분류가 끝나지 않았습니다.");
  if (options.from === "author" && sections.some((section) => !section.design)) throw new GenError(409, "기준 실행의 학습 설계가 끝나지 않았습니다.");
  const input: GenInput = { ...structuredClone(base.input), autoConfirm: options.autoConfirm,
    models: { ...base.input.models, ...options.models }, guideDir: options.guideDir ?? base.input.guideDir ?? DEFAULT_GUIDE_DIR };
  for (const section of sections) {
    delete section.author;
    if (options.from === "design") delete section.design;
  }
  const now = new Date().toISOString();
  const state: GenState = { id: `gen_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now, input, status: "queued",
    phase: options.from, message: "", calls: 0, sections, outlineWarnings: base.outlineWarnings, forkOf: { genId: base.id, from: options.from },
    ...(base.images ? { images: structuredClone(base.images) } : {}) };
  if (options.from === "author") {
    // Same objectives as the base: what it confirmed, or the default choice if it stopped at the confirmation.
    const objectives = sections.flatMap((section) => section.design?.objectives ?? []);
    state.confirmedObjectiveIds = base.confirmedObjectiveIds ? [...base.confirmedObjectiveIds] : defaultChosen(input.purpose, objectives);
    if (options.objectiveIds) {
      const known = new Set(objectives.map((objective) => objective.id));
      const chosen = [...new Set(options.objectiveIds)].filter((objectiveId) => known.has(objectiveId));
      if (!chosen.length) throw new GenError(400, "다시 만들 목표가 이 실행에 없습니다.");
      state.confirmedObjectiveIds = chosen;
      const previous: Record<string, string> = {};
      for (const section of base.sections) {
        const document = await readSectionDocument(base.id, section.id) as { questions?: AuthoredQuestion[] } | null;
        for (const question of document?.questions ?? []) if (chosen.includes(question.source.objectiveId)) previous[question.source.objectiveId] = questionText(question);
      }
      input.remake = { genId: base.id, previous };
    }
  } else if (options.objectiveIds) throw new GenError(400, "목표를 골라 다시 만드는 것은 '출제만 다시'에서만 됩니다.");
  await saveState(state);
  // Page readings belong to the copied steps: carry them over so the rerun sees the same source text.
  if (base.images?.done.length) await cp(path.join(dirOf(base.id), "pages"), path.join(dirOf(state.id), "pages"), { recursive: true }).catch(() => undefined);
  return state;
}

const queue = globalThis as typeof globalThis & { __studyGenQueue?: Promise<unknown>; __studyGenQueued?: Set<string> };
/** Saved as queued/running but not queued in this process: the server stopped mid-run. */
export async function genView(id: string): Promise<GenState | null> {
  const state = await loadGen(id);
  if (state && (state.status === "queued" || state.status === "running") && !queue.__studyGenQueued?.has(id)) {
    return { ...state, status: "interrupted", message: "서버가 다시 시작돼 생성이 멈췄어요. 다시 시작하면 멈춘 곳부터 이어가요." };
  }
  return state;
}

/** The one confirmation: keep the chosen objectives and start authoring. */
export async function confirmObjectives(id: string, objectiveIds: string[]) {
  const state = await loadGen(id);
  if (!state) throw new GenError(404, "생성을 찾을 수 없습니다.");
  if (state.status !== "awaiting-confirm") throw new GenError(409, "목표 확인을 기다리는 생성이 아닙니다.");
  const known = new Set(state.sections.flatMap((section) => section.design?.objectives ?? []).map((objective) => objective.id));
  const chosen = [...new Set(objectiveIds)];
  if (chosen.some((objectiveId) => !known.has(objectiveId))) throw new GenError(400, "설계에 없는 목표가 있습니다.");
  state.confirmedObjectiveIds = chosen;
  state.phase = chosen.length ? "author" : "done";
  state.status = chosen.length ? "queued" : "done";
  state.message = chosen.length ? "" : "고른 목표가 없어 문제를 만들지 않았어요.";
  await saveState(state);
  return state;
}

export type RunOptions = {
  /** Page texts for the chosen pages; production reads the registered PDF. Tests pass text directly. */
  pages?: (input: GenInput) => Promise<Map<number, string>>;
  /** Fake replies by step; defaults to the built-in fake when the provider is "fake". */
  fakeReply?: (step: GenStep, user: string, attempt: number) => string;
  /** Page images (data URLs) for pages read from their image; production renders the registered PDF. */
  pageImages?: (input: GenInput, pages: number[]) => Promise<Map<number, string>>;
};

async function registeredImages(input: GenInput, pages: number[]) {
  const { readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  const bytes = await readRegisteredMcpSourcePdf(input.sourceId);
  if (!bytes) throw new Stop("failed", "등록된 원본 PDF를 읽을 수 없어요.");
  return renderPageImages(bytes, pages);
}

// ---- pages read from their image -------------------------------------------------------------------------
const transcriptFile = (id: string, page: number) => path.join(dirOf(id), "pages", `${page}.json`);
/** Replaces page texts with the readings saved for this run (later steps, the judges and reruns all use them). */
export async function withTranscripts(id: string, texts: Map<number, string>) {
  const state = await loadGen(id);
  for (const page of state?.images?.done ?? []) {
    try { texts.set(page, (JSON.parse(await readFile(transcriptFile(id, page), "utf8")) as { text: string }).text); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return texts;
}

export async function registeredPages(input: GenInput) {
  const [{ readRegisteredMcpSourcePdf }, { extractPdfPageTexts }] = await Promise.all([
    import("../../mcp-source-registry.ts"), import("../../../../tools/study-forge-mcp/source-evidence.ts")]);
  const bytes = await readRegisteredMcpSourcePdf(input.sourceId);
  if (!bytes) throw new Stop("failed", "등록된 원본 PDF를 읽을 수 없어요.");
  const texts = await extractPdfPageTexts(bytes, input.pageNumbers);
  return new Map([...texts].map(([page, text]) => [page, cleanPageText(text)]));
}

/** Runs a job after whatever is queued (generation or judging), so model calls of two jobs never overlap. */
export function chainTask<T>(task: () => Promise<T>) {
  const run = (queue.__studyGenQueue ?? Promise.resolve()).catch(() => undefined).then(task);
  queue.__studyGenQueue = run.catch(() => undefined);
  return run;
}

/** One request at a time in this server process. Throws before queueing when the request may not run. */
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
  const finished = (queue.__studyGenQueue ?? Promise.resolve()).then(() => runGen(id, caller, options)).catch(() => undefined).finally(() => queued.delete(id));
  queue.__studyGenQueue = finished;
  // Resolves once queued; `finished` settles when the run stops (done, paused or failed).
  return { finished };
}

// ---- the run -------------------------------------------------------------------------------------------
export async function runGen(id: string, caller: ModelCaller, options: RunOptions = {}): Promise<GenState> {
  const stored = await loadGen(id);
  if (!stored) throw new GenError(404, "생성을 찾을 수 없습니다.");
  const state: GenState = stored;
  if (state.status === "done" || state.status === "failed" || state.status === "awaiting-confirm") return state;
  const input = state.input;
  let callsThisStart = 0;
  let loaded = new Map<number, string>();

  const ask = async (step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown> | null, guide?: LoadedGuide,
    extra: { images?: ModelRequest["images"]; page?: number } = {}) => {
    // Reading pages is bounded by the page count itself, so only the other steps count toward the per-start cap.
    // The cap grows with the material: about 4 calls per section (classify, design, author, a retry) plus the outline.
    const cap = Math.max(MAX_CALLS_PER_START, state.sections.length * 4 + 10);
    if (step !== "transcribe" && callsThisStart >= cap) throw new Stop("paused-invalid", `한 번에 쓸 수 있는 호출 수(${cap})를 다 썼어요. 다시 시작하면 멈춘 곳부터 이어가요.`);
    if (input.provider === "fake" && process.env.NODE_ENV === "production") throw new Stop("failed", "가짜 모델은 개발 환경에서만 쓸 수 있어요.");
    if (step !== "transcribe") callsThisStart += 1;
    state.calls += 1;
    const n = state.calls;
    const choice = input.models[step];
    const model = choice?.model ?? (process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol");
    const effort = choice?.effort ?? (process.env.STUDY_FORGE_EXECUTOR_EFFORT?.trim() || "medium");
    state.current = { step, ...(sectionId ? { sectionId } : {}), ...(extra.page ? { page: extra.page } : {}), attempt };
    await saveState(state);
    const started = Date.now();
    const record: GenCall = { n, step, sectionId, attempt, model, effort, format: null, startedAt: new Date(started).toISOString(), ms: 0, ok: false,
      system: redactCallText(system), user: redactCallText(user), reply: null, error: null,
      ...(guide ? { guide: { dir: guide.dir, version: guide.version, files: guide.files } } : {}) };
    const callFile = path.join(dirOf(id), "calls", `${n}.json`);
    const request: ModelRequest = { purpose: `gen:${step}`, system, user, json: Boolean(schema), ...(schema ? { schema, schemaName: `recaller_${step.replace(/-/g, "_")}` } : {}),
      model, effort, caller, provider: input.provider, ...(extra.images ? { images: extra.images } : {}) };
    try {
      if (input.provider === "fake") request.fakeReply = (options.fakeReply ?? ((s: GenStep, u: string) => genFakeReply(s, u)))(step, user, attempt);
      const reply = await callModel(request);
      Object.assign(record, { ok: true, reply: redactCallText(reply.text), model: reply.model, usage: reply.usage, format: reply.format ?? null, ms: Date.now() - started });
      await saveJson(callFile, record);
      return schema ? reply.data : reply.text;
    } catch (error) {
      const raw = (error as { rawText?: string }).rawText;
      Object.assign(record, { reply: raw === undefined ? null : redactCallText(raw), error: redactCallText(error instanceof Error ? error.message : String(error)), ms: Date.now() - started });
      await saveJson(callFile, record);
      if (error instanceof ModelError && error.code === "usage_limit") throw new Stop("paused-usage-limit", "ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 시작해 주세요.");
      if (error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured")) throw new Stop("paused-login", error.message);
      throw error;
    }
  };
  /** A broken criteria folder pauses the run: fix the folder and start again from the same place. */
  const guideFor = async (step: "design" | "author", kinds?: Objective["kind"][]) => {
    try { return await loadGuide(step, { purpose: input.purpose, kinds, dir: input.guideDir ?? DEFAULT_GUIDE_DIR }); }
    catch (error) { throw new Stop("paused-invalid", `${error instanceof Error ? error.message : String(error)} 출제기준 폴더를 고친 뒤 다시 시작해 주세요.`); }
  };
  /** A call whose reply did not parse or match the schema counts as one try; a dropped connection too. */
  const askParsed = async <T>(step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown>, parser: z.ZodType<T>, guide?: LoadedGuide) => {
    try {
      const parsed = parser.safeParse(await ask(step, sectionId, attempt, system, user, schema, guide));
      return parsed.success ? { ok: true as const, value: parsed.data } : { ok: false as const, problem: "응답이 정해진 JSON 형식과 다릅니다." };
    } catch (error) {
      if (error instanceof Stop) throw error;
      return { ok: false as const, problem: error instanceof Error ? error.message : String(error) };
    }
  };

  try {
    state.status = "running"; state.message = "";
    await saveState(state);
    loaded = await (options.pages ?? registeredPages)(input);

    // ⓪ pages read from their image (readImages), once per page, several at a time. A failed page keeps its text layer.
    if (input.readImages) {
      const images = (state.images ??= { pages: input.pageNumbers.filter((page) => needsImage(loaded.get(page) ?? "")), done: [], failed: [] });
      await saveState(state);
      // Readings of the same PDF from earlier runs are reused (a restart or another purpose does not read again).
      for (const other of await listGens()) {
        if (other.id === id || other.input.sourceId !== input.sourceId || !other.images?.done.length) continue;
        for (const page of other.images.done) {
          if (!images.pages.includes(page) || images.done.includes(page)) continue;
          try { await saveJson(transcriptFile(id, page), JSON.parse(await readFile(transcriptFile(other.id, page), "utf8"))); images.done.push(page); }
          catch { /* that run's file is gone: read it again */ }
        }
      }
      await saveState(state);
      const todo = images.pages.filter((page) => !images.done.includes(page) && !images.failed.includes(page));
      for (let start = 0; start < todo.length; start += PARALLEL) {
        const batch = todo.slice(start, start + PARALLEL);
        const rendered = await (options.pageImages ?? registeredImages)(input, batch);
        const settled = await Promise.allSettled(batch.map(async (page) => {
          const image = rendered.get(page);
          if (!image) throw new Error("쪽을 그리지 못했어요.");
          const user = `[자료] ${input.fileName} p.${page}\n\n[글자 층]\n${loaded.get(page) || "(없음)"}`;
          let text = "";
          for (let attempt = 1; attempt <= 2 && !text.trim(); attempt += 1) {
            try { text = String(await ask("transcribe", null, attempt, TRANSCRIBE_SYSTEM, user, null, undefined, { images: [{ label: `p.${page}`, dataUrl: image }], page })); }
            catch (error) { if (error instanceof Stop || attempt === 2) throw error; }
          }
          if (!text.trim()) throw new Error("빈 응답");
          await saveJson(transcriptFile(id, page), { page, text: cleanPageText(text.trim()) });
          images.done.push(page);
        }));
        const stop = settled.find((result) => result.status === "rejected" && result.reason instanceof Stop) as PromiseRejectedResult | undefined;
        batch.forEach((page, index) => { if (settled[index].status === "rejected" && !(stop)) images.failed.push(page); });
        await saveState(state);
        if (stop) throw stop.reason;
      }
      if (images.failed.length) state.outlineWarnings = [...(state.outlineWarnings ?? []).filter((warning) => warning.code !== "image-read-failed"),
        { severity: "warning", code: "image-read-failed", message: `그림으로 읽지 못해 글자 층만 쓴 쪽: p.${images.failed.join(", ")}` }];
      await withTranscripts(id, loaded);
    }
    const block = (pages: number[]) => pageBlock(new Map(pages.map((page) => [page, loaded.get(page) ?? ""]))).text;

    // ① outline (once). Two tries; an unusable outline stops the run.
    if (!state.sections.length) {
      const prompt = outlinePrompt(input, block(input.pageNumbers));
      let result = await askParsed("outline", null, 1, prompt.system, prompt.user, outlineSchema, outlineReply);
      let normalized = result.ok ? normalizeOutline(result.value, input.pageNumbers) : null;
      if (!normalized?.sections.length) {
        const problem = result.ok ? "고른 쪽 안의 목차 항목이 하나도 없습니다." : result.problem;
        result = await askParsed("outline", null, 2, prompt.system, `${prompt.user}\n\n[이전 시도에서 걸린 것]\n- ${problem}`, outlineSchema, outlineReply);
        normalized = result.ok ? normalizeOutline(result.value, input.pageNumbers) : null;
      }
      if (!normalized?.sections.length) throw new Stop("paused-invalid", "목차를 만들지 못했어요. 다시 시작하면 목차부터 다시 시도해요.");
      state.sections = normalized.sections.map((section) => ({ ...section }));
      state.outlineWarnings = [...(state.outlineWarnings ?? []).filter((warning) => warning.code === "image-read-failed"), ...normalized.warnings];
      state.phase = "design";
      await saveState(state);
    }

    // ① classify + ② design, per section, several sections at once.
    if (state.phase === "design") {
      const pending = state.sections.filter((section) => !section.classify || (input.purpose !== "read" && !section.design));
      const failures: unknown[] = [];
      for (let start = 0; start < pending.length; start += PARALLEL) {
        const settled = await Promise.allSettled(pending.slice(start, start + PARALLEL).map((section) => designSection(section)));
        failures.push(...settled.filter((result) => result.status === "rejected").map((result) => (result as PromiseRejectedResult).reason));
        await saveState(state);
        const stop = failures.find((reason) => reason instanceof Stop);
        if (stop) throw stop;
      }
      if (failures.length) throw failures[0];
      if (input.purpose === "read") {
        state.phase = "done"; state.status = "done"; state.current = undefined; state.message = "그냥 읽기라 문제는 만들지 않았어요.";
        await saveState(state);
        return state;
      }
      mergeAcrossSections(state.sections);
      state.phase = "confirm";
      await saveState(state);
    }

    if (state.phase === "confirm") {
      const all = state.sections.flatMap((section) => section.design?.objectives ?? []).map((objective) => objective.id);
      if (!input.autoConfirm) {
        state.status = "awaiting-confirm"; state.current = undefined; state.message = `목표 ${all.length}개를 확인해 주세요.`;
        await saveState(state);
        return state;
      }
      state.confirmedObjectiveIds = defaultChosen(input.purpose, state.sections.flatMap((section) => section.design?.objectives ?? []));
      state.phase = "author";
      await saveState(state);
    }

    // ③ authoring, section by section in source order.
    if (state.phase === "author") {
      const chosen = new Set(state.confirmedObjectiveIds ?? []);
      for (const section of state.sections) {
        if (section.author) continue;
        const objectives = (section.design?.objectives ?? []).filter((objective) => chosen.has(objective.id));
        if (!objectives.length) { section.author = { documentPath: null, questionCount: 0, dropped: [], warnings: [] }; continue; }
        await authorSection(section, objectives);
        await saveState(state);
      }
      state.phase = "done"; state.status = "done"; state.current = undefined; state.message = "";
      await saveState(state);
    }
    return state;
  } catch (error) {
    const stop = error instanceof Stop ? error : new Stop("failed", error instanceof Error ? error.message : String(error));
    state.status = stop.status; state.message = stop.message;
    await saveState(state);
    return state;
  }

  // -- per-section steps (closures over state, input, ask) ------------------------------------------------
  async function designSection(section: SectionState) {
    // A page shared with a neighbouring section is cut at the section starts (see sectionPageTexts).
    const own = sectionPageTexts(section, state.sections, loaded);
    const sectionTexts = own.texts;
    const sectionBlock = pageBlock(sectionTexts).text;
    if (!section.classify) {
      if (![...sectionTexts.values()].some((text) => text.trim())) {
        section.classify = { items: [], warnings: [{ severity: "warning", code: "no-text", message: "이 목차의 쪽에는 추출된 글자가 없어요(그림 위주)." }] };
      } else {
        const others = state.sections.filter((other) => other.id !== section.id && other.pages.some((page) => section.pages.includes(page))).map((other) => other.title);
        const prompt = classifyPrompt(input, section, sectionBlock, others);
        let result = await askParsed("classify", section.id, 1, prompt.system, prompt.user, classifySchema, classifyReply);
        let checked = result.ok ? checkClassify(result.value, section, sectionTexts) : null;
        if (!checked || checked.problems.length) {
          const problems = checked ? checked.problems.map((problem) => problem.message) : [result.ok ? "" : result.problem];
          result = await askParsed("classify", section.id, 2, prompt.system, retryUser(prompt.user, result.ok ? result.value : null, problems), classifySchema, classifyReply);
          const second = result.ok ? checkClassify(result.value, section, sectionTexts) : null;
          if (second) checked = second;
        }
        if (!checked) throw new Stop("paused-invalid", `${section.title}: 내용 분류 응답을 읽지 못했어요. 다시 시작하면 이 목차부터 이어가요.`);
        // Still-unverified quotes are dropped, not kept: the source must not be misquoted.
        section.classify = { items: checked.items, warnings: [...own.warnings,
          ...checked.problems.map((problem) => ({ severity: "warning" as const, code: "quote-not-found", message: `원문에서 확인되지 않아 뺀 항목: ${problem.message}` }))] };
      }
      await saveState(state);
    }
    if (input.purpose === "read" || section.design) return;
    const items = section.classify.items;
    if (!items.length) { section.design = { objectives: [], warnings: [] }; return; }
    const guide = await guideFor("design");
    const prompt = designPrompt(input, section, items, guide.text);
    let result = await askParsed("design", section.id, 1, prompt.system, prompt.user, designSchema, designReply, guide);
    let checked = result.ok ? checkDesign(result.value, section, items) : null;
    if (!checked || checked.problems.length) {
      const problems = checked ? checked.problems.map((problem) => problem.message) : [result.ok ? "" : result.problem];
      result = await askParsed("design", section.id, 2, prompt.system, retryUser(prompt.user, result.ok ? result.value : null, problems), designSchema, designReply, guide);
      const second = result.ok ? checkDesign(result.value, section, items) : null;
      if (second) checked = second;
    }
    if (!checked) throw new Stop("paused-invalid", `${section.title}: 학습 설계 응답을 읽지 못했어요. 다시 시작하면 이 목차부터 이어가요.`);
    section.design = { objectives: checked.objectives, warnings: [...checked.warnings,
      ...checked.problems.map((problem) => ({ severity: "warning" as const, code: "objective-dropped", message: `근거 연결이 끊겨 뺀 목표: ${problem.message}` }))] };
  }

  async function authorSection(section: SectionState, objectives: Objective[]) {
    const items = section.classify?.items ?? [];
    const accepted = new Map<string, AuthoredQuestion>();
    const warnings: Issue[] = [];
    let problems = new Map<string, string>();
    let previous = new Map<string, unknown>();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const targets = attempt === 1 ? objectives : objectives.filter((objective) => problems.has(objective.id));
      if (!targets.length) break;
      const guide = await guideFor("author", targets.map((objective) => objective.kind));
      const prompt = authorPrompt(input, section, targets, items, guide.text);
      const user = attempt === 1 ? prompt.user
        : retryUser(prompt.user, { questions: targets.map((objective) => previous.get(objective.id)).filter(Boolean) }, targets.map((objective) => `${objective.id}: ${problems.get(objective.id)}`));
      const result = await askParsed("author", section.id, attempt, prompt.system, user, authorSchema, authorReply, guide);
      const next = new Map<string, string>();
      const nextPrevious = new Map<string, unknown>();
      const byId = new Map(targets.map((objective) => [objective.id, objective]));
      if (result.ok) {
        for (const raw of result.value.questions) {
          const parsed = authoredQuestion.safeParse(raw);
          const objectiveId = parsed.success ? parsed.data.objectiveId : String((raw as { objectiveId?: unknown })?.objectiveId ?? "");
          const objective = byId.get(objectiveId);
          if (!objective || accepted.has(objectiveId) || nextPrevious.has(objectiveId)) continue;
          nextPrevious.set(objectiveId, raw);
          if (!parsed.success) { next.set(objectiveId, "문항이 정해진 형식과 다릅니다."); continue; }
          const shape = answerShapeProblem(parsed.data);
          if (shape) { next.set(objectiveId, shape); continue; }
          const question = layoutQuestion(parsed.data, objective, section, input.fileName);
          const meta = metaLabels(parsed.data);
          if (meta.length) warnings.push({ severity: "warning", code: "meta-label-removed", message: `입력칸의 지시 문구를 지웠어요: ${meta.join(" / ").slice(0, 80)}`, ref: objectiveId });
          const inspected = inspectQuestion(question);
          if (inspected.errors.length) { next.set(objectiveId, inspected.errors.map((issue) => issue.message).join(" ")); continue; }
          accepted.set(objectiveId, question);
          warnings.push(...inspected.warnings);
        }
      }
      for (const objective of targets) {
        if (!accepted.has(objective.id) && !next.has(objective.id)) next.set(objective.id, result.ok ? "이 목표의 문항이 없습니다." : result.problem);
      }
      problems = next;
      previous = nextPrevious;
    }
    const questions = objectives.map((objective) => accepted.get(objective.id)).filter((question): question is AuthoredQuestion => Boolean(question));
    let documentPath: string | null = null;
    if (questions.length) {
      documentPath = path.join("sections", section.id, "document.json");
      await saveJson(path.join(dirOf(id), documentPath), sectionDocument(id, section, input.fileName, questions));
    }
    section.author = { documentPath, questionCount: questions.length, warnings,
      dropped: [...problems].map(([objectiveId, reason]) => ({ objectiveId, reason })) };
  }
}

/**
 * One study deck per run: every section's questions in source order as one document, with what /study needs to
 * show it (title, PDF, page count). The hash changes when a section is added or remade, so the screen reloads it.
 */
export async function studyDocument(id: string) {
  const state = await loadGen(id);
  if (!state) return null;
  const questions: AuthoredQuestion[] = [];
  for (const section of state.sections) {
    const document = await readSectionDocument(id, section.id) as { questions?: AuthoredQuestion[] } | null;
    questions.push(...(document?.questions ?? []));
  }
  if (!questions.length) return null;
  const { getRegisteredMcpSource } = await import("../../mcp-source-registry.ts");
  const source = await getRegisteredMcpSource(state.input.sourceId).catch(() => null);
  const pages = state.input.pageNumbers;
  const range = pages.length > 1 ? `p.${pages[0]}–${pages.at(-1)}` : `p.${pages[0]}`;
  const document = { schemaVersion: "problem-authoring-v1" as const, id, title: `${state.input.fileName.replace(/\.pdf$/i, "")} · ${range}${state.input.remake ? " · 다시 만든 문제" : ""}`, questions };
  return {
    meta: { id, title: document.title, artifactSha256: createHash("sha256").update(JSON.stringify(document)).digest("hex"), sourceFile: state.input.fileName,
      sourceCatalogId: state.input.sourceId, sourceTotalPages: source?.pageCount ?? Math.max(...pages) },
    document,
  };
}

export function stepLabel(state: GenState) {
  if (!state.current) return "";
  if (state.current.step === "transcribe") return `그림 쪽 읽기 ${state.images?.done.length ?? 0}/${state.images?.pages.length ?? 0}${state.current.page ? ` · p.${state.current.page}` : ""}`;
  const section = state.sections.find((candidate) => candidate.id === state.current?.sectionId);
  return `${genStepLabel[state.current.step]}${section ? ` · ${section.title}` : ""}${state.current.attempt > 1 ? ` (${state.current.attempt}번째)` : ""}`;
}
export type { Section };
