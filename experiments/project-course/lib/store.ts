// 진도·대화·기록 후보 저장. 모두 experiments/project-course/.data/ 아래 파일(깃에 안 올라감).
// 실제 지식 저장소(src/lib/knowledge)에는 쓰지 않는다. 최종에 붙일 때 records를 knowledge/api.ts로 넘긴다.
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./course.ts";

export const DATA = process.env.PC_DATA_DIR ? path.resolve(process.env.PC_DATA_DIR) : path.join(ROOT, ".data");
export const WORKSPACES = process.env.PC_WORKSPACES ? path.resolve(process.env.PC_WORKSPACES) : path.join(DATA, "workspaces");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}
const queues = new Map<string, Promise<unknown>>();
/** 같은 파일에 대한 읽기-고치기-쓰기를 차례로. */
export function update<T>(file: string, fallback: T, fn: (value: T) => T | void): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    const value = await readJson(file, fallback);
    const out = (fn(value) ?? value) as T;
    await mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, JSON.stringify(out, null, 1));
    return out;
  });
  queues.set(file, next.catch(() => undefined));
  return next;
}
export const read = readJson;

/**
 * 임시 파일에 쓰고 바꿔치기. Windows는 다른 곳(화면이 보내는 읽기, 백신)이 파일을 잠깐 열고 있으면
 * 바꿔치기를 EPERM/EBUSY/EACCES로 거절한다 → 조금 기다렸다 다시, 끝내 안 되면 직접 덮어쓴다.
 */
export async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, text);
  for (let i = 0; i < 8; i++) {
    try { await rename(tmp, file); return; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
  await writeFile(file, text);
  await rm(tmp, { force: true }).catch(() => {});
}

/* ---------- 진도 ---------- */
export type StageProgress = {
  startedAt?: string;
  predict: Record<string, { choice: number; correct: boolean; at: string }>;
  observedAt?: string;
  hints: { level: number; at: string; source: string }[];
  runs: { at: string; passed: number; failed: number; stageOk: boolean }[];
  explain?: { text: string; at: string };
  doneAt?: string;
  independent?: boolean;
  skipped?: boolean;
};
export type Plan = { start: number; stages: number[]; quick: number[]; transfer: boolean; reasons: string[]; notes: string[]; minutes: number };
export type Run = {
  id: string; courseId: string; createdAt: string; intakeId?: string; profile?: Record<string, unknown>;
  plan: Plan; current: number; workspaces: Record<string, string>; stages: Record<string, StageProgress>;
};
type RunsFile = { runs: Run[]; active?: string };
const RUNS = () => path.join(DATA, "runs.json");

export const runs = () => read<RunsFile>(RUNS(), { runs: [] });
export async function getRun(id: string) {
  const r = (await runs()).runs.find((x) => x.id === id);
  if (!r) throw Object.assign(new Error("진행 기록을 찾지 못했어요."), { status: 404 });
  return r;
}
export async function saveRun(id: string, fn: (run: Run) => void) {
  let out: Run | undefined;
  await update<RunsFile>(RUNS(), { runs: [] }, (f) => {
    const r = f.runs.find((x) => x.id === id);
    if (!r) throw Object.assign(new Error("진행 기록을 찾지 못했어요."), { status: 404 });
    fn(r);
    out = r;
  });
  return out!;
}
export async function addRun(run: Run) {
  await update<RunsFile>(RUNS(), { runs: [] }, (f) => { f.runs.push(run); f.active = run.id; });
  return run;
}
export async function setActive(id: string) { await update<RunsFile>(RUNS(), { runs: [] }, (f) => { f.active = id; }); }
export const stageProgress = (run: Run, n: number): StageProgress => (run.stages[String(n)] ??= { predict: {}, hints: [], runs: [] });

/* ---------- 학습 기록 후보 ---------- */
// kind는 지식 저장소의 KEventKind(src/lib/knowledge/store.ts)와 같은 말을 쓴다: met·asked·wrong·hint·correct·note.
export type Candidate = {
  at: string; runId: string; course: string; stage: number;
  knowledgeId: string; knowledgeName: string;
  kind: "met" | "asked" | "wrong" | "hint" | "correct" | "note";
  detail: string;
  evidence: { activity: "start" | "predict" | "hint" | "check" | "explain" | "skip" | "transfer"; independent: boolean };
  source: { kind: "project"; title: string; ref: string };
  /** 지식 저장소에 붙일 때 쓸 종류·주제 힌트(문법은 어휘 vocab, 2026-10-28 사용자 결정) */
  knowledgeKind?: "concept" | "procedure" | "fact" | "formula" | "vocab";
  topic?: string;
};
export const recordsFile = (runId: string) => path.join(DATA, "records", `${runId}.jsonl`);
export async function addCandidates(list: Candidate[]) {
  if (!list.length) return;
  const file = recordsFile(list[0].runId);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, list.map((c) => JSON.stringify(c)).join("\n") + "\n");
}
export async function candidates(runId: string): Promise<Candidate[]> {
  try {
    return (await readFile(recordsFile(runId), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}
