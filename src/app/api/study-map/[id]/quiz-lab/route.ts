// 구조 단위 출제 시험 (11/8): 일은 모두 src/lib/study/lab/quiz-lab.ts에서(이 파일은 얇게 둔다 — 개발 서버가 라우트 파일 고침을 다시 읽지 않는 일이 있었다).
import { fail, guard } from "@/lib/assist/http";
import { quizLab } from "@/lib/study/lab/quiz-lab";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await guard(request); const { id } = await context.params; return await quizLab(request, id); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
