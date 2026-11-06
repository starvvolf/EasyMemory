// 속도 체크 (2026-11-06): GET 최근 기록으로 모델별 속도, POST {model} 짧은 호출 한 번으로 지금 속도. src/lib/assist/speed.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { probeSpeed, recentSamples, speedRows, SPEED_BASE } from "@/lib/assist/speed";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await guard(request); const samples = await recentSamples(); return NextResponse.json({ rows: speedRows(samples), base: SPEED_BASE, samples: samples.length }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await guard(request);
    const { model } = z.object({ model: z.enum(Object.keys(SPEED_BASE) as [string, ...string[]]) }).parse(await boundedJson(request));
    return NextResponse.json(await probeSpeed(model));
  } catch (error) { return fail(error); }
}
