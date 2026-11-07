// 실험실 "이 호출만 다시" (2026-11-07 사용자 "출력을 저장해 놨다가 처음부터 다시 부르지 않고, 중간 단계에서 지시문을 바꾼 상태로
// AI 한 번으로 체크" → "아예 바꾸는 게 아니라 데이터 남겨서 비교 가능하게"): 저장된 호출 하나의 넣은 것을 그대로 두고 지시문·넣은 것·
// 모델·강도 중 바꾼 것으로 한 번 부른다. 제품의 지시문은 바꾸지 않는다. 시도마다 <data>/lab/trials/<원래 호출 열쇠>.jsonl에 남겨
// 원래와 시도들을 나란히 본다. 그림이 같이 갔던 호출은 그림 없이 간다(기록에 그림이 없음 — 화면에 알림).
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { callModel, type ModelCaller, type ModelRequest } from "./model.ts";
import { costOf } from "./prices.ts";
import { newCallId } from "./trace.ts";

export type TrialBase = { kind: "gen"; genId: string; n: number } | { kind: "call"; id: string };
export type Trial = {
  id: string; at: string; base: TrialBase; step: string; note: string;
  system: string; user: string; model: string; effort: string; json: boolean;
  /** 쪽 그림을 같이 보낸 시도(11/8): 그 쪽 번호들(그림 자체는 남기지 않는다) */ pages?: number[];
  ok: boolean; error?: string; reply: string; ms: number; firstTextMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }; cost: number | null;
};
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
export const baseKey = (b: TrialBase) => (b.kind === "gen" ? `gen_${b.genId.replace(/^gen_/, "")}_${b.n}` : `call_${b.id}`).replace(/[^\w-]/g, "");
const file = (b: TrialBase) => path.join(dataDir(), "lab", "trials", `${baseKey(b)}.jsonl`);

export async function listTrials(base: TrialBase): Promise<Trial[]> {
  const text = await readFile(file(base), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as Trial; } catch { return null; } }).filter((x): x is Trial => !!x);
}

const caller: ModelCaller = { uid: "local-experiment" };
export async function runTrial(input: { base: TrialBase; step: string; note?: string; system: string; user: string; model: string; effort: string; json: boolean;
  images?: ModelRequest["images"]; pages?: number[] }): Promise<Trial> {
  const started = Date.now();
  let first = 0;
  const t: Trial = { id: newCallId(), at: new Date(started).toISOString(), base: input.base, step: input.step, note: (input.note ?? "").slice(0, 300),
    system: input.system, user: input.user, model: input.model, effort: input.effort, json: input.json, ...(input.pages?.length ? { pages: input.pages } : {}), ok: false, reply: "", ms: 0, cost: null };
  try {
    const r = await callModel({ purpose: `lab:trial:${input.step}`, system: input.system, user: input.user, model: input.model, effort: input.effort,
      ...(input.json ? { json: true } : {}), ...(input.images?.length ? { images: input.images } : {}), caller, onText: () => { if (!first) first = Date.now(); } });
    t.ok = true;
    t.reply = input.json && r.data !== undefined ? JSON.stringify(r.data, null, 1) : r.text;
    t.usage = r.usage;
  } catch (e) { t.error = (e as Error)?.message?.slice(0, 500) ?? String(e); }
  t.ms = Date.now() - started; if (first) t.firstTextMs = first - started;
  t.cost = costOf(t.model, t.usage);
  await mkdir(path.dirname(file(input.base)), { recursive: true });
  await appendFile(file(input.base), JSON.stringify(t) + "\n", "utf8");
  return t;
}

// 지시문 조각의 버전 (11/7 사용자 "폴더 같은 버튼 — 이전 지시문 버전 정리"): 실험실 상자에서 조각을 고치고 [완료]를 누를 때마다
// <data>/lab/prompt-versions/<조각 열쇠>.jsonl에 한 줄. 제품 지시문은 바꾸지 않는다(시도에 쓰는 초안의 기록).
export type PromptVersion = { id: string; at: string; key: string; step: string; label: string; text: string; note: string };
const vfile = (key: string) => path.join(dataDir(), "lab", "prompt-versions", `${key.replace(/[^\w:#.-]/g, "_").replace(/[:#]/g, "-").slice(0, 120)}.jsonl`);
export async function listPromptVersions(key: string): Promise<PromptVersion[]> {
  const text = await readFile(vfile(key), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as PromptVersion; } catch { return null; } }).filter((x): x is PromptVersion => !!x);
}
export async function savePromptVersion(v: { key: string; step: string; label: string; text: string; note?: string }): Promise<PromptVersion> {
  const row: PromptVersion = { id: newCallId(), at: new Date().toISOString(), key: v.key, step: v.step, label: v.label, text: v.text, note: (v.note ?? "").slice(0, 200) };
  await mkdir(path.dirname(vfile(v.key)), { recursive: true });
  await appendFile(vfile(v.key), JSON.stringify(row) + "\n", "utf8");
  return row;
}
