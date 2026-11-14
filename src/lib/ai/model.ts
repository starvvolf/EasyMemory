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
  provider?: "chatgpt" | "codex" | "fake" | "relay";
  fakeReply?: string;
  signal?: AbortSignal;
  /** Page images sent with the user text (data URLs). Only the ChatGPT route sends them; others refuse. */
  images?: Array<{ label: string; dataUrl: string; /** "low": a small fixed-size view (about 85 tokens), enough to see a slide's layout and title. */ detail?: "low" | "high" }>;
  /** Whole files sent with the user text (e.g. a PDF as a data URL). Same routes as `images`. */
  files?: Array<{ filename: string; dataUrl: string }>;
  /** Called with the text so far while the reply streams in (progress on screen); the final text is still returned whole. */
  onText?: (text: string) => void;
  /** Text sent last, after the images (the step's own task). Calls that share system + user + images then share that
   *  whole prefix in the prompt cache and differ only here (생성 엔진 sol·terra 한 번, 11/2). */
  tail?: string;
  /** Sent as prompt_cache_key: calls with the same key and the same prefix are routed to the same cache (ChatGPT route). */
  cacheKey?: string;
  /** Opt-in stable instructions + files prefix; stage-specific system/user follow it. */
  cachePrefix?: string;
  /** With cachePrefix: a block sent as the first user message, identical across calls (shared source for the cache). */
  sharedContext?: string;
  /** Streaming progress only, never partial model content. */
  onProgress?: (receivedChars: number) => void;
  /** 웹 검색 도구를 켠다(ChatGPT 경로만, 11/8 알고리즘 난이도). 입력 토큰이 크게 늘어서 꼭 필요한 호출에만. */
  webSearch?: boolean;
};

export type ModelResult = {
  text: string;
  data?: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number };
  /** How the reply was constrained: JSON Schema (structured output), plain JSON mode, or free text. */
  format?: "json_schema" | "json_object" | "text";
};

export type ModelErrorCode = "login_required" | "usage_limit" | "transient" | "invalid_output" | "not_configured";

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode, message: string) { super(message); this.code = code; this.name = "ModelError"; }
}

export type ModelStatus = { ready: boolean; message: string; account?: { email?: string; plan?: string } };

export interface ModelBackend {
  readonly name: "chatgpt" | "codex" | "fake" | "relay";
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
        message: `${request.system}\n\n${request.user}${request.tail ? `\n\n${request.tail}` : ""}`,
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

// 중계(relay, 11/15 자체 시험 하네스): 요청을 파일로 내놓고 응답 파일을 기다린다. 다른 에이전트(대역 모델, tools/harness/)가
// 같은 지시문 · 스키마로 답을 써 넣는다. 개발 · 시험 전용(STUDY_FORGE_MODEL_PROVIDER=relay, STUDY_FORGE_RELAY_DIR).
const relayBackend: ModelBackend = {
  name: "relay",
  async status() {
    return process.env.STUDY_FORGE_RELAY_DIR ? { ready: true, message: "중계 모델(시험용)로 불러요." } : { ready: false, message: "STUDY_FORGE_RELAY_DIR가 없어요." };
  },
  async call(request) {
    const dir = process.env.STUDY_FORGE_RELAY_DIR?.trim();
    if (!dir) throw new ModelError("not_configured", "STUDY_FORGE_RELAY_DIR가 없어요.");
    const { mkdir, writeFile, readFile, rename, unlink } = await import("node:fs/promises");
    const path = (await import("node:path")).default;
    const { randomBytes } = await import("node:crypto");
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${request.purpose.replace(/\W+/g, "_").slice(0, 30)}-${randomBytes(3).toString("hex")}`;
    const req = path.join(dir, `req-${id}.json`);
    const tmp = `${req}.tmp`;
    await writeFile(tmp, JSON.stringify({ id, purpose: request.purpose, model: request.model ?? "", effort: request.effort ?? "", json: Boolean(request.json || request.schema),
      system: request.system, user: request.user, ...(request.tail ? { tail: request.tail } : {}), ...(request.schema ? { schema: request.schema } : {}) }, null, 1), "utf8");
    await rename(tmp, req);
    const res = path.join(dir, `res-${id}.json`);
    const limit = Date.now() + Number(process.env.STUDY_FORGE_RELAY_TIMEOUT_MS || 900_000);
    while (Date.now() < limit) {
      if (request.signal?.aborted) throw new ModelError("transient", "호출을 멈췄어요.");
      const text = await readFile(res, "utf8").catch(() => null);
      if (text !== null) {
        await unlink(req).catch(() => undefined);
        let body: { text?: unknown; error?: string };
        try { body = JSON.parse(text) as { text?: unknown; error?: string }; } catch { body = { text }; }
        if (body.error) throw new ModelError("transient", String(body.error));
        const out = typeof body.text === "string" ? body.text : JSON.stringify(body.text ?? body);
        request.onText?.(out);
        return { text: out, model: `relay:${request.model ?? ""}` };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new ModelError("transient", "중계 모델이 시간 안에 답하지 않았어요.");
  },
};

const backends = { chatgpt: chatgptBackend, codex: codexBackend, fake: fakeBackend, relay: relayBackend } as const;

export function modelBackend(provider?: ModelRequest["provider"]): ModelBackend {
  const name = (provider ?? process.env.STUDY_FORGE_MODEL_PROVIDER ?? "chatgpt").trim() as keyof typeof backends;
  return backends[name] ?? chatgptBackend;
}

/** Pulls the JSON value out of a reply that may wrap it in a code fence or a sentence. */
export function parseJsonReply(text: string): unknown {
  // 통째로 JSON이면 그대로(11/12: 값 안에 ``` 코드 블록이 든 JSON을 울타리로 잘못 잘라 실패했다).
  try { return JSON.parse(text.trim()); } catch { /* 울타리·문장에 싸인 경우 아래에서 */ }
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
  const backend = modelBackend(request.provider);
  if ((request.images?.length || request.files?.length) && backend.name === "codex") throw new ModelError("not_configured", "로컬 Codex 경로는 이미지 입력을 지원하지 않아요.");
  const reply = await backend.call(request);
  if (!request.json && !request.schema) return reply;
  try { return { ...reply, data: parseJsonReply(reply.text) }; }
  catch (error) {
    // Keep the raw reply so callers can record what the model actually said.
    if (error instanceof ModelError) Object.assign(error, { rawText: reply.text });
    throw error;
  }
}
