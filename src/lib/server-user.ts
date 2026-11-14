import "server-only";

export class UserDataHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UserDataHttpError";
  }
}

export function toUserDataError(error: unknown, fallback: string) {
  if (error instanceof UserDataHttpError) {
    return { status: error.status, message: error.message };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : fallback,
  };
}
