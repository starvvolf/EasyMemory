// 엔진 호출 공통 조각 (11/12 A 정리: 예전 astra 엔진 파일에서 지금 엔진이 쓰는 것만 옮김).
import { z } from "zod";

/** A structured reply cut off past its expected size (a looping reply never closes). */
export class RunawayReply extends Error {
  readonly limit: number;
  readonly received: number;
  constructor(limit: number, received: number) { super(`응답이 ${received.toLocaleString()}자로 상한 ${limit.toLocaleString()}자를 넘어 끊었어요.`); this.limit = limit; this.received = received; }
}
/** A zod parser as the JSON schema the model is asked to follow. */
export function jsonSchemaOf(parser: z.ZodType) { return z.toJSONSchema(parser, { target: "draft-7" }) as Record<string, unknown>; }
