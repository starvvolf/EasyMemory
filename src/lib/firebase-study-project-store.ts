import "server-only";

import { randomUUID } from "node:crypto";
import { getFirebaseAdminServices } from "@/lib/firebase-admin";
import { uploadCloudSource } from "@/lib/firebase-user-data-store";
import type { LearningConceptTree, PdfAnalysisResult } from "@/lib/types";
import type {
  StudyProject,
  StudyProjectConceptTree,
  StudyProjectDetail,
  StudyProjectSource,
  StudyProjectSummary,
} from "@/lib/study-project-types";

type StoredSource = StudyProjectSource & {
  ownerUid: string;
  storagePath: string;
  hasAnalysis?: boolean;
  hasReadingAnalysis?: boolean;
};

const MAX_FIRESTORE_DETAIL_BYTES = 900_000;

export async function listFirebaseStudyProjects(
  uid: string,
): Promise<StudyProjectSummary[]> {
  const { firestore } = getFirebaseAdminServices();
  const snapshot = await firestore
    .collection("users")
    .doc(uid)
    .collection("projects")
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();
  return snapshot.docs.map((document) => stripOwner(document.data()) as StudyProjectSummary);
}

export async function createFirebaseStudyProject(
  uid: string,
  name: string,
): Promise<StudyProject> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("프로젝트 이름을 입력하세요.");
  if (cleanName.length > 80) throw new Error("프로젝트 이름은 80자 이내로 입력하세요.");
  const now = new Date().toISOString();
  const project: StudyProject = {
    id: randomUUID(),
    name: cleanName,
    createdAt: now,
    updatedAt: now,
  };
  const { firestore } = getFirebaseAdminServices();
  await firestore
    .collection("users")
    .doc(uid)
    .collection("projects")
    .doc(project.id)
    .create({ ...project, ownerUid: uid, sourceCount: 0 });
  return project;
}

export async function importFirebaseStudyProject(
  uid: string,
  detail: StudyProjectDetail,
  sourceFiles: Array<{ source: StudyProjectSource; file: File }>,
) {
  const { firestore } = getFirebaseAdminServices();
  const owner = firestore.collection("users").doc(uid);
  const fingerprint = detail.project.id;
  const importRef = owner.collection("imports").doc(`local-project-${fingerprint}`);
  if ((await importRef.get()).exists) {
    return { status: "duplicate" as const, projectId: detail.project.id };
  }
  const projectRef = owner.collection("projects").doc(detail.project.id);
  const existingProject = await projectRef.get();
  if (existingProject.exists && existingProject.get("name") !== detail.project.name) {
    throw new Error("같은 프로젝트 ID의 다른 계정 데이터가 이미 존재합니다.");
  }

  await projectRef.set({
    ...detail.project,
    ownerUid: uid,
    sourceCount: sourceFiles.length,
  });
  for (const item of sourceFiles) {
    await uploadCloudSource(uid, {
      sourceId: item.source.id,
      projectId: detail.project.id,
      file: item.file,
    });
    if (item.source.analysis) {
      await saveFirebaseStudyProjectSourceAnalysis(
        uid,
        item.source.id,
        item.source.analysis.result,
        "study",
      );
    }
    if (item.source.readingAnalysis) {
      await saveFirebaseStudyProjectSourceAnalysis(
        uid,
        item.source.id,
        item.source.readingAnalysis.result,
        "reading",
      );
    }
  }
  for (const conceptTree of detail.conceptTrees) {
    await saveFirebaseStudyProjectConceptTree(
      uid,
      detail.project.id,
      conceptTree.tree,
      conceptTree.sourceIds,
    );
  }
  await importRef.create({
    ownerUid: uid,
    kind: "local-project",
    projectId: detail.project.id,
    sourceCount: sourceFiles.length,
    createdAt: new Date().toISOString(),
  });
  return { status: "imported" as const, projectId: detail.project.id };
}

export async function getFirebaseStudyProject(
  uid: string,
  projectId: string,
): Promise<StudyProjectDetail | null> {
  assertId(projectId, "프로젝트");
  const { firestore } = getFirebaseAdminServices();
  const owner = firestore.collection("users").doc(uid);
  const projectRef = owner.collection("projects").doc(projectId);
  const [projectSnapshot, sourcesSnapshot, treesSnapshot] = await Promise.all([
    projectRef.get(),
    owner.collection("sources").where("projectId", "==", projectId).orderBy("addedAt", "desc").get(),
    projectRef.collection("conceptTrees").orderBy("createdAt", "asc").get(),
  ]);
  if (!projectSnapshot.exists) return null;
  return {
    project: stripProject(projectSnapshot.data()!),
    sources: sourcesSnapshot.docs.map((document) => stripSource(document.data() as StoredSource)),
    conceptTrees: treesSnapshot.docs.map(
      (document) => stripOwner(document.data()) as StudyProjectConceptTree,
    ),
  };
}

