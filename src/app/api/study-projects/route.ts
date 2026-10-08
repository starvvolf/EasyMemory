import { NextResponse } from "next/server";
import {
  createFirebaseStudyProject,
  listFirebaseStudyProjects,
} from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ projects: await listFirebaseStudyProjects(user.uid) });
  } catch (error) {
    const failure = toUserDataError(error, "학습 프로젝트를 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const input = await request.json() as { name?: unknown };
    const project = await createFirebaseStudyProject(user.uid, typeof input.name === "string" ? input.name : "");
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const failure = toUserDataError(error, "학습 프로젝트를 만들지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status === 500 ? 400 : failure.status });
  }
}
