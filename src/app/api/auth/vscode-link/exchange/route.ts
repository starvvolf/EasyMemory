import { NextResponse } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminServices } from "@/lib/firebase-admin";
import { consumeVscodeLinkCode } from "@/lib/firebase-vscode-link-store";
import { UserDataHttpError, toUserDataError } from "@/lib/server-user";
import { readVscodeLinkJson, VscodeLinkRequestError } from "@/lib/vscode-link-contract";

export async function POST(request: Request) {
  try {
    const body = await readVscodeLinkJson(request);
    if (
      typeof body.code !== "string" ||
      typeof body.state !== "string" ||
      typeof body.verifier !== "string"
    ) {
      throw new UserDataHttpError(400, "VS Code 연결 교환 형식이 올바르지 않습니다.");
    }
    const linked = await consumeVscodeLinkCode(
      getFirebaseAdminServices().firestore,
      { code: body.code, state: body.state, verifier: body.verifier },
    );
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error("Firebase 서버 설정이 없습니다. NEXT_PUBLIC_FIREBASE_API_KEY 환경 변수를 설정하세요.");
    }
    const customToken = await getFirebaseAdminAuth().createCustomToken(linked.uid, {
      studyForgeClient: "vscode",
    });
    return NextResponse.json(
      { ...linked, customToken, firebaseApiKey },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof VscodeLinkRequestError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    const result = toUserDataError(error, "VS Code 계정 연결을 완료하지 못했습니다.");
    return NextResponse.json({ message: result.message }, { status: result.status });
  }
}
