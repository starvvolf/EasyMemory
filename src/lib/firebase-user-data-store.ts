import "server-only";

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { getFirebaseAdminServices } from "@/lib/firebase-admin";
import type {
  CloudDeckDetail,
  CloudDeckSummary,
  CloudMutationOptions,
  PdfReadingPosition,
  PdfReadingPositionState,
  CloudStudySessionDetail,
  CloudStudySessionSummary,
  LegacyImportResult,
} from "@/lib/cloud-storage-types";
import { CloudStorageConflictError } from "@/lib/cloud-storage-types";
import { CloudSourceImportRequiredError } from "@/lib/cloud-storage-types";
import type { Card, Deck, StudyAttempt, StudySession } from "@/lib/types";

const MAX_DECK_CARDS_PER_ATOMIC_WRITE = 440;
const MAX_DETAIL_BYTES = 900_000;

type StoredDeckSummary = CloudDeckSummary & {
  ownerUid: string;
  deletedAt?: string | null;
};

type StoredCard = Card & {
  ownerUid: string;
  deckId: string;
  order: number;
};

export async function listCloudDeckSummaries(
  uid: string,
  limit = 100,
): Promise<CloudDeckSummary[]> {
  const { firestore } = getFirebaseAdminServices();
  const snapshot = await userDoc(firestore, uid)
    .collection("decks")
    .where("deletedAt", "==", null)
    .orderBy("updatedAt", "desc")
    .limit(clampLimit(limit))
    .get();
  return snapshot.docs.map((document) => stripOwner(document.data() as StoredDeckSummary));
}

export async function loadCloudDeck(
  uid: string,
  deckId: string,
): Promise<CloudDeckDetail | null> {
  assertDocumentId(deckId, "덱");
  const { firestore } = getFirebaseAdminServices();
  const deckRef = userDoc(firestore, uid).collection("decks").doc(deckId);
  const [summarySnapshot, contentSnapshot, cardSnapshot] = await Promise.all([
    deckRef.get(),
    deckRef.collection("content").doc("main").get(),
    deckRef.collection("cards").orderBy("order", "asc").get(),
  ]);
  if (!summarySnapshot.exists || summarySnapshot.get("deletedAt")) return null;

  const summary = summarySnapshot.data() as StoredDeckSummary;
  const content = contentSnapshot.data() as Omit<Deck, "cards"> | undefined;
  if (!content) throw new Error("덱 상세 데이터를 찾지 못했습니다.");
  const cards = cardSnapshot.docs.map((document) => {
    const card = { ...(document.data() as StoredCard) } as Partial<StoredCard>;
    delete card.ownerUid;
    delete card.deckId;
    delete card.order;
    return card as Card;
  });
  return {
    deck: { ...content, cards },
    revision: summary.revision,
  };
}

export async function saveCloudDeck(
  uid: string,
  deck: Deck,
  options: CloudMutationOptions,
): Promise<CloudDeckDetail> {
  validateDeck(deck);
  validateMutationOptions(options);
  const { firestore } = getFirebaseAdminServices();
  const deckRef = userDoc(firestore, uid).collection("decks").doc(deck.id);
  const contentRef = deckRef.collection("content").doc("main");
  const operationRef = userDoc(firestore, uid).collection("operations").doc(options.operationId);
  const requestHash = stableHash(deck);

  const revision = await firestore.runTransaction(async (transaction) => {
    const [operationSnapshot, summarySnapshot, existingCards] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(deckRef),
      transaction.get(deckRef.collection("cards")),
    ]);
    if (operationSnapshot.exists) {
      assertIdempotentOperation(operationSnapshot, "save-deck", deck.id, requestHash);
      return Number(operationSnapshot.get("revision"));
    }

    const currentRevision = summarySnapshot.exists
      ? Number(summarySnapshot.get("revision") ?? 0)
      : 0;
    assertExpectedRevision(currentRevision, summarySnapshot.exists, options.expectedRevision);
    const nextRevision = currentRevision + 1;
    const summary = buildDeckSummary(uid, deck, nextRevision);
    const content = deckWithoutCards(deck);
    assertDocumentSize(content, "덱 상세");

    transaction.set(deckRef, summary);
    transaction.set(contentRef, cleanFirestoreValue({ ...content, ownerUid: uid }));

    const nextCardIds = new Set(deck.cards.map((card) => card.id));
    for (const document of existingCards.docs) {
      if (!nextCardIds.has(document.id)) transaction.delete(document.ref);
    }
    deck.cards.forEach((card, order) => {
      transaction.set(
        deckRef.collection("cards").doc(card.id),
        cleanFirestoreValue({ ...card, ownerUid: uid, deckId: deck.id, order }),
      );
    });
    transaction.create(operationRef, {
      ownerUid: uid,
      kind: "save-deck",
      targetId: deck.id,
      requestHash,
      revision: nextRevision,
      createdAt: new Date().toISOString(),
    });
    return nextRevision;
  });

  return { deck, revision };
}

