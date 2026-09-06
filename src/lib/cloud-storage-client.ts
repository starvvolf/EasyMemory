"use client";

import type {
  CloudDeckDetail,
  CloudDeckSummary,
  CloudStudySessionDetail,
  CloudStudySessionSummary,
  LegacyImportResult,
} from "@/lib/cloud-storage-types";
import { CloudStorageConflictError } from "@/lib/cloud-storage-types";
import type { Deck, StudyAttempt, StudySession } from "@/lib/types";

export async function listCloudDeckSummaries(limit = 100) {
  return requestJson<{ decks: CloudDeckSummary[] }>(
    `/api/user-data/decks?limit=${encodeURIComponent(limit)}`,
  ).then((payload) => payload.decks);
}

export async function loadCloudDeckDetail(deckId: string) {
  return requestJson<CloudDeckDetail>(
    `/api/user-data/decks/${encodeURIComponent(deckId)}`,
  );
}

export async function saveCloudDeckData(
  deck: Deck,
  expectedRevision?: number,
) {
  return requestJson<{ result: CloudDeckDetail }>("/api/user-data/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deck,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  }, true).then((payload) => payload.result);
}

export async function deleteCloudDeckData(deckId: string, expectedRevision: number) {
  const response = await fetchWithNetworkRetry(
    `/api/user-data/decks/${encodeURIComponent(deckId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision,
        operationId: crypto.randomUUID(),
      }),
    },
    true,
  );
  if (response.status === 204) return;
  const payload = (await response.json()) as {
    message?: string;
    currentRevision?: number;
  };
  if (response.status === 409 && typeof payload.currentRevision === "number") {
    throw new CloudStorageConflictError(
      payload.message ?? "다른 기기에서 먼저 변경했습니다.",
      payload.currentRevision,
    );
  }
  throw new Error(payload.message ?? "덱을 삭제하지 못했습니다.");
}

export async function listCloudStudySessionSummaries(input: {
  deckId?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (input.deckId) search.set("deckId", input.deckId);
  search.set("limit", String(input.limit ?? 100));
  return requestJson<{ sessions: CloudStudySessionSummary[] }>(
    `/api/user-data/study-sessions?${search}`,
  ).then((payload) => payload.sessions);
}

export async function loadCloudStudySessionDetail(sessionId: string) {
  return requestJson<CloudStudySessionDetail>(
    `/api/user-data/study-sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function startCloudStudySessionData(
  deck: Deck,
  session: StudySession,
  expectedRevision: number,
) {
  return requestJson<{
    session: StudySession;
    deckRevision: number;
    sessionRevision: number;
  }>("/api/user-data/study-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deck,
      session,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  }, true);
}

export async function saveCloudStudySessionData(
  session: StudySession,
  expectedRevision: number,
) {
  return requestJson<{ session: StudySession; revision: number }>(
    `/api/user-data/study-sessions/${encodeURIComponent(session.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session,
        expectedRevision,
        operationId: crypto.randomUUID(),
      }),
    },
    true,
  );
}

export async function saveCloudStudyProgressData(
  input: { deck: Deck; session: StudySession; attempt: StudyAttempt },
  expectedRevision: number,
) {
  return requestJson<{
    ok: true;
    deckRevision: number;
    sessionRevision: number;
  }>("/api/user-data/study-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  }, true);
}

export async function importLegacyDeckData(deck: Deck, files: File[]) {
  const formData = new FormData();
  formData.set("deck", JSON.stringify(deck));
  files.forEach((file) => formData.append("pdfs", file));
  return requestJson<{ result: LegacyImportResult }>(
    "/api/user-data/legacy-import",
    { method: "POST", body: formData },
    true,
  ).then((payload) => payload.result);
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryNetworkFailure = false,
): Promise<T> {
  const response = await fetchWithNetworkRetry(input, init, retryNetworkFailure);
  const payload = (await response.json()) as T & {
    message?: string;
    currentRevision?: number;
  };
  if (!response.ok) {
    if (response.status === 409 && typeof payload.currentRevision === "number") {
      throw new CloudStorageConflictError(
        payload.message ?? "다른 기기에서 먼저 변경했습니다.",
        payload.currentRevision,
      );
    }
    throw new Error(payload.message ?? "계정 저장소 요청에 실패했습니다.");
  }
  return payload;
}

async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryNetworkFailure = false,
) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!retryNetworkFailure) throw offlineError(error);
    try {
      return await fetch(input, init);
    } catch (retryError) {
      throw offlineError(retryError);
    }
  }
}

function offlineError(error: unknown) {
  return new Error(
    error instanceof Error
      ? `네트워크에 연결할 수 없어 저장하지 않았습니다: ${error.message}`
      : "네트워크에 연결할 수 없어 저장하지 않았습니다.",
  );
}
