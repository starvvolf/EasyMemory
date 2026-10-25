import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalExperimentRequest } from "@/lib/local-experiment-mode";
import { ExperimentRequestError } from "@/lib/mcp-experiment-requests";
import { boundedJson, requireLocalRequest, responseError } from "../../mcp-experiment-requests/http";
import { availability, botIds, createRoom, EFFORTS, exportRoom, listRooms, loadRoom, MODEL_HINTS, RoomError, runRounds, say, stop, summarize, updateRoom } from "@/lib/room/room";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
const bots = z.array(z.enum(botIds)).max(3);
const model = z.object({ model: z.string().max(60).regex(/^[\w.:/-]*$/, "모델 이름에는 글자·숫자·. : / - 만 써요."), effort: z.enum(["", "minimal", "low", "medium", "high", "xhigh"]) }).partial();
const settings = z.object({ maxChars: z.number().int().min(60).max(2000), delaySec: z.number().min(0).max(30), chain: z.boolean(), chainMax: z.number().int().min(0).max(20),
  models: z.object({ claude: model, codex: model, gemini: model }).partial() }).partial();

// 토론방: local only, like the lab. Starting a turn returns at once; the page polls the room for answers.
async function handle(request: Request, context: Context) {
  try {
    if (!isLocalExperimentRequest(request)) throw new ExperimentRequestError(403, "로컬 실험 모드에서만 사용할 수 있습니다.");
    await requireLocalRequest(request);
    const p = (await context.params).path ?? [];
    const method = request.method;
    const quiet = (done: Promise<unknown>) => { done.catch(() => undefined); };
    if (!p.length && method === "GET") { const found = await availability(); return NextResponse.json({ rooms: await listRooms(), bots: found.bots, why: found.why, hints: MODEL_HINTS, efforts: EFFORTS }); }
    if (!p.length && method === "POST") {
      const body = z.object({ title: z.string().max(200), bots: bots.optional(), readFiles: z.boolean().optional() }).parse(await boundedJson(request));
      return NextResponse.json({ room: await createRoom(body.title, body.bots, body.readFiles) });
    }
    const id = p[0];
    if (p.length === 1 && method === "GET") { const room = await loadRoom(id); if (!room) throw new RoomError(404, "방을 찾을 수 없습니다."); return NextResponse.json({ room }); }
    if (p.length === 1 && method === "PATCH") {
      const body = z.object({ title: z.string().max(200).optional(), bots: bots.optional(), readFiles: z.boolean().optional(), settings: settings.optional() }).parse(await boundedJson(request));
      return NextResponse.json({ room: await updateRoom(id, body) });
    }
    if (p.length === 2 && method === "POST") {
      if (p[1] === "say") { const body = z.object({ text: z.string().max(4000) }).parse(await boundedJson(request)); const { room, done } = await say(id, body.text); quiet(done); return NextResponse.json({ room }); }
      if (p[1] === "run") { const body = z.object({ rounds: z.number().int().min(1).max(10) }).parse(await boundedJson(request)); const { room, done } = await runRounds(id, body.rounds); quiet(done); return NextResponse.json({ room }); }
      if (p[1] === "summary") { const { done } = await summarize(id); quiet(done); return NextResponse.json({ ok: true }); }
      if (p[1] === "stop") return NextResponse.json({ room: await stop(id) });
      if (p[1] === "export") return NextResponse.json({ file: await exportRoom(id) });
    }
    throw new ExperimentRequestError(404, "경로를 찾을 수 없습니다.");
  } catch (error) {
    if (error instanceof RoomError) return NextResponse.json({ message: error.message }, { status: error.status });
    return responseError(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
