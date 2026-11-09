// 기억 단위 출제 비교 (11/10): 일은 src/lib/study/quiz-lab2.ts에서(라우트는 얇게).
import { fail, guard } from "@/lib/assist/http";
import { quizLab2Api } from "@/lib/study/quiz-lab2";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await quizLab2Api(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
