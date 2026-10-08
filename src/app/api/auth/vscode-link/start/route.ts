import { NextResponse } from "next/server";
import { getFirebaseAdminServices } from "@/lib/firebase-admin";
import { createVscodeLinkCode } from "@/lib/firebase-vscode-link-store";
import { requireAuthenticatedUser, toUserDataError, UserDataHttpError } from "@/lib/server-user";
import { readVscodeLinkJson, VscodeLinkRequestError } from "@/lib/vscode-link-contract";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const body = await readVscodeLinkJson(request);
    if (
      typeof body.callbackUri !== "string" ||
      typeof body.state !== "string" ||
      typeof body.challenge !== "string"
    ) {
      throw new UserDataHttpError(400, "VS Code 연결 요청 형식이 올바르지 않습니다.");
    }
    const result = await createVscodeLinkCode(
      getFirebaseAdminServices().firestore,
      { uid: user.uid, email: user.email },
      {
        callbackUri: body.callbackUri,
        state: body.state,
        challenge: body.challenge,
      },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof VscodeLinkRequestError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    const result = toUserDataError(error, "VS Code 연결 요청을 만들지 못했습니다.");
    return NextResponse.json({ message: result.message }, { status: result.status });
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new UserDataHttpError(403, "허용되지 않은 연결 요청입니다.");
  }
}
