// 부품: HTTP 도우미 — 요청 본문 읽기, JSON 응답 보내기, 쿠키 읽기.
import type { IncomingMessage, ServerResponse } from "node:http";

/** 처리 중에 던지면 server.ts가 이 상태 코드와 메시지로 응답한다. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { ...(text ? { "content-type": "application/json; charset=utf-8" } : {}), ...headers });
  res.end(text);
}

/** 요청 본문을 JSON으로 읽는다. 본문이 비어 있으면 {}. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new HttpError(413, "요청 본문이 너무 커요.");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  // <swap 3>
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "본문이 JSON 형식이 아니에요.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "본문은 { } 객체여야 해요.");
  return value as Record<string, unknown>;
  // <start>
  return JSON.parse(text);
  // </swap>
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}
