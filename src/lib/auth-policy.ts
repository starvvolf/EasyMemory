export type AuthClaims = {
  uid?: string;
  email?: string;
  email_verified?: boolean;
};

export type AuthenticatedUser = {
  uid: string;
  email: string;
  canUseAi: boolean;
};

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

  if (!uid || !email || claims.email_verified !== true) {
    return null;
  }

  return {
    uid,
    email,
    canUseAi: email === normalizeEmail(ownerEmail),
  };
}
