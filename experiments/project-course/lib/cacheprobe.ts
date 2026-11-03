// 캐시 원인 확인(11/3): 튜터가 실제로 보낸 마지막 본문을 같은 ChatGPT 로그인으로 그대로·조금씩 바꿔 두 번씩 보내
// 두 번째 호출의 캐시 읽기 토큰을 본다. 로컬에서만, 사람이 부를 때만(질문 1번 크기 × 변형 수 × 2번의 AI 사용량).
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chatGptBearer } from "./ai.ts";
import { existsSync, readFileSync } from "node:fs";
import { ROOT } from "./course.ts";
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
  "고정 앞부분만(길이 재기)": (b) => { const c = structuredClone(b) as any; const f = c.input[0]; const cut = (t: string) => t.split(/\n\n\[(앞부분|최근 대화|학습자 상태)/)[0]; if (Array.isArray(f.content)) f.content = [{ type: "input_text", text: cut(f.content[0].text) }]; else f.content = cut(f.content); c.input = [f]; return c; },
  "앱과 같은 최소 모양": (b) => ({ model: b.model, instructions: b.instructions, input: b.input, store: false, stream: true }),
};

async function send(token: string, body: Body, extra: Record<string, string> = {}) {
  const t0 = Date.now();
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { ...extra, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ...body, max_output_tokens: 16 }) });
  const text = await r.text();
  let usage: any = null, id: string | null = null, diag: unknown = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { const j = JSON.parse(line.slice(5)); if (j?.response?.usage) usage = j.response.usage; if (j?.response?.id) id = j.response.id; if (j?.response?.prompt_cache_diagnostics) diag = j.response.prompt_cache_diagnostics; } catch { /* */ }
  }
  return { status: r.status, ms: Date.now() - t0, id, diag, input: usage?.input_tokens ?? null, cached: usage?.input_tokens_details?.cached_tokens ?? null, error: r.ok ? undefined : text.slice(0, 300) };
}

