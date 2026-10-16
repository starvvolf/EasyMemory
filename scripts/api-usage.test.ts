import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateApiCostUsd,
  parseApiTokenUsage,
} from "../src/lib/api-usage.ts";

test("Responses API usage를 단계별 공통 형식으로 변환한다", () => {
  const usage = parseApiTokenUsage(
    {
      usage: {
        input_tokens: 10_000,
        input_tokens_details: { cached_tokens: 2_000 },
        output_tokens: 1_000,
        output_tokens_details: { reasoning_tokens: 300 },
        total_tokens: 11_000,
      },
    },
    {
      sourceName: "opic.pdf",
      experimentId: "exp-1",
      stage: "prepare",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
  );

  assert.ok(usage);
  assert.equal(usage.inputTokens, 10_000);
  assert.equal(usage.cachedInputTokens, 2_000);
  assert.equal(usage.outputTokens, 1_000);
  assert.equal(usage.reasoningTokens, 300);
  assert.equal(usage.totalTokens, 11_000);
  assert.equal(usage.estimatedCostUsd, 0.071);
});

test("usage가 없는 구형 응답은 null로 처리한다", () => {
  assert.equal(
    parseApiTokenUsage(
      { output_text: "{}" },
      {
        stage: "cards",
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
      },
    ),
    null,
  );
});

test("Luna 사용량의 평가용 예상 비용을 계산한다", () => {
  assert.equal(
    estimateApiCostUsd("gpt-5.6-luna", {
      inputTokens: 10_000,
      cachedInputTokens: 2_000,
      outputTokens: 1_000,
    }),
    0.0142,
  );
});

test("알 수 없는 모델은 토큰을 보존하고 비용만 계산하지 않는다", () => {
  assert.equal(
    estimateApiCostUsd("custom-model", {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
    }),
    null,
  );
});
