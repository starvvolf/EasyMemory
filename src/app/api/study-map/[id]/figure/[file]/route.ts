// 카드에 붙은 그림 (src/lib/study/gen/figures.ts가 잘라 둔 것): study-gen/<id>/figures/<file>.jpg
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { fail, guard } from "@/lib/assist/http";
import { dataRoot } from "@/lib/study/gen/runner";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  try {
    await guard(request);
    const { id, file } = await context.params;
    if (!/^gen_[a-z0-9]{8,64}$/.test(id) || !/^[\w.-]{1,120}\.jpg$/.test(file)) return NextResponse.json({ message: "없는 그림이에요." }, { status: 404 });
    const bytes = await readFile(path.join(dataRoot(), id, "figures", file)).catch(() => null);
    if (!bytes) return NextResponse.json({ message: "없는 그림이에요." }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  } catch (error) { return fail(error); }
}
