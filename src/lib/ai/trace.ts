// AI 호출 실험실의 바탕 (2026-11-06 사용자 "통합으로 AI 호출하는 부분을 관리하는 실험실, 만들어서 쓸 거야"):
// 1) 호출이 어느 일(알고리즘 문제·동작)에서 나왔는지 — API가 withTrace로 감싸고, 안쪽 함수가 tagTrace로 문제 id를 붙인다.
//    AsyncLocalStorage라 뒤에서 이어 도는 일(문제 준비 등)도 같은 표시를 갖는다.
// 2) 호출 한 번의 입력·출력 원문 — <data>/ai-calls/날짜.jsonl, 칸마다 4만 자까지. 강의 내용이 들어가므로 이 PC에만 둔다
//    (RecallerData .gitignore에 ai-calls/). 끄기: RECALLER_AI_CALLS=0.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TraceCtx = { area: string; action?: string; ref?: string };
const store = new AsyncLocalStorage<TraceCtx>();
export function withTrace<T>(ctx: TraceCtx, fn: () => T): T { return store.run({ ...ctx }, fn); }
/** 지금 일에 표시를 더한다(문제 id 등). 감싼 일이 없으면 아무것도 안 한다. */
export function tagTrace(more: Partial<TraceCtx>) { const c = store.getStore(); if (c) Object.assign(c, Object.fromEntries(Object.entries(more).filter(([, v]) => v))); }
export function currentTrace(): TraceCtx | undefined { const c = store.getStore(); return c ? { ...c } : undefined; }

export type CallRecord = {
  id: string; at: string; purpose: string; model: string; effort: string;
  ms: number; firstTextMs?: number; ok: boolean; error?: string;
  tokens?: { in?: number; cached?: number; out?: number; reasoning?: number };
  trace?: TraceCtx; format?: string;
  system: string; user: string; reply: string;
};
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const dir = () => path.join(dataDir(), "ai-calls");
const CAP = 40_000;
const cap = (s: string) => (s.length > CAP ? `${s.slice(0, CAP)}\n…(${s.length - CAP}자 더)` : s);
let seq = 0;
export function newCallId() { seq = (seq + 1) % 1e6; return `${Date.now().toString(36)}${seq.toString(36).padStart(3, "0")}`; }

export function recordCall(r: CallRecord) {
  if (process.env.RECALLER_AI_CALLS === "0") return;
  const line = JSON.stringify({ ...r, system: cap(r.system), user: cap(r.user), reply: cap(r.reply) }) + "\n";
  const file = path.join(dir(), `${r.at.slice(0, 10)}.jsonl`);
  void mkdir(dir(), { recursive: true }).then(() => appendFile(file, line, "utf8")).catch(() => undefined);
}

/** 최근 호출들(새것부터). 원문 없이 요약만(full=false) 또는 원문까지. days: 며칠 치 파일을 볼지. */
export async function readCalls(opts: { area?: string; ref?: string; since?: string; limit?: number; days?: number; full?: boolean; id?: string } = {}) {
  let names: string[] = [];
  try { names = (await readdir(dir())).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().reverse().slice(0, opts.days ?? 3); } catch { return []; }
  const out: CallRecord[] = [];
  const limit = opts.limit ?? 300;
  for (const n of names) {
    const text = await readFile(path.join(dir(), n), "utf8").catch(() => "");
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      let r: CallRecord; try { r = JSON.parse(lines[i]); } catch { continue; }
      if (opts.id && r.id !== opts.id) continue;
      if (opts.since && r.at <= opts.since) continue;
      const area = r.trace?.area ?? r.purpose.split(":")[0];
      if (opts.area && area !== opts.area) continue;
      if (opts.ref && r.trace?.ref !== opts.ref) continue;
      out.push(opts.full || opts.id ? r : { ...r, system: "", user: r.user.slice(0, 300), reply: r.reply.slice(0, 300) });
    }
    if (out.length >= limit) break;
  }
  return out;
}
