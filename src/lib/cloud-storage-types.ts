import type {
  Card,
  Deck,
  StudyAttempt,
  StudySession,
} from "@/lib/types";

export type CloudDeckSummary = Pick<
  Deck,
  | "id"
  | "projectId"
  | "title"
  | "boardColumn"
  | "subject"
  | "tags"
  | "mode"
  | "createdAt"
  | "updatedAt"
> & {
  cardCount: number;
  dueCount: number;
  sourceCount: number;
  revision: number;
};

export type CloudDeckDetail = {
  deck: Deck;
  revision: number;
};

export type CloudStudySessionSummary = StudySession & {
  attemptCount: number;
};

export type CloudStudySessionDetail = {
  session: StudySession;
  attempts: StudyAttempt[];
};

export type CloudReviewState = {
  id: string;
  deckId: string;
  cardId: string;
  status: Card["status"];
  reviewSchedule?: Card["reviewSchedule"];
  updatedAt: string;
  lastAttemptId: string;
};

export type PdfReadingPosition = {
  sourceId: string;
  page: number;
  updatedAt: string;
  revision: number;
};

export type CloudMutationOptions = {
  expectedRevision?: number;
  operationId: string;
};

export type LegacyImportResult = {
  status: "imported" | "duplicate";
  deckId: string;
  sourceCount: number;
  fingerprint: string;
};

export class CloudStorageConflictError extends Error {
  readonly code = "revision-conflict";
  constructor(
    message: string,
    readonly currentRevision: number,
  ) {
    super(message);
    this.name = "CloudStorageConflictError";
  }
}
