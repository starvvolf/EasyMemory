/**
 * A deliberately narrow switch for explicitly listed local experiment APIs.
 * The server must be started with --hostname 127.0.0.1; the env value records
 * that launch choice and the request host is checked again on every request.
 */
export function isLocalExperimentRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (
    env.NODE_ENV === "production" ||
    env.STUDY_FORGE_LOCAL_EXPERIMENT !== "1" ||
    env.STUDY_FORGE_LOCAL_EXPERIMENT_BIND !== "127.0.0.1"
  ) return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  // Next may normalize request.url to localhost even when the socket and Host
  // header use 127.0.0.1. The external-facing Host remains mandatory below.
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  const host = request.headers.get("host");
  if (!host || !/^127\.0\.0\.1(?::\d{1,5})?$/.test(host)) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && !/^127\.0\.0\.1(?::\d{1,5})?$/.test(forwardedHost)) return false;
  return true;
}

/** Diagnostics are only disclosed to an explicitly enabled loopback request. */
export function localExperimentStatusPayload(
  request: Request,
  runtime: { serverPid: number; projectRoot: string },
  env: Record<string, string | undefined> = process.env,
) {
  const base = { active: isLocalExperimentRequest(request, env), mode: "local-experiment" as const };
  return base.active ? { ...base, serverPid: runtime.serverPid, projectRoot: runtime.projectRoot } : base;
}

export function isLocalExperimentApiPath(pathname: string): boolean {
  return pathname === "/api/mcp-runs" ||
    pathname.startsWith("/api/mcp-runs/") ||
    pathname === "/api/mcp-experiment-requests" ||
    pathname.startsWith("/api/mcp-experiment-requests/") ||
    pathname === "/api/personalization-lab" ||
    pathname.startsWith("/api/personalization-lab/") ||
    pathname === "/api/study-executor" ||
    pathname === "/api/auth/chatgpt/start" ||
    pathname === "/api/auth/chatgpt/callback" ||
    pathname === "/api/auth/chatgpt/logout";
}

export function isSameOriginExperimentMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const internalUrl = new URL(request.url);
    return new URL(origin).origin === `${internalUrl.protocol}//${host}`;
  } catch {
    return false;
  }
}
