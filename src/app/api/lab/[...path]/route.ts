import { NextResponse } from "next/server";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { requireLocalRequest, boundedJson, responseError } from "../../mcp-experiment-requests/http";
import { labStageList } from "@/lib/study/lab-contract";
import { createLabRun, listLabRuns, getLabRun, continueLabRun } from "@/lib/study/lab-store";
import { configureLab, readExecutorCalls } from "@/lib/study/auto-executor";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { registerMcpSource } from "@/lib/mcp-source-registry";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
type Context = {
    params: Promise<{
        path: string[];
    }>;
};
async function handle(request: Request, context: Context) {
    try {
        if (!isLocalExperimentRequest(request))
            throw new ExperimentRequestError(403, "로컬 실험 모드에서만 사용할 수 있습니다.");
        await requireLocalRequest(request);
        const { path: p } = await context.params;
        let result: unknown;
        if (request.method === "POST" && p.length === 1 && p[0] === "fixture") {
            result = { source: await registerMcpSource("cornell-bfs-2pages.pdf", new Uint8Array(await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf")))) };
        }
        else if (request.method === "GET" && p.length === 1 && p[0] === "stages")
            result = { stages: labStageList };
        else if (p[0] === "runs" && p.length === 1 && request.method === "GET")
            result = { runs: await listLabRuns() };
        else if (p[0] === "runs" && p.length === 1 && request.method === "POST")
            result = { request: await createLabRun(await boundedJson(request)) };
        else if (p[0] === "runs" && p.length === 2 && request.method === "GET")
            result = await getLabRun(p[1]);
        else if (p[0] === "runs" && p.length === 2 && request.method === "PATCH") {
            await getLabRun(p[1]);
            await configureLab(p[1], await boundedJson(request));
            result = { ok: true };
        }
        else if (p[0] === "runs" && p.length === 3 && p[2] === "continue" && request.method === "POST") {
            const b = await boundedJson(request) as {
                confirmed?: boolean;
            };
            await continueLabRun(p[1], b.confirmed === true);
            result = { ok: true };
        }
        else if (p[0] === "runs" && p.length === 4 && p[2] === "calls" && request.method === "GET" && /^\d+$/.test(p[3])) {
            await getLabRun(p[1]);
            result = (await readExecutorCalls(p[1])).find(c => c.n === Number(p[3]));
            if (!result)
                throw new ExperimentRequestError(404, "호출 기록을 찾을 수 없습니다.");
        }
        else
            throw new ExperimentRequestError(404, "경로를 찾을 수 없습니다.");
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    catch (e) {
        return responseError(e);
    }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
