import { headers } from "next/headers";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import ReviewLab from "./ReviewLab";

export const metadata = { title: "총정리 실험실" };

// 총정리 실험실 (11/12 사용자 "단위 작게 할 수 있게 해서 프롬프트랑 모델 조정하면서 뭐 나오는지 볼 수 있는"). B 세션.
export default async function Page() {
  const h = await headers();
  const request = new Request(`http://${h.get("host") || "localhost"}/lab/review`, { headers: h });
  if (!isLocalExperimentRequest(request)) return <main>로컬 실험 모드에서만 사용할 수 있습니다.</main>;
  return <>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" />
    <ReviewLab />
  </>;
}