export async function deleteCloudDeck(
  uid: string,
  deckId: string,
  options: CloudMutationOptions,
) {
  assertDocumentId(deckId, "덱");
  validateMutationOptions(options);
  const { firestore, storage } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const deckRef = owner.collection("decks").doc(deckId);
  const operationRef = owner.collection("operations").doc(options.operationId);
  const deletedAt = new Date().toISOString();
  const requestHash = stableHash({ deckId });

  const existed = await firestore.runTransaction(async (transaction) => {
    const [operation, deckSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(deckRef),
    ]);
    if (operation.exists) {
      assertIdempotentOperation(operation, "delete-deck", deckId, requestHash);
      return true;
    }
    if (!deckSnapshot.exists) return false;
    const currentRevision = Number(deckSnapshot.get("revision") ?? 0);
    assertExpectedRevision(currentRevision, true, options.expectedRevision);
    transaction.update(deckRef, { deletedAt, revision: currentRevision + 1 });
    transaction.create(operationRef, operationDocument(uid, "delete-deck", deckId, requestHash));
    return true;
  });
  if (!existed) return false;

  const sourceSnapshot = await owner.collection("sources").where("deckId", "==", deckId).get();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
  for (const document of sourceSnapshot.docs) {
    const storagePath = document.get("storagePath");
    if (typeof storagePath === "string") {
      await bucket.file(storagePath).delete({ ignoreNotFound: true });
    }
    await firestore.recursiveDelete(document.ref);
  }
  await firestore.recursiveDelete(deckRef);
  return true;
}

export async function startCloudStudySession(
  uid: string,
  deck: Deck,
  session: StudySession,
  options: CloudMutationOptions,
): Promise<{ deckRevision: number; sessionRevision: number }> {
  validateStudySession(deck, session);
  validateMutationOptions(options);
  const { firestore } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const deckRef = owner.collection("decks").doc(deck.id);
  const sessionRef = owner.collection("studySessions").doc(session.id);
  const operationRef = owner.collection("operations").doc(options.operationId);
  const requestHash = stableHash({
    deckId: deck.id,
    boardColumn: deck.boardColumn,
    updatedAt: deck.updatedAt,
    session,
  });

  return firestore.runTransaction(async (transaction) => {
    const [operation, deckSnapshot, existingSession] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(deckRef),
      transaction.get(sessionRef),
    ]);
    if (operation.exists) {
      assertIdempotentOperation(operation, "start-session", session.id, requestHash);
      return {
        deckRevision: Number(operation.get("deckRevision")),
        sessionRevision: Number(operation.get("sessionRevision") ?? 1),
      };
    }
    if (!deckSnapshot.exists || deckSnapshot.get("deletedAt")) {
      throw new Error("학습할 덱을 찾지 못했습니다.");
    }
    if (existingSession.exists) throw new Error("이미 존재하는 학습 세션 ID입니다.");
    const currentRevision = Number(deckSnapshot.get("revision") ?? 0);
    assertExpectedRevision(currentRevision, true, options.expectedRevision);
    transaction.update(deckRef, {
      boardColumn: deck.boardColumn,
      updatedAt: deck.updatedAt,
      revision: currentRevision + 1,
    });
    transaction.create(sessionRef, sessionDocument(uid, session, 0, 1));
    const deckRevision = currentRevision + 1;
    transaction.create(operationRef, {
      ...operationDocument(uid, "start-session", session.id, requestHash),
      deckRevision,
      sessionRevision: 1,
    });
    return { deckRevision, sessionRevision: 1 };
  });
}

