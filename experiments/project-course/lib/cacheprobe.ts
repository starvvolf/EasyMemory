// 캐시 원인 확인(11/3): 튜터가 실제로 보낸 마지막 본문을 같은 ChatGPT 로그인으로 그대로·조금씩 바꿔 두 번씩 보내
// 두 번째 호출의 캐시 읽기 토큰을 본다. 로컬에서만, 사람이 부를 때만(질문 1번 크기 × 변형 수 × 2번의 AI 사용량).
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  "끝만 다르게(앞부분 캐시 되나)": (b) => { const c = structuredClone(b) as any; const last = c.input.at(-1); const part = Array.isArray(last.content) ? last.content.at(-1) : null; if (part?.text) part.text += `\n(변형 ${Date.now()})`; else if (typeof last.content === "string") last.content += `\n(변형 ${Date.now()})`; return c; },
  "끝만 다르게 · 매번 새 토큰": (b) => VARIANTS["끝만 다르게(앞부분 캐시 되나)"](b),
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
  const h = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 8); // 토큰은 남기지 않고 같은지만
  const out: Record<string, unknown> = { from: last, tokens: [h(token), h(await chatGptBearer()), h(await chatGptBearer())] };
  for (const [name, fn] of Object.entries(VARIANTS)) {
    if (only?.length && !only.includes(name)) continue;
    const body = fn(structuredClone(base));
    const hdr = name.includes("OpenCode 헤더") ? (name.includes("세션 헤더 빼고") ? Object.fromEntries(Object.entries(ocHeaders).filter(([k]) => !/session/i.test(k))) : ocHeaders) : {};
    const fresh = name.includes("새 토큰");
    const first = await send(fresh ? await chatGptBearer() : token, body, hdr);
    const second = await send(fresh ? await chatGptBearer() : token, name.startsWith("끝만") ? fn(structuredClone(base)) : body, hdr);
    out[name] = { first, second };
    void logUsage({ kind: "cache-probe", variant: name, first, second });
  }
  // 실제 튜터 순서 흉내: 앞 질문 본문(A) 다음 마지막 본문(B) — B가 A의 앞부분을 캐시로 쓰는지
  if (!only?.length || only.includes("앞 질문 → 다음 질문")) {
    const files = (await readdir(dir)).filter((f) => f.endsWith("tutor-request.json")).sort();
    const prevRaw = JSON.parse(await readFile(path.join(dir, files.at(-2)!), "utf8")) as Body;
    delete prevRaw._headers; delete prevRaw._url;
    const a = await send(token, prevRaw);
    const b = await send(token, base);
    const ta = JSON.stringify(prevRaw.input), tb = JSON.stringify(base.input);
    let k = 0; while (k < ta.length && ta[k] === tb[k]) k++;
    out["앞 질문 → 다음 질문"] = { first: a, second: b, sameInstr: prevRaw.instructions === base.instructions, sameTools: JSON.stringify(prevRaw.tools) === JSON.stringify(base.tools), inputCommonChars: k, inputDiffAt: tb.slice(Math.max(0, k - 60), k + 60) };
  }
  return out;
}
