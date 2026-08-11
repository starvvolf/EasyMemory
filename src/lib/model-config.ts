import "server-only";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-terra";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export const EXTRACTION_MODEL =
  process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.6-sol";
export const EXTRACTION_REASONING_EFFORT: ReasoningEffort = "medium";

export const CRITIC_MODEL = process.env.OPENAI_CRITIC_MODEL ?? "gpt-5.6-sol";
export const CRITIC_REASONING_EFFORT: ReasoningEffort = "medium";

export function getPublicModelConfig() {
  return {
    default: {
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    },
    extraction: {
      model: EXTRACTION_MODEL,
      reasoningEffort: EXTRACTION_REASONING_EFFORT,
    },
    critic: {
      model: CRITIC_MODEL,
      reasoningEffort: CRITIC_REASONING_EFFORT,
    },
  };
}
