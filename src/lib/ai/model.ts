// One entry point for model calls made by the app itself (docs/DECISIONS.md, 2026-09-30 "ChatGPT 계정으로 생성").
// Backends are swappable: the user's ChatGPT plan (Sign in with ChatGPT → Responses API), the local Codex
// app-server, or a fake used by tests. Each call is stateless: callers pass every input a stage needs.

export type ModelCaller = { uid: string };

export type ModelRequest = {
  /** Short label for records and the fake backend, e.g. "stage:analyze" or "authoring". */
  purpose: string;
  system: string;
  user: string;
  /** Ask for a JSON value; the text is parsed and returned as `data`. */
  json?: boolean;
  schema?: Record<string, unknown>;
  schemaName?: string;
  model?: string;
  effort?: string;
  caller: ModelCaller;
  provider?: "chatgpt" | "codex" | "fake";
  fakeReply?: string;
  signal?: AbortSignal;
};

export type ModelResult = {
  text: string;
  data?: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ModelErrorCode = "login_required" | "usage_limit" | "transient" | "invalid_output" | "not_configured";

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode, message: string) { super(message); this.code = code; this.name = "ModelError"; }
}

export type ModelStatus = { ready: boolean; message: string; account?: { email?: string; plan?: string } };

export interface ModelBackend {
  readonly name: "chatgpt" | "codex" | "fake";
  status(caller: ModelCaller): Promise<ModelStatus>;
  call(request: ModelRequest): Promise<Omit<ModelResult, "data">>;
}

/** Sign in with ChatGPT + eligible Responses API requests, loaded only for this provider. */
const chatgptBackend: ModelBackend = {
  name: "chatgpt",
  async status(caller) {
    const { chatgptBackend } = await import("./chatgpt-provider.ts");
    return chatgptBackend.status(caller);
  },
  async call(request) {
    const { chatgptBackend } = await import("./chatgpt-provider.ts");
    return chatgptBackend.call(request);
  },
};

const codexBackend: ModelBackend = {
  name: "codex",
  async status() {
    try {
      const { assertCodexSubscriptionReady } = await import("./codex-provider.ts");
      const account = await assertCodexSubscriptionReady();
      return { ready: true, message: "로컬 Codex(ChatGPT 구독)로 생성해요.", account: { email: account.email, plan: account.planType } };
    } catch (error) {
      return { ready: false, message: error instanceof Error ? error.message : "로컬 Codex에 연결하지 못했어요." };
    }
  },
  async call(request) {
    const { callCodexTextWithThread } = await import("./codex-provider.ts");
    try {
      // A fresh thread per call: no implicit memory between stages.
      const result = await callCodexTextWithThread({
        message: `${request.system}\n\n${request.user}`,
        model: request.model,
        reasoningEffort: request.effort,
      });
      return { text: result.text, model: request.model ?? "codex-default" };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "login_required") throw new ModelError("login_required", "로컬 Codex에 ChatGPT 계정으로 로그인해 주세요.");
      if (code === "usage_limit" || code === "rate_limited") throw new ModelError("usage_limit", "ChatGPT 사용량 한도에 닿았어요.");
      throw new ModelError("transient", error instanceof Error ? error.message : "모델 호출이 실패했어요.");
    }
  },
};

type FakeResponder = (request: ModelRequest) => string | Promise<string>;
const fakeState = globalThis as typeof globalThis & { __studyForgeFakeResponder?: FakeResponder };

/** Tests (and local demos) install the responder; nothing leaves the machine. */
export function setFakeModelResponder(responder: FakeResponder | null) {
  fakeState.__studyForgeFakeResponder = responder ?? undefined;
}

const fakeBackend: ModelBackend = {
  name: "fake",
  async status() {
    return fakeState.__studyForgeFakeResponder
      ? { ready: true, message: "가짜 모델로 생성해요(비용 없음, 테스트용)." }
      : { ready: false, message: "가짜 모델 응답이 설정되지 않았어요." };
  },
  async call(request) {
    const responder = fakeState.__studyForgeFakeResponder;
    if (request.fakeReply !== undefined && request.provider === "fake") return { text: request.fakeReply, model: request.model ?? "fake" };
    if (!responder) throw new ModelError("not_configured", "가짜 모델 응답이 설정되지 않았어요.");
    try { return { text: await responder(request), model: "fake" }; }
    catch (error) {
      // A test responder loaded before Next may use a different module instance.
      // Translate only its explicit model errors into this backend's error class.
      const foreign = error as { name?: string; code?: string; message?: string } | null;
      const codes: readonly ModelErrorCode[] = ["login_required", "usage_limit", "transient", "invalid_output", "not_configured"];
      if (!(error instanceof ModelError) && foreign?.name === "ModelError" && codes.includes(foreign.code as ModelErrorCode)) {
        throw new ModelError(foreign.code as ModelErrorCode, typeof foreign.message === "string" ? foreign.message : "가짜 모델 호출이 실패했어요.");
      }
      throw error;
    }
  },
};

const backends = { chatgpt: chatgptBackend, codex: codexBackend, fake: fakeBackend } as const;

export function modelBackend(provider?: ModelRequest["provider"]): ModelBackend {
  const name = (provider ?? process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt").trim() as keyof typeof backends;
  return backends[name] ?? chatgptBackend;
}

/** Pulls the JSON value out of a reply that may wrap it in a code fence or a sentence. */
export function parseJsonReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(body); } catch { /* fall through to the widest object/array */ }
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(body.slice(start, end + 1)); } catch { /* reported below */ }
  }
  throw new ModelError("invalid_output", "모델 응답에서 JSON을 읽지 못했어요.");
}

export async function callModel(request: ModelRequest): Promise<ModelResult> {
  if (request.signal?.aborted) throw new ModelError("transient", "호출을 멈췄어요.");
  const reply = await modelBackend(request.provider).call(request);
  if (!request.json) return reply;
  try { return { ...reply, data: parseJsonReply(reply.text) }; }
  catch (error) {
    // Keep the raw reply so callers can record what the model actually said.
    if (error instanceof ModelError) Object.assign(error, { rawText: reply.text });
    throw error;
  }
}
