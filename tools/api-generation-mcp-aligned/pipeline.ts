import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ChatGptParityService,
  type ChatGptParityStage,
} from "../study-forge-mcp/chatgpt-parity.ts";

export const API_ALIGNED_STAGES = [
  "analyze",
  "concept-tree",
  "learning-design",
  "activity-design",
  "cards",
] as const satisfies readonly ChatGptParityStage[];

export const PDF_STAGES = new Set<ChatGptParityStage>([
  "analyze",
  "concept-tree",
  "learning-design",
]);

export const API_SYSTEM_PROMPT =
  "Study Forge의 현재 한 단계만 작성하세요. 제공된 MCP 단계 지시와 자연어 블록 형식을 그대로 따르고, JSON 외곽 객체 안의 문자열 필드에 블록을 넣으세요. 다음 단계를 미리 작성하지 마세요.";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type ApiStageRequest = {
  stage: ChatGptParityStage;
  stageInput: Record<string, unknown>;
  schema: Record<string, unknown>;
  schemaName: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  pdf?: {
    fileName: string;
    mimeType: "application/pdf";
    bytes: Buffer;
    sha256: string;
  };
  priorAttempt?: {
    output: unknown;
    error: string;
  };
};

export type ApiStageResponse = {
  submitted: unknown;
  rawResponse: unknown;
  responseId?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  durationMs: number;
};

export type StageGenerator = (request: ApiStageRequest) => Promise<ApiStageResponse>;

export class ApiStageGenerationError extends Error {
  readonly details: Pick<ApiStageResponse, "rawResponse" | "durationMs"> &
    Partial<Pick<ApiStageResponse, "responseId" | "usage">>;

  constructor(
    message: string,
    details: Pick<ApiStageResponse, "rawResponse" | "durationMs"> &
      Partial<Pick<ApiStageResponse, "responseId" | "usage">>,
  ) {
    super(message);
    this.name = "ApiStageGenerationError";
    this.details = details;
  }
}

export type AlignedRunOptions = {
  outputDirectory: string;
  pdfPath: string;
  title: string;
  learningGoal: string;
  instruction?: string;
  subject?: string;
  tags?: string[];
  sourceExpressionMode?: "preserve" | "adapt";
  model: string;
  reasoningEffort: ReasoningEffort;
  maxAttemptsPerStage?: number;
  pageCount?: number;
  resume?: boolean;
  stopAfter?: ChatGptParityStage;
  generateStage: StageGenerator;
  now?: () => Date;
};

type AttemptRecord = {
  stage: ChatGptParityStage;
  attempt: number;
  startedAt: string;
  completedAt: string;
  apiDurationMs: number | null;
  validationDurationMs: number | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  pdfAttached: boolean;
  pdfSha256: string | null;
  request: {
    systemPrompt: string;
    userPayload: Record<string, unknown>;
    stageInput: Record<string, unknown>;
    schemaName: string;
    schema: Record<string, unknown>;
    priorAttemptIncluded: boolean;
  };
  submitted: unknown;
  rawResponse: unknown;
  responseId: string | null;
  usage: ApiStageResponse["usage"] | null;
  outcome: "accepted" | "api_or_parse_error" | "server_validation_error";
  error: string | null;
};

type RunManifest = {
  artifactType: "study-forge-api-mcp-aligned-run";
  artifactVersion: 1;
  runId: string;
  status: "active" | "paused" | "completed" | "failed";
  provider: "openai-responses-api";
  materializer: "ChatGptParityService";
  materializerEngineLabel: "chatgpt-mcp";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  serviceRunId: string | null;
  nextStage: ChatGptParityStage | null;
  completedStages: ChatGptParityStage[];
  attemptsByStage: Partial<Record<ChatGptParityStage, number>>;
  model: string;
  reasoningEffort: ReasoningEffort;
  maxAttemptsPerStage: number;
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  totalApiDurationMs: number;
  lastError: string | null;
  differencesFromMcpConversation: string[];
  sourceChecksums: Record<string, string>;
};

type StoredInput = {
  pdfPath: string;
  pdfFileName: string;
  pdfSha256: string;
  pdfBytes: number;
  pageCount?: number;
  title: string;
  learningGoal: string;
  instruction: string;
  subject: string;
  tags: string[];
  sourceExpressionMode: "preserve" | "adapt";
};

