import { chatGptAccessToken, chatGptStorageReady, credentialFor } from "./chatgpt-auth.ts";
import { ModelError, type ModelBackend, type ModelRequest, type ModelResult } from "./model.ts";

type ApiError = { error?: { code?: string; message?: string }; detail?: string };
const endpoint = "https://api.openai.com/v1/responses";
const limitCodes = new Set(["subscription_sharing_usage_limit_exceeded"]);
const loginCodes = new Set(["subscription_sharing_invalid_user", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context"]);

export function responseFailure(status: number, body: ApiError): ModelError {
  const code = body.error?.code;
  if (limitCodes.has(code ?? "")) return new ModelError("usage_limit", "ChatGPT 앱 사용량 한도에 닿았어요. 설정의 사용량 한도를 확인해 주세요.");
  if (status === 401 || loginCodes.has(code ?? "")) return new ModelError("login_required", "ChatGPT 계정 연결을 다시 확인해 주세요.");
  if (code === "subscription_sharing_user_not_eligible") return new ModelError("not_configured", "이 계정은 ChatGPT 플랜 공유 대상이 아니에요.");
  if (code === "subscription_sharing_unsupported_capability" || code === "subscription_sharing_route_not_supported") {
    return new ModelError("not_configured", "요청한 모델이나 응답 형식이 ChatGPT 플랜 공유에서 지원되지 않아요.");
  }
  return new ModelError("transient", status === 503 ? "ChatGPT 사용 가능 여부를 잠시 확인할 수 없어요." : "ChatGPT 모델 요청에 실패했어요.");
}

/** Structured output asks for a JSON Schema; `fallback` is the plain JSON mode used when the plan route refuses it. */
type ResponseBody = {
  model: string; instructions: string; store: boolean; stream: boolean;
  input: Array<{ role: string; content: string | Array<{ type: "input_text"; text: string; prompt_cache_breakpoint?: { mode: "explicit" } } | { type: "input_image"; image_url: string; detail: "high" } | { type: "input_file"; filename: string; file_data: string }> }>;
  reasoning?: { effort: string }; text?: { format: { type: string } & Record<string, unknown> };
  prompt_cache_options?: { mode: "explicit"; ttl: "30m" };
};
export function responseRequest(request: ModelRequest, format: "schema" | "fallback" = "schema"): ResponseBody {
  const useSchema = Boolean(request.schema) && format === "schema";
  if (request.cachePrefix && (!request.files?.length || !request.schema)) throw new ModelError("not_configured", "PDF 캐싱 요청에는 파일과 공통 응답 스키마가 필요해요.");
  const baseInstructions = request.cachePrefix ?? request.system;
  const instructions = request.schema && !useSchema
    ? `${baseInstructions}\n\n응답은 다음 JSON Schema를 따르는 JSON 객체 하나만 쓴다.\n${JSON.stringify(request.schema)}`
    : baseInstructions;
  // JSON mode (json_object) is refused unless the input itself mentions JSON; the instructions do not count.
  const jsonMode = !useSchema && Boolean(request.json || request.schema);
  const userText = jsonMode && !/json/i.test(request.user) ? `${request.user}\n\n(응답은 JSON 객체 하나로)` : request.user;
  return {
    model: request.model ?? "gpt-6-sol",
    instructions,
    // With page images the user turn becomes text plus one labelled image per page.
    input: request.cachePrefix ? [
      { role: "user", content: [
        ...(request.files ?? []).map(file => ({ type: "input_file" as const, filename: file.filename, file_data: file.dataUrl })),
        { type: "input_text", text: "첨부 자료 끝", prompt_cache_breakpoint: { mode: "explicit" } },
      ] },
      { role: "developer", content: request.system },
      { role: "user", content: request.images?.length ? [
        { type: "input_text", text: userText },
        ...request.images.flatMap(image => [{ type: "input_text" as const, text: `[이미지] ${image.label}` }, { type: "input_image" as const, image_url: image.dataUrl, detail: "high" as const }]),
      ] : userText },
    ] : [{ role: "user", content: request.images?.length || request.files?.length
      ? [{ type: "input_text" as const, text: userText },
          ...(request.files ?? []).map((file) => ({ type: "input_file" as const, filename: file.filename, file_data: file.dataUrl })),
          ...(request.images ?? []).flatMap((image) => [
            { type: "input_text" as const, text: `[이미지] ${image.label}` }, { type: "input_image" as const, image_url: image.dataUrl, detail: "high" as const }])]
      : userText }],
    store: false,
    stream: true,
    ...(request.cachePrefix ? { prompt_cache_options: { mode: "explicit" as const, ttl: "30m" as const } } : {}),
    ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
    ...(useSchema
      ? { text: { format: { type: "json_schema", name: request.schemaName ?? "response", schema: request.schema, strict: true } } }
      : request.json || request.schema ? { text: { format: { type: "json_object" } } } : {}),
  };
}

/** The plan route said no to the JSON Schema format itself (not to the login or the model). */
export function isFormatRejection(status: number, body: ApiError) {
  const code = body.error?.code ?? "";
  const message = `${body.error?.message ?? ""} ${body.detail ?? ""}`;
  return code === "subscription_sharing_unsupported_capability" || (status === 400 && /text\.format|json_schema|response_format|strict/i.test(message));
}

// Once refused, later calls in this server process go straight to the fallback instead of paying for a refusal each time.
const formatState = globalThis as typeof globalThis & { __studyForgeSchemaRefused?: boolean };
export function resetSchemaSupport() { formatState.__studyForgeSchemaRefused = undefined; }

/** Sends with the JSON Schema first; on a format refusal, remembers it and sends once more in JSON mode. */
export async function sendWithFallback(send: (format: "schema" | "fallback") => Promise<Response>, hasSchema: boolean, explicitCache = false) {
  let format: "schema" | "fallback" = hasSchema && !formatState.__studyForgeSchemaRefused ? "schema" : "fallback";
  let response = await send(format);
  if (!response.ok) {
    let body: ApiError = {};
    try { body = await response.json() as ApiError; } catch { /* Some admission failures have no JSON error body. */ }
    // Do not mistake rejection of the opt-in cache capability for global JSON Schema rejection.
    if (explicitCache && (body.error?.code === "subscription_sharing_unsupported_capability" || /prompt_cache|cache.breakpoint/i.test(`${body.error?.message ?? ""} ${body.detail ?? ""}`))) {
      throw new ModelError("not_configured", "PDF 캐싱 요청이 거부됐어요. 계정 경로의 캐싱 지원을 확인해야 해요. 캐싱을 끄고 몰래 재호출하지 않습니다.");
    }
    if (format !== "schema" || !isFormatRejection(response.status, body)) throw responseFailure(response.status, body);
    formatState.__studyForgeSchemaRefused = true;
    format = "fallback";
    response = await send(format);
    if (!response.ok) {
      body = {};
      try { body = await response.json() as ApiError; } catch { /* as above */ }
      throw responseFailure(response.status, body);
    }
  }
  return { response, format };
}

export async function readResponseStream(body: ReadableStream<Uint8Array>, onProgress?: ModelRequest["onProgress"]): Promise<{ text: string; usage?: ModelResult["usage"]; model?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", completed = false;
  let usage: ModelResult["usage"];
  let model: string | undefined;
  const event = (raw: string) => {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let value: { type?: string; delta?: string; response?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } }; error?: { code?: string; message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> } };
    try { value = JSON.parse(data); } catch { throw new ModelError("transient", "ChatGPT 응답 스트림을 읽지 못했어요."); }
    if (value.type === "response.output_text.delta") {
      text += value.delta ?? "";
      if (value.delta) onProgress?.(text.length);
    }
    if (value.type === "response.failed") throw responseFailure(0, { error: value.response?.error });
    if (value.type === "response.incomplete" || value.type === "error") throw new ModelError("transient", "ChatGPT 응답이 완료되지 않았어요.");
    if (value.type === "response.completed") {
      completed = true;
      model = value.response?.model;
      usage = { inputTokens: value.response?.usage?.input_tokens, outputTokens: value.response?.usage?.output_tokens };
      const details = value.response?.usage?.input_tokens_details;
      if (typeof details?.cached_tokens === "number") usage.cachedInputTokens = details.cached_tokens;
      if (typeof details?.cache_write_tokens === "number") usage.cacheWriteTokens = details.cache_write_tokens;
      if (!text) text = value.response?.output?.flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("") ?? "";
    }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let index: number;
      while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const match = /\r?\n\r?\n/.exec(buffer.slice(index))!;
        event(buffer.slice(0, index));
        buffer = buffer.slice(index + match[0].length);
      }
    }
    if (buffer.trim()) event(buffer);
  } finally { reader.releaseLock(); }
  if (!completed) throw new ModelError("transient", "ChatGPT 응답이 끝까지 완료되지 않았어요.");
  if (!text.trim()) throw new ModelError("invalid_output", "ChatGPT가 빈 응답을 보냈어요.");
  return { text, usage, model };
}

