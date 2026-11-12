// Runs one generation with the Recaller engine (줄기 계획 → 기억 채우기 → 문제). Everything is saved as it happens,
// so a stop (usage limit, login, call cap, server restart) resumes from what is missing.
// 11/12 A 정리(사용자 "예전 엔진 + 실험실 비교 탭 다 지우기"): v2(목차→분류·설계→출제)·v3·astra·v4·v5·alpha 엔진은 지웠다.
import { knowledgeLayer } from "../knowledge.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, ModelError, type ModelCaller, type ModelRequest } from "../../ai/model.ts";
import { redactCallText } from "../lab-contract.ts";
import { cleanPageText } from "./checks.ts";
import { genFakeReply } from "./fake.ts";
import { jsonSchemaOf, RunawayReply } from "./reply.ts";
import { sectionDocument } from "./layout.ts";
import { cropFigures, pageEmphasis, renderPageFigures, renderPageImages } from "./pages.ts";
import { DEFAULT_GUIDE_DIR, guideDirPattern, loadRecallerGuide, type LoadedGuide } from "./guide.ts";
import { preparePdf, preparePdfFast, prepFromTexts, prepRouters, type PrepResult } from "./prep.ts";
import { recallerFakeReply, runRecaller } from "./recaller.ts";
import { pagesOutside, SUMMARY_SYSTEM, summaryFakeReply, type SummaryState } from "./summary.ts";
import { DEFAULT_GEN_MODELS, defaultChosen, engines, forkFroms, genStepLabel, genSteps, purposes, type GenCall, type GenInput, type GenMark, type GenState, type GenStep, type Section } from "./types.ts";
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
/** What a streaming reply has produced so far, in the screen's words. */
function progressOf(step: GenStep, text: string) {
  const count = (key: string) => text.split(`"${key}"`).length - 1;
  switch (step) {
    case "outline": return `단원 ${count("title")}개`;
    case "classify": return `항목 ${count("quote")}개`;
    case "design": return `목표 ${count("recall")}개`;
    case "author": return `문항 ${count("objectiveId")}개 쓰는 중`;
    case "read": return count("name") ? `개념 ${count("name")}개 · 관계 ${count("statement")}개` : `단원 ${count("title")}개`;
    case "plan": return `문항 계획 ${count("mustRecall")}개`;
    case "gate": return `${count("questionId")}개 검사`;
    default: return `${Math.round(text.length / 100) * 100}자`;
  }
}

export const dataRoot = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-gen");
const idPattern = /^gen_[a-f0-9]{32}$/;
const dirOf = (id: string) => { if (!idPattern.test(id)) throw new GenError(400, "생성 ID가 올바르지 않습니다."); return path.join(dataRoot(), id); };

export class GenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/**
 * A JSON text that stopped after a complete value inside open objects/arrays: closes them and parses. Undefined when the
 * text stops inside a string, after a key or a comma, or does not parse — those are unfinished, not merely unclosed.
 */
export function closeJson(text: string): unknown {
  const t = text.trimEnd();
  const open: string[] = [];
  let inString = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) { if (ch === "\\") i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") open.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") open.pop();
  }
  if (inString || !open.length || /[,:{[]$/.test(t)) return undefined;
  try { return JSON.parse(t + open.reverse().join("")); } catch { return undefined; }
}

/** A JSON reply cut anywhere (mid-string, after a key): closed so it parses, for showing a reply as it is written.
 *  An unfinished string is kept as far as it came; a key with no value yet is dropped. */
export function partialJson(text: string): unknown {
  let t = text.trimEnd(), inString = false, escaped = false;
  const open: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") open.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") open.pop();
  }
  if (inString) t = (escaped ? t.slice(0, -1) : t) + '"';
  const tries = [t, t.replace(/,?\s*"[^"]*"\s*:?\s*$/, ""), t.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*"(?:[^"\\]|\\.)*"$/, "")];
  for (const x of tries) {
    const body = x.replace(/[,:]\s*$/, "");
    try { return JSON.parse(body + [...open].reverse().join("")); } catch { /* try the next cut */ }
  }
  return undefined;
}

// 실시간 카드 (사용자 10/30): each page's 정리 reply as it streams in, kept in this server process for the map to show the
// cards being written, in page order. Not saved: a page's real cards are in the run's state once its reply is in.
type LivePage = { at: number; text: string; done: boolean };
const liveRoot = globalThis as typeof globalThis & { __studyGenLive?: Map<string, Map<number, LivePage>> };
export function setGenLive(id: string, pages: number[], text: string | null) {
  const all = (liveRoot.__studyGenLive ??= new Map());
  const mine = all.get(id) ?? new Map<number, LivePage>();
  all.set(id, mine);
  for (const page of pages) mine.set(page, { at: Date.now(), text: text ?? mine.get(page)?.text ?? "", done: text === null });
}
export function dropGenLive(id: string) { liveRoot.__studyGenLive?.delete(id); }
type LiveCard = { title: string; kind: string; weight: string; shape: Record<string, unknown> };
/** What the map draws while the material is being made: the pages in order (title from 전처리) and each page's cards so far. */
export async function genLive(id: string, since = 0) {
  const state = await loadGen(id);
  const mine = liveRoot.__studyGenLive?.get(id);
  const outline = (state?.recaller?.prep?.pages ?? []).map((p) => ({ page: p.page, title: p.title }));
  const pages = mine ? [...mine].filter(([, v]) => v.at > since).map(([page, v]) => {
    const reply = partialJson(v.text) as { cards?: Array<Partial<LiveCard>> } | undefined;
    const cards = (Array.isArray(reply?.cards) ? reply.cards : []).filter((c) => c && typeof c === "object" && (c.title || c.shape))
      .map((c) => ({ title: String(c.title ?? ""), kind: String(c.kind ?? ""), weight: String(c.weight ?? ""), shape: c.shape && typeof c.shape === "object" ? c.shape : {} }));
    return { page, done: v.done, cards };
  }) : [];
  return { now: Date.now(), status: state?.status ?? "failed", live: Boolean(mine), outline, pages, summary: await loadSummary(id), digest: state?.recaller?.digest ?? null };
}

// 정리 글 (10/31): kept beside the run (summary.json), not in its state, since it may still be writing when the run is done.
const summaryRoot = globalThis as typeof globalThis & { __studyGenSummary?: Set<string> };
export async function loadSummary(id: string): Promise<SummaryState | null> {
  try { return JSON.parse(await readFile(path.join(dirOf(id), "summary.json"), "utf8")) as SummaryState; } catch { return null; }
}

