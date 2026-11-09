// 자료 지도 [구조] (11/9 줄기 기반): 일은 src/lib/study/structure-api.ts에서(라우트는 얇게).
import { fail, guard } from "@/lib/assist/http";
import { structureApi } from "@/lib/study/structure-api";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await structureApi(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
