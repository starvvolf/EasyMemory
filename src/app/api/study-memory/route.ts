import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { appendAgentNote, listMemories, MEMORY_LIMIT, readMemory, saveMemoryAuto } from "@/lib/study/memory";

export const runtime = "nodejs";

// 학습 메모 (study-memory/<과목>.md). GET ?subject= reads one, GET lists them.
// PUT { subject, auto } replaces the auto part (study screen); POST { subject, agentNote } adds a line for agents.
const subject = z.string().trim().min(1).max(60);
const put = z.object({ subject, auto: z.string().max(MEMORY_LIMIT) });
const post = z.object({ subject, agentNote: z.string().trim().min(1).max(500) });

async function caller(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
}
function fail(error: unknown) {
  const status = error instanceof UserDataHttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ message: status !== 500 && error instanceof Error ? error.message : "학습 메모를 처리하지 못했어요." }, { status });
}

export async function GET(request: Request) {
  try {
    await caller(request);
    const name = new URL(request.url).searchParams.get("subject");
    if (!name) return NextResponse.json({ memories: await listMemories() }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ subject: name, markdown: await readMemory(subject.parse(name)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function PUT(request: Request) {
  try {
    await caller(request);
    const body = put.parse(await request.json());
    if (!body.auto.includes("recaller:auto:start")) throw new UserDataHttpError(400, "자동 부분 표시가 없어요.");
    return NextResponse.json({ markdown: await saveMemoryAuto(body.subject, body.auto) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await caller(request);
    const body = post.parse(await request.json());
    return NextResponse.json({ markdown: await appendAgentNote(body.subject, body.agentNote) });
  } catch (error) { return fail(error); }
}
