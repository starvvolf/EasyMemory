// 구조화된 답(JSON) 두 가지 도구: 너무 길게 이어지는 답을 끊는 오류, zod 모양 → JSON 스키마.
// (예전 astra.ts에 있던 것. 11/15 리팩토링에서 astra 엔진을 지우며 이 둘만 남김.)
import { z } from "zod";

/** A reply cut because it ran far past the expected length (a structured reply that loops and never closes). */
export class RunawayReply extends Error {
  readonly limit: number;
  readonly received: number;
  constructor(limit: number, received: number) {
    super(`응답이 ${received.toLocaleString()}자로 상한 ${limit.toLocaleString()}자를 넘어 끊었어요.`);
    this.limit = limit; this.received = received;
  }
}

/** The JSON schema a model is asked to answer in (draft-7, what the ChatGPT backend takes). */
export function replyJsonSchema(parser: z.ZodType) { return z.toJSONSchema(parser, { target: "draft-7" }) as Record<string, unknown>; }
