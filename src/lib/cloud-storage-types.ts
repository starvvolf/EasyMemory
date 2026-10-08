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

export type CloudStudySessionSummary = Pick<
  StudySession,
  | "id"
  | "deckId"
  | "activityType"
  | "startedAt"
  | "endedAt"
  | "status"
  | "selectionMode"
  | "plannedItemCount"
  | "completedItemCount"
> & {
  attemptCount: number;
  revision: number;
};

export type CloudStudySessionDetail = {
  session: StudySession;
  attempts: StudyAttempt[];
  revision: number;
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

export type PdfReadingPositionState =
  | { state: "ready"; position: PdfReadingPosition | null }
  | { state: "import_required"; position: null };

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

export class CloudSourceImportRequiredError extends Error {
  readonly code = "source-import-required";
  constructor() {
    super("이 PDF는 아직 계정 저장소로 가져오지 않았습니다. 먼저 명시적 가져오기를 실행하세요.");
    this.name = "CloudSourceImportRequiredError";
  }
}
