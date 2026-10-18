import { NextResponse } from "next/server";
import { importLegacyDeck } from "@/lib/firebase-user-data-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import type { Deck } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const formData = await request.formData();
    const deck = JSON.parse(String(formData.get("deck") ?? "")) as Deck;
    const files = formData.getAll("pdfs").filter((value): value is File => value instanceof File);
    return NextResponse.json({ result: await importLegacyDeck(user.uid, deck, files) });
  } catch (error) {
    const failure = toUserDataError(error, "기존 로컬 덱을 가져오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
