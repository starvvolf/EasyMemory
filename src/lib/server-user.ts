import "server-only";

import { authenticateRequest } from "@/lib/server-auth";

export class UserDataHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UserDataHttpError";
  }
}

export async function requireAuthenticatedUser(request: Request) {
  const result = await authenticateRequest(request);
  if (!result.ok) throw new UserDataHttpError(result.status, result.message);
  return result.user;
}

export function toUserDataError(error: unknown, fallback: string) {
  if (error instanceof UserDataHttpError) {
    return { status: error.status, message: error.message };
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "revision-conflict"
  ) {
    return {
      status: 409,
      message:
        error instanceof Error
          ? error.message
          : "다른 기기에서 먼저 변경되었습니다.",
    };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : fallback,
  };
}