export async function saveCloudStudySession(
  uid: string,
  session: StudySession,
  options: CloudMutationOptions,
): Promise<number> {
  assertDocumentId(session.id, "학습 세션");
  validateMutationOptions(options);
  const { firestore } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const sessionRef = owner.collection("studySessions").doc(session.id);
  const operationRef = owner.collection("operations").doc(options.operationId);
  const requestHash = stableHash(session);
  return firestore.runTransaction(async (transaction) => {
    const [operation, snapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(sessionRef),
    ]);
    if (operation.exists) {
      assertIdempotentOperation(operation, "save-session", session.id, requestHash);
      return Number(operation.get("revision"));
    }
    if (!snapshot.exists) throw new Error("학습 세션을 찾지 못했습니다.");
    const currentRevision = Number(snapshot.get("revision") ?? 1);
    assertExpectedRevision(currentRevision, true, options.expectedRevision);
    const nextRevision = currentRevision + 1;
    transaction.set(
      sessionRef,
      sessionDocument(uid, session, Number(snapshot.get("attemptCount") ?? 0), nextRevision),
    );
    transaction.create(operationRef, {
      ...operationDocument(uid, "save-session", session.id, requestHash),
      revision: nextRevision,
    });
    return nextRevision;
  });
}

export async function saveCloudStudyProgress(
  uid: string,
  input: { deck: Deck; session: StudySession; attempt: StudyAttempt },
  options: CloudMutationOptions,
): Promise<{ deckRevision: number; sessionRevision: number }> {
  validateStudySession(input.deck, input.session);
  if (!input.session.plannedActivityIds.includes(input.attempt.activityId)) {
    throw new Error("응답 기록이 학습 세션 계획에 포함되지 않았습니다.");
  }
  validateMutationOptions(options);
  const card = input.deck.cards.find((item) => item.id === input.attempt.activityId);
  if (!card) throw new Error("응답 기록에 해당하는 카드를 찾지 못했습니다.");

  const { firestore } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const deckRef = owner.collection("decks").doc(input.deck.id);
  const cardRef = deckRef.collection("cards").doc(card.id);
  const sessionRef = owner.collection("studySessions").doc(input.session.id);
  const attemptRef = sessionRef.collection("attempts").doc(input.attempt.id);
  const reviewRef = owner.collection("reviewStates").doc(reviewStateId(input.deck.id, card.id));
  const operationRef = owner.collection("operations").doc(options.operationId);
  const requestHash = stableHash(input);

  return firestore.runTransaction(async (transaction) => {
    const [operation, deckSnapshot, sessionSnapshot, existingAttempt] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(deckRef),
      transaction.get(sessionRef),
      transaction.get(attemptRef),
    ]);
    if (operation.exists) {
      assertIdempotentOperation(operation, "study-progress", input.attempt.id, requestHash);
      return {
        deckRevision: Number(operation.get("deckRevision")),
        sessionRevision: Number(operation.get("sessionRevision")),
      };
    }
    if (!deckSnapshot.exists || !sessionSnapshot.exists) {
      throw new Error("덱 또는 학습 세션을 찾지 못했습니다.");
    }
    if (existingAttempt.exists) {
      if (stableHash(existingAttempt.data()!) === stableHash(attemptDocument(uid, input.attempt))) {
        return {
          deckRevision: Number(deckSnapshot.get("revision") ?? 0),
          sessionRevision: Number(sessionSnapshot.get("revision") ?? 1),
        };
      }
      throw new Error("같은 응답 ID에 다른 내용이 이미 저장되어 있습니다.");
    }
    const currentRevision = Number(deckSnapshot.get("revision") ?? 0);
    assertExpectedRevision(currentRevision, true, options.expectedRevision);
    const attemptCount = Number(sessionSnapshot.get("attemptCount") ?? 0) + 1;
    transaction.set(cardRef, cleanFirestoreValue({
      ...card,
      ownerUid: uid,
      deckId: input.deck.id,
      order: input.deck.cards.findIndex((item) => item.id === card.id),
    }));
    const sessionRevision = Number(sessionSnapshot.get("revision") ?? 1) + 1;
    transaction.set(sessionRef, sessionDocument(uid, input.session, attemptCount, sessionRevision));
    transaction.create(attemptRef, attemptDocument(uid, input.attempt));
    transaction.set(reviewRef, cleanFirestoreValue({
      id: reviewStateId(input.deck.id, card.id),
      ownerUid: uid,
      deckId: input.deck.id,
      cardId: card.id,
      status: card.status,
      reviewSchedule: card.reviewSchedule,
      updatedAt: input.attempt.completedAt,
      lastAttemptId: input.attempt.id,
    }));
    transaction.update(deckRef, {
      boardColumn: input.deck.boardColumn,
      updatedAt: input.deck.updatedAt,
      dueCount: countDueCards(input.deck.cards),
      revision: currentRevision + 1,
    });
    const deckRevision = currentRevision + 1;
    transaction.create(operationRef, {
      ...operationDocument(uid, "study-progress", input.attempt.id, requestHash),
      deckRevision,
      sessionRevision,
    });
    return { deckRevision, sessionRevision };
  });
}

