import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalCodexRequest } from "@/lib/codex-app-server";
import { callCodexTextWithThread } from "@/lib/ai/codex-provider";
import { toCodexHttpError } from "@/lib/ai/codex-errors";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(50_000),
  projectId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    assertLocalCodexRequest(request);
    const input = requestSchema.parse(await request.json());
    const result = await callCodexTextWithThread(input);
    return NextResponse.json(result);
  } catch (error) {
    const failure = toCodexHttpError(error, "Codex 응답을 받지 못했습니다.");
    return NextResponse.json(
      { message: failure.message, code: failure.code },
      { status: failure.status },
    );
  }
}
