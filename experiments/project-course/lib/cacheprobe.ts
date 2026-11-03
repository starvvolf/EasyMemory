// 캐시 원인 확인(11/3): 튜터가 실제로 보낸 마지막 본문을 같은 ChatGPT 로그인으로 그대로·조금씩 바꿔 두 번씩 보내
// 두 번째 호출의 캐시 읽기 토큰을 본다. 로컬에서만, 사람이 부를 때만(질문 1번 크기 × 변형 수 × 2번의 AI 사용량).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chatGptBearer } from "./ai.ts";
import { DATA } from "./store.ts";
import { logUsage } from "./promptlog.ts";

type Body = Record<string, unknown>;
const VARIANTS: Record<string, (b: Body) => Body> = {
  "그대로": (b) => b,
  "캐시 키 없음": (b) => { const c = { ...b }; delete c.prompt_cache_key; return c; },
  "도구 없음": (b) => { const c = { ...b }; delete c.tools; return c; },
  "생각 요약·암호 생각 없음": (b) => { const c = { ...b }; delete c.include; delete c.reasoning; return c; },
  "그대로 + OpenCode 헤더": (b) => b,
  "그대로 + OpenCode 헤더(세션 헤더 빼고)": (b) => b,
  "앱과 같은 최소 모양": (b) => ({ model: b.model, instructions: b.instructions, input: b.input, store: false, stream: true }),
};

async function send(token: string, body: Body, extra: Record<string, string> = {}) {
  const t0 = Date.now();
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { ...extra, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ...body, max_output_tokens: 16 }) });
  const text = await r.text();
  let usage: any = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { const j = JSON.parse(line.slice(5)); if (j?.response?.usage) usage = j.response.usage; } catch { /* */ }
  }
  return { status: r.status, ms: Date.now() - t0, input: usage?.input_tokens ?? null, cached: usage?.input_tokens_details?.cached_tokens ?? null, error: r.ok ? undefined : text.slice(0, 300) };
}

export async function cacheProbe(only?: string[]) {
  const dir = path.join(DATA, "prompts");
  const last = (await readdir(dir)).filter((f) => f.endsWith("tutor-request.json")).sort().at(-1);
  if (!last) throw Object.assign(new Error("튜터 요청 기록이 없어요."), { status: 404 });
  const raw = JSON.parse(await readFile(path.join(dir, last), "utf8")) as Body;
  const ocHeaders = (raw._headers ?? {}) as Record<string, string>;
  delete raw._headers; delete raw._url;
  const base = raw;
  const token = await chatGptBearer();
  const out: Record<string, unknown> = { from: last };
  for (const [name, fn] of Object.entries(VARIANTS)) {
    if (only?.length && !only.includes(name)) continue;
    const body = fn(structuredClone(base));
    const hdr = name.includes("OpenCode 헤더") ? (name.includes("세션 헤더 빼고") ? Object.fromEntries(Object.entries(ocHeaders).filter(([k]) => !/session/i.test(k))) : ocHeaders) : {};
    const first = await send(token, body, hdr);
    const second = await send(token, body, hdr);
    out[name] = { first, second };
    void logUsage({ kind: "cache-probe", variant: name, first, second });
  }
  return out;
}
