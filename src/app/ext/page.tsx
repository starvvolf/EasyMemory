import { headers } from "next/headers";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import ExtPanel from "./ExtPanel";

export const metadata = { title: "Recaller 사이드바" };

// 크롬 확장의 사이드 패널 안에서 열리는 화면 (extension/recaller-sidepanel). Local only, like the rest of the study tools.
export default async function Page() {
  const h = await headers();
  const request = new Request(`http://${h.get("host") || "localhost"}/ext`, { headers: h });
  if (!isLocalExperimentRequest(request)) return <main style={{ padding: 20 }}>로컬 실험 모드에서만 사용할 수 있습니다.</main>;
  return (
    <>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      <ExtPanel />
    </>
  );
}
