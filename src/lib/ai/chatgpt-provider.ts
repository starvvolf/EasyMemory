import { chatGptAccessToken, chatGptStorageReady, credentialFor } from "./chatgpt-auth.ts";
import { ModelError, type ModelBackend, type ModelRequest } from "./model.ts";

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

export function responseRequest(request: ModelRequest) {
  return {
    model: request.model ?? "gpt-6-sol",
    instructions: request.system,
    input: [{ role: "user", content: request.user }],
    store: false,
    stream: true,
    ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
    ...(request.json ? { text: { format: { type: "json_object" } } } : {}),
  };
}

export async function readResponseStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number }; model?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", completed = false;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  let model: string | undefined;
  const event = (raw: string) => {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let value: { type?: string; delta?: string; response?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { code?: string; message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> } };
    try { value = JSON.parse(data); } catch { throw new ModelError("transient", "ChatGPT 응답 스트림을 읽지 못했어요."); }
    if (value.type === "response.output_text.delta") text += value.delta ?? "";
    if (value.type === "response.failed") throw responseFailure(0, { error: value.response?.error });
    if (value.type === "response.incomplete" || value.type === "error") throw new ModelError("transient", "ChatGPT 응답이 완료되지 않았어요.");
    if (value.type === "response.completed") {
      completed = true;
      model = value.response?.model;
      usage = { inputTokens: value.response?.usage?.input_tokens, outputTokens: value.response?.usage?.output_tokens };
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
    let response: Response;
    try {
      response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(responseRequest(request)), signal: request.signal });
    } catch { throw new ModelError("transient", "ChatGPT 모델 서버에 연결하지 못했어요."); }
    if (!response.ok) {
      let body: ApiError = {};
      try { body = await response.json() as ApiError; } catch { /* Some admission failures have no JSON error body. */ }
      throw responseFailure(response.status, body);
    }
    if (!response.body) throw new ModelError("transient", "ChatGPT 응답 스트림이 비어 있어요.");
    const completed = await readResponseStream(response.body);
    return { text: completed.text, model: completed.model ?? request.model ?? "chatgpt", usage: completed.usage };
  },
};
