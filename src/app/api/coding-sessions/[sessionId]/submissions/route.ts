import { NextResponse } from "next/server";
import { submitStudyCodingCode } from "@/lib/study-project-store";
import type { StudyCodingSubmission } from "@/lib/study-project-types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const input = await request.json() as Record<string, unknown>;
    const authoringMode = typeof input.authoringMode === "string"
      ? input.authoringMode as StudyCodingSubmission["authoringMode"]
      : undefined;
    const submission = await submitStudyCodingCode(sessionId, {
      filePath: typeof input.filePath === "string" ? input.filePath : "",
      language: typeof input.language === "string" ? input.language : "",
      selectedCode: typeof input.selectedCode === "string" ? input.selectedCode : "",
      surroundingCode: typeof input.surroundingCode === "string" ? input.surroundingCode : undefined,
      authoringMode,
    });
    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: getMessage(error) }, { status: 400 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "코드 제출을 저장하지 못했습니다.";
}
