// 훈련 모드 · 지켜보기 (2026-10-31, PS 루트 실험): the parts of "PS 훈련 모드" and "PS 창 지켜보기" that need no model.
// 훈련 모드 walks a problem in seven steps (이해 → 추상화 → 탐색 → 정당성 → 복잡도 → 구현 → 복기); the learner answers each
// step briefly and the app checks what code can check: the constraints, the reference's answer to an input the learner
// made, how many operations a complexity means at the largest N. 지켜보기 runs the examples and the largest hidden test
// on the code so far and says only what went wrong, never the test itself. Both are switched on per server
// (RECALLER_PS_TRAIN, RECALLER_PS_WATCH), so they run on the PS lab server first and the main app stays as it is.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { calibration } from "./calibrate.ts";
import { answerWithReference, CodeError, readProblem, readProblemMeta } from "./problems.ts";
import { judge, normalizeOutput, type Lang, type TestCase } from "./run.ts";

export const psLab = () => ({ train: process.env.RECALLER_PS_TRAIN === "1", watch: process.env.RECALLER_PS_WATCH === "1" });

/* ---------- 단계 기록: code/train/<id>.json ---------- */
export const STEPS = ["understand", "model", "approach", "correct", "complexity", "implement", "review"] as const;
export type Step = (typeof STEPS)[number];
export type StepRecord = { answer: Record<string, unknown>; result?: unknown; skipped?: boolean; at: string };
export type TrainState = { mode: "base" | "train"; steps: Partial<Record<Step, StepRecord>>; startedAt?: string };
const fileOf = (id: string) => {
  if (!/^cp_[a-z0-9_-]{3,40}$/.test(id)) throw new CodeError(400, "문제 ID가 올바르지 않아요.");
  return path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "train", `${id}.json`);
};
export async function readTrain(id: string): Promise<TrainState> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as TrainState; } catch { return { mode: "base", steps: {} }; }
}
async function writeTrain(id: string, state: TrainState) {
  const file = fileOf(id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 1), "utf8");
  await rename(tmp, file);
}
export async function setMode(id: string, mode: TrainState["mode"]) {
  await readProblemMeta(id);
  const state = await readTrain(id);
  await writeTrain(id, { ...state, mode, ...(mode === "train" && !state.startedAt ? { startedAt: new Date().toISOString() } : {}) });
  return readTrain(id);
}
export async function saveStep(id: string, step: Step, record: Omit<StepRecord, "at">) {
  const state = await readTrain(id);
  state.steps[step] = { ...record, at: new Date().toISOString() };
  await writeTrain(id, state);
  return state;
}
/** A finished attempt starts the next one from the first step; the answers stay readable as the last try. */
export async function resetSteps(id: string) {
  const state = await readTrain(id);
  if (!Object.keys(state.steps).length) return;
  await writeTrain(id, { mode: state.mode, steps: {} });
}

