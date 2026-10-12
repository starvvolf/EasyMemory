// Judges (로드맵 3단계, 평가기준/README.md): GPT plays learners and a reviewer so a person does not have to check
// every question. Per section: one blind learner, three learners who read the source (independent calls), one expert.
// Verdicts and rates feed the scorecard. A "trial" run plants known flaws to measure how much the judges catch.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, ModelError, type ModelCaller } from "../../ai/model.ts";
import { gradeResponse, type AuthoredQuestion, type AuthoringBlock, type AuthoringDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { redactCallText } from "../lab-contract.ts";
import { sectionPageTexts } from "./checks.ts";
import { ruleLines } from "./guide.ts";
import { chainTask, dataRoot, GenError, loadGen, pageBlock, readSectionDocument, registeredPages, withTranscripts } from "./runner.ts";
import type { GenInput, GenState, ModelChoice } from "./types.ts";

export const JUDGE_DIR = "평가기준";
const EXPOSED_CONFIDENCE = 0.6;
export type Grade = "correct" | "partial" | "wrong";
export type Verdict = "통과" | "의심" | "실패";
export type MutationKind = "leak" | "wrong-key" | "condition-swap";
export const mutationLabel: Record<MutationKind, string> = { leak: "정답 노출", "wrong-key": "정답 바꾸기", "condition-swap": "조건 바꾸기" };

export type Checks = { answerVisible?: boolean; conditionMatch: boolean; answerCorrect: boolean; answerUnique: boolean; objectiveMatch: boolean; distractorsPlausible: boolean | null; depth: "되풀이" | "이해" | "적용" };
export type QuestionJudgement = {
  questionId: string; objectiveId: string; sectionId: string; mutation?: MutationKind;
  blind: { answer: string; confidence: number; grade: Grade };
  readers: Array<{ answer: string; grade: Grade }>;
  /** Answers the expert graded correct by meaning but code grading marked wrong: the accepted answers miss a spelling. */
  acceptedGaps?: string[];
  checks: Checks; problems: string; verdict: Verdict; reasons: string[];
};
export type JudgeSummary = {
  questions: number; pass: number; suspect: number; fail: number;
  exposed: number; blindSolved: number; acceptedGap: number; ambiguous: number; answerWrong: number; conditionMismatch: number; nonUnique: number; objectiveMismatch: number; weakDistractors: number;
  depth: Record<string, number>;
};
export type JudgeRun = {
  id: string; genId: string; kind: "judge" | "trial"; createdAt: string; updatedAt: string;
  status: "queued" | "running" | "done" | "failed" | "paused-usage-limit" | "paused-login";
  message: string; models: { solver: ModelChoice; expert: ModelChoice }; calls: number;
  results: QuestionJudgement[]; summary?: JudgeSummary;
  /**
   * Trial runs: the planted flaws and how many the judges caught. `falseAlarms` counts originals that did not pass;
   * some may be real flaws, so it is shown as "원본 비통과", not as a false-alarm rate.
   */
  trial?: { planted: number; caught: number; byKind: Record<string, { planted: number; caught: number }>; originals: number; falseAlarms: number };
};
export type JudgeCall = { n: number; role: "blind" | "reader" | "expert"; sectionId: string; attempt: number; model: string; effort: string; format?: string | null; startedAt: string; ms: number; ok: boolean; system: string; user: string; reply: string | null; error: string | null; usage?: { inputTokens?: number; outputTokens?: number } };

// ---- criteria and schemas -----------------------------------------------------------------------------------
const root = () => process.env.STUDY_FORGE_GUIDE_ROOT?.trim() || process.cwd();
async function criteria(file: string) {
  try { return ruleLines(await readFile(/* turbopackIgnore: true */ path.join(root(), JUDGE_DIR, file), "utf8")).join("\n"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`평가기준 파일이 없습니다: ${JUDGE_DIR}/${file}`); throw error; }
}
type Json = Record<string, unknown>;
const obj = (properties: Record<string, Json>): Json => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const solverSchema = obj({ answers: { type: "array", items: obj({ questionId: { type: "string" }, answer: { type: "string" }, confidence: { type: "number", description: "0~1" } }) } });
const solverReply = z.object({ answers: z.array(z.object({ questionId: z.string(), answer: z.string(), confidence: z.number() })) });
const grade = { type: "string", enum: ["correct", "partial", "wrong"] };
const expertSchema = obj({ questions: { type: "array", items: obj({
  questionId: { type: "string" },
  answerVisible: { type: "boolean", description: "정답 공개 전 화면(본문·보기·입력칸 문구)에 정답이나 결정적 단서가 보이는가" },
  blindGrade: grade,
  readerGrades: { type: "array", items: grade, description: "원문 학습자 1~3의 순서대로" },
  conditionMatch: { type: "boolean" }, answerCorrect: { type: "boolean" }, answerUnique: { type: "boolean" }, objectiveMatch: { type: "boolean" },
  distractorsPlausible: { type: ["boolean", "null"] }, depth: { type: "string", enum: ["되풀이", "이해", "적용"] }, problems: { type: "string" },
}) } });
const gradeEnum = z.enum(["correct", "partial", "wrong"]);
const expertReply = z.object({ questions: z.array(z.object({
  questionId: z.string(), answerVisible: z.boolean(), blindGrade: gradeEnum, readerGrades: z.array(gradeEnum),
  conditionMatch: z.boolean(), answerCorrect: z.boolean(), answerUnique: z.boolean(), objectiveMatch: z.boolean(),
  distractorsPlausible: z.boolean().nullable(), depth: z.enum(["되풀이", "이해", "적용"]), problems: z.string(),
})) });

// ---- what each role sees ------------------------------------------------------------------------------------
const LETTERS = ["A", "B", "C", "D", "E", "F"];
function blockText(block: AuthoringBlock, question: AuthoredQuestion) {
  switch (block.kind) {
    case "text": return block.text;
    case "box": return block.label ?? "";
    case "math": return `식: ${block.latex}`;
    case "table": return block.rows.map((row) => row.join(" | ")).join("\n");
    case "choice-set": {
      const response = question.responses.find((candidate) => candidate.id === block.responseId);
      if (response?.kind !== "single-choice") return "";
      return block.optionIds.map((id, index) => { const option = response.options.find((candidate) => candidate.id === id); return `${LETTERS[index]}. ${option?.text ?? option?.latex ?? ""}`; }).join("\n");
    }
    case "blank": return `[답 입력칸] ${block.promptBefore} ____ ${block.promptAfter}`.replace(/\s+/g, " ").trim();
    default: return "";
  }
}
/** Everything a learner can read before the answer is revealed. */
export function learnerView(question: AuthoredQuestion, label: string) {
  return [`### ${label}`, ...question.blocks.map((block) => blockText(block, question)).filter((text) => text.trim())].join("\n");
}
function choiceOrder(question: AuthoredQuestion) {
  const block = question.blocks.find((candidate) => candidate.kind === "choice-set") as Extract<AuthoringBlock, { kind: "choice-set" }> | undefined;
  return block?.optionIds ?? [];
}
export function keyText(question: AuthoredQuestion) {
  const response = question.responses[0];
  if (response.kind === "single-choice") {
    const index = choiceOrder(question).indexOf(response.correctOptionId);
    const option = response.options.find((candidate) => candidate.id === response.correctOptionId);
    return `${LETTERS[index] ?? "?"}. ${option?.text ?? option?.latex ?? ""}`;
  }
  return response.grading === "self-check" ? `모범 답: ${response.acceptedAnswers[0] ?? ""}` : `인정 답안: ${response.acceptedAnswers.join(" / ")}`;
}
/** Choice and short answers are graded by code; self-check answers have no code grade (null). */
export function codeGrade(question: AuthoredQuestion, answer: string): Grade | null {
  const response = question.responses[0];
  if (response.kind === "single-choice") {
    const letter = answer.trim().toUpperCase().match(/^[A-F]/)?.[0];
    const optionId = letter ? choiceOrder(question)[LETTERS.indexOf(letter)] : undefined;
    return optionId ? (gradeResponse(response, optionId) ? "correct" : "wrong") : "wrong";
  }
  const graded = gradeResponse(response, answer);
  return graded === null ? null : graded ? "correct" : "wrong";
}

// ---- verdicts -------------------------------------------------------------------------------------------------
export function verdictOf(judgement: Omit<QuestionJudgement, "verdict" | "reasons">): { verdict: Verdict; reasons: string[] } {
  const fail: string[] = [], suspect: string[] = [];
  const { checks, readers } = judgement;
  if (!checks.answerCorrect) fail.push("정답이 원문과 다름");
  if (!checks.conditionMatch) fail.push("질문의 조건이 원문과 다름");
  if (readers.length && readers.every((reader) => reader.grade === "wrong")) fail.push("원문 읽은 학습자가 모두 틀림");
  // A blind learner who knows the subject is not exposure; only an answer or decisive clue on screen is.
  if (checks.answerVisible) suspect.push("정답이나 결정적 단서가 화면에 보임(노출)");
  if (judgement.acceptedGaps?.length) suspect.push(`뜻은 맞는데 인정 답안에 없음: ${judgement.acceptedGaps.join(" / ").slice(0, 60)}`);
  if (readers.some((reader) => reader.grade === "correct") && readers.some((reader) => reader.grade !== "correct")) suspect.push("원문 읽은 학습자들의 정오가 갈림(모호)");
  if (!checks.answerUnique) suspect.push("다른 답도 정답이 됨");
  if (!checks.objectiveMatch) suspect.push("목표와 안 맞음");
  if (checks.distractorsPlausible === false) suspect.push("티 나는 오답");
  return fail.length ? { verdict: "실패", reasons: [...fail, ...suspect] } : suspect.length ? { verdict: "의심", reasons: suspect } : { verdict: "통과", reasons: [] };
}
export function summarize(results: QuestionJudgement[]): JudgeSummary {
  const depth: Record<string, number> = {};
  for (const result of results) depth[result.checks.depth] = (depth[result.checks.depth] ?? 0) + 1;
  const has = (text: string) => results.filter((result) => result.reasons.some((reason) => reason.includes(text))).length;
  return {
    questions: results.length,
    pass: results.filter((result) => result.verdict === "통과").length,
    suspect: results.filter((result) => result.verdict === "의심").length,
    fail: results.filter((result) => result.verdict === "실패").length,
    exposed: has("노출"), ambiguous: has("모호"), acceptedGap: has("인정 답안에 없음"),
    // Informational: solved confidently without studying (easy, common knowledge, or a clue). Not a verdict reason.
    blindSolved: results.filter((result) => result.blind.grade === "correct" && result.blind.confidence >= EXPOSED_CONFIDENCE).length,
    answerWrong: results.filter((result) => result.reasons.some((reason) => reason.includes("정답이 원문과 다름") || reason.includes("모두 틀림"))).length,
    conditionMismatch: has("조건이 원문과 다름"), nonUnique: has("다른 답도"), objectiveMismatch: has("목표와 안 맞음"), weakDistractors: has("티 나는 오답"),
    depth,
  };
}

// ---- planted flaws (trial) --------------------------------------------------------------------------------------
const SWAPS: Array<[string, string]> = [["한 번도", "이미"], ["처음", "이미"], ["먼저", "나중에"], ["최대", "최소"], ["증가", "감소"], ["항상", "가끔"], ["모든", "일부"], ["앞", "뒤"], ["있는", "없는"]];
export function mutate(question: AuthoredQuestion, kind: MutationKind, others: AuthoredQuestion[]): AuthoredQuestion | null {
  const copy = JSON.parse(JSON.stringify(question)) as AuthoredQuestion;
  copy.id = `${question.id}~${kind}`;
  const response = copy.responses[0];
  if (kind === "leak") {
    const answer = response.kind === "single-choice" ? (response.options.find((option) => option.id === response.correctOptionId)?.text ?? "") : response.acceptedAnswers[0] ?? "";
    if (!answer.trim()) return null;
    const last = copy.blocks.filter((block) => block.kind === "text").at(-1) as Extract<AuthoringBlock, { kind: "text" }> | undefined;
    if (!last) return null;
    last.text = `${last.text} (참고: ${answer})`;
    return copy;
  }
  if (kind === "wrong-key") {
    if (response.kind === "single-choice") {
      const index = response.options.findIndex((option) => option.id === response.correctOptionId);
      response.correctOptionId = response.options[(index + 1) % response.options.length].id;
      return copy;
    }
    const other = others.find((candidate) => candidate.id !== question.id && candidate.responses[0].kind === "short-text");
    const replacement = other && other.responses[0].kind === "short-text" ? other.responses[0].acceptedAnswers[0] : undefined;
    if (!replacement) return null;
    response.acceptedAnswers = [replacement];
    return copy;
  }
  for (const block of copy.blocks) {
    if (block.kind !== "text") continue;
    for (const [from, to] of SWAPS) {
      if (block.text.includes(from)) { block.text = block.text.replace(from, to); return copy; }
      if (block.text.includes(to)) { block.text = block.text.replace(to, from); return copy; }
    }
  }
  return null;
}

// ---- storage ---------------------------------------------------------------------------------------------------
const judgeDir = (genId: string) => path.join(dataRoot(), genId, "judge");
async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
const runFile = (genId: string, id: string) => { if (!/^j_[a-f0-9]{16}$/.test(id)) throw new GenError(400, "판정 ID가 올바르지 않습니다."); return path.join(judgeDir(genId), `${id}.json`); };
export async function loadJudge(genId: string, id: string): Promise<JudgeRun | null> {
  try { return JSON.parse(await readFile(runFile(genId, id), "utf8")) as JudgeRun; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listJudges(genId: string): Promise<JudgeRun[]> {
  let names: string[];
  try { names = await readdir(judgeDir(genId)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const runs = await Promise.all(names.filter((name) => /^j_[a-f0-9]{16}\.json$/.test(name)).map((name) => loadJudge(genId, name.slice(0, -5))));
  return runs.filter((run): run is JudgeRun => Boolean(run)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function readJudgeCalls(genId: string, id: string): Promise<JudgeCall[]> {
  const dir = path.join(judgeDir(genId), `${id}-calls`);
  let names: string[];
  try { names = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(names.filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b)).map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as JudgeCall));
}

// ---- running --------------------------------------------------------------------------------------------------
export const DEFAULT_JUDGE_MODELS = { solver: { model: "gpt-6-luna", effort: "low" }, expert: { model: "gpt-6-sol", effort: "medium" } } as const;
export type JudgeOptions = {
  pages?: (input: GenInput) => Promise<Map<number, string>>;
  fakeReply?: (role: JudgeCall["role"], user: string, reader: number) => string;
};
const modelSchema = z.object({ model: z.string().trim().min(1).max(80), effort: z.enum(["low", "medium", "high", "xhigh"]) });
const startSchema = z.object({ kind: z.enum(["judge", "trial"]).default("judge"), models: z.object({ solver: modelSchema, expert: modelSchema }).partial().default({}), confirmed: z.boolean().optional() });

/** Creates a judge run for a finished generation and queues it after any running job. */
export async function startJudge(genId: string, raw: unknown, caller: ModelCaller, options: JudgeOptions = {}) {
  const body = startSchema.parse(raw);
  const gen = await loadGen(genId);
  if (!gen) throw new GenError(404, "생성을 찾을 수 없습니다.");
  if (gen.status !== "done") throw new GenError(409, "출제가 끝난 생성만 판정할 수 있습니다.");
  if (gen.input.provider !== "fake" && body.confirmed !== true) throw new GenError(400, "실제 모델 호출 확인이 필요합니다.");
  const now = new Date().toISOString();
  const run: JudgeRun = {
    id: `j_${randomBytes(8).toString("hex")}`, genId, kind: body.kind, createdAt: now, updatedAt: now, status: "queued", message: "", calls: 0, results: [],
    models: { solver: body.models.solver ?? { ...DEFAULT_JUDGE_MODELS.solver }, expert: body.models.expert ?? { ...DEFAULT_JUDGE_MODELS.expert } },
  };
  await save(runFile(genId, run.id), run);
  const finished = chainTask(() => runJudge(gen, run, caller, options));
  return { run, finished };
}

async function runJudge(gen: GenState, run: JudgeRun, caller: ModelCaller, options: JudgeOptions): Promise<JudgeRun> {
  const persist = async () => { run.updatedAt = new Date().toISOString(); await save(runFile(gen.id, run.id), run); };
  const callsDir = path.join(judgeDir(gen.id), `${run.id}-calls`);
  const ask = async (role: JudgeCall["role"], sectionId: string, reader: number, system: string, user: string, schema: Json, parser: z.ZodTypeAny) => {
    const choice = role === "expert" ? run.models.expert : run.models.solver;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      run.calls += 1;
      const started = Date.now();
      const record: JudgeCall = { n: run.calls, role, sectionId, attempt, model: choice.model, effort: choice.effort, startedAt: new Date(started).toISOString(), ms: 0, ok: false, system: redactCallText(system), user: redactCallText(user), reply: null, error: null };
      try {
        const reply = await callModel({ purpose: `judge:${role}`, system, user, json: true, schema, schemaName: `recaller_judge_${role}`, model: choice.model, effort: choice.effort, caller, provider: gen.input.provider,
          ...(gen.input.provider === "fake" ? { fakeReply: (options.fakeReply ?? fakeJudgeReply)(role, user, reader) } : {}) });
        Object.assign(record, { ok: true, reply: redactCallText(reply.text), model: reply.model, usage: reply.usage, format: reply.format ?? null, ms: Date.now() - started });
        await save(path.join(callsDir, `${record.n}.json`), record);
        const parsed = parser.safeParse(reply.data);
        if (parsed.success) return parsed.data as z.infer<typeof parser>;
        record.ok = false; record.error = "응답이 정해진 JSON 형식과 다릅니다."; await save(path.join(callsDir, `${record.n}.json`), record);
      } catch (error) {
        Object.assign(record, { error: redactCallText(error instanceof Error ? error.message : String(error)), ms: Date.now() - started });
        await save(path.join(callsDir, `${record.n}.json`), record);
        if (error instanceof ModelError && error.code === "usage_limit") throw Object.assign(new Error("ChatGPT 사용량 한도에 닿았어요."), { pause: "paused-usage-limit" as const });
        if (error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured")) throw Object.assign(new Error(error.message), { pause: "paused-login" as const });
      }
    }
    throw new Error(`${role} 판정 응답을 읽지 못했어요.`);
  };

  try {
    run.status = "running"; await persist();
    const [blindRules, readerRules, expertRules] = await Promise.all([criteria("맨손학습자.md"), criteria("원문학습자.md"), criteria("전문가.md")]);
    const loaded = await withTranscripts(gen.id, await (options.pages ?? registeredPages)(gen.input));
    const objectives = new Map(gen.sections.flatMap((section) => section.design?.objectives ?? []).map((objective) => [objective.id, objective]));

    const judgeSection = async (section: GenState["sections"][number], questions: AuthoredQuestion[]) => {
      if (!questions.length) return [] as QuestionJudgement[];
      const labels = new Map(questions.map((question, index) => [question.id, `Q${index + 1}`]));
      const byLabel = new Map(questions.map((question) => [labels.get(question.id)!, question]));
      const views = questions.map((question) => learnerView(question, labels.get(question.id)!)).join("\n\n");
      const source = pageBlock(sectionPageTexts(section, gen.sections, loaded).texts).text;
      const answerFormat = "questionId에는 문항 머리글(Q1, Q2 …)을 그대로 쓴다.";
      const blind = await ask("blind", section.id, 0, `${blindRules}\n${answerFormat}`, `[문제]\n${views}`, solverSchema, solverReply) as z.infer<typeof solverReply>;
      const readers: Array<z.infer<typeof solverReply>> = [];
      for (let reader = 1; reader <= 3; reader += 1) {
        readers.push(await ask("reader", section.id, reader, `${readerRules}\n${answerFormat}`, `[원문]\n${source}\n\n[문제]\n${views}`, solverSchema, solverReply) as z.infer<typeof solverReply>);
      }
      const answerOf = (reply: z.infer<typeof solverReply>, label: string) => reply.answers.find((answer) => answer.questionId.trim().toUpperCase() === label) ?? { answer: "", confidence: 0, questionId: label };
      const expertUser = [`[원문]\n${source}`, ...questions.map((question) => {
        const label = labels.get(question.id)!;
        const objective = objectives.get(question.source.objectiveId);
        return [learnerView(question, label), `목표: ${objective?.statement ?? question.source.target}`, `떠올릴 것: ${objective?.recall ?? question.source.knowledgeContent ?? ""}`,
          `정답: ${keyText(question)}`, `맨손 학습자 답: ${answerOf(blind, label).answer || "(없음)"}`,
          ...readers.map((reply, index) => `원문 학습자 ${index + 1} 답: ${answerOf(reply, label).answer || "(없음)"}`)].join("\n");
      })].join("\n\n");
      const expert = await ask("expert", section.id, 0, `${expertRules}\n${answerFormat} readerGrades는 원문 학습자 1, 2, 3 순서로 세 개를 쓴다.`, expertUser, expertSchema, expertReply) as z.infer<typeof expertReply>;
      return [...byLabel].map(([label, question]): QuestionJudgement => {
        const review = expert.questions.find((item) => item.questionId.trim().toUpperCase() === label);
        const blindAnswer = answerOf(blind, label);
        const gaps: string[] = [];
        /** Code grade first; when code says wrong but the expert says correct by meaning, keep the expert's and note the gap. */
        const final = (answer: string, expertGrade: Grade | undefined): Grade => {
          const coded = codeGrade(question, answer);
          if (coded === null) return expertGrade ?? "wrong";
          if (coded === "wrong" && question.responses[0].kind === "short-text" && expertGrade === "correct" && answer.trim()) { gaps.push(answer.trim()); return "correct"; }
          return coded;
        };
        const blindFinal = final(blindAnswer.answer, review?.blindGrade);
        const readerFinal = readers.map((reply, index) => { const answer = answerOf(reply, label).answer; return { answer, grade: final(answer, review?.readerGrades[index]) }; });
        const base = {
          questionId: question.id, objectiveId: question.source.objectiveId, sectionId: section.id,
          ...(question.id.includes("~") ? { mutation: question.id.split("~")[1] as MutationKind } : {}),
          blind: { answer: blindAnswer.answer, confidence: Math.max(0, Math.min(1, blindAnswer.confidence)), grade: blindFinal },
          readers: readerFinal,
          ...(gaps.length ? { acceptedGaps: [...new Set(gaps)] } : {}),
          // A question the expert skipped is treated as unreviewed: kept, but marked suspect below.
          checks: review ? { answerVisible: review.answerVisible, conditionMatch: review.conditionMatch, answerCorrect: review.answerCorrect, answerUnique: review.answerUnique, objectiveMatch: review.objectiveMatch, distractorsPlausible: review.distractorsPlausible, depth: review.depth }
            : { conditionMatch: true, answerCorrect: true, answerUnique: true, objectiveMatch: true, distractorsPlausible: null, depth: "되풀이" as const },
          problems: review?.problems ?? "전문가 검토 응답에 이 문항이 없음",
        };
        const verdict = verdictOf(base);
        if (!review) verdict.reasons.push("전문가 검토 없음");
        return { ...base, verdict: !review && verdict.verdict === "통과" ? "의심" : verdict.verdict, reasons: verdict.reasons };
      });
    };

    const documents = new Map<string, AuthoringDocument | null>();
    for (const section of gen.sections) documents.set(section.id, await readSectionDocument(gen.id, section.id) as AuthoringDocument | null);
    for (const section of gen.sections) {
      run.results.push(...await judgeSection(section, documents.get(section.id)?.questions ?? []));
      await persist();
    }
    run.summary = summarize(run.results);

    if (run.kind === "trial") {
      const originals = [...run.results];
      const passing = new Set(originals.filter((result) => result.verdict === "통과").map((result) => result.questionId));
      const kinds: MutationKind[] = ["condition-swap", "wrong-key", "leak"];
      let turn = 0;
      for (const section of gen.sections) {
        const questions = documents.get(section.id)?.questions ?? [];
        const all = [...documents.values()].flatMap((document) => document?.questions ?? []);
        const planted = questions.filter((question) => passing.has(question.id)).map((question) => {
          for (let offset = 0; offset < kinds.length; offset += 1) {
            const mutant = mutate(question, kinds[(turn + offset) % kinds.length], all);
            if (mutant) { turn += 1; return mutant; }
          }
          return null;
        }).filter((question): question is AuthoredQuestion => Boolean(question));
        run.results.push(...await judgeSection(section, planted));
        await persist();
      }
      const mutants = run.results.filter((result) => result.mutation);
      const byKind: Record<string, { planted: number; caught: number }> = {};
      for (const result of mutants) {
        const entry = (byKind[mutationLabel[result.mutation!]] ??= { planted: 0, caught: 0 });
        entry.planted += 1;
        if (result.verdict !== "통과") entry.caught += 1;
      }
      run.trial = { planted: mutants.length, caught: mutants.filter((result) => result.verdict !== "통과").length, byKind,
        originals: originals.length, falseAlarms: originals.filter((result) => result.verdict !== "통과").length };
    }
    run.status = "done"; run.message = "";
    await persist();
  } catch (error) {
    const pause = (error as { pause?: JudgeRun["status"] }).pause;
    run.status = pause ?? "failed";
    run.message = error instanceof Error ? error.message : String(error);
    await persist();
  }
  return run;
}

/** Free stand-in: learners do not know, the expert finds nothing wrong. Tests pass their own replies. */
export function fakeJudgeReply(role: JudgeCall["role"], user: string): string {
  const labels = [...user.matchAll(/^### (Q\d+)$/gm)].map((match) => match[1]);
  if (role !== "expert") return JSON.stringify({ answers: labels.map((questionId) => ({ questionId, answer: "모름", confidence: 0.1 })) });
  return JSON.stringify({ questions: labels.map((questionId) => ({ questionId, answerVisible: false, blindGrade: "wrong", readerGrades: ["correct", "correct", "correct"],
    conditionMatch: true, answerCorrect: true, answerUnique: true, objectiveMatch: true, distractorsPlausible: null, depth: "이해", problems: "" })) });
}
