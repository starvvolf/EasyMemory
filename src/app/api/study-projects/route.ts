import { NextResponse } from "next/server";
import { createStudyProject, listStudyProjects } from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listStudyProjects() });
  } catch (error) {
    return NextResponse.json({ message: getMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as { name?: unknown };
    const project = await createStudyProject(typeof input.name === "string" ? input.name : "");
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: getMessage(error) }, { status: 400 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "학습 프로젝트를 처리하지 못했습니다.";
}
