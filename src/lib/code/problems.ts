// 코드 문제 (2026-10-26): problems, the learner's drafts and submissions, kept in STUDY_FORGE_DATA_DIR/code.
// Every problem's tests have outputs made by its reference solution (JavaScript, so it runs on any computer that runs
// Recaller): a test the reference cannot answer is dropped, so a wrong expected output never grades the learner.
// The screen gets examples only; hidden tests and the reference stay on the server.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { calibration } from "./calibrate.ts";
import { judge, LANGS, normalizeOutput, runOnce, type CompareHow, type Judgement, type Lang, type TestCase } from "./run.ts";
import { SEEDS } from "./seeds.ts";

export type Problem = {
  id: string; title: string; statement: string; inputText: string; outputText: string;
  examples: TestCase[]; tests: TestCase[]; timeLimitMs: number; /** MB; 256 when left out */ memoryLimitMb?: number;
  /** "full": write the whole program. "blank": fill the ____ in a given program. */
  kind: "full" | "blank";
  templates: Partial<Record<Lang, string>>;
  reference: { lang: "javascript"; code: string } | null;
  /** Knowledge this problem checks, by name; ids are filled when the problem is saved into the knowledge store. */
  knowledge: string[]; knowledgeIds: string[];
  folder: string; source: { kind: "seed" | "ai" | "manual"; title: string; url?: string };
  /** Where the examples came from: copied from the pasted problem ("source") or made by the model ("made"). */
  examplesFrom?: "source" | "made";
  /** How the reference was checked before saving: against the source examples, or against a simple solution on small inputs. */
  check?: ProblemCheck;
  /** The constraints as the model read them (N·값 범위), shown with the problem. */
  constraints?: string;
  /** How the hidden tests were made (testgen/harness.mjs): the generator and its seed, so they can be made again. */
  testgen?: { generator: string; seed: number };
  /** How outputs are compared (compare.mjs); exact when left out. */
  compare?: CompareHow;
  createdAt: string;
};
/** `human`: a person's solution (from the import's sources) agreed with the reference on every test, or could not run here. */
export type ProblemCheck = { by: "source" | "cross"; cases: number; tries: number; human?: "match" | "skipped";
  /** Hidden tests made by the generator, how many are max-size, and small inputs the simple solution agreed on. */
  tests?: number; maxTests?: number; compared?: number;
  /** 결함 풀이 검출: faulty solutions the tests failed, out of those that really are faulty (a score, not a gate). */
  mutation?: { killed: number; total: number; survived: string[]; added: number };
  /** 안전장치 ⑤: a solution from another model call agreed on `agreed` of `total` tests (`unchecked`: it was too slow or crashed). */
  second?: { model: string; status: "agreed" | "second-wrong" | "unchecked" | "broken" | "skipped"; agreed: number; total: number; unchecked: number };
  /** Each try of the problem maker: where its time went (ms) and why it failed (the last one passed). */
  attempts?: Array<{ draftMs: number; testsMs: number; secondMs: number; verifyMs: number; reason?: string }> };
export type ProblemLite = Pick<Problem, "id" | "title" | "kind" | "knowledge" | "folder" | "createdAt"> & { source: string; status: "new" | "tried" | "wrong" | "solved"; tries: number; lastAt: string };
export type Submission = { id: string; at: string; problemId: string; lang: Lang; mode: "example" | "submit"; verdict: string; passed: number; total: number; hints: number; code: string; ms: number };

export class CodeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const STARTERS: Record<Lang, string> = {
  python: "import sys\ninput = sys.stdin.readline\n\n# 여기에 풀이를 써요\n",
  javascript: "const input = require(\"fs\").readFileSync(0, \"utf8\").trim().split(/\\s+/);\nlet p = 0;\nconst next = () => input[p++];\n\n// 여기에 풀이를 써요\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // 여기에 풀이를 써요\n\n    return 0;\n}\n",
  csharp: "using System;\nusing System.IO;\nusing System.Text;\n\nclass Program {\n    static void Main() {\n        string[] input = Console.In.ReadToEnd().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);\n        int p = 0;\n        // 여기에 풀이를 써요\n    }\n}\n",
};
export const BLANK = "____";

const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code");
const problemsDir = () => path.join(root(), "problems");
const draftsDir = () => path.join(root(), "drafts");
const submissionsFile = () => path.join(root(), "submissions.jsonl");
const idPattern = /^cp_[a-z0-9_-]{3,40}$/;
const fileOf = (dir: string, id: string) => { if (!idPattern.test(id)) throw new CodeError(400, "문제 ID가 올바르지 않아요."); return path.join(dir, `${id}.json`); };
const newId = () => `cp_${randomBytes(6).toString("hex")}`;
async function writeJson(file: string, value: unknown, compact = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, compact ? JSON.stringify(value) : JSON.stringify(value, null, 1), "utf8");
  await rename(tmp, file);
}