export async function listCloudStudySessions(
  uid: string,
  deckId?: string,
  limit = 100,
): Promise<CloudStudySessionSummary[]> {
  const { firestore } = getFirebaseAdminServices();
  let query = userDoc(firestore, uid)
    .collection("studySessions")
    .orderBy("startedAt", "desc")
    .limit(clampLimit(limit));
  if (deckId) query = query.where("deckId", "==", deckId);
  const snapshot = await query.select(
    "id",
    "deckId",
    "activityType",
    "startedAt",
    "endedAt",
    "status",
    "selectionMode",
    "plannedItemCount",
    "completedItemCount",
    "attemptCount",
    "revision",
  ).get();
  return snapshot.docs.map((document) => stripOwner(document.data()) as CloudStudySessionSummary);
}

export async function loadCloudStudySession(
  uid: string,
  sessionId: string,
): Promise<CloudStudySessionDetail | null> {
  assertDocumentId(sessionId, "학습 세션");
  const { firestore } = getFirebaseAdminServices();
  const sessionRef = userDoc(firestore, uid).collection("studySessions").doc(sessionId);
  const [sessionSnapshot, attemptSnapshot] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection("attempts").orderBy("completedAt", "asc").get(),
  ]);
  if (!sessionSnapshot.exists) return null;
  const storedSession = { ...sessionSnapshot.data()! };
  const revision = Number(storedSession.revision ?? 1);
  delete storedSession.ownerUid;
  delete storedSession.attemptCount;
  delete storedSession.revision;
  return {
    session: storedSession as StudySession,
    attempts: attemptSnapshot.docs.map((document) => stripOwner(document.data()) as StudyAttempt),
    revision,
  };
}

