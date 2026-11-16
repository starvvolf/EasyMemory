// 실습 정리(11/16): 실습 한 판에서 배운 것을 층(기본기 → A → B)으로. 실습은 상황 재현을 만들지 않는다.
//   GET  /api/practice-notes?run=<id>   저장된 정리(없으면 null)
//   POST /api/practice-notes {runId}     정리하기 · 다시 정리하기 (AI 1번)
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, responseError } from "@/lib/http";
import { makeNotes, readNotes } from "@/lib/scene/practice-notes";

export const runtime = "nodejs";
const runId = z.string().regex(/^[A-Za-z0-9_-]{3,60}$/);

export async function GET(request: Request) {
  try { return NextResponse.json({ notes: await readNotes(runId.parse(new URL(request.url).searchParams.get("run"))) }); }
  catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  try { const b = z.object({ runId }).parse(await boundedJson(request)); return NextResponse.json({ notes: await makeNotes(b.runId) }); }
  catch (error) { return responseError(error); }
}