/* ---------- 문제 파일 (2026-10-28): the problem and its hidden tests are two files ----------
   <id>.json is what the list and the problem screen need (a few KB); <id>.tests.json holds the hidden tests (up to
   tens of MB with max-size inputs). The list never opens the tests; opening a problem starts reading them, so they
   are in memory by the time the learner submits. Files from before kept the tests inline and are split on first read. */
/** A problem without its hidden tests (and how many there are). */
export type ProblemMeta = Omit<Problem, "tests"> & { hiddenTests: number };
const testsFileOf = (id: string) => fileOf(problemsDir(), id).replace(/\.json$/, ".tests.json");
const testsCache = globalThis as unknown as { __codeTests?: Map<string, { mtimeMs: number; tests: TestCase[] }> };
const cache = () => (testsCache.__codeTests ??= new Map());
const remember = (id: string, mtimeMs: number, tests: TestCase[]) => {
  const c = cache(); c.delete(id); c.set(id, { mtimeMs, tests });
  while (c.size > 4) c.delete(c.keys().next().value!); // the few problems open lately
};
async function writeProblem(problem: Problem) {
  const { tests, ...rest } = problem;
  await writeJson(testsFileOf(problem.id), tests, true); // tests first: a problem file means its tests are there
  remember(problem.id, (await stat(testsFileOf(problem.id))).mtimeMs, tests);
  await writeJson(fileOf(problemsDir(), problem.id), { ...rest, hiddenTests: tests.length });
}
async function readMeta(id: string): Promise<ProblemMeta> {
  let raw: (ProblemMeta & { tests?: TestCase[] });
  try { raw = JSON.parse(await readFile(fileOf(problemsDir(), id), "utf8")); }
  catch (error) { if (error instanceof CodeError) throw error; throw new CodeError(404, "문제를 찾을 수 없어요."); }
  if (Array.isArray(raw.tests)) { // a file from before the split
    const { tests, ...rest } = raw;
    await writeProblem({ ...(rest as Omit<Problem, "tests">), tests });
    return { ...rest, hiddenTests: tests.length };
  }
  return raw;
}
async function readTests(id: string): Promise<TestCase[]> {
  const file = testsFileOf(id);
  const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: -1 }));
  if (mtimeMs < 0) return [];
  const hit = cache().get(id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.tests;
  const tests = JSON.parse(await readFile(file, "utf8")) as TestCase[];
  remember(id, mtimeMs, tests);
  return tests;
}
/** The problem without its hidden tests: for the list, the problem screen and the tutor. */
export const readProblemMeta = readMeta;
/** Start reading a problem's hidden tests now (the problem was just opened), so judging doesn't wait for them. */
export function warmTests(id: string) { void readTests(id).catch(() => undefined); }

/** Expected outputs from the reference solution; inputs it fails on are dropped. Returns the tests that survived. */
export async function answerWithReference(reference: string, inputs: string[], timeLimitMs = 5000) {
  const kept: TestCase[] = []; const dropped: Array<{ input: string; why: string }> = [];
  for (const input of inputs) {
    const out = await runOnce("javascript", reference, input, timeLimitMs, true);
    if (!out.ok) throw new CodeError(422, `모범 풀이를 실행하지 못했어요: ${out.error.slice(0, 300)}`);
    if (out.timedOut || out.tooMuch || out.code !== 0 || !out.stdout.trim()) dropped.push({ input: input.slice(0, 200), why: out.timedOut ? "시간 초과" : out.stderr.slice(0, 200) || "출력 없음" });
    else kept.push({ input, output: normalizeOutput(out.stdout) });
  }
  return { tests: kept, dropped };
}

// 정답 풀이 검사 (docs/DECISIONS.md 2026-10-26 "코드 문제 받아오기"): a reference is trusted only after one of these passes.
const short = (text: string, n = 80) => { const one = text.replace(/\n/g, " ⏎ "); return one.length > n ? `${one.slice(0, n)}…` : one || "(빈 출력)"; };
function ranBadly(out: Awaited<ReturnType<typeof runOnce>>) {
  if (!out.ok) return `실행하지 못함 (${out.error.slice(0, 200)})`;
  if (out.timedOut) return "시간 초과";
  if (out.tooMuch || out.code !== 0) return `실행 중 에러 (${out.stderr.slice(0, 200) || `종료 코드 ${out.code}`})`;
  return "";
}
/** The reference must print each source example's output. Returns the first mismatch as a reason, or "" when all match. */
export async function matchSourceExamples(reference: string, examples: TestCase[], timeLimitMs = 5000) {
  for (const [i, ex] of examples.entries()) {
    const out = await runOnce("javascript", reference, ex.input, timeLimitMs, true);
    const bad = ranBadly(out);
    if (bad) return `예제 ${i + 1}번: 모범 풀이 ${bad}`;
    const got = normalizeOutput(out.ok ? out.stdout : ""), want = normalizeOutput(ex.output);
    if (got !== want) return `예제 ${i + 1}번: 기대 ${short(want)}, 모범 풀이 ${short(got)}`;
  }
  return "";
}
/**
 * 교차 확인: with no source examples to trust, the reference and a slow-but-simple solution must agree on small inputs.
 * An input the simple solution cannot answer is skipped (not compared); `compared` counts the ones that agreed.
 */