export async function uploadCloudSource(
  uid: string,
  input: { sourceId: string; deckId?: string; projectId?: string; file: File },
) {
  assertDocumentId(input.sourceId, "자료");
  if (input.file.size > 50 * 1024 * 1024) throw new Error("자료 파일은 최대 50MB입니다.");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const checksum = sha256(bytes);
  const { firestore, storage } = getFirebaseAdminServices();
  const bucket = configuredBucket(storage.bucket());
  const storagePath = `users/${uid}/sources/${input.sourceId}/original/${safeFileName(input.file.name)}`;
  const storageFile = bucket.file(storagePath);
  await storageFile.save(bytes, {
      resumable: false,
      contentType: input.file.type || "application/octet-stream",
      metadata: { metadata: { ownerUid: uid, checksum } },
    });
  const now = new Date().toISOString();
  const source = cleanFirestoreValue({
    id: input.sourceId,
    ownerUid: uid,
    deckId: input.deckId,
    projectId: input.projectId,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
    lastModified: input.file.lastModified,
    checksum,
    storagePath,
    addedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await userDoc(firestore, uid).collection("sources").doc(input.sourceId).set(source);
  } catch (error) {
    await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return source;
}

export async function importLegacyDeck(
  uid: string,
  deck: Deck,
  files: File[],
): Promise<LegacyImportResult> {
  validateDeck(deck);
  const fingerprint = await legacyImportFingerprint(deck, files);
  const { firestore } = getFirebaseAdminServices();
  const importRef = userDoc(firestore, uid).collection("imports").doc(fingerprint);
  const existing = await importRef.get();
  if (existing.exists) {
    return {
      status: "duplicate",
      deckId: String(existing.get("deckId")),
      sourceCount: Number(existing.get("sourceCount") ?? 0),
      fingerprint,
    };
  }

  const importedSourceIds: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const sourceId = deck.pdfSourceIds?.[index] ?? `${deck.id}-legacy-${index + 1}`;
    await uploadCloudSource(uid, {
      sourceId,
      deckId: deck.id,
      file: files[index],
    });
    importedSourceIds.push(sourceId);
  }
  const importedDeck = {
    ...deck,
    pdfSourceIds: importedSourceIds,
  };
  await saveCloudDeck(uid, importedDeck, {
    operationId: `import-${fingerprint}`,
    expectedRevision: 0,
  });
  await importRef.create({
    ownerUid: uid,
    deckId: deck.id,
    sourceCount: files.length,
    createdAt: new Date().toISOString(),
  });
  return { status: "imported", deckId: deck.id, sourceCount: files.length, fingerprint };
}

export async function getCloudPdfReadingPosition(
  uid: string,
  sourceId: string,
): Promise<PdfReadingPosition | null> {
  assertDocumentId(sourceId, "자료");
  const { firestore } = getFirebaseAdminServices();
  const snapshot = await userDoc(firestore, uid)
    .collection("readingStates")
    .doc(sourceId)
    .get();
  if (!snapshot.exists) return null;
  const value = snapshot.data() as PdfReadingPosition & { ownerUid: string };
  return {
    sourceId: value.sourceId,
    page: value.page,
    updatedAt: value.updatedAt,
    revision: value.revision,
  };
}

export async function getCloudPdfReadingPositionState(
  uid: string,
  sourceId: string,
): Promise<PdfReadingPositionState> {
  assertDocumentId(sourceId, "자료");
  const { firestore } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const [sourceSnapshot, readingSnapshot] = await Promise.all([
    owner.collection("sources").doc(sourceId).get(),
    owner.collection("readingStates").doc(sourceId).get(),
  ]);
  if (!sourceSnapshot.exists) return { state: "import_required", position: null };
  if (!readingSnapshot.exists) return { state: "ready", position: null };
  const value = readingSnapshot.data() as PdfReadingPosition & { ownerUid: string };
  return {
    state: "ready",
    position: {
      sourceId: value.sourceId,
      page: value.page,
      updatedAt: value.updatedAt,
      revision: value.revision,
    },
  };
}

export async function saveCloudPdfReadingPosition(
  uid: string,
  sourceId: string,
  page: number,
  expectedRevision?: number,
  operationId?: string,
): Promise<PdfReadingPosition> {
  assertDocumentId(sourceId, "자료");
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("PDF 페이지는 1 이상의 정수여야 합니다.");
  }
  const { firestore } = getFirebaseAdminServices();
  const owner = userDoc(firestore, uid);
  const sourceRef = owner.collection("sources").doc(sourceId);
  const readingRef = owner.collection("readingStates").doc(sourceId);
  const requestHash = stableHash({ sourceId, page, expectedRevision });

  return firestore.runTransaction(async (transaction) => {
    const [sourceSnapshot, readingSnapshot] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(readingRef),
    ]);
    if (!sourceSnapshot.exists) throw new CloudSourceImportRequiredError();
    if (operationId && readingSnapshot.get("lastOperationId") === operationId) {
      if (readingSnapshot.get("lastOperationHash") !== requestHash) {
        throw new Error("같은 작업 ID에 다른 PDF 읽기 위치가 이미 저장되어 있습니다.");
      }
      return {
        sourceId,
        page: Number(readingSnapshot.get("page")),
        updatedAt: String(readingSnapshot.get("updatedAt")),
        revision: Number(readingSnapshot.get("revision")),
      };
    }
    const currentRevision = readingSnapshot.exists
      ? Number(readingSnapshot.get("revision") ?? 0)
      : 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new CloudStorageConflictError(
        "다른 기기에서 PDF 읽기 위치가 변경되었습니다. 최신 위치를 다시 불러오세요.",
        currentRevision,
      );
    }
    const position: PdfReadingPosition = {
      sourceId,
      page,
      updatedAt: new Date().toISOString(),
      revision: currentRevision + 1,
    };
    transaction.set(readingRef, {
      ...position,
      ownerUid: uid,
      lastOperationId: operationId ?? null,
      lastOperationHash: operationId ? requestHash : null,
    });
    return position;
  });
}

function userDoc(firestore: Firestore, uid: string) {
  assertDocumentId(uid, "사용자");
  return firestore.collection("users").doc(uid);
}

function buildDeckSummary(uid: string, deck: Deck, revision: number): StoredDeckSummary {
  return cleanFirestoreValue({
    id: deck.id,
    ownerUid: uid,
    projectId: deck.projectId,
    title: deck.title,
    boardColumn: deck.boardColumn,
    subject: deck.subject,
    tags: deck.tags,
    mode: deck.mode,
    cardCount: deck.cards.length,
    dueCount: countDueCards(deck.cards),
    sourceCount: deck.pdfSourceIds?.length ?? 0,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
    revision,
    deletedAt: null,
  }) as StoredDeckSummary;
}

