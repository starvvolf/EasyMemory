import "server-only";

import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { CloudStorageConflictError } from "@/lib/cloud-storage-types";
import { getFirebaseAdminServices } from "@/lib/firebase-admin";
import {
  applyMemorySummary,
  createMemoryState,
  editMemoryEntry,
  selectMemoryContext,
  validateMemoryCandidates,
  type MemoryDomain,
  type MemoryState,
} from "@/lib/learner-memory";
import { UserDataHttpError } from "@/lib/server-user";

const MAX_DOCUMENT_BYTES = 900_000;
const MAX_EVIDENCE = 2_000;
const MAX_SECTIONS = 150;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type LearnerMemoryRecordInput = {
  recordId: string;
  summary: {
    throughMessageId: string;
    updatedAt: string;
    automatic: boolean;
    sections: Array<{
      text: string;
      messageIds: string[];
      codeIds: string[];
    }>;
    learnerMemoryCandidates: unknown;
  };
  evidenceIndex: Array<{
    id: string;
    kind: "message" | "code";
    contentHash: string;
  }>;
};

type MutationOptions = { expectedRevision: number; operationId: string };
type StoredRecord = LearnerMemoryRecordInput & {
  ownerUid: string;
  throughSequence: number;
  storedAt: string;
};

export async function loadLearnerMemory(
  uid: string,
  firestore = getFirebaseAdminServices().firestore,
): Promise<MemoryState> {
  assertId(uid, "사용자");
  const snapshot = await memoryRef(firestore, uid).get();
  if (!snapshot.exists) return createMemoryState(uid);
  return readOwnedState(snapshot, uid);
}

export async function applyLearnerMemorySummary(
  uid: string,
  input: LearnerMemoryRecordInput,
  options: MutationOptions,
  firestore = getFirebaseAdminServices().firestore,
): Promise<{ state: MemoryState; status: "applied" | "duplicate" }> {
  validateRecord(input);
  validateOptions(options);
  const candidates = validateCandidates(input.summary.learnerMemoryCandidates);
  const throughSequence = resolveThroughSequence(input, candidates.flatMap((item) => item.evidenceIds));
  const requestHash = stableHash({ input, expectedRevision: options.expectedRevision });
  const stateReference = memoryRef(firestore, uid);
  const recordReference = userRef(firestore, uid).collection("learnerMemoryRecords").doc(input.recordId);
  const operationReference = userRef(firestore, uid).collection("operations").doc(options.operationId);

  return firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, recordSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(recordReference),
      transaction.get(operationReference),
    ]);
    const state = stateSnapshot.exists ? readOwnedState(stateSnapshot, uid) : createMemoryState(uid);
    if (operationSnapshot.exists) {
      assertSameOperation(operationSnapshot, "apply-learner-memory", input.recordId, requestHash);
      return { state, status: "duplicate" as const };
    }
    assertRevision(state.revision, options.expectedRevision);
    if (recordSnapshot.exists) {
      const previous = recordSnapshot.data() as StoredRecord;
      if (previous.ownerUid !== uid) throw new Error("학습 기록 소유자가 일치하지 않습니다.");
      assertEvidenceAppendOnly(previous.evidenceIndex, input.evidenceIndex);
      if (!Number.isSafeInteger(previous.throughSequence) || throughSequence <= previous.throughSequence) {
        throw new UserDataHttpError(409, "기존 학습 기록보다 이전 위치의 요약으로 되돌릴 수 없습니다.");
      }
    }

    let next: MemoryState;
    try {
      next = applyMemorySummary(
        state,
        uid,
        options.expectedRevision,
        {
          ownerUid: uid,
          recordId: input.recordId,
          throughSequence,
          events: input.evidenceIndex
            .map((item, sequence) => ({ id: item.id, sequence }))
            .filter((item) => item.sequence <= throughSequence),
        },
        candidates,
        input.summary.updatedAt,
      );
    } catch (error) {
      throw badRequest(error);
    }
    const storedRecord: StoredRecord = {
      recordId: input.recordId,
      summary: {
        throughMessageId: input.summary.throughMessageId,
        updatedAt: new Date(input.summary.updatedAt).toISOString(),
        automatic: input.summary.automatic,
        sections: input.summary.sections.map((section) => ({
          text: section.text.trim(),
          messageIds: [...section.messageIds],
          codeIds: [...section.codeIds],
        })),
        learnerMemoryCandidates: clean(candidates),
      },
      evidenceIndex: input.evidenceIndex.map((evidence) => ({
        id: evidence.id,
        kind: evidence.kind,
        contentHash: evidence.contentHash,
      })),
      ownerUid: uid,
      throughSequence,
      storedAt: new Date().toISOString(),
    };
    assertSize(storedRecord, "학습 기록");
    assertSize(next, "학습자 메모리");
    transaction.set(recordReference, storedRecord);
    transaction.set(stateReference, next);
    transaction.create(operationReference, operation(uid, "apply-learner-memory", input.recordId, requestHash, next.revision));
    return { state: next, status: "applied" as const };
  });
}