export async function crossCheck(reference: string, brute: string, inputs: string[], timeLimitMs = 5000) {
  let compared = 0;
  for (const [i, input] of inputs.entries()) {
    const slow = await runOnce("javascript", brute, input, timeLimitMs, true);
    if (!slow.ok) return { compared, mismatch: `단순 풀이 ${ranBadly(slow)}` };
    if (ranBadly(slow) || !slow.stdout.trim()) continue;
    const fast = await runOnce("javascript", reference, input, timeLimitMs, true);
    const bad = ranBadly(fast);
    if (bad) return { compared, mismatch: `작은 입력 ${i + 1}번 (${short(input, 60)}): 모범 풀이 ${bad}` };
    const a = normalizeOutput(slow.stdout), b = normalizeOutput(fast.ok ? fast.stdout : "");
    if (a !== b) return { compared, mismatch: `작은 입력 ${i + 1}번 (${short(input, 60)}): 단순 풀이 ${short(a)}, 모범 풀이 ${short(b)}` };
    compared++;
  }
  return { compared, mismatch: "" };
}

/** The seed problems are written once, with outputs from their references, the first time the list is read. */
async function ensureSeeds() {
  const marker = path.join(root(), "seeded.json");
  let done: string[] = [];
  try { done = JSON.parse(await readFile(marker, "utf8")) as string[]; } catch { /* first time */ }
  const missing = SEEDS.filter((seed) => !done.includes(seed.id));
  if (!missing.length) return;
  for (const seed of missing) {
    const examples = (await answerWithReference(seed.reference, seed.exampleInputs)).tests;
    const answered = await answerWithReference(seed.reference, seed.testInputs());
    if (answered.dropped.length) console.warn(`[code] ${seed.id}: 테스트 ${answered.dropped.length}개 제외`, answered.dropped.map((d) => d.why));
    const tests = answered.tests;
    const problem: Problem = { id: seed.id, title: seed.title, statement: seed.statement, inputText: seed.inputText, outputText: seed.outputText,
      examples, tests, timeLimitMs: seed.timeLimitMs ?? 2000, kind: seed.kind, templates: seed.templates ?? {}, reference: { lang: "javascript", code: seed.reference },
      knowledge: seed.knowledge, knowledgeIds: [], folder: seed.folder, source: { kind: "seed", title: "Recaller 기본 문제" }, createdAt: new Date().toISOString() };
    await writeProblem(problem);
    done.push(seed.id);
  }
  await writeJson(marker, done);
}

/** The whole problem, hidden tests included: for judging. */
export async function readProblem(id: string): Promise<Problem> {
  const { hiddenTests, ...meta } = await readMeta(id);
  void hiddenTests;
  return { ...meta, tests: await readTests(id) };
}
/** What the screen may see: no hidden tests, no reference, no generator. */
export function publicProblem(problem: Problem | ProblemMeta) {
  const { reference, testgen, ...rest } = problem;
  void testgen;
  const hiddenTests = "tests" in problem ? problem.tests.length : problem.hiddenTests;
  if ("tests" in rest) delete (rest as { tests?: unknown }).tests;
  return { ...rest, hiddenTests, hasReference: Boolean(reference), starters: Object.fromEntries(LANGS.map((lang) => [lang, problem.templates[lang] ?? STARTERS[lang]])) as Record<Lang, string> };
}
export async function saveProblem(input: Omit<Problem, "id" | "createdAt" | "knowledgeIds"> & { id?: string; knowledgeIds?: string[] }) {
  if (!input.title.trim()) throw new CodeError(400, "문제 제목이 비어 있어요.");
  if (!input.tests.length && !input.examples.length) throw new CodeError(400, "테스트가 하나도 없어요.");
  const problem: Problem = { ...input, id: input.id ?? newId(), knowledgeIds: input.knowledgeIds ?? [], createdAt: new Date().toISOString() };
  await writeProblem(problem);
  return problem;
}
/** Only the problem file changes; the tests stay as they are. */
export async function setProblemKnowledge(id: string, knowledgeIds: string[]) {
  const meta = await readMeta(id);
  await writeJson(fileOf(problemsDir(), id), { ...meta, knowledgeIds });
}
export async function deleteProblem(id: string) {
  await rm(fileOf(problemsDir(), id), { force: true });
  await rm(testsFileOf(id), { force: true });
  cache().delete(id);
  await rm(fileOf(draftsDir(), id), { force: true });
  return { ok: true };
}

