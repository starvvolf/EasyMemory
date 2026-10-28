// One door to the model for the new study tools (지식, 코드, 칼럼): the same signed-in ChatGPT account the question
// window uses (src/lib/ai/model.ts), with structured output when a shape is given.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { callModel, type ModelCaller } from "../ai/model.ts";

export const LOCAL_CALLER: ModelCaller = { uid: "local-experiment" };
const str = { type: "string" } as const;
export const S = {
  str,
  int: { type: "integer" } as const,
  arr: (items: unknown) => ({ type: "array", items }),
  obj: (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties }),
  oneOf: (...values: string[]) => ({ type: "string", enum: values }),
};
export function assistSettings(heavy = false) {
  return {
    model: process.env.RECALLER_ASSIST_MODEL?.trim() || process.env.STUDY_FORGE_NOTE_MODEL?.trim() || process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol",
    effort: heavy ? process.env.RECALLER_ASSIST_HEAVY_EFFORT?.trim() || "medium" : process.env.RECALLER_ASSIST_EFFORT?.trim() || "low",
  };
}
const clip = (text: string, n: number) => text.length > n ? `${text.slice(0, n)}\n…(이하 생략)` : text;

type AskOptions = { heavy?: boolean; caller?: ModelCaller; /** this call only: a model and effort other than the assist settings */ model?: string; effort?: string };
const settingsFor = (options: AskOptions) => { const s = assistSettings(options.heavy); return { model: options.model || s.model, effort: options.effort || s.effort }; };
/** 걸린 시간 기록 (2026-10-29, 시연 시간 재기): one line per call in <data>/assist-log.jsonl — what for, which model, how long. */
// firstTextMs: when the answer began to come (before it, the model was thinking); tokens as the model reports them.
type Usage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
async function timed<T extends { usage?: Usage }>(purpose: string, model: string, effort: string, inChars: number, run: (onText: () => void) => Promise<T>, outChars: (r: T) => number): Promise<T> {
  const started = Date.now();
  let ok = false, out = 0, first = 0, usage: Usage | undefined;
  try { const r = await run(() => { if (!first) first = Date.now(); }); ok = true; out = outChars(r); usage = r.usage; return r; }
  finally {
    const line = { at: new Date(started).toISOString(), purpose, model, effort, ms: Date.now() - started, ...(first ? { firstTextMs: first - started } : {}), ok, inChars, outChars: out,
      ...(usage ? { tokens: { in: usage.inputTokens, cached: usage.cachedInputTokens, out: usage.outputTokens, reasoning: usage.reasoningTokens } } : {}) };
    const file = path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "assist-log.jsonl");
    void mkdir(path.dirname(file), { recursive: true }).then(() => appendFile(file, JSON.stringify(line) + "\n", "utf8")).catch(() => undefined);
  }
}
export async function askText(purpose: string, system: string, user: string, options: AskOptions = {}) {
  const { model, effort } = settingsFor(options);
  const reply = await timed(purpose, model, effort, system.length + user.length,
    (onText) => callModel({ purpose, system: clip(system, 12000), user: clip(user, 60000), model, effort, caller: options.caller ?? LOCAL_CALLER, onText }), (r) => r.text.length);
  return reply.text.trim();
}
export async function askJson<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>, options: AskOptions = {}): Promise<T> {
  const { model, effort } = settingsFor(options);
  const reply = await timed(purpose, model, effort, system.length + user.length,
    (onText) => callModel({ purpose, system: clip(`${system}\n출력은 JSON으로만 한다.`, 12000), user: clip(user, 60000), json: true, schema, schemaName: `recaller_${purpose.replace(/\W+/g, "_")}`,
      model, effort, caller: options.caller ?? LOCAL_CALLER, onText }), (r) => JSON.stringify(r.data ?? "").length);
  return reply.data as T;
}
