import { NextResponse, type NextRequest } from "next/server";
import { isLocalExperimentRequest, isSameOriginExperimentMutation } from "@/lib/local-experiment-mode";

// 모든 API는 내 PC(127.0.0.1)에서 온 같은 출처 요청만 받는다 (11/15 리팩토링: Firebase 로그인 길을 뺐다).
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/local-experiment/status") return NextResponse.next();
  if (!isLocalExperimentRequest(request)) {
    return NextResponse.json({ message: "Recaller는 내 PC(127.0.0.1)에서만 쓸 수 있어요." }, { status: 403 });
  }
  if (!isSameOriginExperimentMutation(request)) {
    return NextResponse.json({ message: "같은 출처의 요청만 허용합니다." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