class Stop extends Error {
  readonly status: GenState["status"];
  /** A connection or server hiccup (not the call cap, a limit or a bad reply): the run picks itself up again. */
  transient = false;
  constructor(status: GenState["status"], message: string) { super(message); this.status = status; }
}
/** A reply stuck saying the same short piece (1–12 chars) at least 40 times in a row at its end. */
export function repeating(text: string) {
  const tail = text.slice(-600);
  return tail.length >= 200 && /([\s\S]{1,12}?)\1{39,}$/.test(tail);
}
/** Times a run picks itself up after a connection hiccup, before it waits for the learner (사용자 점검 10/29). */
const AUTO_RESUMES = 3;
const AUTO_RESUME_MS = 10_000;
const TRANSIENT_WAITS = [2000, 5000, 12000];

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
/** 그림 다시 자르기 (11/8): 자르는 코드를 고친 뒤 AI 호출 없이 카드 그림만 다시. 쪽 그림 위치(AI 힌트)는 그대로 쓴다. */
export async function recropFigures(id: string) {
  const state = await loadGen(id);
  if (!state?.recaller) throw new GenError(404, "자료를 찾을 수 없어요.");
  const { readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  const bytes = await readRegisteredMcpSourcePdf(state.input.sourceId);
  if (!bytes) throw new GenError(404, "원본 PDF를 읽을 수 없어요.");
  const cards = state.sections.flatMap((s) => state.recaller!.units[s.id]?.cards ?? []);
  const dir = path.join(dirOf(id), "figures");
  await mkdir(dir, { recursive: true });
  const { attachFigures } = await import("./figures.ts");
  const r = await attachFigures(bytes, state.input.pageNumbers, cards, async (name, jpeg) => { await writeFile(path.join(dir, name.replace(/[^\w.-]/g, "_")), jpeg); });
  state.recaller.timing.figuresMs = r.ms;
  await saveState(state);
  return r;
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
  // s1… for page sections, t1… for 요약 → 카드 (lab.digest) topics.
  if (!/^[st]\d+$/.test(sectionId)) throw new GenError(400, "목차 ID가 올바르지 않습니다.");
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
  priorityPage: z.number().int().positive().max(500).optional(),
  purpose: z.enum(purposes),
  note: z.string().max(2000).default(""),
  autoConfirm: z.boolean().default(false),
  provider: z.enum(["chatgpt", "codex", "fake"]).default("chatgpt"),
  models: z.partialRecord(z.enum(genSteps), modelChoice).default({}),
  signals: z.object({ weakSpots: z.array(z.string().max(300)).max(30), reports: z.array(z.string().max(300)).max(30) }).default({ weakSpots: [], reports: [] }),
  /** 출제기준 folder; a candidate copy (출제기준-후보) lets one run compare criteria without touching the main folder. */
  guideDir: z.string().regex(guideDirPattern).default(DEFAULT_GUIDE_DIR),
  origin: z.enum(["lab", "study"]).default("lab"),
  readImages: z.boolean().default(false),
  /** recaller: also make deep questions (several cards tied into one worked problem). The learner turns it on. */
  deep: z.boolean().optional(),
  questionsLater: z.boolean().optional(),
  /** 강의 준비(11/11 사용자 "아예 시작할 때 강의 OX 넣고"): 자료를 다 만들면 강의 첫 영역을 뒤에서 써 둔다(lecture-areas.ts). */
  lecture: z.boolean().optional(),
  /** recaller: write two drafts of each deep question at once and keep the first that passes (faster, twice the use). */
  deepDrafts: z.union([z.literal(1), z.literal(2)]).optional(),
  /** recaller 검증 실험: one plain call per section instead of cards and checks (the comparison baseline). */
  baseline: z.boolean().optional(),
  /** recaller 종합 문제: earlier recaller runs whose cards are tied into one long problem (no new pages are read). */
  combine: z.array(z.string().regex(/^gen_[a-f0-9]{32}$/)).min(2).max(4).optional(),
  pastExamSourceIds: z.array(z.string().regex(/^src_[a-f0-9]{64}$/)).min(1).max(2).optional(),
  engine: z.enum(engines).default("recaller"),
  planInput: z.enum(["pdf", "pages", "figures"]).optional(),
  cacheMode: z.enum(["shared"]).optional(),
  lab: z.strictObject({ router: z.enum(prepRouters).optional(), skimOnly: z.boolean().optional(), pageParallel: z.number().int().min(1).max(64).optional(),
    readParallel: z.number().int().min(1).max(64).optional(), imageWidth: z.number().int().min(512).max(2400).optional(), inlineRead: z.boolean().optional(),
    outline: z.boolean().optional(), consolidate: z.boolean().optional(), fastPrep: z.number().int().min(1).max(16).optional(),
    chunk: z.number().int().min(1).max(4).optional(), hedgeMs: z.number().int().min(1000).max(120000).optional(),
    lean: z.boolean().optional(), lenientQuotes: z.boolean().optional(), intent: z.boolean().optional(), intentPass: z.boolean().optional(), intentLean: z.boolean().optional(), intentParallel: z.boolean().optional(), summary: z.boolean().optional(), digest: z.boolean().optional(), digestTopicCards: z.boolean().optional(), digestOne: z.boolean().optional(), digestStyle: z.enum(["univ", "plan"]).optional(), quiz: z.enum(["luna"]).optional(), quizCount: z.number().int().min(1).max(60).optional(), goalsInPlan: z.boolean().optional(), conceptLines: z.boolean().optional(), mapCards: z.boolean().optional(), prompts: z.record(z.string().max(40), z.string().max(30000)).optional(), mapUnit: z.enum(["topic", "page"]).optional(), flowCard: z.enum(["with", "after"]).optional(), stem: z.boolean().optional(), cardQA: z.boolean().optional(), planLines: z.boolean().optional(), goalsInStem: z.enum(["early", "feed"]).optional(), headingTerms: z.boolean().optional(), figures: z.boolean().optional(), goalQuiz: z.boolean().optional(), outlineOnly: z.boolean().optional(), noSourceOutline: z.boolean().optional(), sectionContext: z.boolean().optional(), callCap: z.number().int().min(10).max(2000).optional() }).optional(),
  survey: z.strictObject({ style: z.enum(["recall", "understand"]).optional(), difficulty: z.enum(["easy", "normal", "hard"]).optional(), exam: z.enum(["choice", "mixed", "written"]).optional(), depth: z.enum(["core", "all"]).optional(),
    time: z.enum(["short", "normal", "long"]).optional(), known: z.string().max(500).optional() }).optional(),
});

