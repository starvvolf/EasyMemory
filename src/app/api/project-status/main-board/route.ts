import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const MAX_BOARD_LENGTH = 50_000;

export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "다른 사이트에서는 수정할 수 없습니다." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "저장할 내용을 읽지 못했습니다." }, { status: 400 });
  }

  const content = typeof body === "object" && body !== null &&
      "content" in body && typeof body.content === "string"
    ? body.content.replace(/\r\n/g, "\n").trimEnd() + "\n"
    : "";

  if (!content.trim()) {
    return NextResponse.json({ error: "메인 보드 내용을 입력해 주세요." }, { status: 400 });
  }
  if (content.length > MAX_BOARD_LENGTH) {
    return NextResponse.json({ error: "메인 보드가 너무 깁니다." }, { status: 400 });
  }
  if (!content.startsWith("# ")) {
    return NextResponse.json({ error: "첫 줄에는 # 메인 보드 제목이 필요합니다." }, { status: 400 });
  }

  await fs.writeFile(
    path.join(process.cwd(), "docs", "MAIN_BOARD.md"),
    content,
    "utf8",
  );
  return NextResponse.json({ ok: true });
}
