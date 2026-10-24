import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { ModelError } from "@/lib/ai/model";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { ASK_SYSTEM, askNote, chatReply, composeReply, FOLLOW_SYSTEM, followUp, listNotes, markNote, markSeen, NoteError, removeNote, saveTalk } from "@/lib/study/notes";
import { boundedJson } from "../mcp-experiment-requests/http";
import { listExplanations, saveExplanation } from "@/lib/study/explain";

export const runtime = "nodejs";

const sourceId = z.string().regex(/^[\w.-]{1,120}$/);
const page = z.number().int().min(1).max(5000);
const text = (max: number) => z.string().max(max);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), sourceId, page, quote: text(400).min(1), sentence: text(800).nullish(), pageText: text(20000).nullish(), title: text(300).nullish(), purpose: text(2000).nullish(), style: text(1500).nullish() }),
  z.object({ action: z.literal("mark"), sourceId, page, quote: text(400).min(1), sentence: text(800).nullish() }),
  z.object({ action: z.literal("seen"), sourceId, noteId: z.string().max(60) }),
  z.object({ action: z.literal("remove"), sourceId, noteId: z.string().max(60) }),
  z.object({ action: z.literal("follow"), sourceId, noteId: z.string().max(60), question: text(1000).min(1), pageText: text(20000).nullish(), title: text(300).nullish(), style: text(1500).nullish() }),
  z.object({ action: z.literal("chat"), turns: z.array(z.object({ role: z.string().max(20), content: text(40000) })).min(1).max(40),
    // A picture-heavy page: its picture regions go with the request (the text layer alone says almost nothing).
    pageImage: z.object({ sourceId, page }).optional() }),
  z.object({ action: z.literal("talk"), sourceId, page, noteId: z.string().max(60).nullish(),
    turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: text(8000), quote: text(400).nullish(), page: page.optional() })).min(1).max(80),
    usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional() }),
  // 작업대 흐름 boxes pick their own model and effort; other callers leave them out and get the note defaults.
  z.object({ action: z.literal("compose"), system: text(8000).min(1), user: text(60000).min(1), kind: z.enum(["terms", "translate"]).nullish(),
    model: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,39}$/).nullish(), effort: z.enum(["low", "medium", "high", "xhigh"]).nullish() }),
  z.object({ action: z.literal("explain-save"), sourceId, page, text: text(60000).min(1), goal: z.string().min(1).max(160).nullish() }),
]);

async function caller(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
  return { uid: who.id };
}

function failure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ message: "입력값이 올바르지 않아요." }, { status: 400 });
  if (error instanceof NoteError || error instanceof UserDataHttpError) return NextResponse.json({ message: error.message }, { status: error.status });
  if (error instanceof ModelError) {
    const status = error.code === "usage_limit" ? 429 : error.code === "login_required" || error.code === "not_configured" ? 401 : 502;
    return NextResponse.json({ message: error.message, code: error.code }, { status });
  }
  return NextResponse.json({ message: "요청을 처리하지 못했어요." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await caller(request);
    const params = new URL(request.url).searchParams;
    // 프롬프트 설정 화면: the fixed instructions, shown read-only next to the learner's own part.
    if (params.get("prompts")) return NextResponse.json({ ask: ASK_SYSTEM, follow: FOLLOW_SYSTEM });
    const id = sourceId.parse(params.get("sourceId"));
    if (params.get("explain")) return NextResponse.json({ pages: await listExplanations(id) }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ notes: await listNotes(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const who = await caller(request);
    const input = body.parse(await boundedJson(request));
    switch (input.action) {
      case "ask": return NextResponse.json(await askNote(who, input));
      case "mark": return NextResponse.json({ note: await markNote(input) });
      case "seen": return NextResponse.json({ note: await markSeen(input.sourceId, input.noteId) });
      case "remove": await removeNote(input.sourceId, input.noteId); return NextResponse.json({ ok: true });
      case "follow": return NextResponse.json({ note: await followUp(who, input) });
      case "chat": return NextResponse.json(await chatReply(who, input.turns, input.pageImage));
      case "compose": return NextResponse.json(await composeReply(who, input));
      case "talk": return NextResponse.json({ note: await saveTalk(who, input) });
      case "explain-save": return NextResponse.json({ page: await saveExplanation(input.sourceId, input.page, input.text, input.goal) });
    }
  } catch (error) { return failure(error); }
}