export async function editLearnerMemory(
  uid: string,
  target: { domain: MemoryDomain; topic: string },
  change: { confirmed: string[]; uncertain: string[] } | "delete" | "confirm",
  options: MutationOptions,
  firestore = getFirebaseAdminServices().firestore,
): Promise<MemoryState> {
  validateOptions(options);
  const requestHash = stableHash({ target, change, expectedRevision: options.expectedRevision });
  const stateReference = memoryRef(firestore, uid);
  const operationReference = userRef(firestore, uid).collection("operations").doc(options.operationId);
  return firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(operationReference),
    ]);
    const state = stateSnapshot.exists ? readOwnedState(stateSnapshot, uid) : createMemoryState(uid);
    if (operationSnapshot.exists) {
      assertSameOperation(operationSnapshot, "edit-learner-memory", JSON.stringify(target), requestHash);
      return state;
    }
    assertRevision(state.revision, options.expectedRevision);
    let next: MemoryState;
    try {
      next = editMemoryEntry(state, uid, options.expectedRevision, target, change, new Date().toISOString());
    } catch (error) {
      throw badRequest(error);
    }
    assertSize(next, "학습자 메모리");
    transaction.set(stateReference, next);
    transaction.create(operationReference, operation(uid, "edit-learner-memory", JSON.stringify(target), requestHash, next.revision));
    return next;
  });
}

export async function selectLearnerMemory(
  uid: string,
  domain: MemoryDomain,
  topics: string[],
  firestore = getFirebaseAdminServices().firestore,
) {
  const state = await loadLearnerMemory(uid, firestore);
  try {
    return selectMemoryContext(state, uid, domain, topics);
  } catch (error) {
    throw badRequest(error);
  }
}

function validateRecord(input: LearnerMemoryRecordInput) {
  if (!input || typeof input !== "object") throw new UserDataHttpError(400, "학습 기록 형식이 올바르지 않습니다.");
  assertId(input.recordId, "학습 기록");
  if (!input.summary || typeof input.summary !== "object") throw new UserDataHttpError(400, "학습 요약이 없습니다.");
  assertId(input.summary.throughMessageId, "마지막 메시지");
  if (!Number.isFinite(Date.parse(input.summary.updatedAt))) throw new UserDataHttpError(400, "학습 요약 시각이 올바르지 않습니다.");
  if (typeof input.summary.automatic !== "boolean") throw new UserDataHttpError(400, "학습 요약 유형이 올바르지 않습니다.");
  if (!Array.isArray(input.summary.sections) || input.summary.sections.length > MAX_SECTIONS) throw new UserDataHttpError(400, "학습 요약 섹션이 너무 많습니다.");
  for (const section of input.summary.sections) {
    if (!section || typeof section.text !== "string" || !section.text.trim() || section.text.length > 4_000) throw new UserDataHttpError(400, "학습 요약 섹션이 올바르지 않습니다.");
    validateIdList(section.messageIds);
    validateIdList(section.codeIds);
  }
  if (!Array.isArray(input.evidenceIndex) || !input.evidenceIndex.length || input.evidenceIndex.length > MAX_EVIDENCE) throw new UserDataHttpError(400, "학습 근거 색인이 올바르지 않습니다.");
  const ids = new Set<string>();
  const kinds = new Map<string, "message" | "code">();
  for (const evidence of input.evidenceIndex) {
    assertId(evidence?.id, "학습 근거");
    if (ids.has(evidence.id) || !["message", "code"].includes(evidence.kind) || !SHA256_HEX.test(evidence.contentHash)) throw new UserDataHttpError(400, "학습 근거 색인이 올바르지 않습니다.");
    ids.add(evidence.id);
    kinds.set(evidence.id, evidence.kind);
  }
  for (const section of input.summary.sections) {
    for (const id of section.messageIds) {
      if (kinds.get(id) !== "message") throw new UserDataHttpError(400, "학습 요약이 알 수 없거나 종류가 다른 메시지 근거를 참조합니다.");
    }
    for (const id of section.codeIds) {
      if (kinds.get(id) !== "code") throw new UserDataHttpError(400, "학습 요약이 알 수 없거나 종류가 다른 코드 근거를 참조합니다.");
    }
  }
}

