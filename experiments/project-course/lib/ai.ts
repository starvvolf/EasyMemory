// AI 호출: 앱과 같은 ChatGPT 로그인을 쓴다(src/lib/assist/model.ts를 읽기만 하고 고치지 않는다).
// 호출 수는 .data/ai-usage.json에 센다. 한도는 10/30 사용자 결정으로 없음(PC_AI_LIMIT을 주면 그만큼).
// AI는 판정하지 않는다: 코스 고르기 대화와 힌트·설명만 한다.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./course.ts";
import { DATA, read, update } from "./store.ts";
import { logAnswer, logPrompt, logUsage } from "./promptlog.ts";

const APP_ROOT = path.resolve(ROOT, "..", "..");
// 사용자 결정 10/30: 한도 없음(호출 수는 계속 센다). 필요하면 PC_AI_LIMIT으로만 제한
export const AI_LIMIT = process.env.PC_AI_LIMIT ? Number(process.env.PC_AI_LIMIT) : Infinity;
const USAGE = () => path.join(DATA, "ai-usage.json");
type Usage = { count: number; calls: { at: string; purpose: string; ok: boolean; note?: string }[] };

export class AiUnavailable extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function aiMode(): "off" | "fake" | "app" {
  if (process.env.PC_FAKE_AI === "1") return "fake";
  if (process.env.PC_AI === "off") return "off";
  return existsSync(path.join(APP_ROOT, "src", "lib", "assist", "model.ts")) ? "app" : "off";
}
export async function aiStatus() {
  const u = await read<Usage>(USAGE(), { count: 0, calls: [] });
  return { mode: aiMode(), used: u.count, limit: Number.isFinite(AI_LIMIT) ? AI_LIMIT : null };
}

type Assist = {
  askText: (purpose: string, system: string, user: string, options?: { heavy?: boolean }) => Promise<string>;
  askJson: <T>(purpose: string, system: string, user: string, schema: Record<string, unknown>, options?: { heavy?: boolean }) => Promise<T>;
};
let assist: Promise<Assist> | null = null;
function loadAssist(): Promise<Assist> {
  // 앱 서버(3000)와 같은 로그인 기록·암호화 키를 쓴다. 이미 설정돼 있으면 그대로.
  process.env.STUDY_FORGE_AUTH_DIR ||= path.join(APP_ROOT, ".study-forge-data");
  if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
    const file = path.join(homedir(), ".study-forge", "chatgpt-token-key");
    if (existsSync(file)) {
      const key = readFileSync(file, "utf8").trim();
      if (/^[a-f0-9]{64}$/i.test(key)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = key;
    }
  }
  process.env.STUDY_FORGE_MODEL_PROVIDER ||= "chatgpt";
  assist ??= import(pathToFileURL(path.join(APP_ROOT, "src", "lib", "assist", "model.ts")).href) as Promise<Assist>;
  return assist;
}

/** OpenCode 엔진용: 앱과 같은 ChatGPT 로그인의 지금 쓸 수 있는 접근 토큰(갱신 포함). 메모리에서만 쓴다. */
export async function chatGptBearer(): Promise<string> {
  await loadAssist();
  const auth = await import(pathToFileURL(path.join(APP_ROOT, "src", "lib", "ai", "chatgpt-auth.ts")).href) as { chatGptAccessToken: (uid: string) => Promise<string> };
  const assistMod = await import(pathToFileURL(path.join(APP_ROOT, "src", "lib", "assist", "model.ts")).href) as { LOCAL_CALLER: { uid: string } };
  try { return await auth.chatGptAccessToken(assistMod.LOCAL_CALLER.uid); }
  catch (error) { throw explain(error); }
}
/** 다른 엔진(OpenCode)이 부른 AI 호출도 같은 한도에 센다. */
export async function aiBudget(purpose: string) { if (aiMode() === "app") await budget(purpose); }
export async function countCalls(purpose: string, n: number, ok = true) {
  if (aiMode() !== "app" || n <= 0) return;
  await update<Usage>(USAGE(), { count: 0, calls: [] }, (u) => { u.count += n; u.calls.push({ at: new Date().toISOString(), purpose, ok, note: n > 1 ? `${n}회` : undefined }); });
}

let fakeReply: ((purpose: string, user: string) => unknown) | null = null;
/** 테스트용: 호출 없이 정해 둔 답. */
export function setFakeAi(fn: typeof fakeReply) { fakeReply = fn; }

