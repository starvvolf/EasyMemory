// 기억 합치기 실험 (11/9): 일은 src/lib/study/compact-lab.ts에서(라우트는 얇게).
import { fail, guard } from "@/lib/assist/http";
import { compactLabApi } from "@/lib/study/compact-lab";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await compactLabApi(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
