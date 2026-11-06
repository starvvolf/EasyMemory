// 속도 체크 (2026-11-06 사용자 "모델 속도 체크, 원래 빨랐을 때보다 어느 정도로 나오는지"): 최근 호출 기록에서 모델별 첫 글자 시간과
// 출력 속도를 재고, 원하면 짧은 호출 한 번으로 지금 속도를 잰다. 기준은 10/30 실측(호출 5,403건, "Recaller AI 호출 가이드"):
// 첫 글자 약 3.4초, 출력 초당 terra 117 · sol 63 · luna 125 토큰. 출력 속도 = (출력 + 생각 토큰) ÷ (전체 − 첫 글자), 출력 50토큰 이상만.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { callModel } from "../ai/model.ts";
import { LOCAL_CALLER, logAssistCall } from "./model.ts";

export const SPEED_BASE: Record<string, { first: number; speed: number; label: string }> = {
  "gpt-6.1-terra": { first: 3.4, speed: 117, label: "terra" },
  "gpt-6-sol": { first: 3.4, speed: 63, label: "sol" },
  "gpt-6.1-sol": { first: 3.4, speed: 63, label: "sol 6.1" },
  "gpt-6-luna": { first: 3.4, speed: 125, label: "luna" },
};
export type SpeedSample = { at: string; model: string; ms: number; first: number; out: number; purpose: string };
export type SpeedRow = { model: string; label: string; base: { first: number; speed: number } | null; n: number; first: number | null; speed: number | null; lastAt: string | null };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Tokens per second while writing; null when the call is too short to say (the rule the 10/30 measurement used). */
export const writeSpeed = (s: Pick<SpeedSample, "ms" | "first" | "out">) => (s.out >= 50 && s.ms - s.first >= 300 ? s.out / ((s.ms - s.first) / 1000) : null);

/** Recent successful calls with timing and tokens: the assistant log and the PDF engine's call files (newest runs first). */
export async function recentSamples(limitRuns = 12): Promise<SpeedSample[]> {
  const out: SpeedSample[] = [];
  try {
    const lines = (await readFile(path.join(dataDir(), "assist-log.jsonl"), "utf8")).trim().split("\n").slice(-3000);
    for (const l of lines) {
      try { const x = JSON.parse(l); const t = x.tokens; if (!x.ok || !x.firstTextMs || !t) continue;
        out.push({ at: x.at, model: String(x.model ?? "?"), ms: Number(x.ms), first: Number(x.firstTextMs), out: Number(t.out ?? 0) + Number(t.reasoning ?? 0), purpose: String(x.purpose ?? "") }); } catch { /* 깨진 줄 */ }
    }
  } catch { /* 기록 없음 */ }
  const gen = path.join(dataDir(), "study-gen");
  try {
    const runs = (await readdir(gen)).filter((n) => n.startsWith("gen_"));
    const withTime = await Promise.all(runs.map(async (id) => ({ id, t: (await stat(path.join(gen, id)).catch(() => null))?.mtimeMs ?? 0 })));
    for (const { id } of withTime.sort((a, b) => b.t - a.t).slice(0, limitRuns)) {
      const dir = path.join(gen, id, "calls");
      for (const f of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"))) {
        try { const c = JSON.parse(await readFile(path.join(dir, f), "utf8")); const u = c.usage; if (!c.ok || !c.firstTextMs || !u) continue;
          out.push({ at: c.startedAt ?? "", model: String(c.model ?? "?"), ms: Number(c.ms), first: Number(c.firstTextMs), out: Number(u.outputTokens ?? 0) + Number(u.reasoningTokens ?? 0), purpose: String(c.step ?? "") }); } catch { /* 깨진 파일 */ }
      }
    }
  } catch { /* 엔진 기록 없음 */ }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Per model: the median of its last `take` calls (first text in seconds, writing speed in tokens/s) next to the base. */
export function speedRows(samples: SpeedSample[], take = 30): SpeedRow[] {
  const models = [...new Set(samples.map((s) => s.model))];
  return models.map((model) => {
    const mine = samples.filter((s) => s.model === model).slice(0, take);
    const speeds = mine.map(writeSpeed).filter((v): v is number => v !== null);
    const base = SPEED_BASE[model] ?? null;
    return { model, label: base?.label ?? model, base: base ? { first: base.first, speed: base.speed } : null, n: mine.length,
      first: median(mine.map((s) => s.first / 1000)), speed: median(speeds), lastAt: mine[0]?.at ?? null };
  }).sort((a, b) => Number(Boolean(b.base)) - Number(Boolean(a.base)) || b.n - a.n);
}

const PROBE_SYSTEM = "지시대로만 쓴다. 다른 말은 하지 않는다.";
const PROBE_USER = "1부터 120까지의 숫자를 한국어 이름(일, 이, 삼 …)으로 쉼표로 이어서 한 줄에 쓴다.";
/** One short streamed call to see the speed right now (about 300 output tokens, logged like any other call). */
export async function probeSpeed(model: string, effort = "low") {
  const t0 = Date.now(); let first = 0;
  const r = await callModel({ purpose: "speed-check", system: PROBE_SYSTEM, user: PROBE_USER, model, effort, caller: LOCAL_CALLER, onText: () => { first ||= Date.now() - t0; } });
  const ms = Date.now() - t0;
  const outTokens = Number(r.usage?.outputTokens ?? 0) + Number(r.usage?.reasoningTokens ?? 0);
  logAssistCall({ at: new Date(t0).toISOString(), purpose: "speed-check", model, effort, ms, firstTextMs: first || ms, ok: true, inChars: PROBE_USER.length, outChars: r.text.length,
    tokens: { in: r.usage?.inputTokens, cached: r.usage?.cachedInputTokens, out: r.usage?.outputTokens, reasoning: r.usage?.reasoningTokens } });
  const sample = { ms, first: first || ms, out: outTokens };
  return { model, ms, first: sample.first / 1000, out: outTokens, speed: writeSpeed(sample), base: SPEED_BASE[model] ?? null };
}
