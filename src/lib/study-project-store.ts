import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LearningConceptTree, PdfAnalysisResult } from "@/lib/types";
import type {
  StudyCodingSession,
  StudyCodingSessionDetail,
  StudyCodingSubmission,
  StudyProject,
  StudyProjectConceptTree,
  StudyProjectDetail,
  StudyProjectSource,
  StudyProjectSummary,
} from "@/lib/study-project-types";

type StoredProjectSource = StudyProjectSource & { storageName: string };

type StudyProjectDatabase = {
  projects: StudyProject[];
  sources: StoredProjectSource[];
  codingSessions: StudyCodingSession[];
  codingSubmissions: StudyCodingSubmission[];
  conceptTrees: StudyProjectConceptTree[];
};

const dataDirectory =
  process.env.STUDY_FORGE_DATA_DIR?.trim() ||
  path.join(process.cwd(), ".study-forge-data");
const sourceDirectory = path.join(dataDirectory, "sources");
const projectsDirectory = path.join(dataDirectory, "projects");
const databasePath = path.join(dataDirectory, "projects.json");
let writeQueue: Promise<unknown> = Promise.resolve();

async function ensureStorage() {
  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(projectsDirectory, { recursive: true }),
  ]);
}

async function readDatabase(): Promise<StudyProjectDatabase> {
  await ensureStorage();
  try {
    const value = JSON.parse(await readFile(databasePath, "utf8")) as Partial<StudyProjectDatabase>;
    const database = {
      projects: Array.isArray(value.projects) ? value.projects : [],
      sources: Array.isArray(value.sources) ? value.sources : [],
      codingSessions: Array.isArray(value.codingSessions) ? value.codingSessions : [],
      codingSubmissions: Array.isArray(value.codingSubmissions) ? value.codingSubmissions : [],
      conceptTrees: Array.isArray(value.conceptTrees) ? value.conceptTrees : [],
    };
    await normalizeStoredSources(database);
    return database;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { projects: [], sources: [], codingSessions: [], codingSubmissions: [], conceptTrees: [] };
    }
    throw error;
  }
}

async function writeDatabase(database: StudyProjectDatabase) {
  await ensureStorage();
  const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(database, null, 2), "utf8");
  await rename(temporaryPath, databasePath);
}

