import "server-only";

import { isLocalExperimentRequest, isSameOriginExperimentMutation } from "@/lib/local-experiment-mode";
import { UserDataHttpError } from "@/lib/server-user";

export type ExperimentPrincipal = { mode: "local-experiment"; id: "local-experiment" };

/** Recaller는 내 PC에서만 돈다: 127.0.0.1에서 온 같은 출처 요청만 받는다 (11/15 리팩토링: Firebase 계정 길을 뺐다). */
export async function requireExperimentPrincipal(request: Request): Promise<ExperimentPrincipal> {
  if (!isLocalExperimentRequest(request)) throw new UserDataHttpError(403, "Recaller는 내 PC(127.0.0.1)에서만 쓸 수 있어요.");
  if (!isSameOriginExperimentMutation(request)) throw new UserDataHttpError(403, "같은 출처의 요청만 허용합니다.");
  return { mode: "local-experiment", id: "local-experiment" };
}
