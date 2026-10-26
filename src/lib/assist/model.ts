// One door to the model for the new study tools (지식, 코드, 칼럼): the same signed-in ChatGPT account the question
// window uses (src/lib/ai/model.ts), with structured output when a shape is given.
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
export async function askText(purpose: string, system: string, user: string, options: AskOptions = {}) {
  const { model, effort } = settingsFor(options);
  const reply = await callModel({ purpose, system: clip(system, 12000), user: clip(user, 60000), model, effort, caller: options.caller ?? LOCAL_CALLER });
  return reply.text.trim();
}
export async function askJson<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>, options: AskOptions = {}): Promise<T> {
  const { model, effort } = settingsFor(options);
  const reply = await callModel({ purpose, system: clip(`${system}\n출력은 JSON으로만 한다.`, 12000), user: clip(user, 60000), json: true, schema, schemaName: `recaller_${purpose.replace(/\W+/g, "_")}`,
    model, effort, caller: options.caller ?? LOCAL_CALLER });
  return reply.data as T;
}
