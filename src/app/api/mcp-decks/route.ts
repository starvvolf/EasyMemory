import { NextResponse } from "next/server";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const directory = path.join(
      process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"),
      "mcp",
      "published",
    );
    await mkdir(directory, { recursive: true });
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const decks = await Promise.all(names.map(async (name) => JSON.parse(
      await readFile(path.join(directory, name), "utf8"),
    ) as unknown));
    return NextResponse.json({ decks });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error
          ? error.message
          : "MCP 덱을 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