const DIFFERENCES = [
  "MCP에서는 대화 AI가 첨부 PDF를 읽지만 이 경로는 Analyze, Concept Tree, Learning Design 요청마다 동일 PDF 바이트를 input_file로 보낸다.",
  "각 Responses API 호출은 previous_response_id를 사용하지 않는다. MCP stageInput에 포함된 선별 이전 산출물과 재시도 시 직전 출력·검증 오류만 명시적으로 보낸다.",
  "MCP의 '현재 대화 첨부 PDF' 환경 문구만 '이 API 요청의 input_file PDF'로 바꾼다. 학습 정책, 단계 지시, 자연어 블록 형식과 서버 검사는 바꾸지 않는다.",
  "Responses API strict JSON Schema는 자연어 블록을 담는 MCP submit 객체의 외곽 계약에만 적용한다. 블록 자체는 동일 MCP 파서가 검사한다.",
  "MCP 대화의 모델·시스템 지시·숨은 대화 문맥은 고정할 수 없다. 이 실행은 기록된 OpenAI 모델·추론 강도와 stageInput만 사용한다.",
  "API/파싱/서버 검증 실패는 단계당 유한 횟수로 제한한다. Cards 재시도는 MCP 서버에 보존된 정상 CARD 블록과 동일한 부분 제출 규칙을 사용한다.",
];

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function writeJson(target: string, value: unknown, exclusive = false) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.partial`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    if (exclusive) {
      await writeFile(target, await readFile(temporary), { flag: "wx" });
      return;
    }
    await writeFile(target, await readFile(temporary));
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
  }
}

async function checksumFiles(repoRoot: string) {
  const files = [
    "tools/study-forge-mcp/chatgpt-parity.ts",
    "tools/concept-tree-mcp/outline-parser.ts",
    "src/lib/pipeline/analyze.ts",
    "src/lib/pipeline/plan.ts",
    "src/lib/pipeline/generate.ts",
    "src/lib/practice-blueprint.ts",
    "tools/api-generation-mcp-aligned/pipeline.ts",
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    sha256(await readFile(path.join(repoRoot, file))),
  ])));
}

function adaptAttachmentRule(stage: ChatGptParityStage, value: Record<string, unknown>) {
  const cloned = structuredClone(value);
  const input = cloned.input;
  if (!input || typeof input !== "object") return cloned;
  const record = input as Record<string, unknown>;
  if (stage === "analyze") {
    record.attachmentRule =
      "이 Responses API 요청의 input_file PDF를 직접 읽고 그 내용만 근거로 결과를 작성하세요. 파일 바이트는 MCP 서버가 아니라 이 요청에 전달됩니다.";
  } else if (stage === "concept-tree") {
    record.attachmentRule =
      "이 Responses API 요청의 input_file PDF에서 선택된 목차 범위의 실제 내용을 다시 읽고 개념 관계만 트리로 작성하세요. 목차 순서를 복제하지 말고 의미 관계를 표현하되 선택 범위 밖으로 확장하지 마세요.";
  } else if (stage === "learning-design") {
    record.attachmentRule =
      "개념트리를 기준으로 묶거나 나눕니다. 이 Responses API 요청의 input_file PDF는 근거 문구 확인에만 사용하고 트리에 없는 학습 대상을 새로 만들지 마세요.";
  }
  return cloned;
}

function openAiStrictSchema(value: Record<string, unknown>) {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const record = Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, visit(child)]),
    );
    if (record.type === "object") record.additionalProperties = false;
    return record;
  };
  return visit(structuredClone(value)) as Record<string, unknown>;
}

function parseStageInput(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("MCP stageInput이 객체가 아닙니다.");
  const input = value as Record<string, unknown>;
  if (!input.outputContract || typeof input.outputContract !== "object") {
    throw new Error("MCP stageInput에 outputContract가 없습니다.");
  }
  if (typeof input.instructions !== "string" || !input.instructions.trim()) {
    throw new Error("MCP stageInput에 instructions가 없습니다.");
  }
  return input;
}

export function buildApiUserPayload(request: Pick<ApiStageRequest, "stage" | "stageInput" | "priorAttempt">) {
  return {
    ...request.stageInput,
    ...(request.priorAttempt
      ? {
          retryContext: {
            validationError: request.priorAttempt.error,
            previousAttemptOutput: request.priorAttempt.output,
            rule: request.stage === "cards"
              ? "서버에 보존된 정상 CARD는 반복하지 말고 오류가 난 CARD 블록만 같은 번호로 다시 작성하세요."
              : "검증 오류를 고쳐 이 단계 전체 결과를 다시 작성하세요.",
          },
        }
      : {}),
  };
}

function attemptPath(outputDirectory: string, stage: ChatGptParityStage, attempt: number) {
  return path.join(
    outputDirectory,
    "attempts",
    stage,
    `attempt-${String(attempt).padStart(3, "0")}.json`,
  );
}

async function initialize(options: AlignedRunOptions, pdfBytes: Buffer, pdfHash: string) {
  const outputDirectory = path.resolve(options.outputDirectory);
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const inputPath = path.join(outputDirectory, "input.json");
  const now = options.now ?? (() => new Date());
  if (options.resume) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
    const input = JSON.parse(await readFile(inputPath, "utf8")) as StoredInput;
    if (input.pdfSha256 !== pdfHash) throw new Error("재개 PDF의 SHA-256이 원래 입력과 다릅니다.");
    if (manifest.status === "completed") throw new Error("이미 완료된 API 정렬 run은 다시 실행하지 않습니다.");
    return { outputDirectory, manifestPath, inputPath, manifest, input, now };
  }

  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const input: StoredInput = {
    pdfPath: path.resolve(options.pdfPath),
    pdfFileName: path.basename(options.pdfPath),
    pdfSha256: pdfHash,
    pdfBytes: pdfBytes.length,
    ...(options.pageCount ? { pageCount: options.pageCount } : {}),
    title: options.title,
    learningGoal: options.learningGoal,
    instruction: options.instruction ?? "",
    subject: options.subject ?? "",
    tags: options.tags ?? [],
    sourceExpressionMode: options.sourceExpressionMode ?? "adapt",
  };
  const createdAt = now().toISOString();
  const manifest: RunManifest = {
    artifactType: "study-forge-api-mcp-aligned-run",
    artifactVersion: 1,
    runId: path.basename(outputDirectory),
    status: "active",
    provider: "openai-responses-api",
    materializer: "ChatGptParityService",
    materializerEngineLabel: "chatgpt-mcp",
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    serviceRunId: null,
    nextStage: "analyze",
    completedStages: [],
    attemptsByStage: {},
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    maxAttemptsPerStage: options.maxAttemptsPerStage ?? 3,
    totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    totalApiDurationMs: 0,
    lastError: null,
    differencesFromMcpConversation: DIFFERENCES,
    sourceChecksums: await checksumFiles(process.cwd()),
  };
  await writeJson(inputPath, input, true);
  await writeJson(manifestPath, manifest, true);
  return { outputDirectory, manifestPath, inputPath, manifest, input, now };
}

function addUsage(manifest: RunManifest, response: ApiStageResponse) {
  manifest.totalApiDurationMs += response.durationMs;
  manifest.totalUsage.inputTokens += Number(response.usage?.input_tokens ?? 0);
  manifest.totalUsage.outputTokens += Number(response.usage?.output_tokens ?? 0);
  manifest.totalUsage.totalTokens += Number(response.usage?.total_tokens ?? 0);
}

export async function runAlignedPipeline(options: AlignedRunOptions) {
  if (!options.learningGoal.trim()) throw new Error("학습 목표가 필요합니다.");
  if (!Number.isInteger(options.maxAttemptsPerStage ?? 3) || (options.maxAttemptsPerStage ?? 3) < 1) {
    throw new Error("단계별 최대 시도 수는 1 이상의 정수여야 합니다.");
  }
  const pdfBytes = await readFile(path.resolve(options.pdfPath));
  const pdfHash = sha256(pdfBytes);
  const state = await initialize(options, pdfBytes, pdfHash);
  const { outputDirectory, manifestPath, manifest, input, now } = state;
  const service = new ChatGptParityService(
    path.join(outputDirectory, "server-state", "runs"),
    path.join(outputDirectory, "server-state", "published-disabled"),
  );

  if (!manifest.serviceRunId) {
    const started = await service.startRun({
      clientRequestId: `api-aligned-${manifest.runId}`,
      title: input.title,
      files: [{ fileName: input.pdfFileName, ...(input.pageCount ? { pageCount: input.pageCount } : {}) }],
      learningGoal: input.learningGoal,
      instruction: input.instruction,
      subject: input.subject,
      tags: input.tags,
      sourceExpressionMode: input.sourceExpressionMode,
    });
    manifest.serviceRunId = started.runId;
    manifest.nextStage = started.nextStage;
    manifest.updatedAt = now().toISOString();
    await writeJson(manifestPath, manifest);
  }

  let priorAttempt: ApiStageRequest["priorAttempt"];
  if (manifest.status === "failed" && manifest.nextStage) {
    const attempt = manifest.attemptsByStage[manifest.nextStage] ?? 0;
    if (attempt > 0) {
      const previous = JSON.parse(await readFile(
        attemptPath(outputDirectory, manifest.nextStage, attempt),
        "utf8",
      )) as AttemptRecord;
      priorAttempt = {
        output: previous.submitted,
        error: previous.error ?? "이전 시도가 실패했습니다.",
      };
    }
  }
  while (manifest.nextStage) {
    const next = await service.getNextStage(manifest.serviceRunId);
    const stage = next.nextStage;
    if (!stage) break;
    const rawStageInput = parseStageInput(next.stageInput);
    const stageInput = adaptAttachmentRule(stage, rawStageInput);
    const schema = openAiStrictSchema(rawStageInput.outputContract as Record<string, unknown>);
    const existingAttempts = manifest.attemptsByStage[stage] ?? 0;
    if (existingAttempts >= manifest.maxAttemptsPerStage) {
      manifest.status = "failed";
      manifest.lastError = `${stage} 단계가 최대 ${manifest.maxAttemptsPerStage}회 시도에 도달했습니다.`;
      manifest.updatedAt = now().toISOString();
      await writeJson(manifestPath, manifest);
      throw new Error(manifest.lastError);
    }

    const attempt = existingAttempts + 1;
    manifest.attemptsByStage[stage] = attempt;
    const startedAt = now();
    let response: ApiStageResponse | undefined;
    let outcome: AttemptRecord["outcome"] = "api_or_parse_error";
    let validationDurationMs: number | null = null;
    let failure: string | null = null;
    const priorForRequest = priorAttempt;
    try {
      response = await options.generateStage({
        stage,
        stageInput,
        schema,
        schemaName: `study_forge_${stage.replaceAll("-", "_")}`,
        model: manifest.model,
        reasoningEffort: manifest.reasoningEffort,
        ...(PDF_STAGES.has(stage)
          ? { pdf: { fileName: input.pdfFileName, mimeType: "application/pdf", bytes: pdfBytes, sha256: pdfHash } }
          : {}),
        ...(priorForRequest ? { priorAttempt: priorForRequest } : {}),
      });
      addUsage(manifest, response);
      const validationStarted = now();
      try {
        const submitted = await service.submitStage({
          runId: manifest.serviceRunId,
          stage,
          result: response.submitted,
        });
        validationDurationMs = Math.max(0, now().getTime() - validationStarted.getTime());
        outcome = "accepted";
        manifest.nextStage = submitted.nextStage;
        manifest.completedStages = API_ALIGNED_STAGES.filter((candidate) =>
          candidate === stage || manifest.completedStages.includes(candidate)
        );
        manifest.lastError = null;
        priorAttempt = undefined;
      } catch (error) {
        validationDurationMs = Math.max(0, now().getTime() - validationStarted.getTime());
        failure = errorMessage(error);
        outcome = "server_validation_error";
        priorAttempt = { output: response.submitted, error: failure };
      }
    } catch (error) {
      failure = errorMessage(error);
      if (error instanceof ApiStageGenerationError) {
        response = {
          submitted: null,
          rawResponse: error.details.rawResponse,
          responseId: error.details.responseId,
          usage: error.details.usage,
          durationMs: error.details.durationMs,
        };
        addUsage(manifest, response);
      }
      priorAttempt = { output: null, error: failure };
    }
    const completedAt = now();
    const userPayload = buildApiUserPayload({
      stage,
      stageInput,
      ...(priorForRequest ? { priorAttempt: priorForRequest } : {}),
    });
    const record: AttemptRecord = {
      stage,
      attempt,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      apiDurationMs: response?.durationMs ?? null,
      validationDurationMs,
      model: manifest.model,
      reasoningEffort: manifest.reasoningEffort,
      pdfAttached: PDF_STAGES.has(stage),
      pdfSha256: PDF_STAGES.has(stage) ? pdfHash : null,
      request: {
        systemPrompt: API_SYSTEM_PROMPT,
        userPayload,
        stageInput,
        schemaName: `study_forge_${stage.replaceAll("-", "_")}`,
        schema,
        priorAttemptIncluded: Boolean(priorForRequest),
      },
      submitted: response?.submitted ?? null,
      rawResponse: response?.rawResponse ?? null,
      responseId: response?.responseId ?? null,
      usage: response?.usage ?? null,
      outcome,
      error: failure,
    };
    await writeJson(attemptPath(outputDirectory, stage, attempt), record, true);
    manifest.updatedAt = completedAt.toISOString();
    manifest.status = outcome === "accepted" ? "active" : "failed";
    manifest.lastError = failure;
    await writeJson(manifestPath, manifest);

    if (outcome !== "accepted") {
      if (attempt >= manifest.maxAttemptsPerStage) {
        throw new Error(`${stage} 단계가 ${attempt}회 실패했습니다: ${failure}`);
      }
      manifest.status = "active";
      continue;
    }
    if (options.stopAfter === stage) {
      manifest.status = "paused";
      manifest.updatedAt = now().toISOString();
      await writeJson(manifestPath, manifest);
      return { outputDirectory, manifest, result: null };
    }
  }

  const result = await service.getResult(manifest.serviceRunId);
  const resultEnvelope = {
    provider: "openai-responses-api",
    materializer: "ChatGptParityService",
    materializerEngineLabel: result.engine,
    result,
  };
  const resultPath = path.join(outputDirectory, "result.json");
  try {
    await writeJson(resultPath, resultEnvelope, true);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  manifest.status = "completed";
  manifest.nextStage = null;
  manifest.completedAt = now().toISOString();
  manifest.updatedAt = manifest.completedAt;
  manifest.lastError = null;
  await writeJson(manifestPath, manifest);
  return { outputDirectory, manifest, result: resultEnvelope };
}

function extractOutputText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output;
  if (!Array.isArray(output)) throw new Error("Responses API 응답에 output이 없습니다.");
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  throw new Error("Responses API 응답에서 출력 텍스트를 찾지 못했습니다.");
}

export function createOpenAiStageGenerator(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): StageGenerator {
  const fetchImpl = input.fetchImpl ?? fetch;
  return async (request) => {
    const startedAt = Date.now();
    const userPayload = buildApiUserPayload(request);
    const content: Array<Record<string, unknown>> = [];
    if (request.pdf) {
      content.push({
        type: "input_file",
        filename: request.pdf.fileName,
        file_data: `data:${request.pdf.mimeType};base64,${request.pdf.bytes.toString("base64")}`,
      });
    }
    content.push({ type: "input_text", text: JSON.stringify(userPayload) });
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        reasoning: { effort: request.reasoningEffort },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: API_SYSTEM_PROMPT,
              },
            ],
          },
          { role: "user", content },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      }),
    });
    const rawResponse = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof rawResponse.error === "object" && rawResponse.error
        ? String((rawResponse.error as { message?: unknown }).message ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
      throw new ApiStageGenerationError(
        `OpenAI Responses API 요청 실패: ${message}`,
        {
          rawResponse,
          responseId: typeof rawResponse.id === "string" ? rawResponse.id : undefined,
          usage: rawResponse.usage as ApiStageResponse["usage"],
          durationMs: Date.now() - startedAt,
        },
      );
    }
    const outputText = extractOutputText(rawResponse);
    let submitted: unknown;
    try {
      submitted = JSON.parse(outputText);
    } catch {
      throw new ApiStageGenerationError(
        "Responses API 출력이 JSON 객체가 아닙니다.",
        {
          rawResponse,
          responseId: typeof rawResponse.id === "string" ? rawResponse.id : undefined,
          usage: rawResponse.usage as ApiStageResponse["usage"],
          durationMs: Date.now() - startedAt,
        },
      );
    }
    return {
      submitted,
      rawResponse,
      responseId: typeof rawResponse.id === "string" ? rawResponse.id : undefined,
      usage: rawResponse.usage as ApiStageResponse["usage"],
      durationMs: Date.now() - startedAt,
    };
  };
}