export async function createGen(raw: unknown): Promise<GenState> {
  const input = genInputSchema.parse(raw) as GenInput;
  if (input.pastExamSourceIds?.includes(input.sourceId)) throw new GenError(400, "강의 PDF 자체를 기출로 함께 선택할 수 없습니다.");
  if (input.combine && input.engine !== "recaller") throw new GenError(400, "종합 문제는 Recaller 엔진만 만들 수 있습니다.");
  input.pageNumbers = [...new Set(input.pageNumbers)].sort((a, b) => a - b);
  if (input.priorityPage !== undefined) throw new GenError(400, "읽는 쪽 우선 출제는 예전 엔진(astra) 기능이라 지웠어요.");
  if (input.engine !== "recaller") throw new GenError(400, "예전 엔진(v2·v3·astra·v4·v5)은 지웠어요. Recaller 엔진만 쓸 수 있어요.");
  // 공부 화면의 Recaller는 빠른 첫 정리로 (docs/DECISIONS.md 2026-10-29): 실험 서버의 /lab/gen은 고른 손잡이 그대로.
  if (input.engine === "recaller" && input.origin === "study" && !input.lab && !input.combine) input.lab = studyRecallerLab(input.pageNumbers.length);
  const now = new Date().toISOString();
  const state: GenState = { id: `gen_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now, input, status: "queued", phase: "outline", message: "", calls: 0, sections: [] };
  await saveState(state);
  return state;
}

/** 빠른 첫 정리 (연구 1): pages sorted by code (prep-2) and drawn in worker processes, every page organized at once with its
 *  picture and the material's outline. 44쪽 첫 훑기 47초 → 14초 (terra), and no drawing inside the server process (canvas 오류로 서버가 꺼지던 일). */
export function studyRecallerLab(pages: number): NonNullable<GenInput["lab"]> {
  // 자료 성격·쪽 의도 (10/29, C): one short pass over every page (small pictures + text) beside 정리 decides the material's
  // kind and each page's intent; cover/guide/preview pages make no card, 현황 pages' cards are 보조, a worked example is a card.
  return { router: "prep-2", inlineRead: true, outline: true, pageParallel: Math.min(64, Math.max(1, pages)), fastPrep: 8, imageWidth: 1024, lenientQuotes: true,
    intentPass: true, intentLean: true, intentParallel: true,
    // 정리 hedge (10/31, 사용자 "다 수정해봐"): a page's 정리 still out after 8 s gets a second identical request; the first wins.
    hedgeMs: 8000,
    // 그림 쪽 읽기 (blind checks wait for it): drawing is done in the workers already, so this is only model calls in flight
    // (4 at a time made a first-time 32쪽 wait about 70 s for its 25 picture pages, 10/29).
    readParallel: Math.min(32, Math.max(4, pages)),
    // 목차 → 바로 카드 + luna 퀴즈 (11/5 사용자 "오늘 의논한 변경사항 전부 앱에 정식으로"; 협업/결과보고/실험_목차에서바로카드_C_20261105.md):
    // one terra call lists what each topic teaches, cards come straight from those items and the pages (no topic summary call),
    // and the quiz is 10 luna questions picked by learning objective. 데드락 14쪽 카드까지 $0.09 (전 $0.12~0.19).
    // 흐름 카드 (11/6 사용자 "1번으로 그냥 앱에 박아"): after a topic's cards, one short terra call writes its one story card
    // (in what order the pieces come and why), first in the topic and not quizzed. 그래픽스 04: 카드 단계 +$0.09, +20초.
    // 카드에 그림 붙이기 (11/8 사용자 "한번 해봐"): 카드 AI가 그림 위치·역할·설명을 쓰고 코드가 잘라 둔다(figures.ts).
    digest: true, digestTopicCards: true, digestStyle: "plan", mapCards: true, mapUnit: "topic", figures: true, noSourceOutline: true, quiz: "luna", quizCount: 10,
    // 정리 글(summary.ts, sol)은 끈다 (11/6 사용자 "1의 목차로 바꾸고, 목차가 나오면서 지식이 하나씩 붙게"): 자료 지도의 첫 탭은
    // 엔진 목차(위의 목차 호출, 쓰는 대로 흘러나옴)에 카드가 항목마다 붙는 화면이다. 켜려면 summary: true (그 전 결정 11/6 B).
    // 목표형 문제 (11/6 사용자 "데드락 시연: 학습 목표부터, 그 목표에 맞는 문제" → "sol로 가고 본 앱에 연결"): 목표마다 주는 것·내는 것,
    // 판정·구별은 상황 객관식(보기는 가능한 판정 전부), 설명은 상황만 주는 서술, OX 없음, 다시 만들기 없음(예비 문제가 빈 목표를 채움).
    // 모델은 DEFAULT_GEN_MODELS(학습 목표·출제 고르기·상황 판정·서술 sol low).
    goalQuiz: true,
    // 줄기 먼저 (11/10 사용자 "기억 단위로 다 옮겨"): 목차 대신 줄기 계획 → 기억 채우기. 자료 전체 정리(rc-merge)는 하지 않는다(핵심 = 메인 기억).
    // 그래픽스 52쪽: 줄기 약 47초, 기억 채우기 약 39초 (전: 목차 50~68초 + 카드 57초 + 정리 80초 + 합치기 36초).
    stem: true, consolidate: false,
    // 11/12 사용자 "테라로 하고 … 네 개 뜨는 것 고쳐": 줄기는 줄 형식(줄기 시간 거의 반, 50쪽 47 → 29초), 카드는 질문 하나 · 답 하나(칸 없음).
    // 50쪽 실측 약 98초 → 74초. 학습 목표는 따로(줄기 안에 넣어 본 3가지는 느리거나 카드가 목표에 맞춰 늘어났다).
    planLines: true, cardQA: true };
}

export const forkInputSchema = z.strictObject({
  from: z.enum(forkFroms),
  /** Only the steps that run again matter; earlier steps keep the base run's results. */
  models: z.partialRecord(z.enum(["design", "author", "astra-plan", "astra-author", "astra-solve", "astra-review"]), modelChoice).default({}),
  guideDir: z.string().regex(guideDirPattern).optional(),
  autoConfirm: z.boolean().default(true),
  /** With "author": only these objectives, e.g. the ones a learner reported. The earlier questions go to the prompt. */
  objectiveIds: z.array(z.string().max(40)).min(1).max(200).optional(),
  pastExamSourceIds: z.array(z.string().regex(/^src_[a-f0-9]{64}$/)).min(1).max(2).optional(),
  purpose: z.enum(purposes).optional(),
  note: z.string().max(2000).optional(),
  reasons: z.record(z.string().min(1).max(40), z.string().trim().min(1).max(1000)).refine(value => Object.keys(value).length <= 200, "신고 사유가 너무 많습니다.").optional(),
});

/** Plain text of a question as the learner saw it, plus its answer: what a remake should not repeat. */
function questionText(question: AuthoredQuestion) {
  const stem = question.blocks.map((block) => block.kind === "text" ? block.text : block.kind === "math" ? `$${block.latex}$` : block.kind === "table" ? block.rows.map((row) => row.join(" | ")).join(" / ") : "")
    .filter(Boolean).join(" ");
  const response = question.responses[0];
  const answer = response.kind === "single-choice" ? response.options.find((option) => option.id === response.correctOptionId)?.text ?? "" : response.acceptedAnswers[0] ?? "";
  return `${stem} → 답: ${answer}`.slice(0, 600);
}

/** 문제 만들기 (사용자 10/30): a study run that stopped after its cards (questionsLater) goes on to the questions, in the
 *  same run: the cards and 자료 전체 정리 stay, every section is authored as a resumed run would be. */
export async function questionsGen(id: string): Promise<GenState> {
  const state = await loadGen(id);
  if (!state?.recaller || state.input.engine !== "recaller") throw new GenError(404, "카드가 있는 Recaller 실행을 찾을 수 없습니다.");
  if (!state.input.questionsLater) return state;
  if (state.status !== "done") throw new GenError(409, "지식 정리가 끝난 뒤에 문제를 만들 수 있어요.");
  if (!state0Cards(state)) throw new GenError(409, "문제로 만들 지식 카드가 없어요.");
  state.input.questionsLater = false;
  for (const s of state.sections) if (state.recaller.units[s.id]) state.recaller.units[s.id].status = "waiting";
  state.status = "queued"; state.phase = "author"; state.message = "";
  await saveState(state);
  return state;
}
const state0Cards = (gen: GenState) => Object.values(gen.recaller?.units ?? {}).reduce((n, u) => n + (u.cards?.length ?? 0), 0);

export async function forkGen(baseId: string, raw: unknown): Promise<GenState> {
  const options = forkInputSchema.parse(raw);
  const base = await loadGen(baseId);
  if (!base) throw new GenError(404, "기준 실행을 찾을 수 없습니다.");
  if (options.purpose !== undefined || options.note !== undefined) throw new GenError(400, "목적·메모 바꿔 다시 만들기는 예전 엔진(astra) 기능이라 지웠어요.");
  if (options.reasons !== undefined) throw new GenError(400, "신고 사유 붙여 다시 만들기는 예전 엔진(astra) 기능이라 지웠어요.");
  if (base.input.purpose === "read") throw new GenError(400, "그냥 읽기 실행은 다시 돌릴 설계·출제가 없습니다.");
  const sections = structuredClone(base.sections);
  if (!sections.length || sections.some((section) => !section.classify)) throw new GenError(409, "기준 실행의 내용 분류가 끝나지 않았습니다.");
  if (options.from === "author" && sections.some((section) => !section.design)) throw new GenError(409, "기준 실행의 학습 설계가 끝나지 않았습니다.");
  const input: GenInput = { ...structuredClone(base.input), autoConfirm: options.autoConfirm,
    models: { ...base.input.models, ...options.models }, guideDir: options.guideDir ?? base.input.guideDir ?? DEFAULT_GUIDE_DIR };
  if (options.pastExamSourceIds) input.pastExamSourceIds = [...new Set(options.pastExamSourceIds)];
  if (input.pastExamSourceIds?.includes(input.sourceId)) throw new GenError(400, "강의 PDF 자체를 기출로 함께 선택할 수 없습니다.");
  for (const section of sections) {
    delete section.author;
    if (options.from === "design") delete section.design;
  }
  const now = new Date().toISOString();
  const state: GenState = { id: `gen_${randomBytes(16).toString("hex")}`, createdAt: now, updatedAt: now, input, status: "queued",
    phase: options.from, message: "", calls: 0, sections, outlineWarnings: base.outlineWarnings, forkOf: { genId: base.id, from: options.from },
    ...(base.images ? { images: structuredClone(base.images) } : {}),
  };
  if (options.from === "author") {
    // Same objectives as the base: what it confirmed, or the default choice if it stopped at the confirmation.
    const objectives = sections.flatMap((section) => section.design?.objectives ?? []);
    state.confirmedObjectiveIds = base.confirmedObjectiveIds ? [...base.confirmedObjectiveIds] : defaultChosen(input.purpose, objectives);
    if (options.objectiveIds) {
      const known = new Set(objectives.map((objective) => objective.id));
      const chosen = [...new Set(options.objectiveIds)].filter((objectiveId) => known.has(objectiveId));
      if (!chosen.length) throw new GenError(400, "다시 만들 목표가 이 실행에 없습니다.");
      if (options.reasons && Object.keys(options.reasons).some(id => !chosen.includes(id))) throw new GenError(400, "신고 사유는 다시 만들기로 선택한 목표에만 붙일 수 있습니다.");
      state.confirmedObjectiveIds = chosen;
      const previous: Record<string, string> = {};
      for (const section of base.sections) {
        const document = await readSectionDocument(base.id, section.id) as { questions?: AuthoredQuestion[] } | null;
        for (const question of document?.questions ?? []) if (chosen.includes(question.source.objectiveId)) previous[question.source.objectiveId] = questionText(question);
      }
      input.remake = { genId: base.id, previous, ...(options.reasons ? { reasons: options.reasons } : {}) };
    }
  } else if (options.objectiveIds) throw new GenError(400, "목표를 골라 다시 만드는 것은 '출제만 다시'에서만 됩니다.");
  await saveState(state);
  // Page readings belong to the copied steps: carry them over so the rerun sees the same source text.
  if (base.images?.done.length) await cp(path.join(dirOf(base.id), "pages"), path.join(dirOf(state.id), "pages"), { recursive: true }).catch(() => undefined);
  return state;
}

const queue = globalThis as typeof globalThis & { __studyGenQueue?: Promise<unknown>; __studyGenQueued?: Set<string>; __studyGenFocus?: Map<string, number>; __studyGenFocusLog?: Map<string, Array<{ at: string; page: number }>> };
/** Where the learner is reading while a material is being made: units around this page are authored first. */
export function setGenFocus(id: string, page: number) {
  if (!idPattern.test(id) || !Number.isInteger(page) || page < 1) throw new GenError(400, "읽는 위치가 올바르지 않습니다.");
  const focus = (queue.__studyGenFocus ??= new Map());
  if (focus.get(id) !== page) (queue.__studyGenFocusLog ??= new Map()).set(id, [...(queue.__studyGenFocusLog?.get(id) ?? []), { at: new Date().toISOString(), page }].slice(-50));
  focus.set(id, page);
}
/** Units in the order to author: the one being read, then the ones after it, then the ones before. */
export function byFocus<T extends { pages: number[] }>(sections: T[], page: number | undefined) {
  if (!page) return sections;
  const at = sections.findIndex((section) => section.pages.includes(page) || section.pages[0] > page);
  if (at < 0) return sections;
  return [...sections.slice(at), ...sections.slice(0, at)];
}
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
  (state.timeline ??= []).push({ at: new Date().toISOString(), event: "confirmed" });
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
  /** v3: the PDF bytes sent whole to the read step; production reads the registered PDF. */
  pdf?: (input: GenInput) => Promise<Uint8Array | null>;
  /** recaller: the prepared pages; production reads the PDF (or, without one, the page texts). */
  prep?: (pdf: Uint8Array | null, pages: number[]) => Promise<PrepResult>;
};

async function registeredPdfBytes(input: GenInput) {
  const { readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  return readRegisteredMcpSourcePdf(input.sourceId);
}

async function registeredImages(input: GenInput, pages: number[]) {
  const { readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  const bytes = await readRegisteredMcpSourcePdf(input.sourceId);
  if (!bytes) throw new Stop("failed", "등록된 원본 PDF를 읽을 수 없어요.");
  return renderPageImages(bytes, pages, input.lab?.imageWidth);
}

// ---- pages read from their image -------------------------------------------------------------------------
const transcriptFile = (id: string, page: number) => path.join(dirOf(id), "pages", `${page}.json`);
/** Replaces page texts with the readings saved for this run (later steps, the judges and reruns all use them). */
export async function withTranscripts(id: string, texts: Map<number, string>) {
  const state = await loadGen(id);
  // recaller keeps its page texts in the run (the cleaned text layer, and what was read off the picture for picture pages):
  // the judges read the same source the questions were made from, not the bare text layer (그림 속 행렬·식이 "원문에 없음"이 되던 것).
  for (const [key, text] of Object.entries(state?.recaller?.texts ?? {})) if (/^\d+$/.test(key) && text.trim()) texts.set(Number(key), text);
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
  // Coloured emphasis is invisible in the text layer; it is added as one line per page (lecturers mark what matters).
  const emphasis = await pageEmphasis(bytes, input.pageNumbers).catch(() => new Map<number, string[]>());
  return new Map([...texts].map(([page, text]) => [page, cleanPageText(text) + (emphasis.get(page)?.length ? `\n[색 강조] ${emphasis.get(page)!.join(" · ")}` : "")]));
}

/** Runs a job after whatever is queued (generation or judging), so model calls of two jobs never overlap. */
export function chainTask<T>(task: () => Promise<T>) {
  const run = (queue.__studyGenQueue ?? Promise.resolve()).catch(() => undefined).then(task);
  queue.__studyGenQueue = run.catch(() => undefined);
  return run;
}

/** One request at a time in this server process. Throws before queueing when the request may not run. */
/** 강의 준비를 골랐으면(input.lecture) 다 만든 뒤 강의 첫 영역을 뒤에서 부른다. 실패해도 자료에는 영향 없음. */
async function lectureAfter(state: GenState) {
  if (state?.status !== "done" || !state.input.lecture) return state;
  void (async () => { const { context } = await import("../lecture-steps.ts"); const { startArea } = await import("../lecture-areas.ts");
    const first = (await context(state.id)).sections[0]; if (first) await startArea(state.id, first.id); })().catch(() => undefined);
  return state;
}
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
  const astraAbort = input.engine === "recaller" ? new AbortController() : undefined;
  let astraFailure: Stop | undefined;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  // saveJson already serializes writes per file, including state snapshots from concurrent batches.
  const failAstra = (error: unknown): Stop => {
    const stop = error instanceof Stop ? error
      : error instanceof ModelError && error.code === "usage_limit" ? new Stop("paused-usage-limit", "ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 시작해 주세요.")
        : error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured") ? new Stop("paused-login", error.message)
          : Object.assign(new Stop("paused-invalid", error instanceof Error ? error.message : String(error)), { transient: error instanceof ModelError && error.code === "transient" });
    astraFailure ??= stop;
    astraAbort?.abort();
    return astraFailure;
  };
  if (astraAbort) state.liveCalls = [];
  let callsThisStart = 0;

  const ask = async (step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown> | null, guide?: LoadedGuide,
    extra: { images?: ModelRequest["images"]; files?: ModelRequest["files"]; page?: number; cachePrefix?: string; onPartial?: (text: string) => void; maxChars?: number; sharedContext?: string; tail?: string; cacheKey?: string } = {}) => {
    if (astraFailure) throw astraFailure;
    // Reading pages is bounded by the page count itself, so only the other steps count toward the per-start cap.
    // The cap grows with the material: about 4 calls per section (classify, design, author, a retry) plus the outline.
    // Recaller: about 2 cards a page, each a question and its blind check (≈ 5.5 calls a page measured), plus deep questions;
    // 8 a page + 40 lets a 44-page material finish in one start and still stops a run that loops.
    // lab.quiz "luna": about 6 cheap calls a card (≈ 3 cards a page) on top.
    const cap = input.lab?.callCap ?? Math.max(MAX_CALLS_PER_START, input.engine === "recaller" ? input.pageNumbers.length * (input.lab?.quiz === "luna" ? 26 : 8) + 40 : state.sections.length * 4 + 10);
    if (step !== "transcribe" && callsThisStart >= cap) {
      const stop = new Stop("paused-invalid", `한 번에 쓸 수 있는 호출 수(${cap})를 다 썼어요. 다시 시작하면 멈춘 곳부터 이어가요.`);
      throw astraAbort ? failAstra(stop) : stop;
    }
    if (input.provider === "fake" && process.env.NODE_ENV === "production") throw new Stop("failed", "가짜 모델은 개발 환경에서만 쓸 수 있어요.");
    if (step !== "transcribe") callsThisStart += 1;
    state.calls += 1;
    const n = state.calls;
    let started = Date.now();
    const live: NonNullable<GenState["liveCalls"]>[number] = { n, step, startedAt: new Date(started).toISOString(), receivedChars: 0 };
    if (astraAbort) state.liveCalls!.push(live);
    // A step the start did not name runs on the step's measured default (an API start with no models ran every step on
    // sol·medium: 정리 35초·자료 전체 정리 99초, 10/29 A 실측), then on the environment's model.
    const choice = input.models[step] ?? DEFAULT_GEN_MODELS[step];
    const model = choice?.model ?? (process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol");
    const effort = choice?.effort ?? (process.env.STUDY_FORGE_EXECUTOR_EFFORT?.trim() || "medium");
    state.current = { step, ...(sectionId ? { sectionId } : {}), ...(extra.page ? { page: extra.page } : {}), attempt };
    await saveState(state);
    if (!astraAbort) started = Date.now();
    const record: GenCall = { n, step, sectionId, attempt, model, effort, format: null, startedAt: new Date(started).toISOString(), ms: 0, ok: false,
      ...(extra.files?.length ? { withPdf: true } : {}),
      ...(extra.sharedContext ? { sharedChars: extra.sharedContext.length } : {}),
      system: redactCallText(system), user: redactCallText(extra.tail ? `${user}\n\n${extra.tail}` : user), reply: null, error: null,
      ...(guide ? { guide: { dir: guide.dir, version: guide.version, files: guide.files } } : {}) };
    const callFile = path.join(dirOf(id), "calls", `${n}.json`);
    // Progress while the reply streams in: the screen shows how far the current call has got (체감 시간).
    let lastProgress = 0;
    const onText = (text: string) => {
      const now = Date.now();
      record.firstTextMs ??= now - started;
      if (now - lastProgress < 1500) return;
      lastProgress = now;
      state.current = { step, ...(sectionId ? { sectionId } : {}), ...(extra.page ? { page: extra.page } : {}), attempt, progress: progressOf(step, text) };
      void saveState(state).catch(() => undefined);
    };
    // Runaway guard: a structured reply can loop (same items or blank space) and never close; past maxChars the call is
    // cut and what came in is kept on the call record (astrav3 첫 실측: 6.6만 자를 267초 받다가 서버를 꺼 증거를 잃음).
    const cut = extra.maxChars ? new AbortController() : undefined;
    let partial = "", runaway = false;
    const baseText = extra.onPartial ?? (astraAbort ? undefined : onText);
    const guardText = (text: string) => {
      partial = text;
      // A structured reply stuck emitting blank space (seen with recaller's organize) is cut as soon as it shows, not at the limit.
      // …or one short piece said over and over ("다. 다. 다." for 6,000자 took 27 s on 32쪽 p.31, 10/29).
      if (cut && !runaway && (text.length > extra.maxChars! || /\s{1500}$/.test(text) || repeating(text))) { runaway = true; cut.abort(); return; }
      baseText?.(text);
    };
    const request: ModelRequest = { purpose: `gen:${step}`, system, user, json: Boolean(schema), ...(cut || baseText ? { onText: guardText } : {}), ...(schema ? { schema, schemaName: `recaller_${step.replace(/-/g, "_")}` } : {}),
      model, effort, caller, provider: input.provider, ...(extra.images ? { images: extra.images } : {}), ...(extra.files ? { files: extra.files } : {}),
      ...(extra.cachePrefix ? { cachePrefix: extra.cachePrefix, schemaName: "recaller_astra" } : {}), ...(extra.sharedContext ? { sharedContext: extra.sharedContext } : {}), ...(extra.tail ? { tail: extra.tail } : {}), ...(extra.cacheKey ? { cacheKey: extra.cacheKey } : {}) };
    if (astraAbort) {
      request.signal = astraAbort.signal;
      request.onProgress = receivedChars => {
        if (astraAbort.signal.aborted) return;
        live.receivedChars = receivedChars;
        if (!live.firstTextAt) {
          live.firstTextAt = new Date().toISOString();
          record.firstTextMs = Date.now() - started;
        }
        if (!progressTimer) progressTimer = setTimeout(() => {
          progressTimer = undefined;
          void saveState(state).catch(failAstra);
        }, 1000);
      };
    }
    if (cut) {
      const parent = request.signal;
      if (parent?.aborted) cut.abort();
      else parent?.addEventListener("abort", () => cut.abort(), { once: true });
      request.signal = cut.signal;
    }
    try {
      if (astraFailure) throw astraFailure;
      if (input.provider === "fake") request.fakeReply = (options.fakeReply ?? ((s: GenStep, u: string) => s.startsWith("rc-") ? recallerFakeReply(s, u) : genFakeReply(s, u)))(step, extra.tail ? `${user}\n\n${extra.tail}` : user, attempt);
      if (extra.cachePrefix && request.fakeReply !== undefined) request.fakeReply = JSON.stringify({ result: JSON.parse(request.fakeReply) });
      // The fake model has no stream; hand the reply over in pieces so streaming consumers behave as with a real one.
      if (request.fakeReply !== undefined && (extra.onPartial || cut)) for (let at = 200; at < request.fakeReply.length + 200 && !runaway; at += 200) guardText(request.fakeReply.slice(0, at));
      if (runaway) throw new Error("cut");
      // One quiet retry for a dropped or unfinished reply.
      let reply: Awaited<ReturnType<typeof callModel>>;
      for (let retry = 0; ; retry++) {
        try { reply = await callModel(request); break; }
        catch (error) {
          // A connection hiccup is retried a few times, spread out so calls that failed together do not come back together.
          if (retry >= TRANSIENT_WAITS.length || runaway || request.signal?.aborted || !(error instanceof ModelError) || error.code !== "transient") throw error;
          partial = "";
          await new Promise(resolve => setTimeout(resolve, TRANSIENT_WAITS[retry] * (0.75 + Math.random() / 2)));
          if (request.signal?.aborted) throw error;
        }
      }
      Object.assign(record, { ok: true, reply: redactCallText(reply.text), model: reply.model, usage: reply.usage, format: reply.format ?? null, ms: Date.now() - started });
      await saveJson(callFile, record);
      return schema ? reply.data : reply.text;
    } catch (error) {
      // A finished JSON reply that then ran on in blank space (seen with nested replies: every field written, only the last
      // closing brace missing) is read as finished: close what is open, and only if nothing is left mid-string.
      const closed = runaway && schema ? closeJson(partial) : undefined;
      if (closed !== undefined) {
        Object.assign(record, { ok: true, reply: redactCallText(partial.trimEnd()), note: "빈칸이 이어져 끊고, 닫는 괄호만 채워 읽었어요.", ms: Date.now() - started });
        await saveJson(callFile, record);
        return closed;
      }
      if (runaway) {
        // Head and tail are enough to see what repeated; the whole text can be tens of thousands of characters.
        const kept = partial.length > 24000 ? `${partial.slice(0, 12000)}\n…(중략 ${partial.length - 24000}자)…\n${partial.slice(-12000)}` : partial;
        Object.assign(record, { reply: redactCallText(kept), error: repeating(partial) ? `응답이 같은 글을 되풀이해 ${partial.length.toLocaleString()}자에서 끊었어요.` : `응답이 ${partial.length.toLocaleString()}자로 상한 ${extra.maxChars!.toLocaleString()}자를 넘어 끊었어요.`, ms: Date.now() - started });
        await saveJson(callFile, record);
        throw new RunawayReply(extra.maxChars!, partial.length);
      }
      if (astraAbort) failAstra(error);
      const raw = (error as { rawText?: string }).rawText;
      Object.assign(record, { reply: raw === undefined ? null : redactCallText(raw), error: redactCallText(error instanceof Error ? error.message : String(error)), ms: Date.now() - started });
      await saveJson(callFile, record);
      if (astraFailure) throw astraFailure;
      if (error instanceof ModelError && error.code === "usage_limit") throw new Stop("paused-usage-limit", "ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 시작해 주세요.");
      if (error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured")) throw new Stop("paused-login", error.message);
      throw error;
    } finally {
      if (astraAbort) {
        state.liveCalls = state.liveCalls!.filter(call => call.n !== n);
        await saveState(state);
      }
    }
  };
  /** A call whose reply did not parse or match the schema counts as one try; a dropped connection too. */
  const askParsed = async <T>(step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, schema: Record<string, unknown>, parser: z.ZodType<T>, guide?: LoadedGuide,
    extra: { files?: ModelRequest["files"]; cachePrefix?: string; onPartial?: (text: string) => void; images?: ModelRequest["images"]; maxChars?: number; sharedContext?: string; cacheKey?: string } = {}) => {
    try {
      const parsed = parser.safeParse(await ask(step, sectionId, attempt, system, user, schema, guide, extra));
      return parsed.success ? { ok: true as const, value: parsed.data } : { ok: false as const, problem: "응답이 정해진 JSON 형식과 다릅니다." };
    } catch (error) {
      if (error instanceof Stop || error instanceof RunawayReply) throw error;
      return { ok: false as const, problem: error instanceof Error ? error.message : String(error) };
    }
  };

  // The reading position steers the order only for materials made on the study screen. Lab runs (engine comparison)
  // assume the learner reads front to back, so every engine authors in source order there.
  const readingFocus = () => (input.origin ?? "lab") === "study" ? queue.__studyGenFocus?.get(id) : undefined;
  const mark = (event: GenMark["event"], extra: Omit<GenMark, "at" | "event"> = {}) => {
    // Focus changes are kept in memory by the route; they are written here so the timeline shows them in order.
    for (const focus of queue.__studyGenFocusLog?.get(id) ?? []) (state.timeline ??= []).push({ at: focus.at, event: "focus", page: focus.page });
    queue.__studyGenFocusLog?.delete(id);
    (state.timeline ??= []).push({ at: new Date().toISOString(), event, ...extra });
  };
  try {
    state.status = "running"; state.message = "";
    mark("start", { note: state.phase });
    await saveState(state);
    if (input.engine === "recaller") {
      const pdf = await (options.pdf ?? registeredPdfBytes)(input).catch(() => null);
      const marked = { outline: false, published: new Map(state.sections.map((s) => [s.id, s.author?.questionCount ?? 0])) };
      const marks = () => {
        if (!marked.outline && state.sections.length) { marked.outline = true; mark("outline"); }
        for (const section of state.sections) {
          const count = section.author?.questionCount ?? 0;
          if (count > (marked.published.get(section.id) ?? 0)) { marked.published.set(section.id, count); mark("unit-done", { sectionId: section.id, questions: count }); }
        }
      };
      const readingFile = (hash: string, page: number) => path.join(dataRoot(), "readings", hash.replace(/[^a-z0-9:_-]/gi, "_").slice(0, 80), `${page}.json`);
      const stopWith = (message: string) => failAstra(new Stop("paused-invalid", message));
      // 빠른 전처리: pages drawn while 전처리 read them (data URLs) and their picture regions, for this run only.
      const drawn = new Map<number, string>(), drawnFigures = new Map<number, number[][]>();
      let fastEmphasis: Map<number, string[]> | undefined;
      await runRecaller({
        state, pdf,
        live: (pages, text) => setGenLive(id, pages, text),
        ask: async (step, sectionId, attempt, system, user, parser, extra = {}) => {
          const schema = jsonSchemaOf(parser);
          const more = { ...(extra.images ? { images: extra.images } : {}), ...(extra.maxChars ? { maxChars: extra.maxChars } : {}), ...(extra.onPartial ? { onPartial: extra.onPartial } : {}), ...(extra.cacheKey ? { cacheKey: extra.cacheKey } : {}) };
          let result = await askParsed(step, sectionId, attempt, system, user, schema, parser, extra.guide, more);
          // One quiet retry for a reply that did not match the format; then the run pauses where it is.
          if (!result.ok) result = await askParsed(step, sectionId, attempt, system, `${user}

[앞 응답 문제] ${result.problem} 정해진 JSON 형식으로만 다시 답한다.`, schema, parser, extra.guide, more);
          if (!result.ok) throw stopWith(`${genStepLabel[step]}: ${result.problem} 완료 단계는 보존됩니다.`);
          return result.value;
        },
        halted: () => Boolean(astraFailure),
        saveFigure: async (name, jpeg) => { const dir = path.join(dirOf(id), "figures"); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, name.replace(/[^\w.-]/g, "_")), jpeg); },
        askText: async (step, page, attempt, system, user, images, onPartial, tail, cacheKey) => String(await ask(step, null, attempt, system, user, null, undefined, { images, ...(page ? { page } : {}), ...(onPartial ? { onPartial } : {}), ...(tail ? { tail } : {}), ...(cacheKey ? { cacheKey } : {}) })),
        prepare: options.prep ?? (async (bytes, pages) => {
          if (!bytes) return prepFromTexts(await (options.pages ?? registeredPages)(input), pages);
          if (!input.lab?.fastPrep) return preparePdf(bytes, pages, input.lab?.router);
          // 빠른 전처리 (연구 1 실험): read and draw in worker processes; the drawings are kept for 정리 and the reading step.
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
        guide: async (step, kinds) => {
          try { return await loadRecallerGuide(step, { purpose: input.purpose, kinds, dir: input.guideDir ?? DEFAULT_GUIDE_DIR }); }
          catch (error) { throw stopWith(`${error instanceof Error ? error.message : String(error)} 출제기준 폴더를 고친 뒤 다시 시작해 주세요.`); }
        },
        reading: {
          get: async (hash, page) => { try { return (JSON.parse(await readFile(readingFile(hash, page), "utf8")) as { text: string }).text; } catch { return null; } },
          put: async (hash, page, text) => { await saveJson(readingFile(hash, page), { page, text }); },
        },
        combined: async () => Promise.all((input.combine ?? []).map(async (genId) => {
          const src = await loadGen(genId);
          if (!src?.recaller || src.input.engine !== "recaller") throw stopWith(`${genId}는 Recaller로 만든 자료가 아니라 종합 문제에 쓸 수 없어요.`);
          return { genId, fileName: src.input.fileName, sections: src.sections, recaller: src.recaller };
        })),
        save: () => { marks(); return saveState(state); },
        publish: async (section, questions) => {
          if (!questions.length) return null;
          const documentPath = path.join("sections", section.id, "document.json");
          await saveJson(path.join(dirOf(id), documentPath), sectionDocument(id, section, input.fileName, questions));
          return documentPath;
        },
        priorityPage: () => readingFocus(),
        // 정리 글: once per run (a later start of the same run, 문제 만들기, keeps the one written), beside the cards and not
        // counted toward the call cap. A summary still writing in this process is left alone; one cut by a server stop is redone.
        summary: async (build) => {
          const inFlight = (summaryRoot.__studyGenSummary ??= new Set());
          if (inFlight.has(id) || (await loadSummary(id))?.status === "done") return;
          inFlight.add(id);
          const file = path.join(dirOf(id), "summary.json");
          try {
            const { user, images, pages } = await build();
            const choice = input.models["rc-summary"] ?? DEFAULT_GEN_MODELS["rc-summary"];
            const t0 = Date.now();
            const summary: SummaryState = { status: "writing", text: "", startedAt: new Date(t0).toISOString(), model: choice?.model, effort: choice?.effort };
            await saveJson(file, summary);
            let saved = 0;
            const request: ModelRequest = { purpose: "gen:rc-summary", system: SUMMARY_SYSTEM, user, model: choice?.model, effort: choice?.effort, caller, provider: input.provider,
              ...(images.length ? { images } : {}),
              onText: (text) => {
                summary.firstMs ??= Date.now() - t0;
                summary.text = text;
                if (Date.now() - saved < 1000) return;
                saved = Date.now();
                void saveJson(file, summary).catch(() => undefined);
              } };
            if (input.provider === "fake") request.fakeReply = summaryFakeReply(user);
            try {
              let reply: Awaited<ReturnType<typeof callModel>>;
              for (let retry = 0; ; retry++) {
                try { reply = await callModel(request); break; }
                catch (error) { if (retry >= 1 || !(error instanceof ModelError) || error.code !== "transient") throw error; summary.text = ""; await new Promise((r) => setTimeout(r, 3000)); }
              }
              Object.assign(summary, { status: "done", text: reply.text, ms: Date.now() - t0, model: reply.model, usage: reply.usage, outside: pagesOutside(reply.text, pages) });
              summary.firstMs ??= summary.ms;
            } catch (error) {
              Object.assign(summary, { status: "failed", ms: Date.now() - t0, error: error instanceof Error ? error.message : String(error) });
            }
            await saveJson(file, summary);
          } finally { inFlight.delete(id); }
        },
      }).catch((error) => { throw error instanceof Stop ? error : failAstra(error); });
      if (progressTimer) clearTimeout(progressTimer);
      if (astraFailure) throw astraFailure;
      if ((state.status as string) === "done") { mark("done"); await saveState(state); }
      return state;
    }
    throw new Stop("failed", "이 자료는 예전 엔진으로 만든 것이라 더 이어 만들 수 없어요. 새로 만들어 주세요.");
    return state;
  } catch (error) {
    if (progressTimer) clearTimeout(progressTimer);
    const stop = astraFailure ?? (error instanceof Stop ? error : new Stop("failed", error instanceof Error ? error.message : String(error)));
    state.status = stop.status; state.message = stop.message;
    mark("stopped", { note: stop.status });
    // Recaller after a connection hiccup: it goes on by itself a few times (what is done is kept), so a long material is not
    // left half made while the learner reads. The call cap, usage limit and login still wait for the learner.
    const again = stop.transient && input.engine === "recaller" && input.provider !== "fake" && (state.autoResumes ?? 0) < AUTO_RESUMES;
    if (again) {
      state.autoResumes = (state.autoResumes ?? 0) + 1;
      state.message = `연결이 잠깐 끊겼어요. ${AUTO_RESUME_MS / 1000}초 뒤 멈춘 곳부터 저절로 이어 가요.`;
    }
    await saveState(state);
    if (again) setTimeout(() => { void enqueueGen(id, caller, { ...options, confirmedRealCalls: true }).catch(() => undefined); }, AUTO_RESUME_MS).unref?.();
    return state;
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
  const document = { schemaVersion: "problem-authoring-v1" as const, id, title: `${state.input.fileName.replace(/\.pdf$/i, "")} · ${range}${state.input.pastExamSourceIds?.length ? " · 기출형" : ""}${state.input.remake ? " · 다시 만든 문제" : ""}`, questions };
  // The designed objectives (what to recall, by unit and heading) for the study screen's one-page summary (정리).
  const confirmed = state.confirmedObjectiveIds ? new Set(state.confirmedObjectiveIds) : null;
  const outline = state.sections.map((section) => ({
    title: section.title,
    pages: section.pages,
    objectives: (section.design?.objectives ?? []).filter((objective) => !confirmed || confirmed.has(objective.id)).map((objective) => ({
      id: objective.id, statement: objective.statement, cue: objective.cue, recall: objective.recall, importance: objective.importance, kind: objective.kind, pages: objective.pages,
      part: section.parts?.find((part) => part.pages.includes(objective.pages[0]))?.title,
    })),
  })).filter((section) => section.objectives.length);
  return {
    outline,
    // Recaller 2: knowledge points and which goal checks which (mastery is kept per point, not per page or deck).
    points: knowledgeLayer(state),
    meta: { id, title: document.title, artifactSha256: createHash("sha256").update(JSON.stringify(document)).digest("hex"), sourceFile: state.input.fileName,
      sourceCatalogId: state.input.sourceId, sourceTotalPages: source?.pageCount ?? Math.max(...pages) },
    document,
  };
}

export function stepLabel(state: GenState) {
  if (!state.current) return "";
  if (state.current.step === "transcribe") return `그림 쪽 읽기 ${state.images?.done.length ?? 0}/${state.images?.pages.length ?? 0}${state.current.page ? ` · p.${state.current.page}` : ""}`;
  const section = state.sections.find((candidate) => candidate.id === state.current?.sectionId);
  return `${genStepLabel[state.current.step]}${section ? ` · ${section.title}` : ""}${state.current.attempt > 1 ? ` (${state.current.attempt}번째)` : ""}${state.current.progress ? ` · ${state.current.progress}` : ""}`;
}
export type { Section };
