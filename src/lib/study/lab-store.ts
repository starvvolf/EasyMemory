import { readFile } from "node:fs/promises";
import path from "node:path";
import { createExperimentRequest, getExperimentRequest, listExperimentRequests, experimentStages, ExperimentRequestError } from "../mcp-experiment-requests.ts";
import { executorView, configureLab, readExecutorCalls, enqueueStudyRequest } from "./auto-executor.ts";
import { labConfigSchema, labStageList } from "./lab-contract.ts";
import { authoringRunsRoot } from "../../../tools/study-forge-mcp/authoring-packet.ts";
import { renderInteractiveDocument } from "../../../tools/problem-authoring-lab/renderer.ts";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { z } from "zod";
import { resolveMcpSource } from "../mcp-source-registry.ts";
const newRunSchema = z.strictObject({ sourceId: z.string(), startPage: z.number().int().positive(), endPage: z.number().int().positive().max(500),
    purpose: z.string().min(1).max(2000), abilities: z.array(z.string()).default([]), lab: labConfigSchema, confirmed: z.boolean().optional() });
export async function createLabRun(body: unknown) {
    const b = newRunSchema.parse(body);
    if (b.endPage < b.startPage)
        throw new ExperimentRequestError(400, "끝 쪽은 시작 쪽 이상이어야 합니다.");
    if (b.lab.provider === "fake") {
        const source = await resolveMcpSource(b.sourceId);
        if (source?.fileName !== "cornell-bfs-2pages.pdf" || b.startPage !== 1 || b.endPage !== 1)
            throw new ExperimentRequestError(400, "가짜 모델은 cornell-bfs-2pages.pdf의 1쪽 전용입니다. 예제 PDF를 등록해 주세요.");
    }
    if (b.lab.provider === "chatgpt" && b.confirmed !== true)
        throw new ExperimentRequestError(400, "실제 모델 실행 확인이 필요합니다.");
    const fallback = { model: "gpt-6-luna" as const, effort: "low" as const };
    const request = await createExperimentRequest({ sourceId: b.sourceId,
        scope: { pageNumbers: Array.from({ length: b.endPage - b.startPage + 1 }, (_, i) => b.startPage + i), outlineLeafIds: [] },
        purpose: b.purpose, abilities: b.abilities, stopAfterStage: "cards",
        requestedStages: Object.fromEntries(experimentStages.map(s => [s, b.lab.stages[s] ?? fallback])),
    });
    await configureLab(request.id, b.lab);
    await enqueueStudyRequest(request.id, { uid: "local-experiment" }, b.confirmed === true);
    return request;
}
export async function listLabRuns() {
    const requests = await listExperimentRequests();
    const results = await Promise.all(requests.map(async (request) => {
        const executor = await executorView(request.id);
        return executor?.lab ? { request, executor } : null;
    }));
    return results.filter(r => r !== null);
}
export async function getLabRun(id: string) {
    const request = await getExperimentRequest(id);
    const executor = await executorView(id);
    if (!executor?.lab)
        throw new ExperimentRequestError(404, "실험실 실행을 찾을 수 없습니다.");
    const calls = await readExecutorCalls(id);
    let engineChecks: unknown = null;
    if (request.runId && /^[\w.-]+$/.test(request.runId)) {
        try {
            const record = JSON.parse(await readFile(path.join(process.env.STUDY_FORGE_DATA_DIR || path.join(process.cwd(), ".study-forge-data"), "mcp", "chatgpt-runs", request.runId, "run.json"), "utf8"));
            engineChecks = { stageValidationFailures: record.stageValidationFailures, stageAttemptCounts: record.stageAttemptCounts };
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                throw e;
        }
    }
    let authoring: {
        document: AuthoringDocument;
        issues: unknown;
        html: string;
        iteration: number;
    } | null = null;
    if (request.runId && /^[\w.-]+$/.test(request.runId)) {
        for (const iteration of [1, 0]) {
            const dir = path.join(authoringRunsRoot(), request.runId, `iteration-${iteration}`);
            try {
                const document = JSON.parse(await readFile(path.join(dir, "document.json"), "utf8")) as AuthoringDocument;
                const issues = JSON.parse(await readFile(path.join(dir, "inspection.json"), "utf8")) as unknown;
                const html = renderInteractiveDocument(document).replaceAll("../../../assets/katex/", "/api/personalization-lab/assets/katex/").replaceAll("../../../assets/fonts/", "/api/personalization-lab/assets/fonts/");
                authoring = { document, issues, html, iteration };
                break;
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                    throw e;
            }
        }
    }
    const summaries = calls.map(({ system: _system, user: _user, reply: _reply, ...rest }) => { void _system; void _user; void _reply; return rest; });
    return { stages: labStageList, request, executor, calls: summaries, authoring, engineChecks };
}
export async function continueLabRun(id: string, confirmed: boolean) {
    const run = await getLabRun(id);
    if (run.executor.lab!.provider === "chatgpt" && !confirmed)
        throw new ExperimentRequestError(400, "실제 모델 실행 확인이 필요합니다.");
    if (["done", "failed", "running", "queued"].includes(run.executor.status))
        throw new ExperimentRequestError(409, "멈춘 실행만 이어갈 수 있습니다.");
    await enqueueStudyRequest(id, { uid: "local-experiment" }, confirmed);
}
export type LabRun = Awaited<ReturnType<typeof getLabRun>>;
export type LabRunSummary = Awaited<ReturnType<typeof listLabRuns>>[number];