export const chatgptBackend: ModelBackend = {
  name: "chatgpt",
  async status(caller) {
    if (!chatGptStorageReady()) return { ready: false, message: "서버에 ChatGPT 토큰 암호화 키를 설정해야 해요." };
    let credential;
    try { credential = await credentialFor(caller.uid); }
    catch { return { ready: false, message: "ChatGPT 연결 기록을 읽지 못해 다시 연결해야 해요." }; }
    if (!credential?.accessToken || !credential.refreshToken) return { ready: false, message: "ChatGPT 계정을 연결해 주세요." };
    if (!credential.scopes.includes("chatgpt.tokens.use.direct")) return { ready: false, message: "ChatGPT 플랜 사용 권한을 승인해 주세요.", account: { email: credential.email } };
    try { await chatGptAccessToken(caller.uid); }
    catch (error) { return { ready: false, message: error instanceof Error ? error.message : "ChatGPT 연결을 확인하지 못했어요." }; }
    return { ready: true, message: "ChatGPT 계정으로 생성할 수 있어요.", account: { email: credential.email } };
  },
  async call(request) {
    const accessToken = await chatGptAccessToken(request.caller.uid);
    const send = async (format: "schema" | "fallback") => {
      try {
        return await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(responseRequest(request, format)), signal: request.signal });
      } catch { throw new ModelError("transient", "ChatGPT 모델 서버에 연결하지 못했어요."); }
    };
    const { response, format } = await sendWithFallback(send, Boolean(request.schema), Boolean(request.cachePrefix));
    if (!response.body) throw new ModelError("transient", "ChatGPT 응답 스트림이 비어 있어요.");
    const completed = await readResponseStream(response.body, request.onProgress);
    const used = !request.schema && !request.json ? "text" as const : format === "schema" ? "json_schema" as const : "json_object" as const;
    return { text: completed.text, model: completed.model ?? request.model ?? "chatgpt", usage: completed.usage, format: used };
  },
};
