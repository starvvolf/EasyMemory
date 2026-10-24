import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { archiveDecks, readArchive, restoreDecks } from "@/lib/study/archive";

export const runtime = "nodejs";

// 보관함. GET: { entries }. POST { action:"archive", items:[{id,title,reason}] } | { action:"restore", ids }
const id = z.string().trim().min(1).max(200);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), items: z.array(z.object({ id, title: z.string().max(300), reason: z.string().max(200) })).min(1).max(500) }),
  z.object({ action: z.literal("restore"), ids: z.array(id).min(1).max(500) }),
]);
async function caller(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
}
function fail(error: unknown) {
  const status = error instanceof UserDataHttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ message: status !== 500 && error instanceof Error ? error.message : "보관함을 처리하지 못했어요." }, { status });
}
export async function GET(request: Request) {
  try { await caller(request); return NextResponse.json({ entries: await readArchive() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await caller(request);
    const input = body.parse(await request.json());
    const entries = input.action === "archive" ? await archiveDecks(input.items) : await restoreDecks(input.ids);
    return NextResponse.json({ entries });
  } catch (error) { return fail(error); }
}
