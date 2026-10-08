import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resultsRoot, ledgerFile, preflight } from "./verification-11-real.mjs";
import { stopRepeatedRecordedFailures } from "./verification-11-real-budget.mjs";
if (!preflight.ready) throw new Error("ChatGPT connection required; no provider fallback allowed.");
process.env.STUDY_FORGE_LOCAL_EXPERIMENT = "1";
process.env.STUDY_FORGE_LOCAL_EXPERIMENT_BIND = "127.0.0.1";
process.env.STUDY_FORGE_MODEL_PROVIDER = "chatgpt";
const { createLabRun, getLabRun, continueLabRun } = await import("../src/lib/study/lab-store.ts");
const { registerMcpSource } = await import("../src/lib/mcp-source-registry.ts");
const { extractPdfPageTexts } = await import("../tools/study-forge-mcp/source-evidence.ts");
const { readExecutorCalls } = await import("../src/lib/study/auto-executor.ts");
const mode = process.argv[2] ?? "prepare";
const count = () => existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")).calls.length : 0;
const budget = () => existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : { calls: [] };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (process.argv.includes("--new-batch-approved")) {
  const ledger = budget();
  writeFileSync(path.join(resultsRoot, `call-budget-before-new-batch-${stamp}.json`), JSON.stringify(ledger, null, 2), { flag: "wx" });
  ledger.resumes = [...(ledger.resumes ?? []), { at: new Date().toISOString(), reason: "User approved new requests after concept-tree submission repair and source-input correction", previousStop: ledger.stopped ?? null, preservedCalls: ledger.calls.length, batchId: stamp }];
  for (const key of ["stopped", "stoppedAt", "lastCorrection", "correctionCounts", "recordedFailureCounts", "lastHttpError", "repeatedHttpErrors", "httpErrorCounts"]) delete ledger[key];
  ledger.batchId = stamp;
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
}
if (process.argv.includes("--resume-approved")) {
  const ledger = budget();
  if (ledger.stopped) {
    writeFileSync(path.join(resultsRoot, `call-budget-before-approved-resume-${stamp}.json`), JSON.stringify(ledger, null, 2), { flag: "wx" });
    ledger.resumes = [...(ledger.resumes ?? []), { at: new Date().toISOString(), reason: "User approved a network-enabled process after sandbox EACCES diagnosis", previousStop: ledger.stopped, preservedCalls: ledger.calls.length }];
    delete ledger.stopped;
    delete ledger.lastCorrection;
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  }
}
const batchDir = path.join(resultsRoot, `${mode}-${stamp}`);
mkdirSync(batchDir, { recursive: true });
const save = (file, value) => writeFileSync(path.join(batchDir, file), JSON.stringify(value, null, 2), { flag: "wx" });
globalThis.__verification11Event = (event) => console.log(JSON.stringify(event));
const files = [
  { name: "bfs-2pages", file: path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf"), pages: [1, 2] },
  { name: "geometry-10pages", file: "C:/Users/jkh01/OneDrive/바탕 화면/예외폴/02_Geometric Transformations.pdf", pages: Array.from({ length: 10 }, (_, i) => i + 1) },
  { name: "merged-44-one-page", file: "C:/Users/jkh01/OneDrive/바탕 화면/예외폴/ilovepdf_merged.pdf", pages: [3] },
];
const sources = [];
for (const entry of files) {
  const bytes = new Uint8Array(readFileSync(entry.file));
  const texts = await extractPdfPageTexts(bytes, entry.pages);
  if ([...texts.values()].every((text) => !text.trim())) throw new Error("Selected source pages have no text.");
  const source = await registerMcpSource(path.basename(entry.file), bytes);
  sources.push({ ...entry, source, texts: [...texts].map(([page, text]) => ({ page, text })) });
}
save("sources.json", sources.map(({ name, source, pages, texts }) => ({ name, source, pages, texts })));
if (mode === "stage5") {
  const rows = [];
  const batchCalls = [];
  for (const material of sources) for (const setting of [{ model: "gpt-6-luna", effort: "low" }, { model: "gpt-6-sol", effort: "medium" }]) {
    if (budget().stopped || count() >= 60) break;
    if (material.name !== "bfs-2pages" && rows.filter((row) => row.material === "bfs-2pages" && row.status === "done").length !== 2) {
      const ledger = budget(); ledger.stopped = "cornell-authoring-gate-not-passed"; ledger.stoppedAt = new Date().toISOString(); writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
      break;
    }
    if (budget().stopped || count() >= 60) break;
    if (budget().unavailableModels?.includes(setting.model)) {
      rows.push({ material: material.name, ...setting, status: "unavailable", calls: 0 });
      continue;
    }
    const caseId = `${material.name}-${setting.model}`;
    globalThis.__verification11Operation = { caseId, phase: "stage5" };
    const startedAt = Date.now(), before = count();
    const resumeId = caseId === "bfs-2pages-gpt-6-luna" && process.argv.includes("--resume-approved") ? "req_cf57cc2edd05e056e108101d4967cc96" : null;
    let request;
    if (resumeId) {
      const previous = await getLabRun(resumeId);
      globalThis.__verification11Operation.previousRecordedCalls = previous.executor.calls;
      if (previous.executor.status === "done") request = previous.request;
      else { await continueLabRun(resumeId, true); request = previous.request; }
    } else request = await createLabRun({ sourceId: material.source.id, startPage: material.pages[0], endPage: material.pages.at(-1),
      purpose: "선택한 원문 내용을 시험 대비로 공부한다. 원문에서 확인할 수 있는 핵심을 기억하고 설명한다.",
      lab: { provider: "chatgpt", stepMode: false, stages: Object.fromEntries(["analyze", "concept-tree", "learning-design", "activity-design", "cards", "authoring"].map((stage) => [stage, setting])) }, confirmed: true });
    console.log(JSON.stringify({ type: "started", caseId, requestId: request.id }));
    let run;
    do { await new Promise((resolve) => setTimeout(resolve, 1000)); run = await getLabRun(request.id); }
    while (["queued", "running"].includes(run.executor.status));
    const calls = await readExecutorCalls(request.id);
    batchCalls.push(...calls.filter((call) => call.n > (globalThis.__verification11Operation.previousRecordedCalls ?? 0)));
    stopRepeatedRecordedFailures(ledgerFile, batchCalls);
    const learning = run.request.stages.find((stage) => stage.stage === "learning-design")?.output?.learningDesign;
    const timings = run.executor.timings ?? [];
    const slowest = timings.toSorted((a, b) => b.ms - a.ms)[0];
    const row = { caseId, material: material.name, ...setting, requestId: request.id, runId: run.request.runId,
      status: budget().unavailableModels?.includes(setting.model) ? "unavailable" : run.executor.status,
      ms: Date.now() - startedAt, outgoingFetchAttempts: count() - before, recordedCalls: run.executor.calls,
      backendFailures: calls.filter((call) => !call.ok).length,
      guardBlockedBeforeFetch: calls.filter((call) => call.n > (globalThis.__verification11Operation.previousRecordedCalls ?? 0)).length - (count() - before),
      httpResponsesReceived: budget().calls.slice(before).filter((call) => call.httpStatus !== undefined).length,
      slowest, objectives: learning?.objectives?.length ?? null,
      pagesPerObjective: learning?.objectives?.length ? material.pages.length / learning.objectives.length : null,
      reviewAt: `/lab (request ${request.id})`, message: run.executor.message, engineChecks: run.engineChecks };
    rows.push(row);
    save(`${caseId}-summary.json`, row);
    save(`${caseId}-calls.json`, calls);
    save(`${caseId}-outputs.json`, { stages: run.request.stages, authoring: run.authoring });
    writeFileSync(path.join(batchDir, "summary_public.json"), JSON.stringify({ batchId: stamp, modelCallsTotal: count(), httpResponsesTotal: budget().calls.filter((call) => call.httpStatus !== undefined).length, remaining: 60 - count(), stopped: budget().stopped ?? null, notesExecuted: 0, rows: rows.map((row) => { const safe = { ...row }; delete safe.message; delete safe.engineChecks; return safe; }) }, null, 2));
    console.log(JSON.stringify({ type: "finished", caseId, requestId: request.id, status: row.status, outgoingFetchAttempts: row.outgoingFetchAttempts, ms: row.ms }));
    if (budget().stopped || ["paused-login", "paused-usage-limit"].includes(run.executor.status) && row.status !== "unavailable") break;
  }
  save("summary.json", { rows, modelCallsTotal: count(), budgetStopped: budget().stopped ?? null });
} else if (mode !== "prepare") throw new Error("Unsupported experiment mode.");
console.log(JSON.stringify({ type: "complete", mode, modelCallsTotal: count(), directory: batchDir }));
