// One JSON Schema per model call. Strict structured output needs every property listed in `required`
// and `additionalProperties: false`; "may be empty" is written as a nullable type, not an optional key.
// The zod twins validate the reply again on our side (the JSON-mode fallback is not schema-enforced).
import { z } from "zod";
import { itemKinds, objectiveKinds } from "./types.ts";

type Json = Record<string, unknown>;
const obj = (properties: Record<string, Json>): Json => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (description?: string): Json => ({ type: "string", ...(description ? { description } : {}) });
const nullable = (schema: Json): Json => ({ ...schema, type: [schema.type as string, "null"] });
const int = (description?: string): Json => ({ type: "integer", ...(description ? { description } : {}) });
const arr = (items: Json, description?: string): Json => ({ type: "array", items, ...(description ? { description } : {}) });
const oneOf = (values: readonly string[], description?: string): Json => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });

export const outlineSchema = obj({
  sections: arr(obj({
    title: str("원문에 있는 장·절·슬라이드 제목 그대로"),
    startText: str("이 항목이 원문에서 시작되는 곳의 글자를 그대로 복사(보통 제목 줄, 20~60자)"),
    pageStart: int("시작 쪽"),
    pageEnd: int("끝 쪽(한 쪽이면 시작 쪽과 같음)"),
    parts: arr(obj({ title: str("원문의 소제목·슬라이드 제목 그대로"), pageStart: int("시작 쪽") }), "이 단원 안의 세부 항목, 원문 순서대로. 없으면 빈 배열"),
  }), "공부 단위(단원). 원문 순서대로, 고른 쪽을 빠짐없이 덮는다"),
});
export const outlineReply = z.object({
  sections: z.array(z.object({ title: z.string().trim().min(1), startText: z.string(), pageStart: z.number().int(), pageEnd: z.number().int(),
    parts: z.array(z.object({ title: z.string().trim(), pageStart: z.number().int() })).default([]) })),
});

export const classifySchema = obj({
  items: arr(obj({
    kind: oneOf(itemKinds, "내용의 성격"),
    content: str("이 내용이 말하는 것(짧게, 한국어)"),
    quote: str("근거 원문을 글자 그대로 복사한 짧은 구절(한 문장 안팎)"),
    page: int("인용이 있는 쪽"),
  })),
});
export const classifyReply = z.object({
  items: z.array(z.object({ kind: z.enum(itemKinds), content: z.string().trim().min(1), quote: z.string().trim().min(1), page: z.number().int() })),
});

export const designSchema = obj({
  objectives: arr(obj({
    statement: str("학습자 행동으로 쓴 목표, '~할 수 있다'로 끝남. 정답을 그대로 쓰지 않음"),
    cue: str("학습자가 보는 것(질문의 실마리)"),
    recall: str("학습자가 기억에서 꺼내야 하는 것 하나"),
    kind: oneOf(objectiveKinds),
    importance: oneOf(["core", "support"]),
    itemNumbers: arr(int(), "근거가 되는 분류 항목 번호"),
    materialNumbers: arr(int(), "문제 소재로 쓸 예시·연습문제 항목 번호(없으면 빈 배열)"),
  })),
});
export const designReply = z.object({
  objectives: z.array(z.object({
    statement: z.string().trim().min(1), cue: z.string().trim().min(1), recall: z.string().trim().min(1),
    kind: z.enum(objectiveKinds), importance: z.enum(["core", "support"]),
    itemNumbers: z.array(z.number().int()), materialNumbers: z.array(z.number().int()),
  })),
});

export const stemKinds = ["heading", "text", "math", "table", "box"] as const;
export const answerKinds = ["choice", "short", "self-check"] as const;

export const authorSchema = obj({
  questions: arr(obj({
    objectiveId: str("이 문항이 확인하는 목표 id"),
    stem: arr(obj({
      kind: oneOf(stemKinds, "블록 종류. 배치는 코드가 위에서 아래로 쌓는다"),
      text: nullable(str("heading·text·box의 글")),
      latex: nullable(str("math의 LaTeX")),
      rows: nullable(arr(arr(str()), "table의 행(첫 행은 머리글)")),
    }), "공개 전에 보이는 문제 본문 블록, 읽는 순서대로"),
    answer: obj({
      kind: oneOf(answerKinds, "choice: 보기 고르기 / short: 짧은 값 하나 입력 / self-check: 떠올린 뒤 모범 답과 비교"),
      options: nullable(arr(obj({ text: nullable(str()), latex: nullable(str()) }), "choice일 때 보기 4개")),
      correctIndex: nullable(int("choice 정답 보기 번호, 0부터")),
      accepted: nullable(arr(str(), "short: 인정 답안(원문 표기 먼저) / self-check: 모범 답 하나")),
      before: nullable(str("short·self-check 입력칸 앞 문구")),
      after: nullable(str("입력칸 뒤 문구")),
      explanation: str("정답인 이유 1~2문장"),
    }),
  })),
});

const authoredStem = z.object({ kind: z.enum(stemKinds), text: z.string().nullable(), latex: z.string().nullable(), rows: z.array(z.array(z.string())).nullable() });
export const authoredQuestion = z.object({
  objectiveId: z.string().trim().min(1),
  stem: z.array(authoredStem),
  answer: z.object({
    kind: z.enum(answerKinds),
    options: z.array(z.object({ text: z.string().nullable(), latex: z.string().nullable() })).nullable(),
    correctIndex: z.number().int().nullable(),
    accepted: z.array(z.string()).nullable(),
    before: z.string().nullable(),
    after: z.string().nullable(),
    explanation: z.string(),
  }),
});
export type AuthoredReplyQuestion = z.infer<typeof authoredQuestion>;
/** Questions are parsed one by one so one malformed question does not sink the others. */
export const authorReply = z.object({ questions: z.array(z.unknown()) });
