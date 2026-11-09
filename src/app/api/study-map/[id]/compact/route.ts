// 기억 합치기 (11/9): 일은 src/lib/study/compact.ts에서(라우트는 얇게).
import { fail, guard } from "@/lib/assist/http";
import { compactApi } from "@/lib/study/compact";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await compactApi(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
