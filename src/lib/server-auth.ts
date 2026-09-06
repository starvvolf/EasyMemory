import "server-only";

import { authorizeAuthenticatedUser, readAiOwnerEmail } from "@/lib/auth-policy";
import { getFirebaseAdminAuth } from "@/lib/firebase-admin";

export type AuthenticationResult =
  | {
      ok: true;
      user: {
        uid: string;
        email: string;
        canUseAi: boolean;
      };
    }
  | {
      ok: false;
      status: 401 | 500;
      message: string;
    };

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticationResult> {
  const owner = readAiOwnerEmail(process.env.AI_OWNER_EMAIL);
  if (!owner.ok) {
    return {
      ok: false,
      status: 500,
      message: `서버 인증 설정이 없습니다. 누락된 환경 변수: ${owner.missing.join(", ")}`,
    };
  }

  const token = readIdToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "로그인이 필요합니다.",
    };
  }

  try {
    const claims = await getFirebaseAdminAuth().verifyIdToken(token);
    const user = authorizeAuthenticatedUser(claims, owner.email);
    if (!user) {
      return {
        ok: false,
        status: 401,
        message: "확인된 Google 이메일이 있는 계정으로 다시 로그인해 주세요.",
      };
    }
    return { ok: true, user };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Firebase 서버 설정")) {
      return { ok: false, status: 500, message: error.message };
    }
    return {
      ok: false,
      status: 401,
      message: "로그인 정보가 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.",
    };
  }
}

export const AUTH_COOKIE_NAME = "study_forge_id_token";

function readIdToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}
