// 학습 목표 ↔ 기억 카드 잇기 (11/9): 일은 src/lib/study/goal-links.ts에서(라우트는 얇게 — 개발 서버가 라우트 고침을 다시 읽지 않는 일이 있었다).
import { fail, guard } from "@/lib/assist/http";
import { goalLinksApi } from "@/lib/study/goal-links";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await goalLinksApi(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
