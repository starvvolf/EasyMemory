import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { CAUSES } from "@/lib/study/quality";
import { addPatch, logQuality, qualitySummary, removePatch } from "@/lib/study/quality-store";

export const runtime = "nodejs";

// 빠른 고리 (docs/품질_자동화.md). GET: patches by deck, the ledger and counts per cause.
// POST { action:"log", entries } | { action:"patch", deckId, patch, entry? } | { action:"unpatch", deckId, patchId, entry? }
const text = (max: number) => z.string().trim().max(max);
const entry = z.object({
  at: z.string().max(40), deck: text(200).min(1), item: text(200).optional(), objective: text(200).optional(),
  signal: text(200).min(1), action: text(300).min(1), cause: z.enum(Object.keys(CAUSES) as [keyof typeof CAUSES, ...Array<keyof typeof CAUSES>]), detail: text(500).optional(),
});
const deckId = text(200).min(1);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), entries: z.array(entry).min(1).max(50) }),
  z.object({ action: z.literal("patch"), deckId, entry: entry.optional(), patch: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("accept"), itemId: text(200).min(1), answer: text(200).min(1) }),
    z.object({ kind: z.literal("card"), itemId: text(200).min(1) }),
  ]) }),
  z.object({ action: z.literal("unpatch"), deckId, patchId: text(40).min(1), entry: entry.optional() }),
]);

async function caller(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
}
function fail(error: unknown) {
  const status = error instanceof UserDataHttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ message: status !== 500 && error instanceof Error ? error.message : "품질 기록을 처리하지 못했어요." }, { status });
}
export async function GET(request: Request) {
  try { await caller(request); return NextResponse.json(await qualitySummary(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await caller(request);
    const input = body.parse(await request.json());
    if (input.action === "log") { await logQuality(input.entries); return NextResponse.json({ ok: true }); }
    if (input.action === "patch") return NextResponse.json({ patch: await addPatch(input.deckId, input.patch, input.entry) });
    return NextResponse.json({ removed: await removePatch(input.deckId, input.patchId, input.entry) });
  } catch (error) { return fail(error); }
}
