import { headers } from "next/headers";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import AiLab from "./AiLab";

export const metadata = { title: "AI 호출 실험실" };

export default async function Page() {
  const h = await headers();
  const request = new Request(`http://${h.get("host") || "localhost"}/lab/ai`, { headers: h });
  if (!isLocalExperimentRequest(request)) return <main>로컬 실험 모드에서만 사용할 수 있습니다.</main>;
  return <>
    {/* 11/7 사용자 "폰트도 모던하고 이쁜 폰트로": Pretendard(본문) + JetBrains Mono(지시문·코드). 막히면 시스템 글꼴로. */}
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" />
    <AiLab />
  </>;
}
