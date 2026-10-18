import "server-only";
import { loadLearnerMemory, applyLearnerMemorySummary, editLearnerMemory } from "@/lib/firebase-learner-memory-store";
import { requireLearnerMemoryUser, toUserDataError } from "@/lib/server-user";
import { createMemoryHttpHandlers } from "./http";

export const memoryHttpHandlers = createMemoryHttpHandlers({
  authenticate: requireLearnerMemoryUser,
  load: loadLearnerMemory,
  apply: applyLearnerMemorySummary,
  edit: async (uid, input, options) => ({ state: await editLearnerMemory(uid, input.target, input.change, options) }),
  mapError: (error) => toUserDataError(error, "학습자 기억 요청을 처리하지 못했습니다."),
});