function validateCandidates(value: unknown) {
  try {
    return validateMemoryCandidates(value);
  } catch (error) {
    throw badRequest(error);
  }
}

function resolveThroughSequence(input: LearnerMemoryRecordInput, candidateIds: string[]) {
  const positions = new Map(input.evidenceIndex.map((item, index) => [item.id, { index, kind: item.kind }]));
  const through = positions.get(input.summary.throughMessageId);
  if (!through || through.kind !== "message") throw new UserDataHttpError(400, "마지막 메시지가 학습 근거 색인에 없습니다.");
  let sequence = through.index;
  for (const id of candidateIds) {
    const evidence = positions.get(id);
    if (!evidence) throw new UserDataHttpError(400, "메모리 후보가 알 수 없는 학습 근거를 참조합니다.");
    sequence = Math.max(sequence, evidence.index);
  }
  return sequence;
}

function assertEvidenceAppendOnly(previous: LearnerMemoryRecordInput["evidenceIndex"], next: LearnerMemoryRecordInput["evidenceIndex"]) {
  if (!Array.isArray(previous) || previous.length > next.length) throw new UserDataHttpError(409, "기존 학습 근거 순서를 변경할 수 없습니다.");
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index];
    const right = next[index];
    if (!right || left.id !== right.id || left.kind !== right.kind || left.contentHash !== right.contentHash) throw new UserDataHttpError(409, "기존 학습 근거는 수정하거나 재정렬할 수 없습니다.");
  }
}

function readOwnedState(snapshot: DocumentSnapshot, uid: string): MemoryState {
  const state = snapshot.data() as MemoryState;
  if (!state || state.ownerUid !== uid || !Number.isSafeInteger(state.revision) || !Array.isArray(state.entries) || !Array.isArray(state.appliedSources)) throw new Error("저장된 학습자 메모리 형식이 올바르지 않습니다.");
  return state;
}

function assertRevision(current: number, expected: number) {
  if (current !== expected) throw new CloudStorageConflictError("다른 기기에서 학습자 메모리를 먼저 변경했습니다. 최신 데이터를 불러온 뒤 재시도하세요.", current);
}

function validateOptions(options: MutationOptions) {
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw new UserDataHttpError(400, "예상 리비전이 올바르지 않습니다.");
  assertId(options.operationId, "작업");
}

function assertSameOperation(snapshot: DocumentSnapshot, kind: string, targetId: string, requestHash: string) {
  if (snapshot.get("kind") !== kind || snapshot.get("targetId") !== targetId || snapshot.get("requestHash") !== requestHash) throw new UserDataHttpError(409, "같은 작업 ID에 다른 요청이 이미 처리되었습니다.");
}

function operation(uid: string, kind: string, targetId: string, requestHash: string, revision: number) {
  return { ownerUid: uid, kind, targetId, requestHash, revision, createdAt: new Date().toISOString() };
}

function userRef(firestore: Firestore, uid: string) {
  assertId(uid, "사용자");
  return firestore.collection("users").doc(uid);
}

function memoryRef(firestore: Firestore, uid: string) {
  return userRef(firestore, uid).collection("learnerMemory").doc("state");
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 200 || value.includes("/")) throw new UserDataHttpError(400, `${label} ID가 올바르지 않습니다.`);
}

function validateIdList(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new UserDataHttpError(400, "학습 요약 근거 목록이 올바르지 않습니다.");
  value.forEach((id) => assertId(id, "학습 요약 근거"));
}

function assertSize(value: unknown, label: string) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DOCUMENT_BYTES) throw new UserDataHttpError(413, `${label} 데이터가 Firestore 문서 제한에 가깝습니다.`);
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function badRequest(error: unknown) {
  return error instanceof UserDataHttpError
    ? error
    : new UserDataHttpError(400, error instanceof Error ? error.message : "학습자 메모리 요청이 올바르지 않습니다.");
}
