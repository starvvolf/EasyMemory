import { NextResponse } from "next/server";
import { importFirebaseStudyProject } from "@/lib/firebase-study-project-store";
import { requireAuthenticatedUser, toUserDataError } from "@/lib/server-user";
import {
  getStudyProject,
  listStudyProjects,
  loadStudyProjectSource,
} from "@/lib/study-project-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user.canUseAi) return NextResponse.json({ message: "운영자만 PC 자료를 가져올 수 있습니다." }, { status: 403 });
    return NextResponse.json({ projects: await listStudyProjects() });
  } catch (error) {
    const failure = toUserDataError(error, "기존 PC 프로젝트 목록을 불러오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user.canUseAi) return NextResponse.json({ message: "운영자만 PC 자료를 가져올 수 있습니다." }, { status: 403 });
    const input = (await request.json()) as { projectId?: unknown; confirmed?: unknown };
    if (input.confirmed !== true || typeof input.projectId !== "string") {
      return NextResponse.json(
        { message: "가져올 프로젝트를 선택하고 명시적으로 확인해야 합니다." },
        { status: 400 },
      );
    }
    const detail = await getStudyProject(input.projectId);
    if (!detail) return NextResponse.json({ message: "기존 PC 프로젝트를 찾지 못했습니다." }, { status: 404 });
    const sourceFiles = [];
    for (const source of detail.sources) {
      const loaded = await loadStudyProjectSource(source.id);
      if (!loaded) throw new Error(`기존 원본 파일을 찾지 못했습니다: ${source.fileName}`);
      sourceFiles.push({
        source,
        file: new File([Uint8Array.from(loaded.bytes)], source.fileName, {
          type: source.mimeType,
          lastModified: source.lastModified,
        }),
      });
    }
    return NextResponse.json({
      result: await importFirebaseStudyProject(user.uid, detail, sourceFiles),
    });
  } catch (error) {
    const failure = toUserDataError(error, "기존 PC 프로젝트를 가져오지 못했습니다.");
    return NextResponse.json({ message: failure.message }, { status: failure.status });
  }
}
