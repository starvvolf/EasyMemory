import "server-only";

import { isLocalExperimentRequest, isSameOriginExperimentMutation } from "@/lib/local-experiment-mode";
import { requireAuthenticatedUser, UserDataHttpError } from "@/lib/server-user";

export type ExperimentPrincipal =
  | { mode: "local-experiment"; id: "local-experiment" }
  | { mode: "firebase-owner"; id: string };

/** Only experiment APIs may call this; it does not authorize normal cloud data routes. */
export async function requireExperimentPrincipal(request: Request): Promise<ExperimentPrincipal> {
  if (isLocalExperimentRequest(request)) {
    if (!isSameOriginExperimentMutation(request)) {
      throw new UserDataHttpError(403, "같은 출처의 요청만 허용합니다.");
    }
    return { mode: "local-experiment", id: "local-experiment" };
  }
  const user = await requireAuthenticatedUser(request);
  if (!user.canUseAi) throw new UserDataHttpError(403, "이 실험 기록을 사용할 권한이 없습니다.");
  return { mode: "firebase-owner", id: user.uid };
}
