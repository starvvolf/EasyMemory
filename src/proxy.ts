import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/server-auth";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/auth/session") {
    return NextResponse.next();
  }

  const result = await authenticateRequest(request);
  if (!result.ok) {
    return NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
  }

  if (!result.user.canUseAi) {
    return NextResponse.json(
      {
        message:
          "이 계정은 앱과 로컬 덱을 사용할 수 있지만 AI 생성 권한은 없습니다.",
      },
      { status: 403 },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-study-forge-user-id", result.user.uid);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: "/api/:path*",
};
