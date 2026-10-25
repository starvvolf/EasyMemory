import { headers } from "next/headers";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import RoomApp from "./RoomApp";

export const metadata = { title: "토론방 · Recaller" };

export default async function Page() {
  const h = await headers();
  const request = new Request(`http://${h.get("host") || "localhost"}/room`, { headers: h });
  if (!isLocalExperimentRequest(request)) return <main>로컬 실험 모드에서만 사용할 수 있습니다.</main>;
  // Fonts: Pretendard for reading, Gowun Batang for the topic. Without a connection the system fonts take over.
  return (
    <>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" precedence="default" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap" precedence="default" />
      <RoomApp />
    </>
  );
}
