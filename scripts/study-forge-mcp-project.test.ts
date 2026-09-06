import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("canonical 프로젝트의 여러 PDF를 복제 없이 조회하고 analyze를 저장한다", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "study-forge-project-mcp-"));
  process.env.STUDY_FORGE_DATA_DIR = dataRoot;
  t.after(async () => {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(dataRoot, { recursive: true, force: true });
  });
  const fixture = path.resolve("eval/corpus/generation-quality-v1/speaking-opic-person-description.pdf");
  const bytes = await readFile(fixture);
  const sourceDirectory = path.join(dataRoot, "sources");
  await mkdir(sourceDirectory, { recursive: true });
  const sourceIds = ["source-a", "source-b"];
  await Promise.all(sourceIds.map((sourceId) => copyFile(fixture, path.join(sourceDirectory, `${sourceId}.pdf`))));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const now = new Date().toISOString();
  await writeFile(path.join(dataRoot, "projects.json"), JSON.stringify({
    projects: [{ id: "project-a", name: "OPIc 프로젝트", createdAt: now, updatedAt: now }],
    sources: sourceIds.map((id, index) => ({
      id,
      projectId: "project-a",
      fileName: `opic-${index + 1}.pdf`,
      mimeType: "application/pdf",
      size: bytes.byteLength,
      lastModified: Date.now(),
      addedAt: now,
      checksum,
      storageName: `${id}.pdf`,
    })),
    codingSessions: [{
      id: "coding-session-a",
      projectId: "project-a",
      learningGoal: "TypeScript 비동기 흐름을 이해한다.",
      currentTask: "PDF 로딩 오류를 처리한다.",
      workspaceLabel: "CD0625",
      status: "active",
      startedAt: now,
      updatedAt: now,
    }],
    codingSubmissions: [{
      id: "coding-submission-a",
      sessionId: "coding-session-a",
      projectId: "project-a",
      filePath: "src/app/page.tsx",
      language: "typescriptreact",
      selectedCode: "await loadPdf();",
      authoringMode: "direct",
      submittedAt: now,
    }],
  }, null, 2));

  const { StudyForgeMcpService } = await import("../tools/study-forge-mcp/service.ts");
  const service = new StudyForgeMcpService();
  const projects = await service.listProjects();
  assert.equal(projects[0].sourceCount, 2);
  const project = await service.getProject("project-a");
  assert.equal(project.sources.length, 2);
  const coding = await service.getActiveCodingSession("project-a");
  assert.equal(coding.session?.currentTask, "PDF 로딩 오류를 처리한다.");
  assert.equal(coding.session?.latestSubmission?.selectedCode, "await loadPdf();");

  const next = await service.getNextStage({
    projectId: "project-a",
    sourceIds,
    config: {
      learningGoal: "인물 묘사 표현을 학습한다.",
      instruction: "재사용 가능한 표현을 우선한다.",
      mode: "flashcard",
    },
  });
  assert.equal(next.nextStage, "analyze");
  const stageInput = next.stageInput as { input: { sources: Array<{ sourceId: string; content: string }> } };
  assert.deepEqual(stageInput.input.sources.map((source) => source.sourceId), sourceIds);
  assert.match(stageInput.input.sources[0].content, /\[PDF 1쪽\]/);

  const files = sourceIds.map((sourceId, index) => ({
    fileName: `opic-${index + 1}.pdf`,
    documentType: "말하기 자료",
    summary: "인물 묘사 표현",
    keyTopics: ["인물 묘사"],
    outline: [{ heading: "패턴", points: ["소개"] }],
    sourceOutline: {
      title: `자료 ${index + 1}`,
      summary: "인물 소개 패턴",
      nodes: [{
        id: `node-${index + 1}`,
        parentId: null,
        order: 1,
        title: "인물 소개",
        summary: "사람을 소개한다.",
        sourceRefs: [{ sourceId, fileName: `opic-${index + 1}.pdf`, pageNumbers: [1] }],
        sourceEvidence: "I'd like to talk about",
        selectedByDefault: true,
        structureTags: ["틀"],
        importance: 3,
      }],
    },
    suggestedRole: "핵심 표현 자료",
  }));
  await service.submitNextStageResult({ runId: next.runId, result: { files } });

  const stored = JSON.parse(await readFile(path.join(dataRoot, "projects.json"), "utf8")) as {
    sources: Array<{ analysis?: { sourceChecksum: string; result: { fileName: string } } }>;
  };
  assert.equal(stored.sources.every((source) => source.analysis?.sourceChecksum === checksum), true);
  assert.deepEqual(stored.sources.map((source) => source.analysis?.result.fileName), ["opic-1.pdf", "opic-2.pdf"]);
  assert.equal(await containsPdf(path.join(dataRoot, "mcp")), false);
});

async function containsPdf(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) return true;
      if (entry.isDirectory() && await containsPdf(path.join(directory, entry.name))) return true;
    }
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
