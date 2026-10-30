// 실험 (사용자 10/31): a blog post with pictures → knowledge cards without a PDF (src/lib/study/gen/webtrial.ts).
// POST {action:"article", article} saves what the browser read; POST {action:"run", id, confirmed} runs the methods in the
// background; GET ?id= reads the result. Same-origin local experiment only, like the rest of /api/lab.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { requireLocalRequest, responseError } from "../../mcp-experiment-requests/http";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { assertTrialId, loadTrial, runWebTrial, saveArticle, webMethods } from "@/lib/study/gen/webtrial";

export const runtime = "nodejs";
const caller = { uid: "local-experiment" };
async function local(request: Request) {
  if (!isLocalExperimentRequest(request)) throw new ExperimentRequestError(403, "로컬 실험 모드에서만 쓸 수 있습니다.");
  await requireLocalRequest(request);
}
export async function GET(request: Request) {
  try {
    await local(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    assertTrialId(id);
    return NextResponse.json({ trial: await loadTrial(id) });
  } catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  try {
    await local(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 60_000_000) throw new ExperimentRequestError(413, "너무 큽니다.");
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("article"), article: z.unknown() }),
      z.object({ action: z.literal("run"), id: z.string(), confirmed: z.literal(true), methods: z.array(z.enum(webMethods)).optional() }),
    ]).parse(JSON.parse(text));
    if (body.action === "article") return NextResponse.json(await saveArticle(body.article));
    assertTrialId(body.id);
    void runWebTrial(body.id, caller, { methods: body.methods }).catch(() => undefined);
    return NextResponse.json({ started: true, id: body.id });
  } catch (error) { return responseError(error); }
}
