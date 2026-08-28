import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PdfAnalysisResult } from "../src/lib/types";

test("프로젝트 PDF와 두 종류의 분석 결과를 같은 원본에 연결한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "study-forge-project-store-"));
  process.env.STUDY_FORGE_DATA_DIR = directory;

  try {
    const store = await import(`../src/lib/study-project-store.ts?test=${Date.now()}`);
    const project = await store.createStudyProject("운영체제");
    const bytes = new TextEncoder().encode("%PDF-1.4\nStudy Forge test PDF");
    const [source] = await store.addStudyProjectSources(project.id, [
      new File([bytes], "deadlocks.pdf", { type: "application/pdf", lastModified: 1234 }),
    ]);

    const codexContext = await store.getStudyProjectCodexContext(project.id);
    assert.equal(codexContext.projectName, project.name);
    assert.equal(codexContext.workspacePath, path.join(directory, "projects", project.id));
    const projectSourcePath = path.join(codexContext.workspacePath, "sources", `${source.id}.pdf`);
    await access(projectSourcePath);
    await store.bindStudyProjectCodexThread(project.id, "thread-study-forge-test");
    const boundContext = await store.getStudyProjectCodexContext(project.id);
    assert.equal(boundContext.codexThreadId, "thread-study-forge-test");
    await assert.rejects(
      store.bindStudyProjectCodexThread(project.id, "thread-other"),
      /이미 다른 Codex 스레드/,
    );
    await store.replaceStudyProjectCodexThread(
      project.id,
      "thread-study-forge-test",
      "thread-study-forge-recovered",
    );
    const recoveredContext = await store.getStudyProjectCodexContext(project.id);
    assert.equal(recoveredContext.codexThreadId, "thread-study-forge-recovered");
    await assert.rejects(
      store.replaceStudyProjectCodexThread(
        project.id,
        "thread-study-forge-test",
        "thread-stale-replacement",
      ),
      /이미 다른 요청에서 변경/,
    );

    const legacySourceDirectory = path.join(directory, "sources");
    const legacySourcePath = path.join(legacySourceDirectory, `${source.id}.pdf`);
    await mkdir(legacySourceDirectory, { recursive: true });
    await rename(projectSourcePath, legacySourcePath);

    const expectedChecksum = createHash("sha256").update(bytes).digest("hex");
    assert.equal(source.checksum, expectedChecksum);
    const [summary] = await store.listStudyProjects();
    assert.equal(summary.id, project.id);
    assert.equal(summary.name, project.name);
    assert.equal(summary.sourceCount, 1);
    assert.ok(summary.updatedAt >= project.updatedAt);

    const loaded = await store.loadStudyProjectSource(source.id);
    assert.ok(loaded);
    assert.deepEqual(new Uint8Array(loaded.bytes), bytes);
    await access(projectSourcePath);

    const codingSession = await store.startStudyCodingSession(project.id, {
      learningGoal: "React 상태 흐름을 이해한다.",
      currentTask: "덱 삭제 기능을 구현한다.",
      workspaceLabel: "CD0625",
    });
    assert.equal(codingSession.projectId, project.id);
    assert.equal(codingSession.submissionCount, 0);

    const submission = await store.submitStudyCodingCode(codingSession.id, {
      filePath: "src/app/page.tsx",
      language: "typescriptreact",
      selectedCode: "setDecks((items) => items.filter((item) => item.id !== id));",
      surroundingCode: "function deleteDeck(id: string) { /* selected code */ }",
      authoringMode: "direct",
    });
    assert.equal(submission.sessionId, codingSession.id);

    const activeSession = await store.getActiveStudyCodingSession(project.id);
    assert.equal(activeSession?.latestSubmission?.id, submission.id);
    assert.equal(activeSession?.submissionCount, 1);

    const detail = await store.getStudyProject(project.id);
    assert.equal(detail?.activeCodingSession?.currentTask, "덱 삭제 기능을 구현한다.");

    const analysis: PdfAnalysisResult = {
      fileName: "deadlocks.pdf",
      documentType: "강의자료",
      summary: "데드락 학습자료",
      keyTopics: ["deadlock"],
      outline: [],
      suggestedRole: "핵심 개념 학습",
      sourceOutline: {
        title: "Deadlocks",
        summary: "데드락의 정의와 처리",
        nodes: [],
      },
    };

    const studySaved = await store.saveStudyProjectSourceAnalysis(source.id, analysis, "study");
    assert.equal(studySaved.analysis?.sourceChecksum, expectedChecksum);
    assert.equal(studySaved.analysis?.result.summary, analysis.summary);

    const readingSaved = await store.saveStudyProjectSourceAnalysis(source.id, analysis, "reading");
    assert.equal(readingSaved.readingAnalysis?.sourceChecksum, expectedChecksum);
    assert.equal(readingSaved.analysis?.sourceChecksum, expectedChecksum);

    assert.equal(await store.deleteStudyProjectSource(source.id), true);
    assert.equal(await store.loadStudyProjectSource(source.id), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
    delete process.env.STUDY_FORGE_DATA_DIR;
  }
});
