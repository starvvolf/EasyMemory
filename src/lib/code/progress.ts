// 가져오기 · 만들기 진행 상황(11/16 사용자 "가져오는 과정 뭐하고 있는지 보이게"): 화면이 정한 job 하나에 단계 문장을 쌓고, 화면은 짧게 물어 읽는다.
// 단계를 적는 곳(intake · source · makeProblem · checkDraft)은 job을 몰라도 된다: AsyncLocalStorage가 요청 흐름을 따라 job을 들고 간다.
import { AsyncLocalStorage } from "node:async_hooks";

type Step = { at: number; text: string };
type Job = { started: number; steps: Step[]; done: boolean };
const g = globalThis as unknown as { __codeProgress?: Map<string, Job> };
const jobs = (g.__codeProgress ??= new Map<string, Job>());
const store = new AsyncLocalStorage<string>();
const KEEP_MS = 15 * 60_000;

export const jobId = /^[a-z0-9-]{8,64}$/;

export async function withProgress<T>(job: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!job) return fn();
  for (const [k, v] of jobs) if (Date.now() - v.started > KEEP_MS) jobs.delete(k);
  if (!jobs.has(job)) jobs.set(job, { started: Date.now(), steps: [], done: false });
  try { return await store.run(job, fn); } finally { const j = jobs.get(job); if (j) j.done = true; }
}

/** 지금 요청의 진행 단계 한 줄(쉬운 말, 해요체). job이 없는 요청에서는 아무것도 안 한다. */
export function note(text: string) {
  const id = store.getStore(); if (!id) return;
  const j = jobs.get(id); if (!j) return;
  if (j.steps.at(-1)?.text === text) return;
  j.steps.push({ at: Date.now(), text: text.slice(0, 200) });
  if (j.steps.length > 60) j.steps.splice(0, j.steps.length - 60);
}

export function readProgress(job: string) {
  const j = jobs.get(job);
  if (!j) return { steps: [] as Array<{ sec: number; text: string }>, done: false };
  return { steps: j.steps.map((s) => ({ sec: Math.round((s.at - j.started) / 1000), text: s.text })), done: j.done };
}
