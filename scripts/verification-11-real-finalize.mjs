import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import envModule from "@next/env";
const { loadEnvConfig } = envModule;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { getLabRun } = await import("../src/lib/study/lab-store.ts");
const { readExecutorCalls } = await import("../src/lib/study/auto-executor.ts");
const root = path.join(process.cwd(), "협업", "검증_11", "real");
const ledgerFile = path.join(root, "call-budget.json");
const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
ledger.stopped = "same-validation-failure-recurred";
ledger.stoppedAt ??= new Date().toISOString();
writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
const cases = [
  { caseId: "bfs-2pages-gpt-6-luna", requestId: "req_cf57cc2edd05e056e108101d4967cc96", previousBackendCalls: 3, pages: 2, wallElapsedMs: 30265 },
  { caseId: "bfs-2pages-gpt-6-sol", requestId: "req_95f6a42ea6e171b2f6ef8141b23d97f9", previousBackendCalls: 0, pages: 2, wallElapsedMs: 63580 },
  { caseId: "geometry-10pages-gpt-6-luna", requestId: "req_bc77ceccaabc6a96f582bb711a2a5d7d", previousBackendCalls: 0, pages: 10, wallElapsedMs: null },
];
const rows = [];
for (const entry of cases) {
  const run = await getLabRun(entry.requestId);
  const calls = await readExecutorCalls(entry.requestId);
  const newCalls = calls.filter((call) => call.n > entry.previousBackendCalls);
  const reserved = ledger.calls.filter((call) => call.caseId === entry.caseId);
  const objectives = run.request.stages.find((stage) => stage.stage === "learning-design")?.output?.learningDesign?.objectives?.length ?? null;
  const errors = {};
  for (const call of newCalls.filter((call) => !call.ok && call.error)) {
    const hash = createHash("sha256").update(call.error).digest("hex");
    errors[hash] = (errors[hash] ?? 0) + 1;
  }
  rows.push({ caseId: entry.caseId, requestId: entry.requestId, runId: run.executor.runId,
    model: reserved.at(-1)?.model, effort: reserved.at(-1)?.effort,
    executorStatus: run.executor.status, requestStatus: run.request.status, stoppedStage: run.executor.stage,
    recordedBackendCalls: run.executor.calls, backendCallsDuringNetworkResume: newCalls.length,
    allReservedFetchAttempts: reserved.length, httpResponsesReceived: reserved.filter((call) => call.httpStatus !== undefined).length,
    failedBackendCallsDuringNetworkResume: newCalls.filter((call) => !call.ok && call.error).length,
    interruptedCallsWithoutCompletion: newCalls.filter((call) => !call.ok && !call.error).length,
    retriesDuringNetworkResume: newCalls.filter((call) => call.attempt > 1).length,
    guardBlockedCallsAcrossBothAttempts: Math.max(0, calls.length - reserved.length),
    errorClass: run.executor.status === "interrupted" ? "interrupted" : newCalls.some((call) => !call.ok && call.error) ? "stage-validation" : null, errorCountsByHash: errors,
    wallElapsedMs: entry.wallElapsedMs,
    summedBackendCallMsDuringNetworkResume: newCalls.reduce((sum, call) => sum + call.ms, 0),
    slowest: newCalls.toSorted((a, b) => b.ms - a.ms).map(({ purpose, ms, ok }) => ({ purpose, ms, ok }))[0] ?? null,
    pages: entry.pages, objectives, pagesPerObjective: objectives ? entry.pages / objectives : null,
    humanReview: `/lab request ${entry.requestId}: ${run.executor.status === "interrupted" ? "analyze" : "concept-tree and learning-design"}`,
    confirmedConnectionIssue: entry.caseId === "bfs-2pages-gpt-6-sol" ? "한줄 루트만 생성되어 참조 가능한 쪽 근거 개념 0. 모델 성능 결론이 아니라 단계 연결 조건 문제이며 자동 수정하지 않았다." : null,
  });
}
const result = { schemaVersion: 2, at: new Date().toISOString(), approvalLimit: 60,
  reservedAttemptsAcrossBothNetworkEnvironments: ledger.calls.length,
  httpResponsesReceived: ledger.calls.filter((call) => call.httpStatus !== undefined).length,
  sandboxConnectionFailuresConservativelyReserved: 2,
  remainingConservativeBudget: 60 - ledger.calls.length,
  stage5CompletedGenerations: 0, stage5StartedCases: rows.length, stage5UnstartedCases: 3,
  stage6Questions: 0, stopped: ledger.stopped, rows,
  stopConditionBreach: "The first case repeated the same error nonconsecutively. The initial guard checked only consecutive duplicates and missed this recurrence. A second case and the beginning of a third ran before the process was stopped. No further model call is allowed without user approval.",
  userDataPreserved: "Interrupted request state and incomplete output directory were preserved. Request status was not rewritten.",
  qualityAssessmentPerformed: false,
};
const file = path.join(root, `resume-stopped-${Date.now()}-v2_public.json`);
writeFileSync(file, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ file, reservedAttempts: result.reservedAttemptsAcrossBothNetworkEnvironments, httpResponses: result.httpResponsesReceived, remaining: result.remainingConservativeBudget, stage6Questions: 0, rows: rows.map(({ caseId, executorStatus, requestStatus, runId }) => ({ caseId, executorStatus, requestStatus, runId })) }));