function deckWithoutCards(deck: Deck): Omit<Deck, "cards"> {
  const { cards, ...content } = deck;
  void cards;
  return content;
}

function sessionDocument(
  uid: string,
  session: StudySession,
  attemptCount: number,
  revision: number,
) {
  return cleanFirestoreValue({ ...session, ownerUid: uid, attemptCount, revision });
}

function attemptDocument(uid: string, attempt: StudyAttempt) {
  return cleanFirestoreValue({ ...attempt, ownerUid: uid });
}

function operationDocument(
  uid: string,
  kind: string,
  targetId: string,
  requestHash: string,
) {
  return { ownerUid: uid, kind, targetId, requestHash, createdAt: new Date().toISOString() };
}

function assertIdempotentOperation(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  kind: string,
  targetId: string,
  requestHash: string,
) {
  if (
    snapshot.get("kind") !== kind ||
    snapshot.get("targetId") !== targetId ||
    snapshot.get("requestHash") !== requestHash
  ) {
    throw new Error("같은 작업 ID에 다른 저장 요청이 이미 처리되었습니다.");
  }
}

function validateDeck(deck: Deck) {
  assertDocumentId(deck.id, "덱");
  if (deck.cards.length > MAX_DECK_CARDS_PER_ATOMIC_WRITE) {
    throw new Error(`한 덱은 원자적 저장을 위해 카드 ${MAX_DECK_CARDS_PER_ATOMIC_WRITE}장 이하만 지원합니다.`);
  }
  const ids = new Set<string>();
  for (const card of deck.cards) {
    assertDocumentId(card.id, "카드");
    if (ids.has(card.id)) throw new Error("덱에 중복된 카드 ID가 있습니다.");
    ids.add(card.id);
  }
}

function validateStudySession(deck: Deck, session: StudySession) {
  if (session.deckId !== deck.id) throw new Error("학습 세션과 덱이 일치하지 않습니다.");
  if (
    session.plannedItemCount === 0 ||
    session.plannedItemCount !== session.plannedActivityIds.length
  ) {
    throw new Error("학습 세션 계획 수와 카드 ID 수가 일치하지 않습니다.");
  }
}

function validateMutationOptions(options: CloudMutationOptions) {
  assertDocumentId(options.operationId, "작업");
  if (options.expectedRevision !== undefined && options.expectedRevision < 0) {
    throw new Error("예상 리비전이 올바르지 않습니다.");
  }
}

function assertExpectedRevision(current: number, exists: boolean, expected?: number) {
  if ((exists && expected === undefined) || (expected !== undefined && expected !== current)) {
    throw new CloudStorageConflictError(
      "다른 기기에서 먼저 변경했습니다. 최신 데이터를 다시 불러온 뒤 재시도하세요. 기존 서버 데이터는 덮어쓰지 않았습니다.",
      current,
    );
  }
}

function assertDocumentId(value: string, label: string) {
  if (!value || value.length > 500 || value.includes("/")) {
    throw new Error(`${label} ID가 올바르지 않습니다.`);
  }
}

function assertDocumentSize(value: unknown, label: string) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DETAIL_BYTES) {
    throw new Error(`${label} 데이터가 Firestore 문서 제한에 가깝습니다.`);
  }
}

function cleanFirestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripOwner<T extends Record<string, unknown>>(value: T): Omit<T, "ownerUid"> {
  const { ownerUid, ...rest } = value;
  void ownerUid;
  return rest;
}

function countDueCards(cards: Card[]) {
  const now = Date.now();
  return cards.filter((card) => {
    const dueAt = card.reviewSchedule?.dueAt;
    return dueAt ? Date.parse(dueAt) <= now : card.status === "review";
  }).length;
}

function reviewStateId(deckId: string, cardId: string) {
  return `${deckId}:${cardId}`;
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(Math.floor(limit || 100), 200));
}

function configuredBucket(defaultBucket: Bucket) {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  return bucketName ? defaultBucket.storage.bucket(bucketName) : defaultBucket;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "source.bin";
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

async function legacyImportFingerprint(deck: Deck, files: File[]) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(sortObjectKeys(deck)));
  for (const file of files) {
    hash.update(file.name);
    hash.update(String(file.lastModified));
    hash.update(Buffer.from(await file.arrayBuffer()));
  }
  return hash.digest("hex");
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    );
  }
  return value;
}
