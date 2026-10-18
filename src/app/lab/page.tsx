import { headers } from "next/headers";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import Lab from "./Lab";
export const metadata = { title: "생성 실험실" };
export default async function Page() {
    const h = await headers();
    const request = new Request(`http://${h.get("host") || "localhost"}/lab`, { headers: h });
    if (!isLocalExperimentRequest(request))
        return <main>로컬 실험 모드에서만 사용할 수 있습니다.</main>;
    return <Lab />;
}
