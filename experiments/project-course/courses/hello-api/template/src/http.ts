// 부품: HTTP 도우미 — 요청 본문 읽기, JSON 응답 보내기. 미리 준비된 부품이라 고치지 않아도 된다.
import type { IncomingMessage, ServerResponse } from "node:http";

/** 처리 중에 던지면 server.ts가 이 상태 코드와 메시지로 응답한다. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 상태 코드와 JSON 본문으로 답장을 보낸다. */
export function sendJson(res: ServerResponse, status: number, body?: unknown) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, text ? { "content-type": "application/json; charset=utf-8" } : {});
  res.end(text);
}

/** 요청 본문을 JSON으로 읽는다. 비어 있으면 {}. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  } catch { /* 아래에서 400 */ }
  throw new HttpError(400, "본문은 { } 모양의 JSON이어야 해요.");
}