export async function addFirebaseStudyProjectSources(
  uid: string,
  projectId: string,
  files: File[],
): Promise<StudyProjectSource[]> {
  validateSourceFiles(files);
  const { firestore } = getFirebaseAdminServices();
  const projectRef = firestore.collection("users").doc(uid).collection("projects").doc(projectId);
  if (!(await projectRef.get()).exists) throw new Error("학습 프로젝트를 찾지 못했습니다.");

  const added: StudyProjectSource[] = [];
  try {
    for (const file of files) {
      const id = randomUUID();
      const stored = (await uploadCloudSource(uid, {
        sourceId: id,
        projectId,
        file,
      })) as StoredSource;
      added.push(stripSource(stored));
    }
  } catch (error) {
    for (const source of added) {
      await deleteFirebaseStudyProjectSource(uid, source.id).catch(() => undefined);
    }
    const remaining = await firestore
      .collection("users")
      .doc(uid)
      .collection("sources")
      .where("projectId", "==", projectId)
      .count()
      .get();
    await projectRef.update({ sourceCount: remaining.data().count });
    throw error;
  }
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(projectRef);
    if (!snapshot.exists) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    transaction.update(projectRef, {
      sourceCount: Number(snapshot.get("sourceCount") ?? 0) + added.length,
      updatedAt: new Date().toISOString(),
    });
  });
  return added;
}

export async function loadFirebaseStudyProjectSource(uid: string, sourceId: string) {
  assertId(sourceId, "자료");
  const { firestore, storage } = getFirebaseAdminServices();
  const snapshot = await firestore.collection("users").doc(uid).collection("sources").doc(sourceId).get();
  if (!snapshot.exists) return null;
  const stored = snapshot.data() as StoredSource;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
  const [bytes] = await bucket.file(stored.storagePath).download();
  return { source: stripSource(stored), bytes };
}

export async function saveFirebaseStudyProjectSourceAnalysis(
  uid: string,
  sourceId: string,
  analysis: PdfAnalysisResult,
  purpose: "study" | "reading" = "study",
) {
  assertId(sourceId, "자료");
  if (!analysis.fileName || !analysis.sourceOutline) {
    throw new Error("저장할 PDF 분석 결과가 올바르지 않습니다.");
  }
  const { firestore } = getFirebaseAdminServices();
  const sourceRef = firestore.collection("users").doc(uid).collection("sources").doc(sourceId);
  const contentRef = sourceRef.collection("content").doc("main");
  const result = await firestore.runTransaction(async (transaction) => {
    const [sourceSnapshot, contentSnapshot] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(contentRef),
    ]);
    if (!sourceSnapshot.exists) throw new Error("PDF 소스를 찾지 못했습니다.");
    const source = sourceSnapshot.data() as StoredSource;
    const storedAnalysis = {
      sourceChecksum: source.checksum,
      generatedAt: new Date().toISOString(),
      result: JSON.parse(JSON.stringify(analysis)),
    };
    const nextContent = {
      ...(contentSnapshot.data() ?? {}),
      [purpose === "reading" ? "readingAnalysis" : "analysis"]: storedAnalysis,
      ownerUid: uid,
    };
    assertFirestoreDetailSize(nextContent, "PDF 분석 결과");
    transaction.set(
      contentRef,
      purpose === "reading"
        ? { readingAnalysis: storedAnalysis, ownerUid: uid }
        : { analysis: storedAnalysis, ownerUid: uid },
      { merge: true },
    );
    transaction.update(sourceRef, {
      [purpose === "reading" ? "hasReadingAnalysis" : "hasAnalysis"]: true,
      updatedAt: new Date().toISOString(),
    });
    return { ...stripSource(source), [purpose === "reading" ? "readingAnalysis" : "analysis"]: storedAnalysis };
  });
  return result as StudyProjectSource;
}

export async function getFirebaseStudyProjectSourceAnalysis(
  uid: string,
  sourceId: string,
) {
  assertId(sourceId, "자료");
  const { firestore } = getFirebaseAdminServices();
  const sourceRef = firestore.collection("users").doc(uid).collection("sources").doc(sourceId);
  const [sourceSnapshot, contentSnapshot] = await Promise.all([
    sourceRef.get(),
    sourceRef.collection("content").doc("main").get(),
  ]);
  if (!sourceSnapshot.exists) return null;
  return {
    source: stripSource(sourceSnapshot.data() as StoredSource),
    analysis: contentSnapshot.get("analysis") ?? null,
    readingAnalysis: contentSnapshot.get("readingAnalysis") ?? null,
  };
}

