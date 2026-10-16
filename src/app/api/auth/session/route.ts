import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, authenticateRequest } from "@/lib/server-auth";

export async function POST(request: Request) {
  const result = await authenticateRequest(request);
  if (!result.ok) {
    return NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
  }

  const authorization = request.headers.get("authorization");
  const idToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!idToken) {
    return NextResponse.json({ message: "로그인 토큰이 없습니다." }, { status: 401 });
  }

  const response = NextResponse.json({
    uid: result.user.uid,
    email: result.user.email,
    canUseAi: result.user.canUseAi,
  });
  response.cookies.set(AUTH_COOKIE_NAME, idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 55 * 60,
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
