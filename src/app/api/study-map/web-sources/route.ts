// 웹 글 → 자료 (src/lib/study/web-material.ts): GET 저장한 웹 글 목록 · POST {id} 그 글을 PDF로(Recaller 앱의 인쇄 창).
import { NextResponse } from "next/server";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { webSourcePdf, webSources } from "@/lib/study/web-material";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await guard(request); return NextResponse.json({ sources: await webSources() }); } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    await guard(request);
    const { id } = await boundedJson(request) as { id?: string };
    const { pdf, name } = await webSourcePdf(String(id ?? ""));
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(name) } });
  } catch (error) { return fail(error); }
}
