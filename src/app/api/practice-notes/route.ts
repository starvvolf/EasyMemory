// 실습 정리(11/16): 실습 한 판에서 배운 것을 층(기본기 → A → B)으로. 실습은 상황 재현을 만들지 않는다.
//   GET  /api/practice-notes?run=<id>   저장된 정리(없으면 null) · 만드는 중인지(pending)
//   POST /api/practice-notes {runId}     정리하기 · 다시 정리하기 (AI 1번, 만드는 중이면 그것을 기다림)
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, responseError } from "@/lib/http";
import { makeNotesOnce, notesPending, readNotes } from "@/lib/scene/practice-notes";

export const runtime = "nodejs";
const runId = z.string().regex(/^[A-Za-z0-9_-]{3,60}$/);

export async function GET(request: Request) {
  try { const id = runId.parse(new URL(request.url).searchParams.get("run")); return NextResponse.json({ notes: await readNotes(id), pending: notesPending(id) }); }
  catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  try { const b = z.object({ runId }).parse(await boundedJson(request)); return NextResponse.json({ notes: await makeNotesOnce(b.runId) }); }
  catch (error) { return responseError(error); }
}