async function budget(purpose: string) {
  const u = await read<Usage>(USAGE(), { count: 0, calls: [] });
  if (u.count >= AI_LIMIT) throw new AiUnavailable("budget", `이 실험의 AI 호출 한도(${AI_LIMIT}회)를 다 썼어요. 준비된 힌트·대본으로 계속할 수 있어요. 더 쓰려면 PC_AI_LIMIT을 올려 다시 켜 주세요.`);
  void purpose;
}
async function count(purpose: string, ok: boolean, note?: string) {
  await update<Usage>(USAGE(), { count: 0, calls: [] }, (u) => { u.count += 1; u.calls.push({ at: new Date().toISOString(), purpose, ok, note }); });
}
function explain(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === "login_required") return new AiUnavailable(code, "ChatGPT 로그인이 필요해요. Recaller 앱(3000)에서 로그인한 뒤 다시 해 주세요.");
  if (code === "usage_limit") return new AiUnavailable(code, "ChatGPT 사용량 한도에 닿았어요.");
  if (code === "not_configured") return new AiUnavailable(code, "AI 연결 설정이 없어요(암호화 키 등).");
  return new AiUnavailable("transient", `AI 호출이 실패했어요: ${(error as Error).message}`);
}

export async function aiJson<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>, heavy = false): Promise<T> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailable("off", "AI를 끈 상태예요.");
  if (mode === "fake") { if (!fakeReply) throw new AiUnavailable("off", "가짜 AI 답이 없어요."); void logPrompt(`fake-${purpose}`, { purpose, system, user }); return fakeReply(purpose, user) as T; }
  await budget(purpose);
  try {
    const log = await logPrompt(purpose, { purpose, heavy, system, user, schema });
    const t0 = Date.now();
    const out = await (await loadAssist()).askJson<T>(`project-course:${purpose}`, system, user, schema, { heavy });
    await logAnswer(log, out);
    void logUsage({ kind: purpose, ms: Date.now() - t0, calls: 1, chars: system.length + user.length, prompt: log });
    await count(purpose, true);
    return out;
  } catch (error) {
    if (error instanceof AiUnavailable) throw error;
    const e = explain(error);
    // 로그인·설정 문제로 모델까지 못 간 것은 세지 않는다.
    if (e.code === "transient" || e.code === "usage_limit") await count(purpose, false, e.message);
    throw e;
  }
}
export async function aiText(purpose: string, system: string, user: string, heavy = false): Promise<string> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailable("off", "AI를 끈 상태예요.");
  if (mode === "fake") { if (!fakeReply) throw new AiUnavailable("off", "가짜 AI 답이 없어요."); return String(fakeReply(purpose, user)); }
  await budget(purpose);
  try {
    const log = await logPrompt(purpose, { purpose, heavy, system, user });
    const t0 = Date.now();
    const out = await (await loadAssist()).askText(`project-course:${purpose}`, system, user, { heavy });
    await logAnswer(log, out);
    void logUsage({ kind: purpose, ms: Date.now() - t0, calls: 1, chars: system.length + user.length, prompt: log });
    await count(purpose, true);
    return out;
  } catch (error) {
    if (error instanceof AiUnavailable) throw error;
    const e = explain(error);
    if (e.code === "transient" || e.code === "usage_limit") await count(purpose, false, e.message);
    throw e;
  }
}

/** 시험용(11/8 lab 평가): 이 호출만 모델 · 강도를 바꿔 부른다. 제품 흐름에서는 쓰지 않는다 */
export async function aiWith(purpose: string, system: string, user: string, opts: { model?: string; effort?: string; schema?: Record<string, unknown> }): Promise<{ out: unknown; ms: number }> {
  if (aiMode() !== "app") throw new AiUnavailable("off", "평가는 실제 AI(로그인)에서만 돌아요.");
  await budget(purpose);
  const a = await loadAssist() as unknown as { askText: (p: string, s: string, u: string, o: object) => Promise<string>; askJson: (p: string, s: string, u: string, sc: object, o: object) => Promise<unknown> };
  const t0 = Date.now();
  const o = { ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}) };
  try {
    const out = opts.schema ? await a.askJson(`project-course:${purpose}`, system, user, opts.schema, o) : await a.askText(`project-course:${purpose}`, system, user, o);
    await count(purpose, true);
    return { out, ms: Date.now() - t0 };
  } catch (e) { await count(purpose, false, (e as Error).message); throw explain(e); }
}

/** 구조화 출력용 스키마 도우미(앱의 S와 같은 꼴). */
export const S = {
  str: { type: "string" } as const,
  int: { type: "integer" } as const,
  bool: { type: "boolean" } as const,
  arr: (items: unknown) => ({ type: "array", items }),
  obj: (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties }),
  oneOf: (...values: string[]) => ({ type: "string", enum: values }),
};
