import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { callTool, toolList } from "@/lib/agent/tools";
import { answerBlock, dismissBlock, getView, screenBlocks, setView } from "@/lib/agent/screen";

export const runtime = "nodejs";

// 에이전트 툴: GET lists the tools with their input schemas; POST /call runs one. The screen reports what is in view
// (POST /view) and shows the blocks an agent puts up (GET /screen).
async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const url = new URL(request.url);
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);
    if (!p.length && m === "GET") return json({ tools: toolList() });
    if (p[0] === "call" && m === "POST") { const b = await body(z.object({ tool: z.string().max(60), input: z.unknown().optional() })); return json({ result: await callTool(b.tool, b.input) }); }
    if (p[0] === "view" && m === "GET") return json({ view: await getView() });
    if (p[0] === "view" && m === "POST") {
      const b = await body(z.object({ view: z.string().max(40), title: z.string().max(200).default(""), detail: z.string().max(4000).default(""), selection: z.string().max(2000).default(""), ids: z.record(z.string(), z.string().max(80)).default({}) }));
      return json({ view: await setView(b) });
    }
    if (p[0] === "screen" && !p[1] && m === "GET") return json({ blocks: await screenBlocks(url.searchParams.get("after") ?? "") });
    if (p[0] === "screen" && p[1] && p[2] === "answer" && m === "POST") { const b = await body(z.object({ answer: z.string().max(2000) })); return json({ block: await answerBlock(p[1], b.answer) }); }
    if (p[0] === "screen" && p[1] && m === "DELETE") return json(await dismissBlock(p[1]));
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