/** 사용자 허락(11/3 "api키로 해봐 내가 허락할게")으로만: 앱 .env.local의 OPENAI_API_KEY를 읽어 쓴다. 값은 어디에도 남기지 않는다 */
function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const f = path.resolve(ROOT, "..", "..", ".env.local");
  if (!existsSync(f)) throw Object.assign(new Error("API 키가 없어요."), { status: 400 });
  const m = /^OPENAI_API_KEY=(.+)$/m.exec(readFileSync(f, "utf8"));
  if (!m) throw Object.assign(new Error("API 키가 없어요."), { status: 400 });
  return m[1].trim().replace(/^["']|["']$/g, "");
}

export async function cacheProbe(only?: string[], waitMs = 0, useApiKey = false) {
  const dir = path.join(DATA, "prompts");
  const last = (await readdir(dir)).filter((f) => f.endsWith("tutor-request.json")).sort().at(-1);
  if (!last) throw Object.assign(new Error("튜터 요청 기록이 없어요."), { status: 404 });
  const raw = JSON.parse(await readFile(path.join(dir, last), "utf8")) as Body;
  const ocHeaders = (raw._headers ?? {}) as Record<string, string>;
  delete raw._headers; delete raw._url;
  const base = raw;
  const token = useApiKey ? apiKey() : await chatGptBearer();
  const h = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 8); // 토큰은 남기지 않고 같은지만
  const out: Record<string, unknown> = { from: last, via: useApiKey ? "API 키" : "ChatGPT 로그인" };
  for (const [name, fn] of Object.entries(VARIANTS)) {
    if (only?.length && !only.includes(name)) continue;
    const body = fn(structuredClone(base));
    const hdr = name.includes("OpenCode 헤더") ? (name.includes("세션 헤더 빼고") ? Object.fromEntries(Object.entries(ocHeaders).filter(([k]) => !/session/i.test(k))) : ocHeaders) : {};
    const fresh = name.includes("새 토큰");
    const first = await send(fresh && !useApiKey ? await chatGptBearer() : token, body, hdr);
    const second = await send(fresh && !useApiKey ? await chatGptBearer() : token, name.startsWith("끝만") ? fn(structuredClone(base)) : body, hdr);
    out[name] = { first, second };
    void logUsage({ kind: "cache-probe", via: useApiKey ? "api-key" : "chatgpt", variant: name, first, second });
  }
  // 실제 튜터 순서 흉내: 앞 질문 본문(A) 다음 마지막 본문(B) — B가 A의 앞부분을 캐시로 쓰는지
  if (!only?.length || only.includes("앞 질문 → 다음 질문")) {
    const files = (await readdir(dir)).filter((f) => f.endsWith("tutor-request.json")).sort();
    const prevRaw = JSON.parse(await readFile(path.join(dir, files.at(-2)!), "utf8")) as Body;
    delete prevRaw._headers; delete prevRaw._url;
    // 처음 보는 앞부분이 되게 맨 앞 입력에 표시를 붙인다(이미 캐시된 본문을 다시 쓰지 않게). waitMs만큼 쉬었다가 B
    const mark = `[시험 ${Date.now()}]\n`;
    const tag = (b0: Body) => { const c = structuredClone(b0) as any; const first = c.input[0]; if (Array.isArray(first.content)) first.content[0].text = mark + first.content[0].text; else first.content = mark + first.content; return c; };
    const a = await send(token, tag(prevRaw));
    await new Promise((r) => setTimeout(r, waitMs));
    const b = await send(token, a.id ? { ...tag(base), prompt_cache_options: { comparison_response_id: a.id } } : tag(base));
    const ta = JSON.stringify(prevRaw.input), tb = JSON.stringify(base.input);
    let k = 0; while (k < ta.length && ta[k] === tb[k]) k++;
    out["앞 질문 → 다음 질문"] = { waitMs, first: a, second: b, sameInstr: prevRaw.instructions === base.instructions, sameTools: JSON.stringify(prevRaw.tools) === JSON.stringify(base.tools), inputCommonChars: k, inputDiffAt: tb.slice(Math.max(0, k - 60), k + 60) };
  }
  // 이어 쓰기 흉내: B = A 전체 + 튜터 답 + 새 질문(대화를 이어 쓰면 앞 요청 전체가 B의 앞부분이 된다)
  if (only?.includes("이어 쓰기")) {
    const mark = `[시험 ${Date.now()}]\n`;
    const a0 = structuredClone(base) as any; const f = a0.input[0]; if (Array.isArray(f.content)) f.content[0].text = mark + f.content[0].text; else f.content = mark + f.content;
    const a = await send(token, a0);
    await new Promise((r) => setTimeout(r, waitMs));
    const b0 = structuredClone(a0); b0.input = [...b0.input, { role: "assistant", content: "네, 200은 성공이라는 뜻이에요." }, { role: "user", content: [{ type: "input_text", text: "[학습자 상태] 같음\n\n[학습자 질문] 그럼 404는요?" }] }];
    const b = await send(token, a.id ? { ...b0, prompt_cache_options: { comparison_response_id: a.id } } : b0);
    out["이어 쓰기"] = { waitMs, first: a, second: b };
  }
  // 처음 보는 앞부분 + 끝만 다르게: 도구 있음/없음 비교(같은 앞부분이 다른 질문 사이에서 재사용되는지)
  for (const withTools of [true, false]) {
    const name = `새 앞부분 끝만 다르게(${withTools ? "도구 있음" : "도구 없음"})`;
    if (!only?.includes(name)) continue;
    const mark = `[시험 ${Date.now()}]\n`;
    const mk = (q: string) => { const c = structuredClone(base) as any; if (!withTools) delete c.tools; const f = c.input[0]; if (Array.isArray(f.content)) f.content[0].text = mark + f.content[0].text + `\n\n[학습자 질문] ${q}`; else f.content = mark + f.content + `\n\n[학습자 질문] ${q}`; return c; };
    const a = await send(token, mk("첫 질문"));
    await new Promise((r) => setTimeout(r, waitMs));
    const b = await send(token, mk("두 번째 질문"));
    const c = await send(token, mk("세 번째 질문"));
    out[name] = { a: a.cached, b: b.cached, c: c.cached, input: a.input };
  }
  return out;
}
