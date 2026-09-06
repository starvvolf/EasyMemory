export type AuthClaims = {
  uid?: string;
  email?: string;
  email_verified?: boolean;
  firebase?: {
    sign_in_provider?: string;
  };
};

export type AuthenticatedUser = {
  uid: string;
  email: string;
  canUseAi: boolean;
};

export type ApiAccessLevel = "member" | "owner-ai" | "owner-local-data";

const ownerOnlyAiRoutes = new Set([
  "/api/analyze",
  "/api/plan",
  "/api/generate",
  "/api/codex/chat",
]);

const ownerOnlyLocalDataPrefixes = [
  "/api/codex",
  "/api/coding-sessions",
  "/api/mcp-decks",
  "/api/model-config",
  "/api/project-status",
  "/api/study-projects",
  "/api/study-sources",
];

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function readAiOwnerEmail(
  value: string | undefined,
): { ok: true; email: string } | { ok: false; missing: string[] } {
  const email = normalizeEmail(value ?? "");
  return email
    ? { ok: true, email }
    : { ok: false, missing: ["AI_OWNER_EMAIL"] };
}

export function authorizeAuthenticatedUser(
  claims: AuthClaims,
  ownerEmail: string,
): AuthenticatedUser | null {
  const uid = claims.uid?.trim();
  const email = normalizeEmail(claims.email ?? "");

  if (
    !uid ||
    !email ||
    claims.email_verified !== true ||
    claims.firebase?.sign_in_provider !== "google.com"
  ) {
    return null;
  }

  return {
    uid,
    email,
    canUseAi: email === normalizeEmail(ownerEmail),
  };
}

export function getApiAccessLevel(pathname: string): ApiAccessLevel {
  if (ownerOnlyAiRoutes.has(pathname)) return "owner-ai";
  if (
    ownerOnlyLocalDataPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return "owner-local-data";
  }
  return "member";
}
