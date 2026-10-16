import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExperimentPrincipal } from "@/lib/local-experiment-auth";
import { UserDataHttpError } from "@/lib/server-user";
import { loadRecords, RECORDS_LIMIT, saveRecords } from "@/lib/study/records";

export const runtime = "nodejs";

const body = z.object({ records: z.record(z.string().max(300), z.unknown()), pending: z.array(z.unknown()).max(500), updatedAt: z.number() });

async function caller(request: Request) {
  const who = await requireExperimentPrincipal(request);
  if (who.mode !== "local-experiment") throw new UserDataHttpError(403, "로컬 실험 모드에서만 사용할 수 있어요.");
  return who.id;
}
function fail(error: unknown) {
  const status = error instanceof UserDataHttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ message: error instanceof Error && status !== 500 ? error.message : "풀이 기록을 처리하지 못했어요." }, { status });
}

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await loadRecords(await caller(request)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}

export async function PUT(request: Request) {
  try {
    const uid = await caller(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > RECORDS_LIMIT) return NextResponse.json({ message: "풀이 기록이 너무 커요." }, { status: 413 });
    await saveRecords(uid, body.parse(JSON.parse(text)));
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
