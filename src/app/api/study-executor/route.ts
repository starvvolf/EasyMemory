import { NextResponse } from "next/server";
import { modelBackend } from "@/lib/ai/model";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { enqueueStudyRequest, executorView } from "@/lib/study/auto-executor";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { boundedJson, responseError } from "../mcp-experiment-requests/http";

export const runtime = "nodejs";

// The in-app executor runs only when turned on; otherwise requests wait for the MCP chat executor as before.
const enabled = () => process.env.STUDY_FORGE_AUTO_EXECUTOR === "1";
const requestId = (value: unknown) => {
  if (typeof value !== "string" || !/^req_[a-f0-9]{32}$/.test(value)) throw new ExperimentRequestError(400, "요청 ID가 올바르지 않습니다.");
  return value;
};

async function principal(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있습니다.");
  return { uid: who.id };
}

export async function GET(request: Request) {
  try {
    const caller = await principal(request);
    const id = new URL(request.url).searchParams.get("id");
    const backend = modelBackend();
    const model = enabled() ? await backend.status(caller) : { ready: false, message: "앱 안 자동 생성이 꺼져 있어요." };
    return NextResponse.json({
      enabled: enabled(), provider: backend.name, model: { ready: model.ready, message: model.message },
      executor: id ? await executorView(requestId(id)) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    const caller = await principal(request);
    if (!enabled()) throw new ExperimentRequestError(409, "앱 안 자동 생성이 꺼져 있어요.");
    const body = await boundedJson(request) as { requestId?: unknown };
    const id = requestId(body.requestId);
    await enqueueStudyRequest(id, caller);
    return NextResponse.json({ executor: await executorView(id) }, { status: 202 });
  } catch (error) { return responseError(error); }
}
