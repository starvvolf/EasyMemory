import { NextResponse, type NextRequest } from "next/server";
import { isLocalExperimentRequest, isSameOriginExperimentMutation } from "@/lib/local-experiment-mode";

// 모든 API는 내 PC(127.0.0.1)에서 온 같은 출처 요청만 받는다 (11/15 리팩토링: Firebase 로그인 길을 뺐다).
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/local-experiment/status") return NextResponse.next();
  if (!isLocalExperimentRequest(request)) {
    return NextResponse.json({ message: "Recaller는 내 PC(127.0.0.1)에서만 쓸 수 있어요." }, { status: 403 });
  }
  // 유튜브 정리 패널(youtube.com 위의 Tampermonkey)이 보내는 것: 사용자 지정 머리글이 있어야 한다(웹 페이지는 CORS 사전 요청 없이 못 붙인다).
  const panel = request.nextUrl.pathname === "/api/youtube" && request.method === "POST" && request.headers.get("x-recaller-client") === "youtube-panel";
  if (!panel && !isSameOriginExperimentMutation(request)) {
    return NextResponse.json({ message: "같은 출처의 요청만 허용합니다." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
