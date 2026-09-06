export type CodexErrorCode =
  | "login_required"
  | "connection_lost"
  | "request_timeout"
  | "turn_timeout"
  | "thread_busy"
  | "thread_unavailable"
  | "invalid_output"
  | "rate_limited"
  | "model_unavailable";

export class CodexRuntimeError extends Error {
  readonly code: CodexErrorCode;

  constructor(code: CodexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexRuntimeError";
    this.code = code;
  }
}

export type CodexHttpError = {
  code: CodexErrorCode | "unknown";
  message: string;
  status: number;
};

export function findCodexRuntimeError(error: unknown) {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof CodexRuntimeError) return current;
    if (typeof current !== "object") break;
    const candidate = current as { cause?: unknown; detail?: unknown };
    current = candidate.cause ?? candidate.detail;
  }
  return inferCodexRuntimeError(error);
}

export function isReplaceableProjectThreadError(error: unknown) {
  const code = findCodexRuntimeError(error)?.code;
  return code === "thread_busy" || code === "thread_unavailable";
}

export function toCodexHttpError(
  error: unknown,
  fallbackMessage: string,
): CodexHttpError {
  const codexError = findCodexRuntimeError(error);
  if (!codexError) {
    return { code: "unknown", message: fallbackMessage, status: 500 };
  }

  switch (codexError.code) {
    case "login_required":
      return {
        code: codexError.code,
        message: "ChatGPT 로그인이 필요합니다. Codex 연결 화면에서 다시 로그인해 주세요.",
        status: 401,
      };
    case "turn_timeout":
      return {
        code: codexError.code,
        message: "Codex 응답 시간이 초과되어 진행 중인 작업을 취소했습니다. 다시 시도해 주세요.",
        status: 504,
      };
    case "request_timeout":
      return {
        code: codexError.code,
        message: "Codex 연결 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
        status: 504,
      };
    case "connection_lost":
      return {
        code: codexError.code,
        message: "Codex 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.",
        status: 503,
      };
    case "thread_busy":
      return {
        code: codexError.code,
        message: "프로젝트 대화가 다른 Study Forge 실행에서 사용 중입니다. 다른 창을 닫고 다시 시도해 주세요.",
        status: 409,
      };
    case "thread_unavailable":
      return {
        code: codexError.code,
        message: "프로젝트 대화를 복구하지 못했습니다. 다시 시도하면 새 대화로 연결합니다.",
        status: 503,
      };
    case "invalid_output":
      return {
        code: codexError.code,
        message: "AI 응답 형식이 올바르지 않습니다. 같은 요청을 다시 시도해 주세요.",
        status: 502,
      };
    case "rate_limited":
      return {
        code: codexError.code,
        message: "현재 Codex 사용 한도에 도달했습니다. 사용량이 갱신된 뒤 다시 시도해 주세요.",
        status: 429,
      };
    case "model_unavailable":
      return {
        code: codexError.code,
        message: "선택한 Codex 모델을 지금 사용할 수 없습니다. 연결 화면에서 다른 모델을 선택해 주세요.",
        status: 503,
      };
  }
}

function inferCodexRuntimeError(error: unknown) {
  const message = collectErrorMessages(error).toLowerCase();
  if (!message) return null;
  if (
    message.includes("먼저 로그인") ||
    message.includes("not logged in") ||
    message.includes("authentication required") ||
    message.includes("token_exchange_failed")
  ) {
    return new CodexRuntimeError("login_required", message);
  }
  if (message.includes("already has an active writer")) {
    return new CodexRuntimeError("thread_busy", message);
  }
  if (message.includes("invalid session id")) {
    return new CodexRuntimeError("thread_unavailable", message);
  }
  if (
    message.includes("thread") &&
    (message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("deleted") ||
      message.includes("archived") ||
      message.includes("failed to load") ||
      message.includes("rollout"))
  ) {
    return new CodexRuntimeError("thread_unavailable", message);
  }
  if (message.includes("rate limit") || message.includes("usage limit")) {
    return new CodexRuntimeError("rate_limited", message);
  }
  if (
    message.includes("model") &&
    (message.includes("not available") ||
      message.includes("not supported") ||
      message.includes("unknown"))
  ) {
    return new CodexRuntimeError("model_unavailable", message);
  }
  if (
    message.includes("유효한 json") ||
    message.includes("invalid json") ||
    message.includes("output schema")
  ) {
    return new CodexRuntimeError("invalid_output", message);
  }
  return null;
}

function collectErrorMessages(error: unknown) {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error && current.message) messages.push(current.message);
    if (typeof current !== "object") break;
    const candidate = current as { cause?: unknown; detail?: unknown };
    current = candidate.cause ?? candidate.detail;
  }
  return messages.join("\n");
}
