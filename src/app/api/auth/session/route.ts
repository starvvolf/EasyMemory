import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/server-auth";

export async function GET(request: Request) {
  const result = await authenticateRequest(request);
  if (!result.ok) {
    return NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json({
    uid: result.user.uid,
    email: result.user.email,
    canUseAi: result.user.canUseAi,
  });
}