function mutateDatabase<T>(run: (database: StudyProjectDatabase) => Promise<T> | T) {
  const operation = writeQueue.then(async () => {
    const database = await readDatabase();
    const result = await run(database);
    await writeDatabase(database);
    return result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function listStudyProjects(): Promise<StudyProjectSummary[]> {
  const database = await readDatabase();
  return database.projects
    .map((project) => ({
      ...project,
      sourceCount: database.sources.filter((source) => source.projectId === project.id).length,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createStudyProject(name: string): Promise<StudyProject> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("프로젝트 이름을 입력하세요.");
  if (cleanName.length > 80) throw new Error("프로젝트 이름은 80자 이내로 입력하세요.");

  return mutateDatabase(async (database) => {
    const now = new Date().toISOString();
    const project: StudyProject = {
      id: randomUUID(),
      name: cleanName,
      createdAt: now,
      updatedAt: now,
    };
    await ensureProjectWorkspace(project.id);
    database.projects.push(project);
    return project;
  });
}

export async function getStudyProjectCodexContext(projectId: string) {
  const database = await readDatabase();
  const project = database.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");
  const workspacePath = await ensureProjectWorkspace(project.id);
  return {
    projectId: project.id,
    projectName: project.name,
    workspacePath,
    codexThreadId: project.codexThreadId,
  };
}

export async function bindStudyProjectCodexThread(
  projectId: string,
  codexThreadId: string,
) {
  const cleanThreadId = cleanRequiredText(codexThreadId, "Codex 스레드 ID", 200);
  return mutateDatabase(async (database) => {
    const project = database.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    await ensureProjectWorkspace(project.id);
    if (project.codexThreadId && project.codexThreadId !== cleanThreadId) {
      throw new Error("이 프로젝트에는 이미 다른 Codex 스레드가 연결되어 있습니다.");
    }
    project.codexThreadId = cleanThreadId;
    project.updatedAt = new Date().toISOString();
    return project;
  });
}

export async function replaceStudyProjectCodexThread(
  projectId: string,
  expectedThreadId: string,
  replacementThreadId: string,
) {
  const cleanExpected = cleanRequiredText(expectedThreadId, "기존 Codex 스레드 ID", 200);
  const cleanReplacement = cleanRequiredText(replacementThreadId, "새 Codex 스레드 ID", 200);
  return mutateDatabase(async (database) => {
    const project = database.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    if (project.codexThreadId !== cleanExpected) {
      throw new Error("프로젝트의 Codex 스레드가 이미 다른 요청에서 변경되었습니다.");
    }
    await ensureProjectWorkspace(project.id);
    project.codexThreadId = cleanReplacement;
    project.updatedAt = new Date().toISOString();
    return project;
  });
}

export async function getStudyProject(projectId: string): Promise<StudyProjectDetail | null> {
  const database = await readDatabase();
  const project = database.projects.find((item) => item.id === projectId);
  if (!project) return null;
  return {
    project,
    sources: database.sources
      .filter((source) => source.projectId === projectId)
      .map(stripStorageName)
      .sort((left, right) => right.addedAt.localeCompare(left.addedAt)),
    conceptTrees: database.conceptTrees
      .filter((tree) => tree.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    activeCodingSession: findActiveCodingSession(database, projectId),
  };
}

export async function saveStudyProjectConceptTree(
  projectId: string,
  inputTree: LearningConceptTree,
  requestedSourceIds: string[] = [],
): Promise<StudyProjectConceptTree> {
  const tree = normalizeConceptTree(inputTree);
  return mutateDatabase((database) => {
    const project = database.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    const projectSources = database.sources.filter((source) => source.projectId === projectId);
    const validSourceIds = new Set(projectSources.map((source) => source.id));
    const explicitSourceIds = [...new Set(requestedSourceIds)].filter((id) => validSourceIds.has(id));
    const sourceFileNames = new Set(tree.sourceFileNames.map(normalizeFileName));
    const inferredSourceIds = projectSources
      .filter((source) => sourceFileNames.has(normalizeFileName(source.fileName)))
      .map((source) => source.id);
    const sourceIds = explicitSourceIds.length ? explicitSourceIds : inferredSourceIds;
    const now = new Date().toISOString();
    const existing = database.conceptTrees.find(
      (item) => item.projectId === projectId && item.id === tree.id,
    );
    if (existing) {
      existing.sourceIds = sourceIds;
      existing.tree = tree;
      existing.updatedAt = now;
      project.updatedAt = now;
      return existing;
    }
    const stored: StudyProjectConceptTree = {
      id: tree.id,
      projectId,
      sourceIds,
      tree,
      createdAt: now,
      updatedAt: now,
    };
    database.conceptTrees.push(stored);
    project.updatedAt = now;
    return stored;
  });
}

export async function startStudyCodingSession(
  projectId: string,
  input: { learningGoal: string; currentTask: string; workspaceLabel?: string },
): Promise<StudyCodingSessionDetail> {
  const learningGoal = cleanRequiredText(input.learningGoal, "학습 목표", 500);
  const currentTask = cleanRequiredText(input.currentTask, "현재 코딩 과제", 500);
  const workspaceLabel = cleanOptionalText(input.workspaceLabel, 120);

  return mutateDatabase((database) => {
    const project = database.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    const now = new Date().toISOString();
    for (const session of database.codingSessions) {
      if (session.projectId === projectId && session.status === "active") {
        session.status = "completed";
        session.updatedAt = now;
      }
    }
    const session: StudyCodingSession = {
      id: randomUUID(),
      projectId,
      learningGoal,
      currentTask,
      workspaceLabel,
      status: "active",
      startedAt: now,
      updatedAt: now,
    };
    database.codingSessions.push(session);
    project.updatedAt = now;
    return { ...session, submissionCount: 0 };
  });
}

export async function getActiveStudyCodingSession(projectId?: string) {
  const database = await readDatabase();
  return findActiveCodingSession(database, projectId);
}

export async function submitStudyCodingCode(
  sessionId: string,
  input: {
    filePath: string;
    language: string;
    selectedCode: string;
    surroundingCode?: string;
    authoringMode?: StudyCodingSubmission["authoringMode"];
  },
) {
  const filePath = cleanRequiredText(input.filePath, "파일 경로", 500);
  const language = cleanRequiredText(input.language, "코드 언어", 80);
  const selectedCode = cleanRequiredText(input.selectedCode, "선택 코드", 30_000);
  const surroundingCode = cleanOptionalText(input.surroundingCode, 30_000) || undefined;
  const authoringMode = input.authoringMode ?? "unspecified";
  if (!["direct", "ai_assisted", "unspecified"].includes(authoringMode)) {
    throw new Error("코드 작성 방식을 확인하지 못했습니다.");
  }

  return mutateDatabase((database) => {
    const session = database.codingSessions.find((item) => item.id === sessionId);
    if (!session || session.status !== "active") {
      throw new Error("진행 중인 코딩 학습 세션을 찾지 못했습니다.");
    }
    const now = new Date().toISOString();
    const submission: StudyCodingSubmission = {
      id: randomUUID(),
      sessionId,
      projectId: session.projectId,
      filePath,
      language,
      selectedCode,
      surroundingCode,
      authoringMode,
      submittedAt: now,
    };
    database.codingSubmissions.push(submission);
    session.updatedAt = now;
    const project = database.projects.find((item) => item.id === session.projectId);
    if (project) project.updatedAt = now;
    return submission;
  });
}

export async function addStudyProjectSources(projectId: string, files: File[]) {
  if (files.length === 0) throw new Error("추가할 PDF를 선택하세요.");
  if (files.length > 20) throw new Error("한 번에 PDF를 최대 20개까지 추가할 수 있습니다.");
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 50 * 1024 * 1024) throw new Error("PDF 전체 용량은 최대 50MB입니다.");
  if (files.some((file) => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
    throw new Error("PDF 파일만 추가할 수 있습니다.");
  }

  return mutateDatabase(async (database) => {
    const project = database.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("학습 프로젝트를 찾지 못했습니다.");

    const added: StudyProjectSource[] = [];
    const projectSources = await ensureProjectSourceDirectory(project.id);
    for (const file of files) {
      const id = randomUUID();
      const storageName = `${id}.pdf`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const source: StoredProjectSource = {
        id,
        projectId,
        fileName: file.name,
        mimeType: "application/pdf",
        size: file.size,
        lastModified: file.lastModified,
        addedAt: new Date().toISOString(),
        checksum: sha256(bytes),
        storageName,
      };
      await writeFile(path.join(projectSources, storageName), bytes);
      database.sources.push(source);
      added.push(stripStorageName(source));
    }
    project.updatedAt = new Date().toISOString();
    return added;
  });
}

export async function loadStudyProjectSource(sourceId: string) {
  const database = await readDatabase();
  const source = database.sources.find((item) => item.id === sourceId);
  if (!source) return null;
  return {
    source: stripStorageName(source),
    bytes: await readFile(await resolveStoredSourcePath(source)),
  };
}

export async function saveStudyProjectSourceAnalysis(
  sourceId: string,
  analysis: PdfAnalysisResult,
  purpose: "study" | "reading" = "study",
) {
  return mutateDatabase(async (database) => {
    const source = database.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("PDF 소스를 찾지 못했습니다.");
    const currentChecksum = sha256(await readFile(await resolveStoredSourcePath(source)));
    if (currentChecksum !== source.checksum) {
      throw new Error("원본 PDF가 변경되어 기존 분석을 저장할 수 없습니다. PDF를 다시 추가하세요.");
    }
    const storedAnalysis = {
      sourceChecksum: currentChecksum,
      generatedAt: new Date().toISOString(),
      result: analysis,
    };
    if (purpose === "reading") source.readingAnalysis = storedAnalysis;
    else source.analysis = storedAnalysis;
    const project = database.projects.find((item) => item.id === source.projectId);
    if (project) project.updatedAt = new Date().toISOString();
    return stripStorageName(source);
  });
}

export async function deleteStudyProjectSource(sourceId: string) {
  return mutateDatabase(async (database) => {
    const index = database.sources.findIndex((item) => item.id === sourceId);
    if (index < 0) return false;
    const [source] = database.sources.splice(index, 1);
    await rm(await resolveStoredSourcePath(source), { force: true });
    for (const conceptTree of database.conceptTrees) {
      if (conceptTree.projectId !== source.projectId) continue;
      conceptTree.sourceIds = conceptTree.sourceIds.filter((id) => id !== source.id);
    }
    const project = database.projects.find((item) => item.id === source.projectId);
    if (project) project.updatedAt = new Date().toISOString();
    return true;
  });
}

function stripStorageName(source: StoredProjectSource): StudyProjectSource {
  return {
    id: source.id,
    projectId: source.projectId,
    fileName: source.fileName,
    mimeType: source.mimeType,
    size: source.size,
    lastModified: source.lastModified,
    addedAt: source.addedAt,
    checksum: source.checksum,
    analysis: source.analysis,
    readingAnalysis: source.readingAnalysis,
  };
}

function findActiveCodingSession(
  database: StudyProjectDatabase,
  projectId?: string,
): StudyCodingSessionDetail | undefined {
  const session = database.codingSessions
    .filter((item) => item.status === "active" && (!projectId || item.projectId === projectId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!session) return undefined;
  const submissions = database.codingSubmissions
    .filter((item) => item.sessionId === session.id)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return {
    ...session,
    latestSubmission: submissions[0],
    submissionCount: submissions.length,
  };
}

function cleanRequiredText(value: string, label: string, maximumLength: number) {
  const clean = value.trim();
  if (!clean) throw new Error(`${label}을 입력하세요.`);
  if (clean.length > maximumLength) throw new Error(`${label}은 ${maximumLength}자 이내로 입력하세요.`);
  return clean;
}

function cleanOptionalText(value: string | undefined, maximumLength: number) {
  const clean = value?.trim() ?? "";
  if (clean.length > maximumLength) throw new Error(`입력은 ${maximumLength}자 이내로 작성하세요.`);
  return clean;
}

function normalizeConceptTree(input: LearningConceptTree): LearningConceptTree {
  const id = cleanRequiredText(input?.id ?? "", "학습트리 ID", 200);
  const title = cleanRequiredText(input?.title ?? "", "학습트리 제목", 200);
  if (!Array.isArray(input?.nodes) || input.nodes.length === 0) {
    throw new Error("학습트리에 개념 노드가 없습니다.");
  }
  const sourceFileNames = [...new Set(
    (Array.isArray(input.sourceFileNames) ? input.sourceFileNames : [])
      .map((fileName) => cleanRequiredText(fileName, "출처 파일명", 500)),
  )];
  const nodes = input.nodes.map((node, index) => ({
    id: cleanRequiredText(node?.id ?? "", "개념 노드 ID", 200),
    parentId: node?.parentId
      ? cleanRequiredText(node.parentId, "상위 개념 노드 ID", 200)
      : null,
    order: Number.isFinite(node?.order) ? node.order : index,
    depth: Number.isFinite(node?.depth) ? Math.max(0, node.depth) : 0,
    title: cleanRequiredText(node?.title ?? "", "개념 노드 제목", 300),
    relation: cleanOptionalText(node?.relation, 300),
    description: cleanOptionalText(node?.description, 2_000),
    sourceRefs: (Array.isArray(node?.sourceRefs) ? node.sourceRefs : []).map((reference) => ({
      fileName: cleanRequiredText(reference?.fileName ?? "", "개념 출처 파일명", 500),
      pageNumbers: [...new Set(
        (Array.isArray(reference?.pageNumbers) ? reference.pageNumbers : [])
          .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0),
      )],
    })),
  }));
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`중복된 개념 노드 ID입니다: ${node.id}`);
    nodeIds.add(node.id);
  }
  for (const node of nodes) {
    if (node.parentId === node.id) throw new Error("개념 노드는 자기 자신을 상위 노드로 가질 수 없습니다.");
    if (node.parentId && !nodeIds.has(node.parentId)) {
      throw new Error(`상위 개념 노드를 찾지 못했습니다: ${node.parentId}`);
    }
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error("학습트리에 순환 연결이 있습니다.");
      visited.add(parentId);
      parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
  return { id, title, sourceFileNames, nodes };
}

function normalizeFileName(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

async function normalizeStoredSources(database: StudyProjectDatabase) {
  for (const source of database.sources) {
    const sourcePath = await resolveStoredSourcePath(source);
    if (!source.checksum) {
      const bytes = await readFile(sourcePath);
      source.checksum = sha256(bytes);
    }
    source.analysis = normalizeStoredAnalysis(source.analysis, source.checksum);
    source.readingAnalysis = normalizeStoredAnalysis(source.readingAnalysis, source.checksum);
  }
}

async function ensureProjectWorkspace(projectId: string) {
  const workspacePath = projectWorkspacePath(projectId);
  await mkdir(path.join(workspacePath, "sources"), { recursive: true });
  return workspacePath;
}

async function ensureProjectSourceDirectory(projectId: string) {
  return path.join(await ensureProjectWorkspace(projectId), "sources");
}

function projectWorkspacePath(projectId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(projectId)) {
    throw new Error("학습 프로젝트 ID가 올바르지 않습니다.");
  }
  return path.join(projectsDirectory, projectId);
}

async function resolveStoredSourcePath(source: StoredProjectSource) {
  const projectPath = path.join(
    await ensureProjectSourceDirectory(source.projectId),
    safeStorageName(source.storageName),
  );
  if (await pathExists(projectPath)) return projectPath;

  const legacyPath = path.join(sourceDirectory, safeStorageName(source.storageName));
  if (!(await pathExists(legacyPath))) return projectPath;

  try {
    await rename(legacyPath, projectPath);
  } catch (error) {
    if (!(await pathExists(projectPath))) throw error;
  }
  return projectPath;
}

function safeStorageName(storageName: string) {
  const fileName = path.basename(storageName);
  if (fileName !== storageName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new Error("저장된 PDF 경로가 올바르지 않습니다.");
  }
  return fileName;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeStoredAnalysis(
  analysis: StoredProjectSource["analysis"] | PdfAnalysisResult | undefined,
  checksum: string,
) {
  if (!analysis) return undefined;
  if ("result" in analysis) return analysis;
  return {
    sourceChecksum: checksum,
    generatedAt: new Date(0).toISOString(),
    result: analysis,
  };
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
