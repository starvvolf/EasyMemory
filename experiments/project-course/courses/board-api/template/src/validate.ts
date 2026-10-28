// @from 3
// 부품: 입력 검증 — 저장하기 전에 들어온 값이 규칙에 맞는지 본다. 틀리면 400.
import { HttpError } from "./http.ts";

export type PostInput = { title: string; body: string };
export const TITLE_MAX = 100;
export const BODY_MAX = 5000;

/**
 * 규칙
 * - title: 글자(string)여야 하고, 앞뒤 공백을 뺀 길이가 1~100자. 저장할 때는 앞뒤 공백을 뺀 값.
 * - body: 없으면 "". 있으면 글자(string)여야 하고 5000자까지.
 * - 규칙에 어긋나면 HttpError(400, 이유)를 던진다.
 */
export function validatePost(input: Record<string, unknown>): PostInput {
  // <swap 3>
  const { title, body = "" } = input;
  if (typeof title !== "string" || typeof body !== "string") throw new HttpError(400, "제목과 내용은 글자여야 해요.");
  const trimmed = title.trim();
  if (!trimmed) throw new HttpError(400, "제목을 적어 주세요.");
  if (trimmed.length > TITLE_MAX) throw new HttpError(400, `제목은 ${TITLE_MAX}자까지예요.`);
  if (body.length > BODY_MAX) throw new HttpError(400, `내용은 ${BODY_MAX}자까지예요.`);
  return { title: trimmed, body };
  // <start>
  // TODO(3단계): 위 규칙대로 검사한다. 지금은 아무 값이나 통과시킨다.
  return { title: String(input.title ?? ""), body: String(input.body ?? "") };
  // </swap>
}