export async function readSubmissions(problemId?: string): Promise<Submission[]> {
  try {
    const all = (await readFile(submissionsFile(), "utf8")).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Submission]; } catch { return []; } });
    return problemId ? all.filter((s) => s.problemId === problemId) : all;
  } catch { return []; }
}
const statusOf = (subs: Submission[]): ProblemLite["status"] => {
  const submits = subs.filter((s) => s.mode === "submit");
  if (!subs.length) return "new";
  if (!submits.length) return "tried";
  return submits.at(-1)!.verdict === "AC" ? "solved" : "wrong";
};
export async function listProblems(): Promise<ProblemLite[]> {
  await ensureSeeds();
  let names: string[] = [];
  try { names = (await readdir(problemsDir())).filter((n) => /^cp_[a-z0-9_-]+\.json$/.test(n)); } catch { return []; }
  const subs = await readSubmissions();
  const out: ProblemLite[] = [];
  for (const name of names) {
    try {
      const p = await readMeta(name.replace(/\.json$/, ""));
      const mine = subs.filter((s) => s.problemId === p.id);
      out.push({ id: p.id, title: p.title, kind: p.kind, knowledge: p.knowledge, folder: p.folder, createdAt: p.createdAt, source: p.source.title,
        status: statusOf(mine), tries: mine.filter((s) => s.mode === "submit").length, lastAt: mine.at(-1)?.at ?? "" });
    } catch { /* a broken file is skipped */ }
  }
  return out.sort((a, b) => (b.lastAt || b.createdAt).localeCompare(a.lastAt || a.createdAt));
}

export async function readDrafts(id: string): Promise<Partial<Record<Lang, string>>> {
  try { return JSON.parse(await readFile(fileOf(draftsDir(), id), "utf8")) as Partial<Record<Lang, string>>; } catch { return {}; }
}
export async function saveDraft(id: string, lang: Lang, code: string) {
  const drafts = await readDrafts(id);
  drafts[lang] = code.slice(0, 100_000);
  await writeJson(fileOf(draftsDir(), id), drafts);
  return { ok: true };
}

export type SubmitResult = Judgement & { submission: Submission; shown: Judgement["results"] };
/**
 * "예제 실행" runs the examples and shows every result. "제출" runs the hidden tests too, stops at the first failure and
 * shows only that one test (the learner sees the case they failed, not the whole answer key).
 */
export async function submit(problemId: string, lang: Lang, code: string, mode: "example" | "submit", hints = 0): Promise<SubmitResult> {
  const problem = await readProblem(problemId);
  if (problem.kind === "blank" && code.includes(BLANK)) throw new CodeError(400, "빈칸(____)을 모두 채워 주세요.");
  const tests = mode === "example" ? problem.examples : [...problem.examples, ...problem.tests];
  const result = await judge(lang, code, tests, { timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, stopAtFirstFail: mode === "submit", compare: problem.compare, calibration: (await calibration()) ?? undefined });
  const shown = mode === "example" ? result.results : result.results.filter((r) => r.verdict !== "AC").slice(0, 1);
  const submission: Submission = { id: `sub_${randomBytes(5).toString("hex")}`, at: new Date().toISOString(), problemId, lang, mode, verdict: result.verdict,
    passed: result.passed, total: result.total, hints, code: code.slice(0, 100_000), ms: result.ms };
  if (result.verdict !== "MISSING") {
    await mkdir(root(), { recursive: true });
    await appendFile(submissionsFile(), JSON.stringify(submission) + "\n", "utf8");
  }
  return { ...result, submission, shown };
}
export async function runCustom(lang: Lang, code: string, input: string) { return runOnce(lang, code, input); }

/** 반례 찾기: inputs where the learner's program and the reference disagree, first one wins. */
export async function findCounterexample(problemId: string, lang: Lang, code: string, inputs: string[]) {
  const problem = await readProblem(problemId);
  if (!problem.reference) throw new CodeError(400, "이 문제에는 모범 풀이가 없어서 반례를 찾을 수 없어요.");
  const { tests } = await answerWithReference(problem.reference.code, inputs.slice(0, 30));
  if (!tests.length) return { found: false as const, tried: 0 };
  const result = await judge(lang, code, tests, { timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, stopAtFirstFail: true, compare: problem.compare, calibration: (await calibration()) ?? undefined });
  const bad = result.results.find((r) => r.verdict !== "AC");
  return bad ? { found: true as const, tried: result.results.length, case: bad, compile: result.compile } : { found: false as const, tried: tests.length, compile: result.compile };
}