/* ---------- 제약 읽기 ---------- */
/** Every number in a constraints text: "1 ≤ N ≤ 100,000", "10^5", "10⁵", "2×10^5", "1e9". */
export function numbersIn(text: string): number[] {
  const sup: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  const t = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => sup[c]).join("")}`).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:[×x*·]\s*10\s*\^\s*(\d+)|e(\d+)|\s*\^\s*(\d+))?/gi;
  for (const m of t.matchAll(re)) {
    const base = Number(m[1]);
    const v = m[2] ? base * 10 ** Number(m[2]) : m[3] ? base * 10 ** Number(m[3]) : m[4] ? base ** Number(m[4]) : base;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/* ---------- T1 이해 ---------- */
export type UnderstandInput = { maxN?: number; timeSec?: number; output?: string; input?: string; myAnswer?: string };
export async function checkUnderstand(id: string, a: UnderstandInput) {
  const p = await readProblem(id);
  const text = [p.constraints, p.inputText].filter(Boolean).join("\n");
  const bounds = numbersIn(text);
  const n = a.maxN === undefined ? null
    : !bounds.length ? { ok: null, note: "문제에서 제약을 읽지 못해 확인하지 못했어요." }
    : bounds.includes(a.maxN) ? { ok: true, note: "맞아요." }
    : { ok: false, note: `문제의 제약을 다시 보세요: ${(p.constraints || p.inputText).split("\n").slice(0, 3).join(" · ")}` };
  const limit = p.timeLimitMs / 1000;
  const time = a.timeSec === undefined ? null : Math.abs(a.timeSec - limit) < 0.01 ? { ok: true, note: "맞아요." } : { ok: false, note: `시간 제한은 ${limit}초예요.` };
  let mine: null | { ok: boolean | null; expected?: string; note: string } = null;
  if (a.input?.trim()) {
    if (!p.reference) mine = { ok: null, note: "이 문제에는 모범 풀이가 없어 정답을 계산할 수 없어요." };
    else {
      const { tests, dropped } = await answerWithReference(p.reference.code, [withNewline(a.input)]);
      if (!tests.length) mine = { ok: null, note: `이 입력은 문제의 입력 형식과 다른 것 같아요 (모범 풀이가 답하지 못함${dropped[0]?.why ? `: ${dropped[0].why.slice(0, 80)}` : ""}).` };
      else {
        const expected = tests[0].output;
        const same = a.myAnswer !== undefined && normalizeOutput(a.myAnswer) === expected;
        mine = { ok: a.myAnswer === undefined ? null : same, expected, note: a.myAnswer === undefined ? "모범 풀이의 답이에요." : same ? "내 답과 같아요." : "내 답과 달라요. 문제를 다르게 읽었을 수 있어요." };
      }
    }
  }
  return { n, time, mine };
}
const withNewline = (s: string) => (s.endsWith("\n") ? s : `${s}\n`);

/* ---------- T3 · T5 복잡도 ---------- */
export const COMPLEXITIES: Record<string, (n: number) => number> = {
  "1": () => 1, "log n": (n) => Math.log2(Math.max(2, n)), "n": (n) => n, "n log n": (n) => n * Math.log2(Math.max(2, n)),
  "n√n": (n) => n * Math.sqrt(n), "n²": (n) => n * n, "n² log n": (n) => n * n * Math.log2(Math.max(2, n)), "n³": (n) => n ** 3,
  "2ⁿ": (n) => 2 ** Math.min(n, 1100), "n!": (n) => { let f = 1; for (let i = 2; i <= Math.min(n, 200); i++) f *= i; return f; },
};
/** Operations at the largest N against about 10^8 simple operations a second: 넉넉 (≤30%) · 아슬 (≤100%) · 안 됨. */
export function complexityVerdict(expr: string, n: number, timeLimitMs: number) {
  const f = COMPLEXITIES[expr];
  if (!f) throw new CodeError(400, "모르는 복잡도예요.");
  const ops = f(n), budget = 1e8 * (timeLimitMs / 1000), ratio = ops / budget;
  const level = ratio <= 0.3 ? "넉넉" : ratio <= 1 ? "아슬" : "안 됨";
  return { expr, n, ops, budget, ratio, level, note: `n = ${n.toLocaleString()}이면 약 ${sci(ops)}번, 제한 ${timeLimitMs / 1000}초에 할 수 있는 양(약 ${sci(budget)}번)의 ${ratio < 0.01 ? "1% 미만" : ratio > 100 ? "100배 넘음" : `${Math.round(ratio * 100)}%`} → ${level}` };
}
const sci = (x: number) => (!Number.isFinite(x) || x >= 1e15 ? `10^${Number.isFinite(x) ? Math.floor(Math.log10(x)) : "300+"}` : x >= 1e5 ? `${(x / 10 ** Math.floor(Math.log10(x))).toFixed(1)}×10^${Math.floor(Math.log10(x))}` : Math.round(x).toLocaleString());
/** The largest N for a problem: the learner's answer in step 1 when it was right, else the largest number in the constraints that is small enough to be a size. */
export async function sizeOf(id: string) {
  const step = (await readTrain(id)).steps.understand;
  const given = step?.answer.maxN;
  if (typeof given === "number" && given > 0) return given;
  const p = await readProblemMeta(id);
  const sizes = numbersIn(p.constraints ?? "").filter((v) => Number.isInteger(v) && v >= 1 && v <= 1e7);
  return sizes.length ? Math.max(...sizes) : null;
}

/* ---------- T4 · T6 내 입력 ---------- */
/** The reference's answers to inputs the learner made (their own inputs, so the answers may be shown), and the learner's code on them. */
export async function tryInputs(id: string, inputs: string[], code?: { lang: Lang; code: string }) {
  const p = await readProblem(id);
  if (!p.reference) throw new CodeError(400, "이 문제에는 모범 풀이가 없어서 정답을 계산할 수 없어요.");
  const asked = inputs.map((x) => x.trim()).filter(Boolean).slice(0, 8).map(withNewline);
  const rows: Array<{ input: string; expected?: string; got?: string; verdict?: string; note?: string }> = [];
  const answered: TestCase[] = [];
  for (const input of asked) {
    const { tests } = await answerWithReference(p.reference.code, [input]);
    if (tests.length) { answered.push(tests[0]); rows.push({ input, expected: tests[0].output }); }
    else rows.push({ input, note: "입력 형식이 문제와 다른 것 같아요." });
  }
  if (code && answered.length) {
    const j = await judge(code.lang, code.code, answered, { timeLimitMs: p.timeLimitMs, memoryLimitMb: p.memoryLimitMb, compare: p.compare, calibration: (await calibration()) ?? undefined });
    if (j.compile) return { rows, compile: j.compile };
    let k = 0;
    for (const row of rows) if (row.expected !== undefined) { const r = j.results[k++]; if (r) { row.got = r.got; row.verdict = r.verdict; } }
  }
  return { rows };
}

/* ---------- 지켜보기 W2: 예제와 가장 큰 테스트 ---------- */
export type QuickCheck = { state: "quiet" | "ok" | "warn"; what?: "예제" | "시간" | "멈춤" | "메모리" | "큰 입력"; say?: string; facts: { examples?: string; big?: string } };
/** Nothing is recorded and no test is shown: only what went wrong, in a sentence. A compile error means "still typing". */
export async function quickCheck(id: string, lang: Lang, code: string): Promise<QuickCheck> {
  const p = await readProblem(id);
  const cal = (await calibration()) ?? undefined;
  const opts = { timeLimitMs: p.timeLimitMs, memoryLimitMb: p.memoryLimitMb, compare: p.compare, calibration: cal };
  const ex = await judge(lang, code, p.examples, opts);
  if (ex.verdict === "CE" || ex.verdict === "MISSING") return { state: "quiet", facts: {} };
  const exFact = `예제 ${ex.passed}/${ex.total}`;
  const bad = ex.results.find((r) => r.verdict !== "AC");
  if (bad) return { state: "warn", what: "예제", say: `예제 ${bad.index + 1}이 ${bad.verdict === "WA" ? "다르게 나와요" : bad.verdict === "TLE" ? "시간 안에 끝나지 않아요" : "실행 중에 멈춰요"}.`, facts: { examples: exFact } };
  const biggest = p.tests.reduce<TestCase | null>((a, t) => (!a || t.input.length > a.input.length ? t : a), null);
  if (!biggest) return { state: "ok", facts: { examples: exFact } };
  const big = await judge(lang, code, [biggest], opts);
  const v = big.results[0]?.verdict ?? big.verdict;
  const facts = { examples: exFact, big: v };
  if (v === "TLE") return { state: "warn", what: "시간", say: "입력이 가장 클 때 시간 안에 끝나지 않을 것 같아요.", facts };
  if (v === "MLE") return { state: "warn", what: "메모리", say: "입력이 가장 클 때 메모리를 너무 많이 써요.", facts };
  if (v === "RE") return { state: "warn", what: "멈춤", say: "입력이 가장 클 때 실행 중에 멈춰요 (재귀 깊이나 배열 범위를 보세요).", facts };
  if (v === "WA") return { state: "warn", what: "큰 입력", say: "입력이 가장 클 때 답이 달라요.", facts };
  return { state: "ok", facts };
}
