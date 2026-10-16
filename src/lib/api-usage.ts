import type { ReasoningEffort } from "./model-config.ts";

export type ApiUsageStage =
  | "analyze"
  | "plan"
  | "prepare"
  | "activity-design"
  | "cards"
  | "critic"
  | "sample"
  | "recall";

export type ApiTokenUsage = {
  sourceName: string;
  experimentId: string;
  stage: ApiUsageStage;
  model: string;
  reasoningEffort: ReasoningEffort;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricingAsOf: string | null;
};

export type ApiUsageCapture = {
  sourceName?: string;
  experimentId?: string;
  stage?: ApiUsageStage;
  onUsage?: (usage: ApiTokenUsage) => void | Promise<void>;
};

type ModelPricing = {
  input: number;
  cachedInput: number;
  output: number;
};

export const API_PRICING_AS_OF = "2026-08-17";

// Evaluation-only estimates in USD per one million tokens. The OpenAI
// dashboard remains authoritative because prices can change.
const modelPricing: Record<string, ModelPricing> = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.6-luna": { input: 1, cachedInput: 0.1, output: 6 },
};

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function estimateApiCostUsd(
  model: string,
  usage: Pick<ApiTokenUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">,
) {
  const pricing = modelPricing[model];
  if (!pricing) return null;

  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cost =
    (uncached * pricing.input +
      cached * pricing.cachedInput +
      usage.outputTokens * pricing.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function parseApiTokenUsage(
  response: unknown,
  context: {
    sourceName?: string;
    experimentId?: string;
    stage: ApiUsageStage;
    model: string;
    reasoningEffort: ReasoningEffort;
  },
): ApiTokenUsage | null {
  const responseRecord = asRecord(response);
  const usage = asRecord(responseRecord?.usage);
  if (!usage) return null;

  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const cachedInputTokens = nonNegativeInteger(inputDetails?.cached_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const reasoningTokens = nonNegativeInteger(outputDetails?.reasoning_tokens);
  const suppliedTotal = nonNegativeInteger(usage.total_tokens);
  const totalTokens = suppliedTotal || inputTokens + outputTokens;
  const estimatedCostUsd = estimateApiCostUsd(context.model, {
    inputTokens,
    cachedInputTokens,
    outputTokens,
  });

  return {
    sourceName: context.sourceName ?? "unknown-source",
    experimentId: context.experimentId ?? "untracked",
    stage: context.stage,
    model: context.model,
    reasoningEffort: context.reasoningEffort,
    inputTokens,
    cachedInputTokens: Math.min(inputTokens, cachedInputTokens),
    outputTokens,
    reasoningTokens,
    totalTokens,
    estimatedCostUsd,
    pricingAsOf: estimatedCostUsd === null ? null : API_PRICING_AS_OF,
  };
}

export async function captureApiTokenUsage(
  response: unknown,
  context: Parameters<typeof parseApiTokenUsage>[1] & ApiUsageCapture,
) {
  const usage = parseApiTokenUsage(response, context);
  if (usage && context.onUsage) await context.onUsage(usage);
  return usage;
}