export async function deleteFirebaseStudyProjectSource(uid: string, sourceId: string) {
  assertId(sourceId, "자료");
  const { firestore, storage } = getFirebaseAdminServices();
  const owner = firestore.collection("users").doc(uid);
  const sourceRef = owner.collection("sources").doc(sourceId);
  const sourceSnapshot = await sourceRef.get();
  if (!sourceSnapshot.exists) return false;
  const source = sourceSnapshot.data() as StoredSource;
  const treeSnapshot = await owner
    .collection("projects")
    .doc(source.projectId)
    .collection("conceptTrees")
    .where("sourceIds", "array-contains", sourceId)
    .get();
  await firestore.runTransaction(async (transaction) => {
    const projectRef = owner.collection("projects").doc(source.projectId);
    const projectSnapshot = await transaction.get(projectRef);
    transaction.delete(sourceRef.collection("content").doc("main"));
    transaction.delete(owner.collection("readingStates").doc(sourceId));
    transaction.delete(sourceRef);
    for (const treeDocument of treeSnapshot.docs) {
      transaction.update(treeDocument.ref, {
        sourceIds: (treeDocument.get("sourceIds") as string[]).filter(
          (id) => id !== sourceId,
        ),
        updatedAt: new Date().toISOString(),
      });
    }
    if (projectSnapshot.exists) {
      transaction.update(projectRef, {
        sourceCount: Math.max(0, Number(projectSnapshot.get("sourceCount") ?? 0) - 1),
        updatedAt: new Date().toISOString(),
      });
    }
  });
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
  await bucket.file(source.storagePath).delete({ ignoreNotFound: true });
  return true;
}

export async function saveFirebaseStudyProjectConceptTree(
  uid: string,
  projectId: string,
  tree: LearningConceptTree,
  sourceIds: string[] = [],
): Promise<StudyProjectConceptTree> {
  assertId(projectId, "프로젝트");
  assertId(tree.id, "학습트리");
  const { firestore } = getFirebaseAdminServices();
  const projectRef = firestore.collection("users").doc(uid).collection("projects").doc(projectId);
  const treeRef = projectRef.collection("conceptTrees").doc(tree.id);
  return firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, existing] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(treeRef),
    ]);
    if (!projectSnapshot.exists) throw new Error("학습 프로젝트를 찾지 못했습니다.");
    const now = new Date().toISOString();
    const stored: StudyProjectConceptTree = {
      id: tree.id,
      projectId,
      sourceIds: [...new Set(sourceIds)],
      tree: JSON.parse(JSON.stringify(tree)) as LearningConceptTree,
      createdAt: existing.exists ? String(existing.get("createdAt")) : now,
      updatedAt: now,
    };
    assertFirestoreDetailSize(stored, "학습트리");
    transaction.set(treeRef, { ...stored, ownerUid: uid });
    transaction.update(projectRef, { updatedAt: now });
    return stored;
  });
}

function stripProject(value: FirebaseFirestore.DocumentData): StudyProject {
  return {
    id: String(value.id),
    name: String(value.name),
    codexThreadId: typeof value.codexThreadId === "string" ? value.codexThreadId : undefined,
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
  };
}

function stripSource(value: StoredSource): StudyProjectSource {
  return {
    id: value.id,
    projectId: value.projectId,
    fileName: value.fileName,
    mimeType: value.mimeType,
    size: value.size,
    lastModified: value.lastModified,
    addedAt: value.addedAt,
    checksum: value.checksum,
  };
}

function stripOwner(value: FirebaseFirestore.DocumentData) {
  const copy = { ...value };
  delete copy.ownerUid;
  return copy;
}

function validateSourceFiles(files: File[]) {
  if (files.length === 0) throw new Error("추가할 PDF를 선택하세요.");
  if (files.length > 20) throw new Error("한 번에 PDF를 최대 20개까지 추가할 수 있습니다.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error("PDF 전체 용량은 최대 50MB입니다.");
  }
  if (files.some((file) => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
    throw new Error("PDF 파일만 추가할 수 있습니다.");
  }
}

function assertId(value: string, label: string) {
  if (!value || value.length > 500 || value.includes("/")) {
    throw new Error(`${label} ID가 올바르지 않습니다.`);
  }
}

function assertFirestoreDetailSize(value: unknown, label: string) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_FIRESTORE_DETAIL_BYTES) {
    throw new Error(`${label}가 Firestore 문서 저장 한도를 초과합니다.`);
  }
}
