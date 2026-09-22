import { NextResponse, type NextRequest } from "next/server";
import { getApiAccessLevel } from "@/lib/auth-policy";
import {
  authenticateLearnerMemoryRequest,
  authenticateRequest,
} from "@/lib/server-auth";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/api/auth/session" ||
    request.nextUrl.pathname === "/api/auth/vscode-link/exchange"
  ) {
    return NextResponse.next();
  }

  const learnerMemoryPath =
    request.nextUrl.pathname === "/api/learner-memory" ||
    request.nextUrl.pathname.startsWith("/api/learner-memory/") ||
    request.nextUrl.pathname === "/api/learning-records" ||
    request.nextUrl.pathname.startsWith("/api/learning-records/");
  const result = learnerMemoryPath
    ? await authenticateLearnerMemoryRequest(request)
    : await authenticateRequest(request);
  if (!result.ok) {
    return NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
  }

  const accessLevel = getApiAccessLevel(request.nextUrl.pathname);

  if (!result.user.canUseAi && accessLevel === "owner-ai") {
    return NextResponse.json(
      {
        message:
          "이 계정은 앱과 로컬 덱을 사용할 수 있지만 AI 생성 권한은 없습니다.",
      },
      { status: 403 },
    );
  }

  if (!result.user.canUseAi && accessLevel === "owner-local-data") {
    return NextResponse.json(
      {
        message:
          "사용자별 서버 데이터 분리가 아직 준비되지 않아 이 기능은 운영자만 사용할 수 있습니다. 이 브라우저의 로컬 덱 학습은 계속 사용할 수 있습니다.",
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
