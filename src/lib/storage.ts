"use client";

import type {
  Deck,
  DeckBoardColumn,
  StudyAttempt,
  StudySession,
  StoredPdfSource,
} from "@/lib/types";
import type {
  PdfReadingPosition,
  PdfReadingPositionState,
} from "@/lib/cloud-storage-types";
import { CloudStorageConflictError } from "@/lib/cloud-storage-types";

const DB_NAME = "memory-transformer";
const DB_VERSION = 4;
const DECK_STORE = "decks";
const SESSION_STORE = "study-sessions";
const ATTEMPT_STORE = "study-attempts";
const PDF_SOURCE_STORE = "pdf-sources";

export async function getPdfReadingPosition(
  sourceId: string,
): Promise<PdfReadingPosition | null> {
  const response = await fetch(
    `/api/user-data/pdf-reading/${encodeURIComponent(sourceId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as PdfReadingPositionState & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "PDF 읽기 위치를 불러오지 못했습니다.");
  }
  return payload.position ?? null;
}

export async function getPdfReadingPositionState(
  sourceId: string,
): Promise<PdfReadingPositionState> {
  const response = await fetch(
    `/api/user-data/pdf-reading/${encodeURIComponent(sourceId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as PdfReadingPositionState & {
    message?: string;
  };
  if (!response.ok || !payload.state) {
    throw new Error(payload.message ?? "PDF 읽기 위치 상태를 확인하지 못했습니다.");
  }
  return payload;
}

export async function savePdfReadingPosition(
  sourceId: string,
  page: number,
  expectedRevision?: number,
): Promise<PdfReadingPosition> {
  const operationId = crypto.randomUUID();
  const response = await fetchWithSingleRetry(
    `/api/user-data/pdf-reading/${encodeURIComponent(sourceId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, expectedRevision, operationId }),
    },
  );
  const payload = (await response.json()) as {
    position?: PdfReadingPosition;
    message?: string;
    currentRevision?: number;
  };
  if (!response.ok || !payload.position) {
    if (response.status === 409 && typeof payload.currentRevision === "number") {
      throw new CloudStorageConflictError(
        payload.message ?? "다른 기기에서 PDF 읽기 위치를 변경했습니다.",
        payload.currentRevision,
      );
    }
    throw new Error(payload.message ?? "PDF 읽기 위치를 저장하지 못했습니다.");
  }
  return payload.position;
}

async function fetchWithSingleRetry(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    return fetch(input, init);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DECK_STORE)) {
        db.createObjectStore(DECK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("deckId", "deckId", { unique: false });
        sessions.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains(ATTEMPT_STORE)) {
        const attempts = db.createObjectStore(ATTEMPT_STORE, { keyPath: "id" });
        attempts.createIndex("sessionId", "sessionId", { unique: false });
        attempts.createIndex("activityId", "activityId", { unique: false });
      }
      if (!db.objectStoreNames.contains(PDF_SOURCE_STORE)) {
        const sources = db.createObjectStore(PDF_SOURCE_STORE, { keyPath: "id" });
        sources.createIndex("deckId", "deckId", { unique: false });
      }

      if (event.oldVersion === 2 && request.transaction) {
        migrateV2StudySessions(request.transaction);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function migrateV2StudySessions(transaction: IDBTransaction) {
  const sessions = transaction.objectStore(SESSION_STORE);
  const decks = transaction.objectStore(DECK_STORE);
  const cursorRequest = sessions.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const session = cursor.value as StudySession & {
      selectionMode?: StudySession["selectionMode"];
      plannedActivityIds?: string[];
    };
    if (session.selectionMode && session.plannedActivityIds) {
      cursor.continue();
      return;
    }

    const deckRequest = decks.get(session.deckId);
    deckRequest.onsuccess = () => {
      const deck = deckRequest.result as Deck | undefined;
      const plannedActivityIds = (deck?.cards ?? [])
        .slice(0, session.plannedItemCount)
        .map((card) => card.id);
      cursor.update({
        ...session,
        selectionMode: "all",
        plannedActivityIds,
        plannedItemCount: plannedActivityIds.length,
      });
      cursor.continue();
    };
  };
}

export async function saveStudySession(session: StudySession): Promise<void> {
  const db = await openDb();
  await completeTransaction(db, [SESSION_STORE], "readwrite", (tx) => {
    tx.objectStore(SESSION_STORE).put(session);
  });
  db.close();
}

export async function startStudySession(
  deck: Deck,
  session: StudySession,
): Promise<void> {
  assertValidStudyPlan(session);
  const db = await openDb();
  await completeTransaction(
    db,
    [DECK_STORE, SESSION_STORE],
    "readwrite",
    (tx) => {
      tx.objectStore(DECK_STORE).put(deck);
      tx.objectStore(SESSION_STORE).add(session);
    },
  );
  db.close();
}

export async function saveStudyProgress(input: {
  deck: Deck;
  session: StudySession;
  attempt: StudyAttempt;
}): Promise<void> {
  assertValidStudyPlan(input.session);
  if (!input.session.plannedActivityIds.includes(input.attempt.activityId)) {
    throw new Error("StudyAttempt activity is not part of the session plan.");
  }
  const db = await openDb();
  await completeTransaction(
    db,
    [DECK_STORE, SESSION_STORE, ATTEMPT_STORE],
    "readwrite",
    (tx) => {
      tx.objectStore(DECK_STORE).put(input.deck);
      tx.objectStore(SESSION_STORE).put(input.session);
      tx.objectStore(ATTEMPT_STORE).add(input.attempt);
    },
  );
  db.close();
}

export async function listStudySessions(): Promise<StudySession[]> {
  const db = await openDb();
  const sessions = await getAll<StudySession>(db, SESSION_STORE);
  db.close();
  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function listStudyAttempts(
  sessionId?: string,
): Promise<StudyAttempt[]> {
  const db = await openDb();
  const attempts = await new Promise<StudyAttempt[]>((resolve, reject) => {
    const tx = db.transaction(ATTEMPT_STORE, "readonly");
    const store = tx.objectStore(ATTEMPT_STORE);
    const request = sessionId
      ? store.index("sessionId").getAll(sessionId)
      : store.getAll();
    request.onsuccess = () => resolve(request.result as StudyAttempt[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return attempts.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

export async function saveDeck(deck: Deck): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    tx.objectStore(DECK_STORE).put(deck);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveDeckWithPdfSources(
  deck: Deck,
  files: File[],
): Promise<Deck> {
  const sources: StoredPdfSource[] = files.map((file, index) => ({
    id: `${deck.id}:pdf:${index + 1}`,
    deckId: deck.id,
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    lastModified: file.lastModified,
    blob: file,
  }));
  const savedDeck = {
    ...deck,
    pdfSourceIds: sources.map((source) => source.id),
  };
  const db = await openDb();
  await completeTransaction(
    db,
    [DECK_STORE, PDF_SOURCE_STORE],
    "readwrite",
    (tx) => {
      tx.objectStore(DECK_STORE).put(savedDeck);
      const sourceStore = tx.objectStore(PDF_SOURCE_STORE);
      for (const source of sources) sourceStore.put(source);
    },
  );
  db.close();
  return savedDeck;
}

export async function loadDeckPdfFiles(deckId: string): Promise<File[]> {
  const db = await openDb();
  const sources = await new Promise<StoredPdfSource[]>((resolve, reject) => {
    const tx = db.transaction(PDF_SOURCE_STORE, "readonly");
    const request = tx.objectStore(PDF_SOURCE_STORE).index("deckId").getAll(deckId);
    request.onsuccess = () => resolve(request.result as StoredPdfSource[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return sources
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) => new File([source.blob], source.fileName, {
      type: source.mimeType,
      lastModified: source.lastModified,
    }));
}

export async function listDecks(): Promise<Deck[]> {
  const db = await openDb();
  const decks = await new Promise<Deck[]>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readonly");
    const request = tx.objectStore(DECK_STORE).getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as Array<Deck & { boardColumn?: DeckBoardColumn }>).map(
          normalizeDeck,
        ),
      );
    request.onerror = () => reject(request.error);
  });
  db.close();
  return decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const listLegacyDecks = listDecks;

export async function importLegacyDeckToCloud(
  deckId: string,
): Promise<import("@/lib/cloud-storage-types").LegacyImportResult> {
  const decks = await listLegacyDecks();
  const deck = decks.find((item) => item.id === deckId);
  if (!deck) throw new Error("가져올 로컬 덱을 찾지 못했습니다.");
  const files = await loadDeckPdfFiles(deckId);
  const { importLegacyDeckData } = await import("@/lib/cloud-storage-client");
  return importLegacyDeckData(deck, files);
}

function normalizeDeck(
  deck: Deck & { boardColumn?: DeckBoardColumn },
): Deck {
  if (deck.boardColumn) return deck;

  const boardColumn: DeckBoardColumn =
    deck.cards.length > 0 && deck.cards.every((card) => card.status === "known")
      ? "completed"
      : deck.cards.some((card) => card.status !== "new")
        ? "learning"
        : "new";

  return { ...deck, boardColumn };
}

export async function deleteDeck(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [DECK_STORE, SESSION_STORE, ATTEMPT_STORE, PDF_SOURCE_STORE],
      "readwrite",
    );
    tx.objectStore(DECK_STORE).delete(id);
    const sourceStore = tx.objectStore(PDF_SOURCE_STORE);
    const sourceKeysRequest = sourceStore.index("deckId").getAllKeys(id);
    sourceKeysRequest.onsuccess = () => {
      for (const sourceId of sourceKeysRequest.result) sourceStore.delete(sourceId);
    };
    const sessionStore = tx.objectStore(SESSION_STORE);
    const attemptStore = tx.objectStore(ATTEMPT_STORE);
    const sessionsRequest = sessionStore.index("deckId").getAllKeys(id);
    sessionsRequest.onsuccess = () => {
      for (const sessionId of sessionsRequest.result) {
        sessionStore.delete(sessionId);
        const attemptsRequest = attemptStore
          .index("sessionId")
          .getAllKeys(sessionId);
        attemptsRequest.onsuccess = () => {
          for (const attemptId of attemptsRequest.result) {
            attemptStore.delete(attemptId);
          }
        };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function completeTransaction(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    run(tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function assertValidStudyPlan(session: StudySession) {
  if (
    session.plannedItemCount === 0 ||
    session.plannedItemCount !== session.plannedActivityIds.length
  ) {
    throw new Error("StudySession plan count does not match its activity IDs.");
  }
}
