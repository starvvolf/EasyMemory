// 부품: 라우터 — "어떤 메서드 + 어떤 주소"를 어떤 처리 함수로 보낼지 정한다.
// 이 파일은 미리 준비된 부품이다. 읽고 이해하면 되고, 고치지 않아도 된다.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Ctx = { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams };
export type Handler = (ctx: Ctx) => Promise<void> | void;
type Route = { method: string; parts: string[]; handler: Handler };

const split = (path: string) => path.split("/").filter(Boolean);

export type Match = { handler: Handler; params: Record<string, string> } | { handler: null; allowed: string[] };

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method: method.toUpperCase(), parts: split(pattern), handler });
    return this;
  }

  /** 주소가 맞는 경로를 찾는다. 주소는 맞는데 메서드가 다르면 허용되는 메서드 목록을 돌려준다. */
  match(method: string, pathname: string): Match {
    const parts = split(pathname);
    const allowed: string[] = [];
    for (const route of this.routes) {
      const params = matchParts(route.parts, parts);
      if (!params) continue;
      if (route.method === method.toUpperCase()) return { handler: route.handler, params };
      allowed.push(route.method);
    }
    return { handler: null, allowed };
  }
}

function matchParts(pattern: string[], parts: string[]) {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pattern[i] !== parts[i]) return null;
  }
  return params;
}
